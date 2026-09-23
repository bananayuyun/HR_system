import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const frontend = 'http://127.0.0.1:5175',
  backend = 'http://127.0.0.1:8091/api';
const require = createRequire(import.meta.url);
const modules = process.env.HR_NODE_MODULES || path.join(root, 'frontend', 'node_modules');
const { chromium } = require(path.join(modules, 'playwright'));
const out = path.join(root, '.local/verification');
await fs.mkdir(out, { recursive: true });
const results = [],
  errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.HR_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (error) => errors.push(error.message));
let original,
  changed = false,
  csrf = '',
  dialog;
const businessRules = (rules) => ({
  enabled: rules.enabled,
  workdays: rules.workdays,
  times: rules.times,
});
async function call(method, resource, data) {
  const response = await context.request.fetch(frontend + '/api' + resource, {
    method,
    headers: { Origin: frontend, ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}) },
    ...(data === undefined ? {} : { data }),
  });
  const body = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(body));
  if (body.csrfToken) csrf = body.csrfToken;
  return body;
}
async function check(name, run) {
  const start = Date.now();
  try {
    const evidence = await run();
    results.push({
      name,
      status: 'PASS',
      ms: Date.now() - start,
      ...(evidence ? { evidence } : {}),
    });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({
      name,
      status: 'FAIL',
      ms: Date.now() - start,
      error: error.message,
    });
    console.error('FAIL ' + name + ': ' + error.message);
  }
}
async function open() {
  const ready = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/settings/reminders' &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '待筛选提醒规则', exact: true }).click();
  assert.equal((await ready).status(), 200);
  dialog = page.getByRole('dialog', {
    name: '待筛选简历 · 钉钉提醒规则',
    exact: true,
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('.modal-f .pri-btn');
    return button && !button.disabled;
  });
}
try {
  await page.goto(frontend + '/#/screening');
  await page.getByLabel('账号', { exact: true }).fill('admin');
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.HR_INITIAL_ADMIN_PASSWORD || 'admin123');
  const booted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/bootstrap' &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const db = await (await booted).json();
  await page.locator('.v-side').waitFor();
  assert.equal(
    (await context.request.get(backend + '/auth/me')).status(),
    200,
    'Do not run against the development database.',
  );
  await call('GET', '/auth/me');
  original = await call('GET', '/settings/reminders');
  await open();
  const groups = new Map();
  const visible = (row) =>
    !row.deletedAt && !row.deleted_at && row.deleted !== true && row.archived !== true;
  const visibleCandidates = db.candidates.filter(visible),
    visibleRequests = db.reqs.filter(visible);
  for (const candidate of visibleCandidates) {
    if (!['待 HR 筛选', '待部门筛选', '暂缓筛选', '待筛选'].includes(candidate.stage)) continue;
    const request = visibleRequests.find((row) => row.id === candidate.req),
      step = candidate.screeningStep || (candidate.stage === '待部门筛选' ? 'department' : 'hr');
    const key = ['dept', 'department'].includes(step) ? 'screener' : 'owner';
    const people = [
      ...new Set(
        String(request?.[key] || '')
          .split(/[、,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    for (const person of people) {
      const key = candidate.dept + '|' + person;
      if (!groups.has(key)) groups.set(key, { person, dept: candidate.dept, rows: [] });
      if (!groups.get(key).rows.some((row) => row.id === candidate.id))
        groups.get(key).rows.push(candidate);
    }
  }
  await check(
    'Reminder uses 1056px prototype drawer, dropdowns, and three reminder times',
    async () => {
      assert.equal((await dialog.boundingBox()).width, 1056);
      assert.equal(await dialog.locator('.v-reminder-times .ant-picker').count(), 3);
      assert.equal(await dialog.locator('.ant-select').count(), 2);
      assert.equal(
        await dialog.locator('.modal-f').getByRole('button', { name: '确定', exact: true }).count(),
        1,
      );
      for (let i = 0; i < original.times.length; i++)
        assert.equal(
          await dialog.locator('#field-reminderTime' + i).inputValue(),
          original.times[i],
        );
    },
  );
  await check(
    'Recipients and message preview follow final HR/department groups without sending requests',
    async () => {
      const rows = await dialog.locator('.v-mini-table tbody tr').allTextContents(),
        counts = await dialog.locator('.v-mini-table tbody tr td:nth-child(3)').allTextContents();
      assert.equal(rows.length, groups.size || 1);
      for (const [index, group] of [...groups.values()].entries()) {
        assert.ok(rows[index].includes(group.person));
        assert.equal(
          counts[index].replace(/\s+/g, ''),
          group.rows.length + '份',
          JSON.stringify({
            index,
            expectedCount: group.rows.length,
            rendered: rows[index],
          }),
        );
        assert.ok(rows[index].includes(db.orgs.find((row) => row.id === group.dept).name));
      }
      await page.waitForLoadState('networkidle');
      const requests = [];
      const listener = (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/'))
          requests.push(request.method() + ' ' + new URL(request.url()).pathname);
      };
      page.on('request', listener);
      try {
        await dialog.getByRole('button', { name: '预览消息', exact: true }).click();
        assert.equal(await dialog.locator('.v-evaluation').count(), groups.size);
        assert.deepEqual(requests, []);
      } finally {
        page.off('request', listener);
      }
      const text = await dialog.innerText();
      assert.ok(text.includes('不向任何人发送真实通知'));
      assert.ok(!text.includes('演示规则'));
      return {
        recipients: groups.size,
        rawCountCellText: counts,
        archivedCandidatesExcluded: db.candidates.length - visibleCandidates.length,
        source:
          'The exact bootstrap response rendered by the browser, with the same archived-record exclusion as store.refresh.',
      };
    },
  );
  await check(
    'Reminder saves through real UI and reads identical values after reload',
    async () => {
      async function select(id, label) {
        await dialog
          .locator('.ant-select-selector')
          .filter({ has: page.locator('#field-' + id) })
          .click();
        await page
          .locator('.ant-select-dropdown:visible')
          .filter({ has: page.locator('#field-' + id + '_list') })
          .locator('.ant-select-item-option-content')
          .getByText(label, { exact: true })
          .click();
      }
      await select('reminderEnabled', original.enabled ? '停用' : '启用');
      await select('reminderWorkdays', original.workdays ? '每天' : '工作日');
      const pending = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/settings/reminders' &&
          response.request().method() === 'PUT',
      );
      await dialog.getByRole('button', { name: '确定', exact: true }).click();
      assert.equal((await pending).status(), 200);
      changed = true;
      await dialog.waitFor({ state: 'hidden' });
      const saved = await call('GET', '/settings/reminders');
      assert.equal(saved.enabled, !original.enabled);
      assert.equal(saved.workdays, !original.workdays);
      assert.deepEqual(saved.times, original.times.filter(Boolean).sort());
      await page.reload();
      await page.locator('.v-side').waitFor();
      await open();
      assert.equal(
        await dialog.locator('.ant-select-selection-item').nth(0).innerText(),
        original.enabled ? '停用' : '启用',
      );
      assert.equal(
        await dialog.locator('.ant-select-selection-item').nth(1).innerText(),
        original.workdays ? '每天' : '工作日',
      );
      for (let i = 0; i < saved.times.length; i++)
        assert.equal(await dialog.locator('#field-reminderTime' + i).inputValue(), saved.times[i]);
    },
  );
} catch (error) {
  results.push({
    name: 'Reminder setup',
    status: 'FAIL',
    error: error.message,
  });
} finally {
  if (original && changed)
    await check('Original reminder business settings are restored and read back', async () => {
      await call('PUT', '/settings/reminders', businessRules(original));
      assert.deepEqual(
        businessRules(await call('GET', '/settings/reminders')),
        businessRules(original),
      );
    });
  else
    results.push({
      name: 'Original reminder business settings are restored and read back',
      status: 'SKIP',
      reason: 'No successful settings write occurred.',
    });
  await browser.close();
  const report = {
    generatedAt: new Date().toISOString(),
    target: backend,
    frontend,
    results,
    errors,
    passed: results.filter((row) => row.status === 'PASS').length,
    failed: results.filter((row) => row.status === 'FAIL').length,
    note: 'Business settings restored; audit timestamp changes are expected. No real notifications sent.',
  };
  await fs.writeFile(path.join(out, 'local-round-reminders.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, errors }));
  if (report.failed || errors.length) process.exitCode = 1;
}
