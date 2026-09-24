import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const split = line.indexOf('=');
      return [line.slice(0, split), line.slice(split + 1).replace(/^['"]|['"]$/g, '')];
    }),
);
if (
  env.SPRING_PROFILES_ACTIVE !== 'dev' ||
  !env.DB_URL?.startsWith('jdbc:mysql://127.0.0.1:3307/hrms_dev?') ||
  env.SERVER_PORT !== '8090'
)
  throw new Error('Only the local dev profile on 127.0.0.1:3307/hrms_dev is allowed.');

const base = 'http://127.0.0.1:8090/api';
let cookie = '';
async function call(method, endpoint, body) {
  const response = await fetch(base + endpoint, {
    method,
    headers: {
      Accept: 'application/json',
      Origin: 'http://127.0.0.1:5180',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${payload.message || ''}`);
  return payload.data ?? payload;
}

await call('POST', '/auth/login', {
  username: 'admin',
  password: env.HR_INITIAL_ADMIN_PASSWORD || 'admin123',
});
const state = await call('GET', '/bootstrap');
const requestedJobs = [
  ['产品经理', '产品设计中心'],
  ['前端工程师', '前端开发组'],
  ['后端工程师', '后端开发组'],
  ['测试工程师', '测试组'],
  ['会计', '会计组'],
  ['出纳', '出纳组'],
  ['销售经理', '销售部'],
  ['采购专员', '供应链管理部'],
  ['人事主管', '人事行政部'],
  ['行政专员', '综合管理部'],
];
const eligible = requestedJobs.map(([name, organization]) => {
  const candidates = state.jobs
    .filter((job) => job.name === name && job.status === '启用')
    .map((job) => ({ job, org: state.orgs.find((row) => row.id === job.dept) }));
  const matches = candidates.filter(({ org }) => org?.name === organization);
  if (matches.length !== 1)
    throw new Error(`Expected one ${name} in ${organization}; found ${JSON.stringify(candidates.map(({ org }) => org?.name))}`);
  const { job, org } = matches[0];
  if (!org) throw new Error(`Missing organization for ${name}`);
  return { job: job.id, jobName: name, dept: org.id, orgName: org.name };
});
if (!process.argv.includes('--apply')) {
  process.stdout.write(
    JSON.stringify({ mode: 'preview', existingEmployees: state.emps.length, visibleEmployees: state.emps.filter((employee) => !employee.deletedAt && employee.status !== '已离职').length, jobs: eligible }) + '\n',
  );
  process.exit(0);
}

const existing = new Set(state.emps.map((employee) => employee.id));
let created = 0;
for (let index = 1; index <= 30; index++) {
  const number = `TEST-EMP-${String(index).padStart(3, '0')}`;
  if (existing.has(number)) continue;
  const assignment = eligible[(index - 1) % eligible.length];
  await call('POST', '/emps', {
    id: number,
    name: `测试员工${String(index).padStart(2, '0')}`,
    phone: `1390002${String(index).padStart(4, '0')}`,
    email: `test.emp.${String(index).padStart(3, '0')}@example.invalid`,
    dept: assignment.dept,
    job: assignment.job,
    status: index % 4 === 0 ? '试用' : '正式',
    workType: '全职',
    entry: `2026-0${(index % 8) + 1}-${String((index % 25) + 1).padStart(2, '0')}`,
    workRegion: index % 3 === 0 ? '南京' : '上海',
    workplace: index % 3 === 0 ? '南京' : '上海',
    contractCompany: '微间',
    notes: '本地模拟数据，仅用于页面测试',
    source: '手工新增',
  });
  created++;
}
const after = await call('GET', '/bootstrap');
process.stdout.write(
  JSON.stringify({ mode: 'applied', created, totalEmployees: after.emps.length, mockEmployees: after.emps.filter((employee) => String(employee.id).startsWith('TEST-EMP-')).length }) + '\n',
);
