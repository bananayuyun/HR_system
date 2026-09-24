import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const base = 'http://127.0.0.1:8091/api';
const prefix = `REQ${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);

class Client {
  cookie = '';
  async call(method, path, body, status = 200) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: 'http://127.0.0.1:5180',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) this.cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  get(path, status) { return this.call('GET', path, undefined, status); }
  post(path, body, status) { return this.call('POST', path, body, status); }
  put(path, body, status) { return this.call('PUT', path, body, status); }
  delete(path, status) { return this.call('DELETE', path, undefined, status); }
}

const admin = new Client();
const manager = new Client();
await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
const managerLogin = await manager.post('/auth/login', { username: 'manager', password: 'manager123' });
assert.equal(managerLogin.user.role, 'manager');
assert.equal(managerLogin.user.dataScope, 'ALL');
const bootstrap = await admin.get('/bootstrap');
const managerBootstrap = await manager.get('/bootstrap');
assert.equal(bootstrap.grades.length, 33);
assert.deepEqual(
  new Set(bootstrap.grades.map((grade) => grade.code)),
  new Set('M4 M5 M6 M7 M8 M9 M10 M11 M12 T1 T2 T3 T4 T5 T6 T7 T8 S1 S2 S3 S4 S5 S6 S7 S8 P1 P2 P3 P4 P5 P6 P7 P8'.split(' ')),
);
assert.equal(managerBootstrap.orgs.length, bootstrap.orgs.length);
const crossOrgJob = await manager.post('/jobs', {
  id: `${prefix}J`, name: `${prefix}跨部门岗位`, dept: 'ORG_02', headcount: 1,
  status: '启用', duties: '验收', requirements: '验收',
});
assert.equal(crossOrgJob.dept, 'ORG_02');

const firstOrg = await admin.post('/orgs', {
  id: 'CLIENT_SHOULD_NOT_CHOOSE_CODE', name: `${prefix}甲`, parent: 'ORG_ROOT', orgType: '部门', status: '启用',
});
const secondOrg = await admin.post('/orgs', {
  name: `${prefix}乙`, parent: 'ORG_ROOT', orgType: '部门', status: '启用',
});
assert.match(firstOrg.id, /^ORG_[a-f0-9]{16}$/i);
assert.notEqual(firstOrg.id, 'CLIENT_SHOULD_NOT_CHOOSE_CODE');
assert.ok(Number(secondOrg.sortOrder) > Number(firstOrg.sortOrder));
await admin.post(`/orgs/${secondOrg.id}/move`, { direction: 'up' });
const moved = await admin.get(`/orgs/${secondOrg.id}`);
const displaced = await admin.get(`/orgs/${firstOrg.id}`);
assert.ok(Number(moved.sortOrder) < Number(displaced.sortOrder));

const stoppedSecondary = await admin.post('/emps', {
  id: `${prefix}E`, name: `${prefix}员工`, dept: 'ORG_18', secondaryDept: firstOrg.id,
  status: '正式', entry: today,
}, 400);
assert.match(stoppedSecondary.message, /兼任部门录入已停用/);
const employee = await admin.post('/emps', {
  id: `${prefix}E`, name: `${prefix}员工`, dept: 'ORG_18',
  status: '正式', entry: today,
});
assert.equal(employee.secondaryDept, '');
const premature = await admin.delete(`/emps/${employee.id}/permanent`, 409);
assert.match(premature.message, /请先办理离职/);
const left = await admin.post(`/emps/${employee.id}/actions/leave`, {
  reason: '需求验收', version: employee.version,
});
assert.equal(left.status, '已离职');
assert.equal(left.leaveDate, today);
assert.ok(left.timeline.some((item) => item.type === '离职'));
assert.equal((await admin.get(`/emps/${employee.id}`)).secondaryDept, '');
const reinstated = await admin.post(`/emps/${employee.id}/actions/reinstate`, { version: left.version });
assert.equal(reinstated.status, '正式');
assert.equal(reinstated.leaveDate, '');
assert.ok(reinstated.timeline.some((item) => item.type === '复职'));
const leftAgain = await admin.post(`/emps/${employee.id}/actions/leave`, {
  leaveDate: today, reason: '需求验收', version: reinstated.version,
});
assert.equal(leftAgain.status, '已离职');
await admin.delete(`/emps/${employee.id}/permanent`);
await admin.get(`/emps/${employee.id}`, 404);

const rows = [{
  id: `${prefix}I`, name: `${prefix}导入员工`, department: 'ORG_18',
  grade: 'T2-6', job: '不存在的职位',
  company: `${prefix}合同主体`, location: `${prefix}片区`, workplace: `${prefix}所在地`,
  status: '未知状态', entry: today,
}];
const secondaryRows = [{ ...rows[0], secondaryDept: firstOrg.id }];
const rejectedSecondaryImport = await admin.post('/imports/emps', {
  rows: secondaryRows, validateOnly: true,
  fileHash: crypto.createHash('sha256').update(JSON.stringify(secondaryRows)).digest('hex'),
});
assert.equal(rejectedSecondaryImport.errorCount, 1);
assert.match(rejectedSecondaryImport.rows[0].errors[0], /兼任部门录入已停用/);
const fileHash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const importBody = { rows, fileHash, fileName: `${prefix}.xlsx`, mode: 'update' };
const preview = await admin.post('/imports/emps', { ...importBody, validateOnly: true });
assert.equal(preview.added, 1);
assert.equal(preview.errorCount, 0);
assert.ok(preview.rows[0].warnings.length >= 3);
const firstImport = await admin.post('/imports/emps', importBody);
assert.equal(firstImport.added, 1);
const secondImport = await admin.post('/imports/emps', { ...importBody, mode: 'skip' });
assert.equal(secondImport.duplicate, true);
const thirdImport = await admin.post('/imports/emps', importBody);
assert.equal(thirdImport.duplicate, true);
const updatedImport = await admin.post('/imports/emps', {
  ...importBody,
  fileHash: crypto.createHash('sha256').update(fileHash + ':updated').digest('hex'),
});
assert.equal(updatedImport.updated, 1);
const imported = await admin.get(`/emps/${rows[0].id}`);
assert.equal(imported.grade, 'T2');
assert.equal(String(imported.salaryBand), '6');
assert.equal(imported.secondaryDept, '');
assert.equal(imported.company, rows[0].company);
assert.equal(imported.job, '');
assert.equal(imported.status, '正式');
const invalidRows = [
  { id: `${prefix}B`, name: '错误手机号', department: 'ORG_18', phone: '123' },
  { id: `${prefix}C`, name: '错误部门', department: 'NO_SUCH_ORG' },
  { id: `${prefix}D`, name: '错误日期', department: 'ORG_18', entry: '2026-99-99' },
  { id: `${prefix}X`, name: '重复一', department: 'ORG_18' },
  { id: `${prefix}X`, name: '重复二', department: 'ORG_18' },
];
const invalid = await admin.post('/imports/emps', {
  rows: invalidRows, mode: 'update', validateOnly: true,
  fileHash: crypto.createHash('sha256').update(JSON.stringify(invalidRows)).digest('hex'),
});
assert.equal(invalid.errorCount, invalidRows.length);
console.log('PASS organization order, single current organization, employee lifecycle, grade catalog, repeat import, validation levels, manager all-scope');
