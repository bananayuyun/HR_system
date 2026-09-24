import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const base = 'http://127.0.0.1:8091/api';
const origin = 'http://127.0.0.1:5175';
const prefix = `UNBOUND${Date.now().toString(36).toUpperCase()}`;
let cookie = '';

async function call(method, route, body, status = 200) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((part) => part.split(';')[0]).join('; ');
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
  return result;
}

function batch(row, suffix, defaultOwnerId) {
  return {
    fileName: `${prefix}${suffix}.xlsx`,
    fileHash: crypto.createHash('sha256').update(`${prefix}${suffix}`).digest('hex'),
    rows: [row],
    mode: 'update',
    ...(defaultOwnerId ? { defaultOwnerId } : {}),
  };
}

const login = await call('POST', '/auth/login', {
  username: 'qa_unbound',
  password: 'qa123',
});
assert.equal(login.user.role, 'hr');
assert.equal(login.user.authSource, 'userCenter');
const bootstrap = await call('GET', '/bootstrap');
const job = await call('POST', '/jobs', {
  id: `${prefix}J`,
  name: `${prefix}岗位`,
  dept: 'ORG_18',
  headcount: 20,
  status: '启用',
});
const row = {
  id: `${prefix}R`,
  name: `${prefix}需求`,
  dept: '开发部',
  job: job.id,
  count: 1,
  salaryMin: 10,
  salaryMax: 20,
  location: bootstrap.baseSettings.workRegion.find((item) => item.status === '启用').name,
  office: bootstrap.baseSettings.workplace.find((item) => item.status === '启用').name,
  company: bootstrap.baseSettings.contractCompany.find((item) => item.status === '启用').name,
  deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  screener: 'E0002',
  first: 'E0002',
  second: 'E0002',
};

const missing = await call('POST', '/imports/reqs', {
  ...batch(row, '-missing'),
  validateOnly: true,
});
assert.equal(missing.errorCount, 1);
assert.match(missing.rows[0].errors.join(' '), /默认 HR 负责人/);

const selected = batch(row, '-selected', 'E0005');
const preview = await call('POST', '/imports/reqs', { ...selected, validateOnly: true });
assert.equal(preview.added, 1, JSON.stringify(preview));
assert.equal(preview.errorCount, 0);
await call('GET', `/reqs/${row.id}`, undefined, 404);
const imported = await call('POST', '/imports/reqs', selected);
assert.equal(imported.added, 1, JSON.stringify(imported));
assert.deepEqual((await call('GET', `/reqs/${row.id}`)).ownerIds, ['E0005']);

const explicit = { ...row, id: `${prefix}R2`, owner: 'E0002' };
const explicitResult = await call('POST', '/imports/reqs', batch(explicit, '-explicit', 'E0005'));
assert.equal(explicitResult.added, 1, JSON.stringify(explicitResult));
assert.deepEqual((await call('GET', `/reqs/${explicit.id}`)).ownerIds, ['E0002']);

const invalid = await call('POST', '/imports/reqs', {
  ...batch({ ...row, id: `${prefix}BAD` }, '-invalid', 'NO_SUCH_EMPLOYEE'),
  validateOnly: true,
});
assert.equal(invalid.errorCount, 1);
assert.match(invalid.rows[0].errors.join(' '), /默认 HR 负责人/);
console.log('PASS unbound user-center HR account imports demands with a selected owner; explicit owner wins.');
