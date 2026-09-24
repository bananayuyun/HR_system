import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:8091/api';
const site = 'http://127.0.0.1:5175';
const marker = await fetch('http://127.0.0.1:8091/__acceptance/identity')
  .then((response) => response.text())
  .catch(() => '');
if (marker !== 'mock-user-center-v1') throw new Error('Run only against the isolated acceptance backend.');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(root, 'frontend/node_modules/playwright'));
const ExcelJS = require(path.join(root, 'frontend/node_modules/exceljs'));
const metadata = require(path.join(root, 'frontend/src/config/prototype-metadata.json'));
const prefix = `UNBOUNDUIM${Date.now().toString(36).toUpperCase()}`;

let cookie = '';
async function api(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Origin: site,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((part) => part.split(';')[0]).join('; ');
  const data = await response.json();
  assert.equal(response.status, 200, `${method} ${route}: ${JSON.stringify(data)}`);
  return data;
}

await api('POST', '/auth/login', { username: 'qa_unbound', password: 'qa123' });
const bootstrap = await api('GET', '/bootstrap');
const job = await api('POST', '/jobs', {
  id: `${prefix}J`, name: `${prefix}岗位`, dept: 'ORG_18', headcount: 10, status: '启用',
});
const row = {
  id: `${prefix}R`,
  name: `${prefix}需求`,
  dept: '开发部',
  job: job.id,
  count: 1,
  salaryMin: 10,
  salaryMax: 20,
  location: bootstrap.baseSettings.workRegion.find((item) => item.status === '启用').name,
  office: bootstrap.baseSettings.workplace.find((item) => item.status === '启用').name,
  company: bootstrap.baseSettings.contractCompany.find((item) => item.status === '启用').name,
  deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  screener: 'E0002',
  first: 'E0002',
  second: 'E0002',
};
const fields = metadata.importConfig.reqs.fields.filter(([key]) => key !== 'owner');
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('数据');
sheet.addRow(fields.map(([, label]) => label));
sheet.addRow(fields.map(([key]) => row[key]));
const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.HR_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(site + '/#/reqs');
  await page.getByLabel('账号', { exact: true }).fill('qa_unbound');
  await page.getByLabel('密码', { exact: true }).fill('qa123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.v-side').waitFor();
  await page.locator('.w-toolbar').getByRole('button', { name: /^导入/ }).click();
  await page.getByRole('menu', { name: '导入选项' })
    .getByRole('button', { name: '导入招聘需求', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入招聘需求', exact: true });
  await dialog.getByLabel('默认 HR 负责人').click();
  await page.locator('.ant-select-dropdown:visible')
    .getByText(/E0005/).first().click();
  await dialog.getByLabel('上传导入文件', { exact: true }).setInputFiles({
    name: `${prefix}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await dialog.getByRole('button', { name: '校验数据', exact: true }).click();
  await dialog.locator('#import-preview').getByText(/新增 1，更新 0，跳过 0，错误 0/).waitFor();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await dialog.getByRole('button', { name: '完成', exact: true }).waitFor();
  const saved = await api('GET', `/reqs/${row.id}`);
  assert.deepEqual(saved.ownerIds, ['E0005']);
  console.log('PASS browser import of the original 14-column request file with selected HR owner.');
} finally {
  await browser.close();
}
