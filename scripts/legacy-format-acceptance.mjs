import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:8091/api';
const supplied = process.argv.find(value => value.startsWith('--fixture='))?.slice(10);
const generateOnly = process.argv.includes('--generate-only');
const prefix = supplied || 'FIXQAFORMAT' + Date.now().toString(36).toUpperCase();
assert.match(prefix, /^FIXQAFORMAT[A-Z0-9]+$/);
const directory = path.join(root, '.local', 'verification', 'legacy-formats', prefix);
const startedAt = new Date().toISOString();
const results = [];
function execute(program, args) {
  const result = spawnSync(program, args, {encoding:'utf8', cwd:root, windowsHide:true, timeout:60000});
  if (result.status !== 0) throw new Error(program + ' failed: ' + (result.stderr || result.stdout || result.error));
}
if (!supplied) {
  const reports = path.join(root, 'backend', 'target', 'surefire-reports');
  const names = (await fs.readdir(reports)).filter(value => /^TEST-.*\.xml$/.test(value));
  const xml = await fs.readFile(path.join(reports, names[0]), 'utf8');
  const encoded = xml.match(/<property name="java\.class\.path" value="([^"]+)"\s*\/>/)?.[1];
  assert.ok(encoded, 'Run backend unit tests first to provide the installed dependency classpath.');
  const decode = value => value.replace(/&(amp|quot|apos|lt|gt);/g, (_, key) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'})[key]);
  const classpath = decode(encoded).split(path.delimiter).filter(value => value.endsWith('.jar')).join(path.delimiter);
  const classes = path.join(directory, 'fixture-classes');
  await fs.mkdir(classes, {recursive:true});
  try {
    execute('javac.exe', ['-encoding','UTF-8','-cp',classpath,'-d',classes,path.join(root,'scripts','fixtures','LegacyFormatFixture.java')]);
    execute('java.exe', ['-cp',classes + path.delimiter + classpath,'LegacyFormatFixture',directory,prefix]);
  } finally {
    await fs.unlink(path.join(classes, 'LegacyFormatFixture.class')).catch(error => {if(error.code!=='ENOENT')throw error;});
    await fs.rmdir(classes);
  }
}
const manifest = JSON.parse(await fs.readFile(path.join(directory,'fixture-manifest.json'),'utf8'));
const xlsBytes = await fs.readFile(manifest.xls.path), pdfBytes = await fs.readFile(manifest.pdf.path);
assert.equal(xlsBytes.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1','XLS must be an actual OLE2/BIFF file.');
assert.equal(pdfBytes.subarray(0,5).toString('ascii'),'%PDF-');
if (generateOnly) {
  console.log(JSON.stringify({prefix,directory,generated:true,apiExecuted:false}));
  process.exit(0);
}
let cookie = '';
let interruption = null;
async function request(resource, body, multipart = false) {
  let response;
  try {
    response = await fetch(base + resource, {method:'POST',headers:{Origin:'http://127.0.0.1:5175',Cookie:cookie,
      ...(!multipart ? {'Content-Type':'application/json'} : {})},body:multipart ? body : JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  } catch(error) {
    error.environmentInterruption = true;
    throw error;
  }
  const cookies = response.headers.getSetCookie();
  if(cookies.length)cookie=cookies.map(value=>value.split(';')[0]).join('; ');
  const data = await response.json();
  if(response.status >= 500) {
    const error = new Error(`${resource}: HTTP ${response.status}; requestId=${data.requestId || 'unavailable'}`);
    error.environmentInterruption = true;
    throw error;
  }
  assert.equal(response.status,200,`${resource}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function check(name, action) {
  try {const evidence=await action();results.push({name,status:'PASS',evidence});}
  catch(error){if(error.environmentInterruption)throw error;results.push({name,status:'FAIL',error:error.message});}
  console.log(results.at(-1).status+' '+name);
}
try {
await request('/auth/login',{username:'admin',password:process.env.HR_INITIAL_ADMIN_PASSWORD || 'admin123'});
await check('Real BIFF XLS preserves Chinese, typed dates, leading zeros and row positions', async()=>{
  const form=new FormData();form.append('file',new Blob([xlsBytes],{type:'application/vnd.ms-excel'}),path.basename(manifest.xls.path));
  const result=await request('/imports/emps/parse',form,true);
  assert.deepEqual(result.headers,manifest.xls.headers);
  assert.deepEqual(result.rows,manifest.xls.rows);
  assert.equal(result.headerRow,2);
  assert.equal(result.sheetName,'花名册兼容');
  return {file:path.basename(manifest.xls.path),sha256:crypto.createHash('sha256').update(xlsBytes).digest('hex'),bytes:xlsBytes.length,...result};
});
await check('Text PDF resume extracts actual name, phone and email with parsed=true', async()=>{
  const form=new FormData();form.append('file',new Blob([pdfBytes],{type:'application/pdf'}),path.basename(manifest.pdf.path));
  const result=await request('/resumes/parse',form,true);
  assert.equal(result.parsed,true);
  assert.equal(result.issue,'');
  assert.equal(result.name,manifest.pdf.name);
  assert.equal(result.phone,manifest.pdf.phone);
  assert.equal(result.email,manifest.pdf.email);
  assert.ok(result.raw.includes(prefix));
  assert.equal(result.raw.replace(/\r\n/g,'\n'),manifest.pdf.text.replace(/\r\n/g,'\n'));
  return {file:path.basename(manifest.pdf.path),sha256:crypto.createHash('sha256').update(pdfBytes).digest('hex'),bytes:pdfBytes.length,parsed:result.parsed,name:result.name,phone:result.phone,email:result.email,rawMatchesFixture:true};
});
} catch(error) {
  interruption={at:new Date().toISOString(),kind:error.environmentInterruption?'ENVIRONMENT':'SETUP',message:error.message};
  console.error('STOP '+interruption.message);
}
const report={startedAt,finishedAt:new Date().toISOString(),base,prefix,results,
  summary:{passed:results.filter(value=>value.status==='PASS').length,failed:results.filter(value=>value.status==='FAIL').length,blocked:interruption?2-results.length:0},interruption,
  additionalFormatSuite:{format:'Legacy binary .doc',script:'scripts/legacy-doc-acceptance.mjs',report:'.local/verification/legacy-doc.json',note:'Verified separately using an unmodified official Apache POI binary Word fixture.'},
  scope:'Only login and read-only parsing endpoints were called. No employees, candidates or import logs were created.',fixtureDirectory:directory};
await fs.writeFile(path.join(root,'.local','verification','legacy-format-'+prefix+'.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.join(root,'.local','verification','legacy-format.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({prefix,...report.summary}));
if(interruption)process.exitCode=2;
else if(report.summary.failed)process.exitCode=1;
