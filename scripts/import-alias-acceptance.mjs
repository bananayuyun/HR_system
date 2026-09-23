import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// This diagnostic intentionally targets only the isolated local test service.
const base = 'http://127.0.0.1:8091/api';
const root = path.resolve(import.meta.dirname, '..');
const tag = `QAALIAS${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const employeeId = tag;
const startedUtc = new Date().toISOString();
let cookie = '';
const results = [],
  fixtures = [],
  previews = [],
  cleanup = [];
const snapshots = new Map();

async function call(method, route, body, expected = 200) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:5180',
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length) cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${method} ${route}: ${text}`);
  return data;
}

async function check(name, action) {
  try {
    await action();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function createRenamedFixture(key) {
  const before = (await call('GET', `/settings/${key}`)).items;
  snapshots.set(key, before);
  const originalName = `${tag}_${key}`;
  const renamedName = `${originalName}_RENAMED`;
  const created = await call('PUT', `/settings/${key}`, {
    items: [...before, { name: originalName, status: '启用' }],
  });
  const item = created.items.find((value) => value.name === originalName);
  assert.ok(item?.id, `Fixture not returned for ${key}`);
  const fixture = { key, id: item.id, originalName, renamedName };
  fixtures.push(fixture);
  const renamed = await call('PUT', `/settings/${key}`, {
    items: created.items.map((value) =>
      value.id === item.id ? { ...value, name: renamedName } : value,
    ),
  });
  const updated = renamed.items.find((value) => value.id === item.id);
  assert.ok(updated.aliases.includes(originalName), `Alias not retained for ${key}`);
  return fixture;
}

async function preview(label, row) {
  const response = await call('POST', '/imports/emps', {
    fileName: `${tag}-${label}.xlsx`,
    fileHash: crypto.createHash('sha256').update(JSON.stringify({ tag, label, row })).digest('hex'),
    rows: [row],
    mode: 'update',
    validateOnly: true,
  });
  previews.push({ label, input: row, response });
  return response;
}

try {
  await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  await call('GET', `/emps/${employeeId}`, undefined, 404);
  const region = await createRenamedFixture('workRegion');
  const company = await createRenamedFixture('contractCompany');
  const row = {
    id: employeeId,
    name: '字典别名预检专用',
    dept: 'ORG_18',
    workRegion: region.renamedName,
    contractCompany: company.renamedName,
  };
  const canonical = await preview('canonical', row);
  await check('Canonical dictionary names pass employee import preview', async () => {
    assert.equal(canonical.errorCount, 0, JSON.stringify(canonical.rows));
    assert.equal(canonical.added, 1);
  });
  const oldRegion = await preview('region-alias', { ...row, workRegion: region.originalName });
  await check('Old workRegion alias behaves like its canonical name', async () => {
    assert.equal(oldRegion.errorCount, canonical.errorCount, JSON.stringify(oldRegion.rows));
    assert.equal(oldRegion.added, canonical.added);
  });
  const oldCompany = await preview('company-alias', {
    ...row,
    contractCompany: company.originalName,
  });
  await check('Old contractCompany alias behaves like its canonical name', async () => {
    assert.equal(oldCompany.errorCount, canonical.errorCount, JSON.stringify(oldCompany.rows));
    assert.equal(oldCompany.added, canonical.added);
  });
  await check('Preview did not persist the synthetic employee', async () => {
    await call('GET', `/emps/${employeeId}`, undefined, 404);
  });
} catch (error) {
  results.push({
    name: 'Fixture setup or preview execution',
    status: 'FAIL',
    error: error.message,
  });
  console.error(error.message);
} finally {
  for (const fixture of [...fixtures].reverse()) {
    try {
      await call('DELETE', `/settings/${fixture.key}/${fixture.id}`);
      const items = (await call('GET', `/settings/${fixture.key}`)).items;
      assert.ok(!items.some((item) => item.id === fixture.id));
      assert.deepEqual(items, snapshots.get(fixture.key), 'Existing dictionary items changed');
      cleanup.push({
        key: fixture.key,
        itemId: fixture.id,
        deleted: true,
        originalItemsUnchanged: true,
      });
    } catch (error) {
      cleanup.push({ key: fixture.key, itemId: fixture.id, deleted: false, error: error.message });
      results.push({
        name: `Cleanup ${fixture.key} fixture`,
        status: 'FAIL',
        error: error.message,
      });
    }
  }
  if (cookie) {
    try {
      await call('POST', '/auth/logout', {});
    } catch (error) {
      results.push({ name: 'Logout', status: 'FAIL', error: error.message });
    }
  }
}

const report = {
  run: tag,
  environment: base,
  startedUtc,
  finishedUtc: new Date().toISOString(),
  command: 'node scripts/import-alias-acceptance.mjs',
  validationOnly: true,
  employeeId,
  fixtures,
  previews,
  results,
  cleanup,
  passed: results.filter((item) => item.status === 'PASS').length,
  failed: results.filter((item) => item.status === 'FAIL').length,
};
await fs.mkdir(path.join(root, '.local/verification'), { recursive: true });
await fs.writeFile(
  path.join(root, '.local/verification/import-alias.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, cleanup }));
process.exitCode = report.failed ? 1 : 0;
