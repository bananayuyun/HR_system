import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const base = process.env.HR_API_URL || 'http://127.0.0.1:8091/api';
const target = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '8091')
  throw new Error('Acceptance writes are restricted to the isolated localhost:8091 test service.');
const prefix = `QA${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const results = [];
class Client {
  cookie = '';
  async call(method, resource, body, expected = 200, headers = {}) {
    const response = await fetch(`${base}${resource}`, {
      method,
      headers: {
        Accept: 'application/json',
        Origin: 'http://127.0.0.1:5180',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) this.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    const allowed = Array.isArray(expected) ? expected : [expected];
    assert.ok(
      allowed.includes(response.status),
      `${method} ${resource}: expected ${allowed.join('/')}, got ${response.status}: ${typeof data === 'object' ? JSON.stringify(data) : String(data).slice(0, 200)}`,
    );
    return data;
  }
  get(p, expected) {
    return this.call('GET', p, undefined, expected);
  }
  post(p, b, expected) {
    return this.call('POST', p, b, expected);
  }
  put(p, b, expected) {
    return this.call('PUT', p, b, expected);
  }
}
const admin = new Client(),
  manager = new Client(),
  anonymous = new Client();
let company, department, employee, job, asset, candidate, request;
const created = [];
async function check(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, status: 'PASS', ms: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message, ms: Date.now() - start });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
function record(type, row) {
  assert.ok(row.id, `${type} create must return stable id`);
  created.push({ type, id: row.id });
  return row;
}
function employeeBody(id, name, dept, jobId, extra = {}) {
  return {
    id,
    name,
    dept,
    job: jobId,
    status: '正式',
    workType: '全职',
    entry: today,
    workRegion: '上海',
    workplace: '上海',
    contractCompany: '微间',
    ...extra,
  };
}

await check('Anonymous access and disallowed-origin login are rejected', async () => {
  await anonymous.get('/bootstrap', 401);
  await anonymous.post('/auth/login', { username: 'admin', password: 'wrong-password' }, 401);
  await anonymous.call('POST', '/auth/login', { username: 'admin', password: 'admin123' }, 403, {
    Origin: 'https://untrusted.invalid',
  });
});
await check('Both accounts authenticate with server-controlled roles and menus', async () => {
  const a = await admin.post('/auth/login', {
    username: 'admin',
    password: process.env.HR_INITIAL_ADMIN_PASSWORD || 'admin123',
  });
  const m = await manager.post('/auth/login', {
    username: 'manager',
    password: process.env.HR_INITIAL_MANAGER_PASSWORD || 'manager123',
  });
  assert.equal(a.user.role, 'hr');
  assert.equal(a.user.menus.length, 11);
  assert.equal(m.user.role, 'manager');
  assert.equal(m.user.managerDept, 'ORG_18');
  assert.ok(!m.user.permissions.includes('emps:write'));
  assert.ok(!m.user.menus.includes('settings'));
  company = await admin.get('/bootstrap');
  department = await manager.get('/bootstrap');
  assert.ok(company.emps.length >= 168, 'Prototype development employees were not initialized.');
});
if (!company || !department) {
  await fs.mkdir(path.join(root, '.local', 'verification'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.local', 'verification', 'api.json'),
    JSON.stringify({ results }, null, 2),
  );
  process.exit(1);
}
const allowed = new Set(department.orgs.map((o) => o.id));
const ownEmployee = department.emps.find((e) => !e.deleted && e.status === '正式');
const outsider = company.emps.find((e) => !allowed.has(e.dept) && !e.deleted);
await check(
  'Department scope filters employees, jobs, requests, candidates and assets',
  async () => {
    for (const type of ['emps', 'jobs', 'reqs', 'candidates', 'assets'])
      for (const row of department[type])
        assert.ok(allowed.has(row.dept), `${type}/${row.id} leaked department ${row.dept}`);
    assert.ok(department.emps.length < company.emps.length);
    await manager.get(`/emps/${outsider.id}`, 403);
    await manager.put(`/emps/${outsider.id}`, { ...outsider, name: 'OUTSIDE_WRITE_PROBE' }, 403);
    await manager.put(
      `/emps/${ownEmployee.id}`,
      { ...ownEmployee, name: 'READONLY_WRITE_PROBE' },
      403,
    );
    const unchanged = await admin.get(`/emps/${outsider.id}`);
    assert.equal(unchanged.name, outsider.name);
  },
);
await check('Department manager can maintain only own-organization jobs', async () => {
  job = record(
    'jobs',
    await manager.post(
      '/jobs',
      {
        id: `${prefix}J`,
        name: `验收岗位${prefix}`,
        dept: 'ORG_18',
        headcount: 10,
        status: '启用',
        duties: '自动化验收',
        requirements: '测试完成后保留在独立测试库',
      },
      [200, 201],
    ),
  );
  job = await manager.put(`/jobs/${job.id}`, { ...job, headcount: 11 });
  await manager.put(`/jobs/${job.id}`, { ...job, dept: 'ORG_11' }, 403);
  await manager.post(
    '/jobs',
    { name: `越权岗位${prefix}`, dept: 'ORG_11', headcount: 1, status: '启用' },
    403,
  );
});
await check(
  'Employee save, optimistic lock, masked sensitive output and authorized reveal',
  async () => {
    assert.ok(job);
    employee = record(
      'emps',
      await admin.post(
        '/emps',
        employeeBody(`${prefix}E`, `验收员工${prefix}`, 'ORG_18', job.id, {
          phone: `199${String(Date.now()).slice(-8)}`,
          identityNumber: '11010519491231002X',
          emergency: `PRIVATE_${prefix}`,
          bankNumber: '622200000000000019',
        }),
        [200, 201],
      ),
    );
    assert.notEqual(employee.identityNumber, '11010519491231002X');
    assert.notEqual(employee.emergency, `PRIVATE_${prefix}`);
    const oldVersion = employee.version;
    employee = await admin.put(`/emps/${employee.id}`, { ...employee, notes: '已保存且应持久化' });
    await admin.put(`/emps/${employee.id}`, { version: oldVersion, notes: '不应覆盖' }, 409);
    const reveal = await admin.get(`/emps/${employee.id}/sensitive`);
    assert.equal(reveal.identityNumber, '11010519491231002X');
    assert.equal(reveal.emergency, `PRIVATE_${prefix}`);
    await manager.get(`/emps/${employee.id}/sensitive`, 403);
    const latest = await admin.get(`/emps/${employee.id}`);
    assert.equal(latest.notes, '已保存且应持久化');
    employee = latest;
  },
);
await check(
  'Asset custody prevents departure; return permits departure and records history',
  async () => {
    assert.ok(employee);
    asset = record(
      'assets',
      await admin.post(
        '/assets',
        {
          id: `${prefix}A`,
          name: '验收笔记本',
          category: '电子设备',
          model: 'QA',
          workRegion: '上海',
          workplace: '上海',
          office: '验收柜',
          status: '使用中',
          owner: employee.id,
          public: '否',
          cost: 100,
        },
        [200, 201],
      ),
    );
    await admin.put(
      `/emps/${employee.id}`,
      { ...employee, status: '已离职', leaveDate: today },
      409,
    );
    await manager.post(
      `/assets/${asset.id}/actions`,
      { action: 'RETURN', version: asset.version, reason: '越权归还' },
      403,
    );
    asset = await admin.post(`/assets/${asset.id}/actions`, {
      action: 'RETURN',
      version: asset.version,
      reason: '验收归还',
      workRegion: '上海',
      location: '上海',
      workplace: '上海',
      office: '验收柜',
    });
    assert.equal(asset.owner, '');
    assert.equal(asset.status, '闲置');
    assert.ok(asset.history.length >= 2);
    employee = await admin.put(`/emps/${employee.id}`, {
      ...employee,
      status: '已离职',
      leaveDate: today,
    });
    assert.equal(employee.status, '已离职');
  },
);
await check('Archive and restore preserve the employee identity and history', async () => {
  const before = await admin.get(`/emps/${employee.id}`);
  await admin.call('DELETE', `/emps/${employee.id}`, { version: before.version }, [200, 204]);
  let row = await admin.get(`/emps/${employee.id}`);
  assert.ok(row.deleted);
  row = await admin.post(`/emps/${employee.id}/restore`, { version: row.version });
  assert.equal(row.deleted, false);
  assert.equal(row.dbId, before.dbId);
  assert.ok(row.timeline.length >= before.timeline.length);
});
await check(
  'Duplicate import batches are idempotent and blank cells do not overwrite values',
  async () => {
    const body = {
      fileName: 'acceptance.csv',
      fileHash: crypto.createHash('sha256').update(prefix).digest('hex'),
      rows: [{ id: employee.id, name: employee.name, notes: '', phone: '' }],
    };
    const first = await admin.post('/imports/emps', body, [200, 201]);
    await admin.post('/imports/emps', body, [200, 409]);
    const saved = await admin.get(`/emps/${employee.id}`);
    assert.equal(saved.notes, '已保存且应持久化');
    assert.equal(saved.phone, employee.phone);
    assert.equal(first.errorCount, 0, JSON.stringify(first));
    for (const key of ['dept', 'job', 'status'])
      assert.equal(saved[key], employee[key], `Blank import overwrote ${key}`);
    await manager.post('/imports/emps', body, 403);
  },
);

await check(
  'Recruitment follows HR screening, department screening and two interview rounds',
  async () => {
    assert.ok(job);
    const interviewer = department.emps.find(
      (e) => !e.deleted && !['已离职', '待离职'].includes(e.status),
    );
    const hrPerson =
      company.emps.find((e) => e.dept === 'ORG_05' && !['已离职', '待离职'].includes(e.status)) ||
      interviewer;
    request = record(
      'reqs',
      await admin.post(
        '/reqs',
        {
          id: `${prefix}R`,
          name: `验收招聘${prefix}`,
          dept: 'ORG_18',
          job: job.id,
          count: 1,
          salaryMin: 10,
          salaryMax: 20,
          type: '新增',
          deadline: tomorrow,
          workRegion: '上海',
          workplace: '上海',
          contractCompany: '微间',
          status: '招聘中',
          ownerIds: [hrPerson.id],
          screenerIds: [interviewer.id],
          firstIds: [interviewer.id],
          secondIds: [interviewer.id],
        },
        [200, 201],
      ),
    );
    candidate = record(
      'candidates',
      await admin.post(
        '/candidates',
        {
          id: `${prefix}C`,
          req: request.id,
          name: `验收候选人${prefix}`,
          phone: `188${String(Date.now()).slice(-8)}`,
          email: 'acceptance@example.test',
          source: '内部推荐',
          education: '本科',
          years: 3,
          workRegion: '上海',
          workplace: '上海',
          contractCompany: '微间',
        },
        [200, 201],
      ),
    );
    await manager.post(
      `/candidates/${candidate.id}/screening`,
      { result: '通过', reason: '越权处理HR阶段' },
      403,
    );
    await admin.put(
      `/candidates/${candidate.id}`,
      { version: candidate.version, stage: '已入职' },
      [400, 409, 422],
    );
    candidate = await admin.post(`/candidates/${candidate.id}/screening`, {
      result: '通过',
      reason: 'HR初筛通过',
    });
    assert.equal(candidate.stage, '待部门筛选');
    candidate = await manager.post(`/candidates/${candidate.id}/screening`, {
      result: '通过',
      reason: '部门筛选通过',
    });
    assert.equal(candidate.stage, '初试');
    const start = Date.now() + 15 * 60000;
    const localTime = (value) =>
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value));
    candidate = await admin.post(`/candidates/${candidate.id}/interviews`, {
      date: tomorrow,
      start: '14:00',
      end: '15:00',
      interviewerIds: [interviewer.id],
      method: '视频面试',
      place: 'https://example.test/interview',
    });
    const first = candidate.interviews.at(-1);
    await admin.post(
      `/interviews/${first.dbId}/result`,
      { result: '通过', evaluation: '不应提前完成未来日期面试' },
      [400, 422],
    );
    candidate = await admin.post(`/candidates/${candidate.id}/interviews`, {
      date: today,
      start: localTime(start),
      end: localTime(start + 20 * 60000),
      interviewerIds: [interviewer.id],
      method: '视频面试',
      place: 'https://example.test/interview',
    });
    candidate = await manager.post(`/interviews/${candidate.interviews.at(-1).dbId}/result`, {
      result: '通过',
      evaluation: '初试通过',
    });
    assert.equal(candidate.stage, '复试');
    candidate = await admin.post(`/candidates/${candidate.id}/interviews`, {
      date: today,
      start: localTime(start + 40 * 60000),
      end: localTime(start + 60 * 60000),
      interviewerIds: [interviewer.id],
      method: '现场面试',
      place: '上海会议室',
    });
    candidate = await manager.post(`/interviews/${candidate.interviews.at(-1).dbId}/result`, {
      result: '通过',
      evaluation: '复试通过',
    });
    assert.equal(candidate.stage, '待入职');
    assert.equal(candidate.interviews.length, 2);
  },
);
await check(
  'Concurrent onboarding creates exactly one employee and completes the requirement',
  async () => {
    assert.equal(candidate?.stage, '待入职');
    const body = {
      action: '确认入职',
      onboard: tomorrow,
      employeeId: `${prefix}H`,
      grade:
        company.grades.find((g) => g.status === '启用' && g.scope === '全部部门')?.code || 'T2',
      workRegion: '上海',
      workplace: '上海',
      contractCompany: '微间',
      entryNotes: '验收并发入职',
    };
    await manager.post(`/candidates/${candidate.id}/onboarding`, body, 403);
    const replies = await Promise.all(
      [1, 2].map(async () => {
        const r = await fetch(`${base}/candidates/${candidate.id}/onboarding`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: admin.cookie,
            Origin: 'http://127.0.0.1:5180',
          },
          body: JSON.stringify(body),
        });
        return { status: r.status, data: await r.json() };
      }),
    );
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409], JSON.stringify(replies));
    const loaded = await admin.get('/bootstrap');
    assert.equal(loaded.emps.filter((e) => e.id === body.employeeId).length, 1);
    assert.equal(loaded.candidates.find((c) => c.id === candidate.id).stage, '已入职');
    assert.equal(loaded.reqs.find((r) => r.id === request.id).status, '已完成');
    const hire = loaded.emps.find((e) => e.id === body.employeeId);
    assert.equal(hire.entry, tomorrow);
    assert.equal(hire.job, job.id);
    created.push({ type: 'emps', id: hire.id });
  },
);
await check(
  'Sensitive data stays encrypted in MySQL and rejected operations remain audited',
  async () => {
    const cfg = Object.fromEntries(
      (await fs.readFile(path.join(root, '.env'), 'utf8'))
        .split(/\r?\n/)
        .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    const mysql = path.join(root, '.tools/mysql-8.4.11-winx64/bin/mysql.exe');
    const query = `SELECT COUNT(*) FROM employee e JOIN employee_sensitive s ON s.employee_id=e.id WHERE e.employee_no='${employee.id}' AND OCTET_LENGTH(s.id_no_cipher)>28 AND LOCATE(_binary '11010519491231002X',s.id_no_cipher)=0; SELECT COUNT(*) FROM employee WHERE extra LIKE '%PRIVATE_${prefix}%' OR extra LIKE '%11010519491231002X%'; SELECT COUNT(*) FROM audit_log WHERE action='ACCESS_DENIED' AND request_id IS NOT NULL AND ip IS NOT NULL;`;
    const run = spawnSync(
      mysql,
      [
        '--no-defaults',
        '--host=127.0.0.1',
        '--port=3307',
        `--user=${cfg.DB_USERNAME}`,
        '--batch',
        '--skip-column-names',
        '--database=hrms_test',
        '--execute',
        query,
      ],
      { env: { ...process.env, MYSQL_PWD: cfg.DB_PASSWORD }, encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    const counts = run.stdout.trim().split(/\s+/).map(Number);
    assert.equal(counts[0], 1);
    assert.equal(counts[1], 0);
    assert.ok(counts[2] > 0, '403 audit records must survive rolled back writes.');
  },
);
await check('Logout invalidates the session', async () => {
  await manager.post('/auth/logout', {}, [200, 204]);
  await manager.get('/bootstrap', 401);
});
const output = {
  at: new Date().toISOString(),
  target: base,
  run: prefix,
  results,
  created,
  passed: results.filter((x) => x.status === 'PASS').length,
  failed: results.filter((x) => x.status === 'FAIL').length,
};
await fs.mkdir(path.join(root, '.local', 'verification'), { recursive: true });
await fs.writeFile(
  path.join(root, '.local', 'verification', 'api.json'),
  JSON.stringify(output, null, 2),
);
console.log(
  JSON.stringify({
    passed: output.passed,
    failed: output.failed,
    report: '.local/verification/api.json',
  }),
);
process.exitCode = output.failed ? 1 : 0;
