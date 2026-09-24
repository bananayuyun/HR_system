import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = require(path.join(root, 'frontend/node_modules/fflate'));
const base = 'http://127.0.0.1:8091/api';
const tag = 'QARESUME' + Date.now().toString(36).toUpperCase();
const results = [];
let cookie = '',
  candidate,
  unboundCandidate;
const headers = () => ({ Cookie: cookie, Origin: 'http://127.0.0.1:5175' });
async function json(method, url, body, expected = 200) {
  const r = await fetch(base + url, {
    method,
    headers: { ...headers(), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (r.headers.getSetCookie().length)
    cookie = r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data;
}
async function upload(url, name, bytes, data, expected = 200) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  if (data) form.append('data', JSON.stringify(data));
  const r = await fetch(base + url, { method: 'POST', headers: headers(), body: form });
  const body = await r.json();
  assert.equal(r.status, expected, JSON.stringify(body));
  return body;
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message });
    console.error('FAIL ' + name + ': ' + e.message);
  }
}
const phone = '189' + String(Date.now()).slice(-8);
const raw = `姓名：测试简历\n电话：${phone}\n邮箱：resume@example.test`;
const xml =
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  raw
    .split('\n')
    .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
    .join('') +
  '</w:body></w:document>';
const docx = zipSync({
  '[Content_Types].xml': strToU8(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  '_rels/.rels': strToU8(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  'word/document.xml': strToU8(xml),
});
try {
  await json('POST', '/auth/login', {
    username: 'admin',
    password: process.env.HR_INITIAL_ADMIN_PASSWORD || 'admin123',
  });
  const bootstrap = await json('GET', '/bootstrap');
  await check('TXT and DOCX resume parsing extracts real name, phone and email', async () => {
    for (const [name, bytes] of [
      ['resume.txt', Buffer.from(raw)],
      ['resume.docx', docx],
    ]) {
      const parsed = await upload('/resumes/parse', name, bytes);
      assert.equal(parsed.parsed, true);
      assert.equal(parsed.name, '测试简历');
      assert.equal(parsed.phone, phone);
      assert.equal(parsed.email, 'resume@example.test');
    }
  });
  await check(
    'Broken document and image require manual input; empty upload is rejected',
    async () => {
      for (const name of ['broken.docx', 'scanned.png']) {
        const parsed = await upload('/resumes/parse', name, Buffer.from('invalid fixture'));
        assert.equal(parsed.parsed, false);
        assert.ok(parsed.issue.includes('手工'));
        assert.equal(parsed.phone, '');
      }
      await upload('/resumes/parse', 'empty.txt', Buffer.alloc(0), undefined, 400);
    },
  );
  const request = bootstrap.reqs.find((r) => r.status === '招聘中' && !r.deletedAt);
  assert.ok(request, 'An open test-database recruitment request is required');
  const dict = (key) => bootstrap.baseSettings[key].find((r) => r.status === '启用').name;
  const data = {
    id: tag,
    name: '测试简历',
    phone,
    req: request.id,
    workRegion: dict('workRegion'),
    workplace: dict('workplace'),
    contractCompany: dict('contractCompany'),
    source: '内部推荐',
    education: '本科',
    years: 3,
  };
  await check('Resume can enter the pool before a recruitment request and later be linked', async () => {
    const unboundId = tag + 'UNBOUND';
    const unboundPhone = '188' + String(Date.now()).slice(-8);
    unboundCandidate = await upload('/resumes', unboundId + '.docx', docx, {
      id: unboundId,
      name: '待关联简历',
      phone: unboundPhone,
      source: '内部推荐',
      education: '待核对',
      years: 0,
    });
    assert.equal(unboundCandidate.stage, '待关联需求');
    assert.equal(unboundCandidate.req, '');
    assert.equal(unboundCandidate.files.length, 1);
    assert.ok((await json('GET', '/bootstrap')).candidates.some((item) => item.id === unboundId));
    const managerLogin = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:5175', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'manager', password: process.env.HR_INITIAL_MANAGER_PASSWORD || 'manager123' }),
    });
    assert.equal(managerLogin.status, 200);
    const managerCookie = managerLogin.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const managerRead = await fetch(base + '/candidates/' + unboundId, {
      headers: { Origin: 'http://127.0.0.1:5175', Cookie: managerCookie },
    });
    assert.equal(managerRead.status, 403);
    const file = await fetch(base + '/candidates/files/' + unboundCandidate.files[0].id, {
      headers: headers(),
    });
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(docx));
    const linked = await json('PUT', '/candidates/' + unboundId, {
      version: unboundCandidate.version,
      req: request.id,
      workRegion: dict('workRegion'),
      workplace: dict('workplace'),
    });
    assert.equal(linked.req, request.id);
    assert.equal(linked.stage, '待 HR 筛选');
    assert.equal(linked.files.length, 1);
  });
  await check(
    'Candidate creation and original attachment commit together; download bytes match',
    async () => {
      candidate = await upload('/resumes', tag + '.docx', docx, data);
      assert.equal(candidate.id, tag);
      const fresh = await json('GET', '/candidates/' + tag);
      assert.equal(fresh.phone, phone);
      assert.equal(fresh.files.length, 1);
      const file = await fetch(base + '/candidates/files/' + fresh.files[0].id, {
        headers: headers(),
      });
      assert.equal(file.status, 200);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(docx));
    },
  );
  await check('Rejected attachment rolls back candidate creation', async () => {
    const invalid = { ...data, id: tag + 'REJECT', phone: '187' + String(Date.now()).slice(-8) };
    await upload('/resumes', 'rejected.exe', Buffer.from('invalid fixture'), invalid, 400);
    await json('GET', '/candidates/' + invalid.id, undefined, 404);
  });
} finally {
  if (candidate) {
    const fresh = await json('GET', '/candidates/' + tag);
    for (const file of fresh.files || []) await json('DELETE', '/candidates/files/' + file.id);
    await json('DELETE', '/candidates/' + tag);
  }
  if (unboundCandidate) {
    const fresh = await json('GET', '/candidates/' + unboundCandidate.id);
    for (const file of fresh.files || []) await json('DELETE', '/candidates/files/' + file.id);
    await json('DELETE', '/candidates/' + unboundCandidate.id);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    base,
    tag,
    results,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: results.filter((r) => r.status === 'FAIL').length,
    cleanup: 'Synthetic candidate and attachment soft-archived in isolated test database only',
  };
  await fs.mkdir(path.join(root, '.local/verification'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.local/verification/resumes.json'),
    JSON.stringify(report, null, 2),
  );
  if (report.failed) process.exitCode = 1;
}
