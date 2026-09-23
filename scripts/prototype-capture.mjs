import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Read-only capture of the supplied reference, including its final patch layers.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const modules = process.env.HR_NODE_MODULES || path.join(root, 'frontend', 'node_modules');
const { chromium } = require(path.join(modules, 'playwright'));
const out = path.join(root, '.local', 'prototype');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.HR_BROWSER_PATH ? { executablePath: process.env.HR_BROWSER_PATH } : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(pathToFileURL(path.join(root, '..', '人力资源平台原型-v1.html')).href, {
  waitUntil: 'load',
});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const source = await page.evaluate(() => ({
  data: JSON.parse(JSON.stringify(DB)),
  routes: ROUTES,
  employeeSections: typeof EMP_SECTIONS !== 'undefined' ? EMP_SECTIONS : [],
  importConfig: IMPORT_CONFIG,
  actions: Object.keys(ACTIONS),
  allowed: { hr: HR_ROUTES, manager: MANAGER_ROUTES },
  dictionary: typeof BASE_CONFIG !== 'undefined' ? BASE_CONFIG : null,
}));
await fs.writeFile(path.join(out, 'state.json'), JSON.stringify(source, null, 2));
const captures = [];
for (const route of Object.keys(source.routes)) {
  await page.evaluate((route) => routeTo(route), route);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, `${route}.png`), fullPage: true });
  const info = await page.evaluate(() => ({
    title: document.querySelector('#breadcrumb')?.textContent,
    actions: Array.from(document.querySelectorAll('#content button'))
      .map((b) => ({ text: b.textContent.trim(), action: b.dataset.act }))
      .filter((b) => b.text),
    columns: Array.from(document.querySelectorAll('#content thead th')).map((th) =>
      th.textContent.trim(),
    ),
    content: document.querySelector('#content')?.innerHTML,
    schemas: state.route === 'settings' ? [] : schema().map(({ key, label }) => ({ key, label })),
    body: document.body.className,
  }));
  captures.push({ route, ...info });
}
await fs.writeFile(path.join(out, 'captures.json'), JSON.stringify(captures, null, 2));
const detailCaptures = [];
for (const route of ['roster', 'jobs', 'reqs', 'interviews', 'offers', 'assets']) {
  await page.evaluate((route) => routeTo(route), route);
  await page.evaluate(() => {
    const row = rawRows()[0];
    if (row) viewRecord(row.id);
  });
  await page.waitForTimeout(150);
  const dialog = page.locator('.v-dialog').last();
  if (await dialog.count()) {
    await page.screenshot({ path: path.join(out, `${route}-detail.png`), fullPage: true });
    detailCaptures.push({ route, html: await dialog.innerHTML() });
  }
  await page.evaluate(() => closeModal());
}
await fs.writeFile(path.join(out, 'detail-captures.json'), JSON.stringify(detailCaptures, null, 2));
await browser.close();
console.log(
  JSON.stringify(
    {
      output: out,
      routes: captures.map((x) => x.route),
      errors,
      counts: Object.fromEntries(
        Object.entries(source.data)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, v.length]),
      ),
    },
    null,
    2,
  ),
);
