import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'),
  base = 'http://127.0.0.1:8091/api',
  tag = 'DICT' + Date.now().toString(36).toUpperCase();
let cookie = '',
  employee,
  item,
  unused;
const results = [];
async function call(method, url, body, expected = 200) {
  const r = await fetch(base + url, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:5180',
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.headers.getSetCookie().length)
    cookie = r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data;
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message });
    console.error('FAIL ' + name + ': ' + e.message);
  }
}
await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
await check('Add an independent dictionary item and persist a referencing employee', async () => {
  const items = (await call('GET', '/settings/workplace')).items;
  const r = await call('PUT', '/settings/workplace', {
    items: [...items, { name: tag, status: '启用' }, { name: tag + 'UNUSED', status: '启用' }],
  });
  item = r.items.find((i) => i.name === tag);
  unused = r.items.find((i) => i.name === tag + 'UNUSED');
  assert.ok(item?.id);
  employee = await call('POST', '/emps', {
    id: tag,
    name: '字典验收' + tag,
    dept: 'ORG_18',
    status: '正式',
    workRegion: '上海',
    workplace: tag,
    contractCompany: '微间',
  });
  assert.equal(employee.workplace, tag);
});
await check(
  'Rename updates references, retains an import alias, and does not change other dictionaries',
  async () => {
    const before = (await call('GET', '/settings/workRegion')).items;
    const items = (await call('GET', '/settings/workplace')).items;
    const r = await call('PUT', '/settings/workplace', {
      items: items.map((i) => (i.id === item.id ? { ...i, name: tag + 'RENAMED' } : i)),
    });
    item = r.items.find((i) => i.id === item.id);
    assert.ok(item.aliases.includes(tag));
    employee = await call('GET', '/emps/' + employee.id);
    assert.equal(employee.workplace, tag + 'RENAMED');
    assert.equal(employee.workRegion, '上海');
    assert.deepEqual((await call('GET', '/settings/workRegion')).items, before);
  },
);
await check(
  'Disabled historical values permit other edits but cannot be selected for new records',
  async () => {
    const items = (await call('GET', '/settings/workplace')).items;
    await call('PUT', '/settings/workplace', {
      items: items.map((i) => (i.id === item.id ? { ...i, status: '停用' } : i)),
    });
    employee = await call('GET', '/emps/' + employee.id);
    employee = await call('PUT', '/emps/' + employee.id, { ...employee, notes: '历史值仍保留' });
    assert.equal(employee.notes, '历史值仍保留');
    assert.equal(employee.workplace, tag + 'RENAMED');
    await call(
      'POST',
      '/emps',
      {
        id: tag + 'INVALID',
        name: '不应创建',
        dept: 'ORG_18',
        status: '正式',
        workplace: tag + 'RENAMED',
      },
      400,
    );
  },
);
await check(
  'Used dictionary deletion is rejected; unused dictionary deletion removes the option',
  async () => {
    await call('DELETE', '/settings/workplace/' + item.id, undefined, 409);
    await call('DELETE', '/settings/workplace/' + unused.id);
    const items = (await call('GET', '/settings/workplace')).items;
    assert.ok(items.some((i) => i.id === item.id));
    assert.ok(!items.some((i) => i.id === unused.id));
  },
);
await check('Maintenance audit exposes before and after values with a real actor', async () => {
  const audit = await call('GET', '/emps/' + employee.id + '/audit');
  assert.ok(
    audit.some(
      (a) =>
        a.action === '资料变更' &&
        a.changes?.some(
          (c) =>
            ['notes', 'remark'].includes(c.field) &&
            c.label === '备注' &&
            c.before === '未填写' &&
            c.after === '历史值仍保留',
        ),
    ),
    JSON.stringify(audit),
  );
  assert.ok(audit.every((a) => a.actorName));
});
await call('POST', '/auth/logout', {});
const result = {
  run: tag,
  at: new Date().toISOString(),
  results,
  passed: results.filter((r) => r.status === 'PASS').length,
  failed: results.filter((r) => r.status === 'FAIL').length,
};
await fs.mkdir(path.join(root, '.local/verification'), { recursive: true });
await fs.writeFile(
  path.join(root, '.local/verification/settings.json'),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }));
process.exitCode = result.failed ? 1 : 0;
