import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Deliberately restricted to this project's isolated acceptance service.
const base = process.env.HR_SECURITY_API_URL || 'http://127.0.0.1:8091/api';
const target = new URL(base);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.port !== '8091' ||
  target.pathname !== '/api'
)
  throw new Error('Security acceptance writes require the isolated localhost:8091/api service.');
const root = path.resolve(import.meta.dirname, '..');
const prefix = `SEC${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex')}`;
const results = [],
  created = [];
let serial = 0;
const phone = () => `19${String(Date.now()).slice(-7)}${String(++serial).padStart(2, '0')}`;
const localDate = (value) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
const localTime = (value) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
const today = localDate(Date.now()),
  future = localDate(Date.now() + 86400000);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
class Client {
  cookie = '';
  async call(method, resource, body, expected = 200) {
    const multipart = body instanceof FormData;
    const response = await fetch(base + resource, {
      method,
      headers: {
        Accept: 'application/json',
        Origin: 'http://127.0.0.1:5180',
        ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) this.cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (expected !== null)
      assert.ok(
        (Array.isArray(expected) ? expected : [expected]).includes(response.status),
        `${method} ${resource}: expected ${expected}, got ${response.status}: ${JSON.stringify(data).slice(0, 1000)}`,
      );
    return { status: response.status, data };
  }
  async get(resource, expected) {
    return (await this.call('GET', resource, undefined, expected)).data;
  }
  async post(resource, body, expected) {
    return (await this.call('POST', resource, body, expected)).data;
  }
  async put(resource, body, expected) {
    return (await this.call('PUT', resource, body, expected)).data;
  }
}
const admin = new Client(),
  manager = new Client(),
  anonymous = new Client();
async function check(name, action) {
  const start = Date.now();
  try {
    const evidence = await action();
    results.push({
      name,
      status: 'PASS',
      ms: Date.now() - start,
      ...(evidence ? { evidence } : {}),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', ms: Date.now() - start, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
async function create(type, body) {
  const row = await admin.post(`/${type}`, body, [200, 201]);
  assert.ok(row.id);
  created.push({ type, id: row.id });
  return row;
}
let all,
  own,
  ownOrg,
  outsideOrg,
  job,
  alternateJob,
  outsideJob,
  interviewer,
  secondPerson,
  outsidePerson,
  request,
  outsideRequest,
  candidate,
  outsideCandidate;
let region, workplace, company;
function employeeBody(id, name, org, jobId, extra = {}) {
  return {
    id,
    name,
    dept: org,
    job: jobId,
    status: '正式',
    workType: '全职',
    entry: today,
    workRegion: region,
    workplace,
    contractCompany: company,
    ...extra,
  };
}
function requestBody(id, org, jobId, person, extra = {}) {
  return {
    id,
    name: `边界验收${id}`,
    dept: org,
    job: jobId,
    count: 12,
    salaryMin: 10,
    salaryMax: 20,
    type: '新增',
    deadline: future,
    workRegion: region,
    workplace,
    contractCompany: company,
    status: '招聘中',
    ownerIds: [person.id],
    screenerIds: [person.id],
    firstIds: [person.id],
    secondIds: [person.id],
    ...extra,
  };
}
async function newCandidate(suffix, req = request) {
  return create('candidates', {
    id: `${prefix}${suffix}`,
    req: req.id,
    name: `边界候选${suffix}`,
    phone: phone(),
    source: '内部推荐',
    education: '本科',
    years: 3,
    workRegion: region,
    workplace,
  });
}
async function firstStage(row) {
  await admin.post(`/candidates/${row.id}/screening`, {
    result: '通过',
    reason: '隔离测试 HR 筛选',
  });
  return admin.post(`/candidates/${row.id}/screening`, {
    result: '通过',
    reason: '隔离测试部门筛选',
  });
}
function upload(name = 'security.txt') {
  const body = new FormData();
  body.append('file', new Blob([`Security acceptance ${prefix}`], { type: 'text/plain' }), name);
  body.append('category', '验收附件');
  return body;
}

await check('Service identity, login roles, and anonymous rejection', async () => {
  await anonymous.get('/bootstrap', 401);
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
  assert.equal(m.user.managerDept, 'ORG_18');
  all = await admin.get('/bootstrap');
  own = await manager.get('/bootstrap');
  ownOrg = m.user.managerDept;
  assert.ok(
    all.orgs.some((row) => row.id === 'ORG_ROOT' && row.name === '中数股份'),
    'Refusing to write to an unidentified service.',
  );
  outsideOrg = all.orgs.find((row) => row.id === 'ORG_11')?.id;
  assert.ok(outsideOrg);
  region = all.baseSettings.workRegion.find((row) => row.status === '启用').name;
  workplace = all.baseSettings.workplace.find((row) => row.status === '启用').name;
  company = all.baseSettings.contractCompany.find((row) => row.status === '启用').name;
});

if (all && own && outsideOrg) {
  await check('Manager bootstrap and single-record reads enforce department scope', async () => {
    const allowed = new Set(own.orgs.map((row) => row.id));
    for (const type of ['emps', 'jobs', 'reqs', 'candidates', 'assets']) {
      for (const row of own[type])
        assert.ok(allowed.has(row.dept), `${type}/${row.id} leaked ${row.dept}`);
      const outside = all[type].find((row) => !allowed.has(row.dept));
      if (outside) await manager.get(`/${type}/${outside.id}`, 403);
    }
    await manager.post('/imports/emps', { rows: [], fileHash: digest(prefix) }, 403);
    await manager.put('/settings/reminders', { times: ['10:00'] }, 403);
  });
  await check('Create isolated fixtures for linked-resource and concurrency checks', async () => {
    job = await create('jobs', {
      id: `${prefix}J`,
      name: `本部边界岗位${prefix}`,
      dept: ownOrg,
      headcount: 100,
      status: '启用',
    });
    alternateJob = await create('jobs', {
      id: `${prefix}J2`,
      name: `本部第二岗位${prefix}`,
      dept: ownOrg,
      headcount: 100,
      status: '启用',
    });
    outsideJob = await create('jobs', {
      id: `${prefix}JX`,
      name: `外部边界岗位${prefix}`,
      dept: outsideOrg,
      headcount: 100,
      status: '启用',
    });
    interviewer = await create(
      'emps',
      employeeBody(`${prefix}E1`, '安全检查员甲', ownOrg, job.id, {
        phone: phone(),
        notes: 'IMPORT_BLANK_MUST_PRESERVE',
      }),
    );
    secondPerson = await create(
      'emps',
      employeeBody(`${prefix}E2`, '安全检查员乙', ownOrg, job.id, { phone: phone() }),
    );
    outsidePerson = await create(
      'emps',
      employeeBody(`${prefix}EX`, '不可关联的外部员工', outsideOrg, outsideJob.id, {
        phone: phone(),
      }),
    );
    request = await create('reqs', requestBody(`${prefix}R`, ownOrg, job.id, interviewer));
    outsideRequest = await create(
      'reqs',
      requestBody(`${prefix}RX`, outsideOrg, outsideJob.id, outsidePerson),
    );
    candidate = await newCandidate('C');
    outsideCandidate = await newCandidate('CX', outsideRequest);
  });
  if (candidate && outsideCandidate) {
    await check('Cross-department linked employees cannot be assigned by manager', async () => {
      const probe = requestBody(`${prefix}RBAD`, ownOrg, job.id, interviewer, {
        count: 1,
        screenerIds: [outsidePerson.id],
      });
      await manager.post('/reqs', probe, [400, 403, 422]);
      const existing = await admin.get(`/reqs/${request.id}`);
      await manager.put(
        `/reqs/${request.id}`,
        { ...existing, firstIds: [outsidePerson.id] },
        [400, 403, 422],
      );
      const unchanged = await admin.get(`/reqs/${request.id}`);
      assert.deepEqual(unchanged.firstIds, existing.firstIds);
    });
    await check('Requests with candidates cannot change department or job', async () => {
      const row = await admin.get(`/reqs/${request.id}`);
      await manager.put(`/reqs/${request.id}`, { ...row, job: alternateJob.id }, [400, 409, 422]);
      assert.equal((await admin.get(`/reqs/${request.id}`)).job, job.id);
    });
    await check('Department screening requires the configured screener identity', async () => {
      await manager.post(
        `/candidates/${candidate.id}/screening`,
        { result: '通过', reason: 'Attempt to bypass HR stage' },
        403,
      );
      candidate = await admin.post(`/candidates/${candidate.id}/screening`, {
        result: '通过',
        reason: 'HR筛选测试',
      });
      await manager.post(
        `/candidates/${candidate.id}/screening`,
        { result: '通过', reason: 'Manager is not fixture screener' },
        403,
      );
      candidate = await admin.post(`/candidates/${candidate.id}/screening`, {
        result: '通过',
        reason: '部门筛选测试',
      });
    });
    await check('Single files, sensitive fields and audit endpoints resist IDOR', async () => {
      const outsideFile = await admin.post(
        `/candidates/${outsideCandidate.id}/files`,
        upload(),
        [200, 201],
      );
      await manager.get(`/candidates/files/${outsideFile.id}`, 403);
      await manager.call('DELETE', `/candidates/files/${outsideFile.id}`, undefined, 403);
      await manager.post(`/candidates/${outsideCandidate.id}/files`, upload(), 403);
      assert.equal(
        (await admin.get(`/candidates/${outsideCandidate.id}`)).files.some(
          (row) => row.id === outsideFile.id,
        ),
        true,
      );
      const ownFile = await admin.post(
        `/candidates/${candidate.id}/files`,
        upload('own.txt'),
        [200, 201],
      );
      assert.match(await manager.get(`/candidates/files/${ownFile.id}`), /Security acceptance/);
      const personnelFile = await admin.post(`/emps/${interviewer.id}/files`, upload(), [200, 201]);
      await manager.get(`/emps/files/${personnelFile.id}`, 403);
      await manager.get(`/emps/${interviewer.id}/sensitive`, 403);
      await manager.get(`/emps/${outsidePerson.id}/sensitive`, 403);
      await manager.get(`/emps/${interviewer.id}/audit`, 403);
      await manager.get(`/reqs/${outsideRequest.id}/audit`, 403);
    });
    await check('Import API enforces the prototype 2000-row limit', async () => {
      await admin.post(
        '/imports/emps',
        {
          fileName: 'oversized.json',
          fileHash: digest(`${prefix}oversized`),
          rows: Array.from({ length: 2001 }, () => ({})),
          validateOnly: true,
        },
        [400, 413, 422],
      );
    });
    await check(
      'Import preview is read-only; blank/null cells preserve values; duplicate files are idempotent',
      async () => {
        const before = await admin.get(`/emps/${interviewer.id}`);
        const body = {
          fileName: 'blank-protection.csv',
          fileHash: digest(`${prefix}blanks`),
          mode: 'update',
          rows: [
            {
              id: before.id,
              name: before.name,
              phone: '',
              notes: '   ',
              dept: null,
              workplace: '',
              contractCompany: null,
            },
          ],
        };
        const preview = await admin.post('/imports/emps', { ...body, validateOnly: true });
        assert.equal(preview.errorCount, 0);
        assert.equal(preview.updated, 1);
        assert.equal((await admin.get(`/emps/${before.id}`)).version, before.version);
        const applied = await admin.post('/imports/emps', { ...body, validateOnly: false });
        assert.equal(applied.updated, 1);
        assert.equal(applied.errorCount, 0);
        const after = await admin.get(`/emps/${before.id}`);
        for (const field of ['phone', 'notes', 'dept', 'workplace', 'contractCompany'])
          assert.equal(after[field], before[field], `${field} was overwritten by a blank`);
        const twice = await admin.post('/imports/emps', { ...body, validateOnly: false });
        assert.equal(twice.duplicate, true);
        assert.equal((await admin.get(`/emps/${before.id}`)).version, after.version);
      },
    );
    await check(
      'Import skip mode still reports invalid and duplicate source rows as errors',
      async () => {
        const report = await admin.post('/imports/emps', {
          fileName: 'duplicate-source.csv',
          fileHash: digest(`${prefix}source-duplicates`),
          mode: 'skip',
          validateOnly: true,
          rows: [
            { id: interviewer.id, name: interviewer.name },
            { id: interviewer.id, name: interviewer.name },
          ],
        });
        assert.equal(report.errorCount, 2);
        assert.equal(report.skipped, 0);
        assert.ok(report.rows.every((row) => row.action === '错误'));
      },
    );
    await check('Invalid growth dates return a client error without adding an event', async () => {
      const before = await admin.get(`/emps/${interviewer.id}`);
      await admin.post(
        `/emps/${interviewer.id}/timeline`,
        { date: '2026-99-99', type: '备注', detail: '非法日期不应写入' },
        [400, 422],
      );
      assert.equal(
        (await admin.get(`/emps/${interviewer.id}`)).timeline.length,
        before.timeline.length,
      );
    });
    await check(
      'Concurrent overlapping interviewer bookings permit exactly one success',
      async () => {
        const first = await firstStage(await newCandidate('CC1')),
          second = await firstStage(await newCandidate('CC2'));
        const date = localDate(Date.now() + 3 * 86400000);
        const body = {
          date,
          start: '10:00',
          end: '11:00',
          interviewerIds: [interviewer.id],
          method: '视频面试',
          place: '隔离测试会议',
        };
        const replies = await Promise.all(
          [first, second].map((row) =>
            admin.call('POST', `/candidates/${row.id}/interviews`, body, null),
          ),
        );
        assert.deepEqual(
          replies.map((row) => row.status).sort(),
          [200, 409],
          JSON.stringify(replies),
        );
        const winner = replies.find((row) => row.status === 200).data;
        await admin.post(
          `/interviews/${winner.interviews.at(-1).id}/result`,
          { result: '通过', evaluation: '不应提前评价未来面试' },
          [400, 422],
        );
        await manager.post(
          `/interviews/${winner.interviews.at(-1).id}/result`,
          { result: '通过', evaluation: '未配置为面试官的主管' },
          403,
        );
        return { statuses: replies.map((row) => row.status) };
      },
    );
    await check('Active interview candidates cannot be archived', async () => {
      const row = await firstStage(await newCandidate('CA'));
      await admin.call('DELETE', `/candidates/${row.id}`, undefined, [400, 409, 422]);
      assert.equal((await admin.get(`/candidates/${row.id}`)).deleted, false);
    });
    await check(
      'Future onboarding date remains allowed and cannot create duplicate employees',
      async () => {
        const start = Date.now() + 10 * 60000;
        if (localDate(start + 60 * 60000) !== today)
          throw new Error(
            'Run this date-boundary check at least 70 minutes before local midnight.',
          );
        let row = await firstStage(await newCandidate('CH'));
        for (const offset of [0, 30]) {
          row = await admin.post(`/candidates/${row.id}/interviews`, {
            date: today,
            start: localTime(start + offset * 60000),
            end: localTime(start + (offset + 20) * 60000),
            interviewerIds: [secondPerson.id],
            method: '现场面试',
            place: '验收会议室',
          });
          row = await admin.post(`/interviews/${row.interviews.at(-1).id}/result`, {
            result: '通过',
            evaluation: '按原型当日录入评价进入下一阶段',
          });
        }
        assert.equal(row.stage, '待入职');
        const grade =
          all.grades.find((item) => item.status === '启用' && item.scope === '全部部门')?.code ||
          all.grades.find((item) => item.status === '启用')?.code;
        const body = {
          action: '确认入职',
          onboard: future,
          employeeId: `${prefix}HIRE`,
          grade,
          workRegion: region,
          workplace,
          contractCompany: company,
        };
        await manager.post(`/candidates/${row.id}/onboarding`, body, 403);
        const replies = await Promise.all(
          [1, 2].map(() => admin.call('POST', `/candidates/${row.id}/onboarding`, body, null)),
        );
        assert.deepEqual(
          replies.map((item) => item.status).sort(),
          [200, 409],
          JSON.stringify(replies),
        );
        const employee = await admin.get(`/emps/${body.employeeId}`);
        assert.equal(employee.entry, future);
        assert.equal(employee.job, job.id);
        created.push({ type: 'emps', id: employee.id });
      },
    );
  }
}

const report = {
  service: base,
  prefix,
  generatedAt: new Date().toISOString(),
  results,
  created,
  note: 'Synthetic fixtures remain only in the isolated acceptance database so failures can be inspected; no existing project rows are edited.',
};
await fs.mkdir(path.join(root, '.local', 'verification'), { recursive: true });
await fs.writeFile(
  path.join(root, '.local', 'verification', 'security.json'),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    passed: results.filter((row) => row.status === 'PASS').length,
    failed: results.filter((row) => row.status === 'FAIL').length,
    prefix,
    report: '.local/verification/security.json',
  }),
);
if (results.some((row) => row.status === 'FAIL')) process.exitCode = 1;
