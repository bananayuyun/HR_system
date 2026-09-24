import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'),
  base = 'http://127.0.0.1:8091/api';
const tag = 'CFG' + Date.now().toString(36).toUpperCase(),
  results = [];
let cookie = '',
  originalRules,
  sequenceName = tag;
async function call(method, url, body, expected = 200) {
  const response = await fetch(base + url, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:5175',
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.headers.getSetCookie().length)
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function check(name, run) {
  try {
    await run();
    results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    console.error('FAIL ' + name + ': ' + error.message);
  }
}
await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
try {
  await check('An unused new sequence persists in settings and bootstrap', async () => {
    const current = (await call('GET', '/settings/sequences')).items;
    await call('PUT', '/settings/sequences', { items: [...current, tag] });
    assert.ok((await call('GET', '/settings/sequences')).items.includes(tag));
    assert.ok((await call('GET', '/bootstrap')).sequences.includes(tag));
  });
  await check('Explicit rename persists an unused sequence', async () => {
    const renamed = tag + 'RENAMED';
    await call('PUT', '/settings/sequences', { rename: { from: tag, to: renamed } });
    sequenceName = renamed;
    const bootstrap = await call('GET', '/bootstrap');
    assert.ok(bootstrap.sequences.includes(renamed));
    assert.ok(!bootstrap.sequences.includes(tag));
  });
  await check('Sequence duplicate names and removal while referenced are rejected', async () => {
    const current = (await call('GET', '/settings/sequences')).items;
    const referenced = '管理 M';
    await call(
      'PUT',
      '/settings/sequences',
      { items: current.filter((name) => name !== referenced) },
      409,
    );
    await call('PUT', '/settings/sequences', { items: [...current, current[0]] }, 400);
    await call(
      'PUT',
      '/settings/sequences',
      { rename: { from: referenced, to: current.find((name) => name !== referenced) } },
      409,
    );
  });
  await check('Reminder API rejects over-three, duplicate and non-HH:mm times', async () => {
    originalRules = await call('GET', '/settings/reminders');
    for (const times of [
      ['09:00', '10:00', '11:00', '12:00'],
      ['09:00', '09:00'],
      ['09:00:00'],
      ['24:00'],
    ])
      await call('PUT', '/settings/reminders', { enabled: true, workdays: true, times }, 400);
    const saved = await call('PUT', '/settings/reminders', {
      enabled: true,
      workdays: false,
      times: ['09:15', '15:45'],
    });
    assert.deepEqual(saved.times, ['09:15', '15:45']);
    assert.deepEqual((await call('GET', '/settings/reminders')).times, ['09:15', '15:45']);
  });
} finally {
  if (originalRules) await call('PUT', '/settings/reminders', originalRules);
  const current = (await call('GET', '/settings/sequences')).items;
  await call('PUT', '/settings/sequences', {
    items: current.filter((name) => name !== tag && name !== sequenceName),
  });
  await call('POST', '/auth/logout', {});
}
const report = {
  target: base,
  tag,
  results,
  passed: results.filter((r) => r.status === 'PASS').length,
  failed: results.filter((r) => r.status === 'FAIL').length,
  cleanup:
    'Reminder rules restored and unused synthetic sequence removed',
};
await fs.mkdir(path.join(root, '.local/verification'), { recursive: true });
await fs.writeFile(
  path.join(root, '.local/verification/configuration.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ passed: report.passed, failed: report.failed }));
if (report.failed) process.exitCode = 1;
