import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '../..'),
  out = path.join(root, 'frontend/test-artifacts/prototype-extra');
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(
      process.env.HR_NODE_MODULES || path.resolve(import.meta.dirname, '../node_modules'),
      'playwright',
    ),
  );
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.HR_BROWSER_PATH,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  results = [];
await page.goto(pathToFileURL(path.join(root, '..', '人力资源平台原型-v1.html')).href);
await page.evaluate(() => document.fonts.ready);
for (const spec of [
  { name: 'pool-detail', route: 'pool' },
  { name: 'screening-detail', route: 'screening' },
  { name: 'employee-files', tab: 'files' },
  { name: 'employee-timeline', tab: 'timeline' },
  { name: 'employee-assets', tab: 'assets' },
]) {
  await page.evaluate((s) => {
    closeModal();
    routeTo(s.route || 'roster');
    if (s.tab) viewEmployee(DB.emps[0], s.tab);
    else ACTIONS.view({ dataset: { id: rawRows()[0].id } });
  }, spec);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, spec.name + '.png') });
  results.push({ ...spec, html: await page.locator('.v-dialog').innerHTML() });
}
await fs.writeFile(path.join(out, 'captures.json'), JSON.stringify(results, null, 2));
await browser.close();
console.log(results.map((r) => r.name));
