import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = process.env.HR_VERIFY_URL || 'http://192.168.8.40:8088';
const username = process.env.HR_VERIFY_USER_CENTER_ACCOUNT;
const password = process.env.HR_VERIFY_USER_CENTER_PASSWORD;
if (!username || !password) throw new Error('Set HR_VERIFY_USER_CENTER_ACCOUNT and HR_VERIFY_USER_CENTER_PASSWORD.');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(root, 'frontend/node_modules/playwright'));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.HR_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const report = { base, checkedAt: new Date().toISOString(), accounts: {} };
const out = path.join(root, '.local/verification/deployment');
await mkdir(out, { recursive: true });
try {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /人力资源平台/);
  for (const [account, secret] of [[username, password]]) {
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account, password: secret }),
    });
    const loginData = await login.json();
    assert.equal(login.status, 200, `${account} API login: ${JSON.stringify(loginData)}`);
    assert.equal(loginData.user.authSource, 'userCenter');
    assert.equal(loginData.user.role, 'hr');
    const cookie = login.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
    const bootstrapResponse = await fetch(base + '/api/bootstrap', { headers: { Cookie: cookie, Origin: base } });
    const bootstrap = await bootstrapResponse.json();
    assert.equal(bootstrapResponse.status, 200, `${account} bootstrap: ${JSON.stringify(bootstrap)}`);
    const apiTypes = ['orgs', 'jobs', 'grades', 'emps', 'reqs', 'candidates', 'assets'];
    for (const type of apiTypes) {
      const response = await fetch(base + '/api/' + type, { headers: { Cookie: cookie, Origin: base } });
      assert.equal(response.status, 200, `${account} ${type} list`);
      assert.ok(Array.isArray((await response.json()).items), `${account} ${type} missing items`);
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill(account);
    await page.locator('#password').fill(secret);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.auth-name').waitFor({ timeout: 15000 });
    const display = await page.locator('.auth-name').innerText();
    const routes = await page.locator('.v-nav a[href^="#/"]').evaluateAll((items) => items.map((item) => ({ href: item.getAttribute('href'), label: item.textContent.trim() })));
    assert.ok(routes.some((route) => route.label === '部门筛选'), `${account} missing department screening`);
    for (const route of routes) {
      await page.locator(`.v-nav a[href="${route.href}"]`).click();
      await page.locator(`main[data-page="${route.href.slice(2)}"]`).waitFor({ timeout: 12000 });
      assert.equal(await page.locator('.v-breadcrumb b').innerText(), route.label);
    }
    assert.deepEqual(pageErrors, [], `${account} page errors`);
    await page.screenshot({ path: path.join(out, 'user-center.png'), fullPage: true });
    report.accounts[account] = { apiLogin: true, bootstrap: true, apiTypes, browserLogin: true, display, pages: routes.map((route) => route.label) };
    console.log(`${account}: API and browser login passed; ${routes.length} menu pages rendered.`);
    await context.close();
  }
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
