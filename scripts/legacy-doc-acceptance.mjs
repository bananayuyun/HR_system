import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const base = 'http://127.0.0.1:8091/api';
const fixture = path.join(root, '.local/verification/legacy-formats/FIXQAFORMATMUDPN62Z/apache-poi-simple.doc');
const source = 'https://svn.apache.org/repos/asf/poi/tags/REL_5_3_0/test-data/document/simple.doc';
const checksum = '4876e828e62d490fa188c7c4e47013e2e0dfdf02f5903dfd374bc0d2b2049ca1';
const expectedText = 'This is a simple file created with Word 97-SR2.\r\n\r\n';
const report = {startedAt:new Date().toISOString(),base,source,fixture,sha256:checksum,
  scope:'Read-only parsing of an unmodified public Apache POI Word 97 fixture; no candidates or files persisted.',results:[]};
let cookie = '';
async function request(resource, body, multipart = false) {
  const response = await fetch(base + resource, {method:'POST',headers:{Origin:'http://127.0.0.1:5175',Cookie:cookie,
    ...(!multipart?{'Content-Type':'application/json'}:{})},body:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const cookies = response.headers.getSetCookie();
  if(cookies.length)cookie=cookies.map(value=>value.split(';')[0]).join('; ');
  const value = await response.json();
  if(response.status >= 500) {
    const error = new Error(`${resource}: HTTP ${response.status}; requestId=${value.requestId || 'unavailable'}`);
    error.environmentInterruption = true;
    throw error;
  }
  assert.equal(response.status,200,resource + ': ' + JSON.stringify(value));
  return value;
}
try {
  let bytes;
  try {bytes = await fs.readFile(fixture);}
  catch(error) {
    if(error.code !== 'ENOENT')throw error;
    const response = await fetch(source,{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200,'Official Apache fixture download failed.');
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),checksum);
    await fs.mkdir(path.dirname(fixture),{recursive:true});
    await fs.writeFile(fixture,bytes);
  }
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),checksum);
  assert.equal(bytes.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
  await request('/auth/login',{username:'admin',password:process.env.HR_INITIAL_ADMIN_PASSWORD || 'admin123'});
  const form = new FormData();
  form.append('file',new Blob([bytes],{type:'application/msword'}),'FIXQAFORMAT-apache-poi-simple.doc');
  const parsed = await request('/resumes/parse',form,true);
  assert.equal(parsed.parsed,true);
  assert.equal(parsed.issue,'');
  assert.equal(parsed.raw.replace(/\r\n/g,'\n'),expectedText.replace(/\r\n/g,'\n'));
  for(const key of ['name','phone','email'])assert.equal(parsed[key],'',key+' must remain empty, not fabricated.');
  report.results.push({name:'Official real binary DOC extracts verified text and leaves absent personal fields empty',status:'PASS',
    evidence:{bytes:bytes.length,parsed:true,rawMatchesOfficialFixture:true,personalFieldsEmpty:true}});
} catch(error) {
  const blocked = error.environmentInterruption || error.name === 'TimeoutError' || error.cause;
  report.results.push({name:'Official real binary DOC parser compatibility',status:blocked?'BLOCKED':'FAIL',error:error.message});
}
report.finishedAt = new Date().toISOString();
report.summary = Object.fromEntries(['PASS','FAIL','BLOCKED'].map(status=>[status.toLowerCase(),report.results.filter(value=>value.status===status).length]));
await fs.writeFile(path.join(root,'.local/verification/legacy-doc.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary));
if(report.summary.fail || report.summary.blocked)process.exitCode=1;
