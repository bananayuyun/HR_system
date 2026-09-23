import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(root, 'frontend/node_modules/playwright'));
const base = 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/#/roster`);
  await page.getByLabel('账号', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('admin123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.v-content[data-page="roster"]').waitFor();
  await page.locator('.v-busy').waitFor({ state: 'hidden' });
  const response = await context.request.get(`${base}/api/bootstrap`);
  assert.equal(response.status(), 200);
  const bootstrap = await response.json();
  const employee = bootstrap.emps.find((row) => !row.deleted && !row.deletedAt);
  assert.ok(employee);
  await page.getByRole('textbox', { name: '关键词搜索' }).fill(employee.id);
  await page.getByRole('textbox', { name: '关键词搜索' }).press('Enter');
  await page.locator('.tbl tbody tr').filter({ hasText: employee.id })
    .getByRole('button', { name: '查看', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '员工档案', exact: true });
  await detail.waitFor();
  await detail.getByText('成长记录', { exact: true }).first().click();
  await detail.getByRole('button', { name: '新增成长记录', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await detail.count(), 0);
  await page.locator('.mask').click({ position: { x: 10, y: 450 } });
  await detail.waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1);
  await page.locator('.mask').click({ position: { x: 10, y: 450 } });
  await detail.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS drawer mask returns secondary panel to employee details, then closes details');
} finally {
  await browser.close();
}
