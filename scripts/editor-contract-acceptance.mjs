import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:8091/api';
const prefix = 'FIXQACONTRACT' + Date.now().toString(36).toUpperCase();
const results = [], created = [];
let cookie = '';
async function call(method, resource, body, expected = 200) {
  const response = await fetch(base + resource, {
    method,
    headers: { Origin: 'http://127.0.0.1:5175', Cookie: cookie,
      ...(body ? {'Content-Type': 'application/json'} : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${resource}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function create(type, body) {
  const value = await call('POST', '/' + type, body);
  created.push({type, id:value.id});
  return value;
}
async function check(name, action) {
  try { const evidence = await action(); results.push({name, status:'PASS', evidence}); }
  catch (error) { results.push({name, status:'FAIL', error:error.message}); }
  console.log(results.at(-1).status + ' ' + name);
}
const startedAt = new Date().toISOString();
await call('POST', '/auth/login', {username:'admin', password:process.env.HR_INITIAL_ADMIN_PASSWORD || 'admin123'});
const bootstrap = await call('GET', '/bootstrap');
const dict = key => bootstrap.baseSettings[key].filter(value => value.status === '启用').map(value => value.name);
const [region, otherRegion] = dict('workRegion');
assert.ok(otherRegion && otherRegion !== region, 'Two enabled work regions are needed.');
const orgA = await create('orgs', {id:prefix+'OA',name:prefix+'甲部门',parent:'ORG_ROOT',orgType:'部门',status:'启用'});
const orgB = await create('orgs', {id:prefix+'OB',name:prefix+'乙部门',parent:'ORG_ROOT',orgType:'部门',status:'启用'});
const jobA = await create('jobs', {id:prefix+'JA',name:prefix+'甲岗位',dept:orgA.id,headcount:20,status:'启用'});
const jobB = await create('jobs', {id:prefix+'JB',name:prefix+'乙岗位',dept:orgB.id,headcount:20,status:'启用'});
const employeeData = suffix => ({id:prefix+suffix,name:prefix+suffix,dept:orgA.id,mainDept:orgA.id,job:jobA.id,
  status:'正式',entry:'2020-01-01',workRegion:region,workplace:dict('workplace')[0],contractCompany:dict('contractCompany')[0]});
const employeeA = await create('emps', employeeData('EA'));
const employeeB = await create('emps', {...employeeData('EB'), supervisor:employeeA.id});
await check('Employee creation accepts prototype supervisor business ID', async () => {
  assert.equal(employeeB.supervisorId, employeeA.id);
  return {employee:employeeB.id, supervisorId:employeeB.supervisorId};
});
await check('Employee work-section supervisor patch changes the stable FK', async () => {
  const before = await call('GET', '/emps/'+employeeB.id);
  const after = await call('PUT','/emps/'+employeeB.id,{version:before.version,supervisor:employeeA.id});
  assert.equal(after.supervisorId, employeeA.id);
  return {employee:after.id, supervisorId:after.supervisorId};
});
await check('Education section graduated date persists and reads back', async () => {
  const before = await call('GET', '/emps/'+employeeA.id);
  const after = await call('PUT','/emps/'+employeeA.id,{version:before.version,graduated:'2018-06-30'});
  assert.equal(after.graduated, '2018-06-30');
  assert.equal(after.graduation, '2018-06-30');
  return {employee:after.id,graduated:after.graduated};
});
for (const [workType, code] of [['劳务派遣', 'LABOR_DISPATCH'], ['其它', 'OTHER']]) {
  await check('Work type persists and audits ' + workType, async () => {
    const before = await call('GET', '/emps/' + employeeB.id);
    const after = await call('PUT', '/emps/' + employeeB.id, {version:before.version, workType});
    assert.equal(after.workType, workType);
    const reread = await call('GET', '/emps/' + employeeB.id);
    assert.equal(reread.workType, workType);
    const logs = await call('GET', '/emps/' + employeeB.id + '/audit');
    assert.ok(logs.some(log => log.action === 'UPDATE' && log.changes?.some(change => change.field === 'employee_type' && change.label === '用工类型' && change.before === before.workType && change.after === workType)), 'Canonical work-type audit change must preserve its before/after display labels.');
    return {employee:after.id,workType:reread.workType,auditBefore:before.workType,auditAfter:workType,databaseCode:code};
  });
}
await check('Unknown work type is rejected without changing the employee', async () => {
  const before = await call('GET', '/emps/' + employeeB.id);
  await call('PUT', '/emps/' + employeeB.id, {version:before.version, workType:'UNKNOWN_TEST_TYPE'}, 400);
  const after = await call('GET', '/emps/' + employeeB.id);
  assert.equal(after.version, before.version);
  assert.equal(after.workType, before.workType);
  return {employee:after.id,version:after.version,workType:after.workType};
});
await check('Department patch replaces stale mainDeptId without dropping other fields', async () => {
  const before = await call('GET', '/emps/'+employeeA.id);
  const after = await call('PUT','/emps/'+employeeA.id,{version:before.version,dept:orgB.id,mainDept:orgB.id,job:jobB.id});
  assert.equal(after.mainDeptId, orgB.id);
  assert.equal(after.dept, orgB.id);
  assert.equal(after.workRegion, before.workRegion);
  return {employee:after.id,dept:after.dept,mainDeptId:after.mainDeptId};
});
const asset = await create('assets', {id:prefix+'AS',name:prefix+'电脑',category:'电子设备',dept:orgA.id,
  status:'使用中',public:'否',owner:employeeB.id,workRegion:region,office:'原位置',cost:1});
await check('Repair start ignores unrelated empty owner and applies canonical location', async () => {
  const before = await call('GET','/assets/'+asset.id);
  const after = await call('POST','/assets/'+asset.id+'/actions/repair-start',
    {version:before.version,owner:'',location:otherRegion,office:'维修位置',reason:'契约校验'});
  assert.equal(after.owner, employeeB.id);
  assert.equal(after.workRegion, otherRegion);
  assert.equal(after.status, '维修中');
  return {asset:after.id,owner:after.owner,workRegion:after.workRegion,status:after.status};
});
await check('Repair end preserves the assignee and returns to in-use state', async () => {
  const before = await call('GET','/assets/'+asset.id);
  const after = await call('POST','/assets/'+asset.id+'/actions/repair-end',
    {version:before.version,owner:'',location:otherRegion,office:'维修后位置',reason:'契约校验'});
  assert.equal(after.owner, employeeB.id);
  assert.equal(after.status, '使用中');
  return {asset:after.id,owner:after.owner,status:after.status};
});
const asset2 = await create('assets', {id:prefix+'AT',name:prefix+'位置校验',category:'电子设备',dept:orgA.id,
  status:'使用中',public:'否',owner:employeeB.id,workRegion:region,office:'原位置',cost:1});
await check('Location action does not clear assignee and honors canonical-only patch', async () => {
  const after = await call('POST','/assets/'+asset2.id+'/actions/location',
    {version:asset2.version,owner:'',location:otherRegion,office:'新位置',reason:'契约校验'});
  assert.equal(after.owner,employeeB.id);
  assert.equal(after.workRegion,otherRegion);
  assert.equal(after.location,otherRegion);
  return {asset:after.id,owner:after.owner,location:after.location};
});
const report = {startedAt,finishedAt:new Date().toISOString(),base,prefix,created,results,
  summary:{passed:results.filter(value=>value.status==='PASS').length,failed:results.filter(value=>value.status==='FAIL').length},
  fixturePolicy:'Only uniquely prefixed test records were written on localhost:8091; fixtures retained for cross-check and audit.'};
await fs.mkdir(path.join(root,'.local','verification'),{recursive:true});
await fs.writeFile(path.join(root,'.local','verification','editor-contract-'+prefix+'.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.join(root,'.local','verification','editor-contract.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({prefix,...report.summary}));
if(report.summary.failed)process.exitCode=1;
