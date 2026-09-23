import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { zipSync, strToU8 } from 'fflate';

const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(
    process.env.HR_NODE_MODULES || path.resolve(import.meta.dirname, '../node_modules'),
    'playwright',
  ),
);
const frontend = process.env.HR_FRONTEND_URL || 'http://127.0.0.1:5175';
const backend = process.env.HR_BACKEND_URL || 'http://127.0.0.1:8091';
assert.equal(
  new URL(backend).port,
  '8091',
  'Run this write-and-cleanup check against the local test database only.',
);
const out = path.resolve(import.meta.dirname, '../test-artifacts/docx-preview');
await fs.mkdir(out, { recursive: true });
const text = 'DOCX 真实附件预览验收';
const xml =
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' +
  text +
  '</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt;window.previewUnsafe=true&lt;/script&gt;</w:t></w:r></w:p></w:body></w:document>';
const fixture = zipSync({
  '[Content_Types].xml': strToU8(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  '_rels/.rels': strToU8(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  'word/document.xml': strToU8(xml),
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.HR_BROWSER_PATH,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let fileId,
  cleaned = false;
try {
  const login = await context.request.post(backend + '/api/auth/login', {
    data: { username: 'admin', password: process.env.HR_INITIAL_ADMIN_PASSWORD || 'admin123' },
  });
  assert.equal(login.status(), 200);
  const bootstrap = await context.request.get(backend + '/api/bootstrap');
  const data = await bootstrap.json();
  const employee = data.emps.find((row) => row.status !== '已离职');
  assert.ok(employee, 'test employee exists');
  const name = 'preview-check-' + Date.now() + '.docx';
  const upload = await context.request.post(backend + '/api/emps/' + employee.id + '/files', {
    multipart: {
      category: '其他文档',
      file: {
        name,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(fixture),
      },
    },
  });
  assert.equal(upload.status(), 200, await upload.text());
  fileId = (await upload.json()).id;
  const blobResponse = await context.request.get(backend + '/api/emps/files/' + fileId);
  assert.equal(blobResponse.status(), 200);
  assert.deepEqual(await blobResponse.body(), Buffer.from(fixture));
  await page.goto(frontend + '/#/roster', { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: '关键词搜索', exact: true }).fill(employee.name);
  await page.getByRole('textbox', { name: '关键词搜索', exact: true }).press('Enter');
  await page
    .locator('.v-actions button')
    .filter({ hasText: /^查看$/ })
    .first()
    .click();
  await page.getByRole('button', { name: '档案材料', exact: true }).click();
  await page
    .locator('.v-file-row')
    .filter({ hasText: name })
    .getByRole('button', { name: '预览', exact: true })
    .click();
  await page.getByText(text, { exact: false }).waitFor();
  assert.match(
    await page.locator('.v-document').innerText(),
    /<script>window\.previewUnsafe=true<\/script>/,
  );
  assert.equal(await page.evaluate(() => window.previewUnsafe), undefined);
  assert.match(await page.getByRole('dialog').innerText(), /Word 文本预览，原始排版请下载文件查看/);
  await page.screenshot({ path: path.join(out, 'docx-preview.png') });
  const safeguards = await page.evaluate(
    async (fixtures) => {
      const { readDocxText } = await import('/src/utils/docx-preview.js');
      const rejected = [];
      for (const [name, bytes] of fixtures) {
        try {
          await readDocxText(new Blob([new Uint8Array(bytes)]));
        } catch {
          rejected.push(name);
        }
      }
      return rejected;
    },
    [
      ['missing-document', Array.from(zipSync({ 'nothing.txt': strToU8('none') }))],
      [
        'large-xml',
        Array.from(zipSync({ 'word/document.xml': strToU8('a'.repeat(4 * 1024 * 1024 + 1)) })),
      ],
      ['dtd', Array.from(zipSync({ 'word/document.xml': strToU8('<!DOCTYPE a><a/>') }))],
      ['invalid-zip', [1, 2, 3]],
    ],
  );
  assert.deepEqual(safeguards, ['missing-document', 'large-xml', 'dtd', 'invalid-zip']);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real upload/download blob and Vue DOCX text preview; script remains inert; four malformed/oversize fixtures rejected.',
  );
} finally {
  if (fileId) {
    const removed = await context.request.delete(backend + '/api/emps/files/' + fileId);
    assert.equal(removed.status(), 200, 'uploaded fixture cleanup');
    cleaned = true;
  }
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify({ errors, fileId, cleaned, backend, frontend }, null, 2),
  );
  await browser.close();
}
