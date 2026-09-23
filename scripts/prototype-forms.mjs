import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '..'),
  require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(
    process.env.HR_NODE_MODULES || path.resolve(import.meta.dirname, '../frontend/node_modules'),
    'playwright',
  ),
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.HR_BROWSER_PATH,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  results = [];
await page.goto(pathToFileURL(path.join(root, '..', '人力资源平台原型-v1.html')).href);
await page.evaluate(() => document.fonts.ready);
const cases = [
  ...['orgs', 'jobs', 'grades', 'reqs', 'roster'].map((route) => ({
    name: route + '-add',
    route,
    action: 'add',
  })),
  { name: 'assets-edit', route: 'assets', action: 'edit' },
  { name: 'employee-basic-edit', route: 'roster', action: 'employeeSectionEdit' },
  { name: 'schedule', route: 'interviews', action: 'schedule' },
  { name: 'interview-result', route: 'interviews', action: 'interviewResult' },
  { name: 'onboarding', route: 'offers', action: 'offerAction' },
  { name: 'cancel-onboarding', route: 'offers', action: 'cancelOnboarding' },
  { name: 'columns', route: 'roster', action: 'columns' },
];
for (const spec of cases) {
  await page.evaluate((spec) => {
    closeModal();
    routeTo(spec.route);
    const element =
      spec.action === 'columns'
        ? document.querySelector('[data-act=columns]')
        : { dataset: { id: rawRows()[0]?.id, section: 'basic' } };
    ACTIONS[spec.action](element);
  }, spec);
  await page.waitForTimeout(200);
  const d = page.locator('.v-dialog').last();
  if (await d.count()) {
    results.push({ ...spec, html: await d.innerHTML() });
    await page.screenshot({ path: path.join(root, '.local/prototype', spec.name + '.png') });
  }
}
await fs.writeFile(
  path.join(root, '.local/prototype/form-captures.json'),
  JSON.stringify(results, null, 2),
);
await browser.close();
console.log(results.map((x) => x.name));
