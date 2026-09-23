import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(root, 'frontend/node_modules/playwright'));
const base = 'http://localhost:5180';
const results = [],
  errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.HR_BROWSER_PATH,
});
try {
  for (const [username, password, role] of [
    ['admin', 'admin123', 'hr'],
    ['manager', 'manager123', 'manager'],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + '/#/roster');
      await page.getByLabel('账号', { exact: true }).fill(username);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.locator('.v-side').waitFor();
      const response = await context.request.get(base + '/api/bootstrap');
      assert.equal(response.status(), 200);
      const data = await response.json();
      assert.equal(data.user.role, role);
      assert.equal(data.user.username, username);
      const menuCount = await page.locator('.v-nav a').count();
      if (role === 'hr') assert.equal(menuCount, 11);
      else assert.ok(menuCount < 11);
      assert.ok(data.emps.length > 0);
      await page.reload();
      await page.locator('.v-side').waitFor();
      assert.equal((await context.request.get(base + '/api/auth/me')).status(), 200);
      results.push({
        username,
        role,
        menuCount,
        employeesVisible: data.emps.length,
        status: 'PASS',
      });
      console.log(
        'PASS ' + username + ' real login, server menus, data and session reload at ' + base,
      );
      const logout = await context.request.post(base + '/api/auth/logout', {
        headers: { Origin: base },
      });
      assert.equal(logout.status(), 200);
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(root, '.local/verification/migration-runtime.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        base,
        source: 'real development frontend/backend; no API mocks',
        businessWrites: false,
        results,
        errors,
      },
      null,
      2,
    ),
  );
}
