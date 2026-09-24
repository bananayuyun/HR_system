import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = 'http://127.0.0.1:8091/api';
const marker = await fetch('http://127.0.0.1:8091/__acceptance/identity')
  .then((response) => response.text())
  .catch(() => '');
if (marker !== 'mock-user-center-v1') throw new Error('Run only against the isolated acceptance backend.');

function client() {
  let cookie = '';
  return async (method, route, body, expected = 200) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        Origin: 'http://127.0.0.1:5175',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map((part) => part.split(';')[0]).join('; ');
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
    return result;
  };
}

const first = client();
const second = client();
await first('POST', '/auth/login', { username: 'manager', password: 'wrong' }, 401);
const signedIn = await first('POST', '/auth/login', {
  username: 'manager',
  password: 'manager123',
});
assert.equal(signedIn.user.authSource, 'userCenter');
assert.equal(signedIn.user.dataScope, 'SELF_ORG_TREE');
await second('POST', '/auth/login', { username: 'manager', password: 'manager123' });
const refused = await first('POST', '/auth/password', {
  oldPassword: 'manager123',
  newPassword: 'another-password',
}, 400);
assert.match(refused.message, /用户中心修改密码/);
assert.equal((await first('GET', '/auth/me')).user.username, 'manager');
assert.equal((await second('GET', '/auth/me')).user.username, 'manager');
await first('POST', '/auth/logout', {});
await first('GET', '/auth/me', undefined, 401);
assert.equal((await second('GET', '/auth/me')).user.username, 'manager');

const report = {
  generatedAt: new Date().toISOString(),
  checks: [
    'Mock user-center rejects an invalid password',
    'Current login records user-center source and department scope',
    'Local password change is refused without ending active sessions',
    'Logout ends only the current session',
  ],
};
const output = path.resolve(import.meta.dirname, '../.local/verification/auth-contract.json');
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.checks.length, failed: 0 }));
