import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..'),
  require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(process.env.HR_NODE_MODULES || path.join(root, 'frontend/node_modules'), 'playwright'),
);
const base = 'http://127.0.0.1:5175',
  tag = 'SEQ' + Date.now().toString(36).toUpperCase(),
  out = path.join(root, '.local/verification/browser');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.HR_BROWSER_PATH ? { executablePath: process.env.HR_BROWSER_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let done = false;
async function call(method, url, data, expected = 200) {
  const response = await context.request.fetch(base + '/api' + url, {
    method,
    headers: { Origin: base },
    ...(data ? { data } : {}),
  });
  const body = await response.json();
  assert.equal(response.status(), expected, JSON.stringify(body));
  return body;
}
try {
  await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert.equal((await context.request.get('http://127.0.0.1:8091/api/auth/me')).status(), 200);
  await page.goto(base + '/#/grades', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '管理职务序列', exact: true }).click();
  await page.getByLabel('新增序列名称', { exact: true }).fill(tag);
  await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
  await page.locator('#sequence-list .v-columns').filter({ hasText: tag }).waitFor();
  assert.ok((await call('GET', '/bootstrap')).sequences.includes(tag));
  await page
    .locator('#sequence-list .v-columns')
    .filter({ hasText: tag })
    .getByRole('button', { name: '重命名', exact: true })
    .click();
  await page.getByLabel('序列名称', { exact: true }).fill(tag + 'NEW');
  await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
  await page
    .locator('#sequence-list .v-columns')
    .filter({ hasText: tag + 'NEW' })
    .waitFor();
  assert.ok((await call('GET', '/bootstrap')).sequences.includes(tag + 'NEW'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '管理职务序列', exact: true }).click();
  const referenced = page.locator('#sequence-list .v-columns').filter({ hasText: '管理 M' });
  await referenced.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '已关联职级' }).waitFor();
  await page.locator('#sequence-list .v-columns').filter({ hasText: tag + 'NEW' })
    .getByRole('button', { name: '删除', exact: true }).click();
  await page.locator('#sequence-list .v-columns').filter({ hasText: tag + 'NEW' })
    .waitFor({ state: 'detached' });
  await page.getByLabel('新增序列名称', { exact: true }).fill(tag + 'UNUSED');
  await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
  await page
    .locator('#sequence-list .v-columns')
    .filter({ hasText: tag + 'UNUSED' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page
    .locator('#sequence-list .v-columns')
    .filter({ hasText: tag + 'UNUSED' })
    .waitFor({ state: 'detached' });
  assert.ok(!(await call('GET', '/bootstrap')).sequences.includes(tag + 'UNUSED'));
  assert.deepEqual(errors, []);
  done = true;
  await fs.mkdir(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'sequences.png') });
  console.log(
    'PASS: real sequence UI add, reload, unused rename/delete and referenced-delete rejection.',
  );
} finally {
  const list = (await call('GET', '/settings/sequences')).items;
  await call('PUT', '/settings/sequences', {
    items: list.filter((name) => ![tag, tag + 'NEW', tag + 'UNUSED'].includes(name)),
  });
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(
    path.join(out, 'sequences-report.json'),
    JSON.stringify(
      {
        base,
        tag,
        passed: done,
        errors,
        cleanup: 'Synthetic unused sequences removed',
      },
      null,
      2,
    ),
  );
  await browser.close();
}
