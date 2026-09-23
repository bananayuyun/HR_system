import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, '../..');
const modules = process.env.HR_NODE_MODULES || path.resolve(import.meta.dirname, '../node_modules');
const { chromium } = require(path.join(modules, 'playwright'));
const { PNG } = require(path.join(modules, 'pngjs'));
const pm = require(path.join(modules, 'pixelmatch')),
  pixelmatch = pm.default || pm;
const fixture = JSON.parse(
  await fs.readFile(path.join(root, '.local/prototype/state.json'), 'utf8'),
);
const data = structuredClone(fixture.data),
  out = path.join(root, 'frontend/test-artifacts/dialogs');
await fs.mkdir(out, { recursive: true });
const user = {
  username: 'admin',
  displayName: '许 HR',
  role: 'hr',
  permissions: ['*'],
  menus: Object.keys(fixture.routes),
  departmentId: 'ORG_18',
};
data.user = user;
data.baseSettings = Object.fromEntries(
  Object.entries({
    workRegion: ['上海', '南京'],
    workplace: ['上海', '南京', '宁波', '西安', '长沙', '郑州', '诸暨'],
    contractCompany: [
      '微间',
      '旦尺',
      '方之达',
      '佛豪斯',
      '宁波舜变',
      '青衿智创',
      '上海数寰',
      '上海有间',
      '致臻',
      '中数求索',
      '中数求索（外包）',
      '中数信息',
    ],
  }).map(([key, names]) => [key, names.map((name, i) => ({ id: i + 1, name, status: '启用' }))]),
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.HR_BROWSER_PATH,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  results = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/api/**', async (route) => {
  const p = new URL(route.request().url()).pathname.slice(4);
  let value = {};
  if (p === '/auth/me') value = { user };
  else if (p === '/bootstrap') value = data;
  else if (/^\/(emps|orgs|jobs|grades|reqs|candidates|assets)\/[^/]+$/.test(p)) {
    const [, type, id] = p.split('/');
    value = data[type].find((r) => r.id === id);
  } else if (p.startsWith('/settings/')) value = data.baseSettings[p.split('/')[2]] || [];
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value),
  });
});
let visitIndex = 0;
async function visit(route) {
  await page.goto(
    (process.env.HR_FRONTEND_URL || 'http://127.0.0.1:5180') +
      '/?verify=' +
      visitIndex++ +
      '#/' +
      route,
    { waitUntil: 'networkidle' },
  );
  await page.evaluate(() => document.fonts.ready);
}
async function capture(name, width) {
  const dialog = page.getByRole('dialog').last();
  await dialog.waitFor();
  const box = await dialog.boundingBox();
  assert.equal(box.width, width, name + ' width');
  const fields = await dialog.locator('.v-field>label').allTextContents();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const image = await page.screenshot({ path: path.join(out, name + '.png') });
  let differencePercent = null;
  try {
    const reference = await fs
        .readFile(path.join(root, '.local/prototype', name + '.png'))
        .catch(() =>
          fs.readFile(path.join(root, 'frontend/test-artifacts/prototype-extra', name + '.png')),
        ),
      before = PNG.sync.read(reference),
      after = PNG.sync.read(image),
      x = Math.ceil(box.x) + 2,
      w = Math.floor(box.width) - 4,
      h = after.height;
    const a = new PNG({ width: w, height: h }),
      b = new PNG({ width: w, height: h }),
      diff = new PNG({ width: w, height: h });
    PNG.bitblt(before, a, x, 0, w, h, 0, 0);
    PNG.bitblt(after, b, x, 0, w, h, 0, 0);
    differencePercent = Number(
      ((pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.12 }) / (w * h)) * 100).toFixed(
        3,
      ),
    );
    await fs.writeFile(path.join(out, name + '-diff.png'), PNG.sync.write(diff));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  results.push({ name, width: box.width, fields, differencePercent });
  return dialog;
}
for (const route of ['jobs', 'grades', 'reqs', 'roster']) {
  await visit(route);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await capture(route + '-add', route === 'grades' ? 528 : 1056);
}
await visit('roster');
await page
  .locator('.v-actions button')
  .filter({ hasText: /^查看$/ })
  .first()
  .click();
await capture('roster-detail', 528);
await page.getByRole('button', { name: '编辑基本信息', exact: true }).click();
await capture('employee-basic-edit', 528);
await visit('assets');
await page
  .locator('.v-actions button')
  .filter({ hasText: /^编辑$/ })
  .first()
  .click();
await capture('assets-edit', 528);
await page.getByRole('button', { name: '领用', exact: true }).click();
await capture('assets-assign', 528);
await visit('interviews');
await page
  .locator('.v-actions button')
  .filter({ hasText: /^改期$/ })
  .first()
  .click();
await capture('schedule', 528);
await visit('offers');
await page
  .locator('.v-actions button')
  .filter({ hasText: /^确认入职$/ })
  .first()
  .click();
await capture('onboarding', 528);
await visit('offers');
await page
  .locator('.v-actions button')
  .filter({ hasText: /^取消入职$/ })
  .first()
  .click();
await capture('cancel-onboarding', 528);
for (const route of ['pool', 'screening']) {
  await visit(route);
  await page
    .locator('.v-actions button')
    .filter({ hasText: /^查看$/ })
    .first()
    .click();
  const dialog = await capture(route + '-detail', 1056);
  assert.deepEqual(await dialog.locator('.v-tabs button').allTextContents(), [
    '简历信息',
    '面试记录',
    '录用信息',
    '操作记录',
  ]);
  await dialog.getByRole('button', { name: '录用信息', exact: true }).click();
  assert.match(await dialog.locator('.modal-b').innerText(), /未接入/);
}
await visit('roster');
await page.getByRole('button', { name: '修改密码', exact: true }).click();
await capture('password', 528);
await browser.close();
assert.deepEqual(errors, []);
await fs.writeFile(
  path.join(out, 'report.json'),
  JSON.stringify({ mode: 'prototype fixture; no persistence claims', results, errors }, null, 2),
);
console.log(JSON.stringify({ passed: results.length, errors, results }, null, 2));
