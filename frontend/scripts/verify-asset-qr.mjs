import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import QRCode from 'qrcode';

const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(
    process.env.HR_NODE_MODULES || path.resolve(import.meta.dirname, '../node_modules'),
    'playwright',
  ),
);
const base = process.env.HR_FRONTEND_URL || 'http://127.0.0.1:5175';
const out = path.resolve(import.meta.dirname, '../test-artifacts/asset-qr');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.HR_BROWSER_PATH,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const login = await context.request.post(base + '/api/auth/login', {
    data: { username: 'admin', password: process.env.HR_INITIAL_ADMIN_PASSWORD || 'admin123' },
  });
  assert.equal(login.status(), 200);
  const response = await context.request.get(base + '/api/bootstrap');
  const data = await response.json();
  await page.goto(base + '/#/assets', { waitUntil: 'networkidle' });
  const asset = data.assets[0];
  await page.getByRole('textbox', { name: '关键词搜索' }).fill(asset.id);
  await page.getByRole('textbox', { name: '关键词搜索' }).press('Enter');
  await page.getByRole('button', { name: '二维码', exact: true }).first().click();
  await page.getByText('二维码内容：HR-ASSET:' + asset.id, { exact: false }).waitFor();
  const singlePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载二维码', exact: true }).click();
  const single = await singlePromise;
  assert.equal(single.suggestedFilename(), asset.id + '-二维码.svg');
  const svg = await fs.readFile(await single.path(), 'utf8');
  const segments = [{ data: 'HR-ASSET:' + asset.id, mode: 'byte' }];
  const code = QRCode.create(segments, { errorCorrectionLevel: 'M' });
  const expected = await QRCode.toString(segments, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0.8,
    width: code.modules.size * 5 + 8,
  });
  assert.equal(svg, expected, 'exported SVG encodes the original HR-ASSET protocol');
  await page.screenshot({ path: path.join(out, 'single.png') });
  await page
    .getByRole('dialog')
    .locator('.modal-f')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  const batchPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出二维码', exact: true }).click();
  const batch = await batchPromise;
  assert.match(batch.suggestedFilename(), /^资产二维码标签_\d{4}-\d{2}-\d{2}\.html$/);
  const html = await fs.readFile(await batch.path(), 'utf8');
  assert.equal((html.match(/<section class="label">/g) || []).length, 1, 'filtered asset only');
  assert.ok(html.includes(svg));
  assert.ok(html.includes('@media print'));
  assert.ok(html.includes(asset.id));
  await page.getByText('已导出 1 个可打印二维码标签。', { exact: false }).waitFor();
  assert.equal(
    await page.getByRole('dialog').count(),
    0,
    'batch exports immediately without a preview-only modal',
  );
  await page.getByRole('textbox', { name: '关键词搜索' }).fill('');
  await page.getByRole('textbox', { name: '关键词搜索' }).press('Enter');
  await page.locator('.tbl tbody tr').filter({ hasText: asset.id }).getByRole('checkbox').check();
  const selectedPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出二维码', exact: true }).click();
  const selected = await selectedPromise;
  const selectedHtml = await fs.readFile(await selected.path(), 'utf8');
  assert.equal(
    (selectedHtml.match(/<section class="label">/g) || []).length,
    1,
    'selected asset only, despite multiple filtered results',
  );
  assert.ok(selectedHtml.includes(svg));
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(
      {
        passed: [
          'single-svg-payload',
          'filtered-printable-html',
          'selected-printable-html',
          'batch-immediate-download',
        ],
        assetId: asset.id,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: original HR-ASSET payload, single SVG download, filtered printable HTML batch export.',
  );
} finally {
  await browser.close();
}
