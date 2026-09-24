import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.HR_MODULE_UI_URL || "http://127.0.0.1:5175";
const target = new URL(base);
assert.ok(
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
    target.port === "5175",
  "Only isolated test frontend 5175 / backend 8091 is allowed",
);
const require = createRequire(import.meta.url);
const modules =
  process.env.HR_NODE_MODULES || path.join(root, "frontend/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const { zipSync, strToU8 } = require(path.join(modules, "fflate"));
const attachmentOnly = process.env.HR_MODULE_ATTACHMENT_ONLY === "1";
const previous = attachmentOnly
  ? JSON.parse(
      await fs.readFile(
        path.join(root, ".local/verification/module-crud/first-run.json"),
        "utf8",
      ),
    )
  : null;
if (previous)
  assert.equal(
    previous.results.find((r) => r.name.startsWith("Batch resume confirm"))
      ?.status,
    "PASS",
    "Original byte-equality commit evidence is required before read-only attachment retest",
  );
const prefix =
  previous?.prefix || "QAMODULE" + Date.now().toString(36).toUpperCase();
const out = path.join(
  root,
  ".local/verification/module-crud",
  attachmentOnly ? "attachment-retest" : "",
);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.HR_BROWSER_PATH
    ? { executablePath: process.env.HR_BROWSER_PATH }
    : {}),
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(14000);
const results = [],
  errors = [],
  created = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
let bootstrap, job, hiringJob, grade, request, resumes, candidates;
const active = (r) => !r.deletedAt && !r.deleted && !r.archived;
const dialog = () => page.getByRole("dialog").last();
async function api(method, resource, data, expected = [200, 201]) {
  const response = await ctx.request.fetch(base + "/api" + resource, {
    method,
    headers: { Origin: base },
    ...(data === undefined ? {} : { data }),
  });
  const body = await response.json();
  assert.ok(
    expected.includes(response.status()),
    `${method} ${resource}: ${response.status()} ${JSON.stringify(body)}`,
  );
  return body;
}
async function report() {
  const value = {
    generatedAt: new Date().toISOString(),
    mode: "Real Vue UI and isolated MySQL; no request mocks",
    target: base,
    backend: "8091",
    prefix,
    results,
    errors,
    created,
    requests,
    boundaries: [
      "Job creation is an API fixture because basic browser suite already covers its valid UI create.",
      "Final prototype has no recruitment-request delete control; this suite does not invent one.",
      "TXT is rejected by the batch UI; positive two-file path uses DOCX. Backend TXT parse is separately covered.",
      "Synthetic open recruitment request, candidates and attachments remain in test database for evidence; no development data or passwords changed.",
    ],
    summary: {
      passed: results.filter((r) => r.status === "PASS").length,
      failed: results.filter((r) => r.status === "FAIL").length,
      total: results.length,
    },
  };
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(value, null, 2),
  );
  return value;
}
async function check(name, fn) {
  if (attachmentOnly && !name.startsWith("Reloaded candidate")) return;
  const start = Date.now();
  try {
    const evidence = await fn();
    results.push({ name, status: "PASS", ms: Date.now() - start, evidence });
    console.log("PASS " + name);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      ms: Date.now() - start,
      error: error.stack,
    });
    console.error("FAIL " + name + ": " + error.message);
    await fs.writeFile(
      path.join(out, String(results.length).padStart(2, "0") + "-failure.html"),
      await page.content(),
    );
  }
  await page
    .screenshot({
      path: path.join(out, String(results.length).padStart(2, "0") + ".png"),
      fullPage: true,
    })
    .catch(() => {});
  await report();
}
async function closeDialogs() {
  for (let i = 0; i < 4; i++) {
    const discard = page.getByRole("alertdialog", {
      name: "未保存的更改",
      exact: true,
    });
    if (await discard.isVisible())
      await discard
        .getByRole("button", { name: "放弃更改", exact: true })
        .click();
    if (!(await page.locator(".v-dialog").count())) return;
    await dialog()
      .locator(".modal-h")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  }
  assert.equal(
    await page.locator(".v-dialog").count(),
    0,
    "Close nested drawers through normal UI",
  );
}
async function goto(route) {
  await closeDialogs();
  await page.goto(base + "/?module=" + Date.now() + "#/" + route);
  await page.locator(`.v-content[data-page="${route}"]`).waitFor();
  await page.locator(".v-busy").waitFor({ state: "hidden" });
}
async function search(value) {
  await page
    .getByRole("textbox", { name: "关键词搜索", exact: true })
    .fill(value);
  await page
    .getByRole("textbox", { name: "关键词搜索", exact: true })
    .press("Enter");
}
async function rowAction(route, record, action) {
  await goto(route);
  await search(record.id);
  await page
    .locator(".tbl tbody tr")
    .filter(
      route === "pool"
        ? { has: page.getByRole("button", { name: record.name, exact: true }) }
        : { hasText: record.id },
    )
    .getByRole("button", { name: action, exact: true })
    .click();
}
async function select(key, label) {
  const box = dialog().locator(`.ant-select:has(#field-${key})`);
  await box.locator(".ant-select-selector").click();
  const control = box.locator("input[role=combobox]");
  await control.fill(label);
  const id = await control.getAttribute("aria-controls");
  const popup = page
    .locator(".ant-select-dropdown:visible")
    .filter({ has: page.locator('[id="' + id + '"]') });
  await popup
    .locator(".ant-select-item-option-content")
    .getByText(label, { exact: true })
    .click();
  if (await popup.isVisible()) await control.press("Escape");
}
async function save(resource, method = "PUT", label = "确定") {
  const waiting = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api" + resource &&
      r.request().method() === method,
  );
  await dialog()
    .locator(".modal-f")
    .getByRole("button", { name: label, exact: true })
    .click();
  const response = await waiting;
  const body = await response.json();
  requests.push({ resource, method, status: response.status() });
  assert.ok(response.ok(), JSON.stringify(body));
  await page.locator(".v-busy").waitFor({ state: "hidden" });
  return body;
}
async function archived(type, record) {
  const value = (await api("GET", "/bootstrap"))[type].find(
    (r) => r.id === record.id,
  );
  assert.ok(!value || value.deleted, "Deleted record must not be active in bootstrap");
  if (value) assert.ok(value.deletedAt);
  await goto(type);
  await search(record.id);
  assert.equal(
    await page.locator(".tbl tbody input[type=checkbox]").count(),
    0,
  );
}
function makeDocx(name, phone, index) {
  const raw = `姓名：${name}\n电话：${phone}\n邮箱：module${index}@example.test\n技能：${prefix}文档核对${index}`;
  const xml =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    raw
      .split("\n")
      .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
      .join("") +
    "</w:body></w:document>";
  const buffer = Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(xml),
    }),
  );
  return {
    originalName: name,
    phone,
    name: `${prefix}-${index}.docx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
    raw,
    reviewedName: prefix + (index === 1 ? "甲核对" : "乙核对"),
  };
}

try {
  await page.goto(base);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.HR_INITIAL_ADMIN_PASSWORD || "admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".v-side").waitFor();
  assert.equal(
    (await ctx.request.get("http://127.0.0.1:8091/api/auth/me")).status(),
    200,
    "Cookie must belong to test service before writes",
  );
  bootstrap = await api("GET", "/bootstrap");
  for (const suffix of attachmentOnly ? [] : ["未引用岗位", "简历岗位"]) {
    const value = await api("POST", "/jobs", {
      name: prefix + suffix,
      dept: "ORG_18",
      headcount: 8,
      status: "启用",
      duties: "独有岗位职责",
      requirements: "独有任职要求",
    });
    created.push({ type: "jobs", id: value.id });
    if (suffix === "未引用岗位") job = value;
    else hiringJob = value;
  }
  if (attachmentOnly) {
    candidates = await Promise.all(
      previous.created
        .filter((r) => r.type === "candidates")
        .map((r) => api("GET", "/candidates/" + r.id)),
    );
    const first = candidates[0],
      file = first.files[0];
    const downloaded = await ctx.request.get(
      base + "/api/candidates/files/" + file.id,
    );
    assert.equal(downloaded.status(), 200);
    resumes = [
      { name: file.name, phone: first.phone, buffer: await downloaded.body() },
    ];
  }

  await check(
    "Job edit, detail, audit log and unreferenced detail deletion persist through actual controls",
    async () => {
      await rowAction("jobs", job, "编辑");
      await dialog()
        .getByLabel("岗位名称", { exact: true })
        .fill(prefix + "岗位已编辑");
      await dialog().getByLabel("岗位编制", { exact: true }).fill("7");
      await dialog()
        .getByLabel("岗位职责", { exact: true })
        .fill(prefix + "岗位职责改动");
      await save("/jobs/" + job.id);
      const updated = await api("GET", "/jobs/" + job.id);
      assert.equal(updated.name, prefix + "岗位已编辑");
      assert.equal(updated.headcount, 7);
      await rowAction("jobs", job, "日志");
      await dialog()
        .getByText(prefix + "岗位职责改动", { exact: true })
        .waitFor();
      assert.ok((await dialog().innerText()).includes("验收 HR"));
      await rowAction("jobs", job, "查看");
      assert.ok((await dialog().innerText()).includes(prefix + "岗位职责改动"));
      await dialog()
        .locator(".modal-f")
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await save("/jobs/" + job.id, "DELETE");
      await archived("jobs", job);
      return { id: job.id };
    },
  );

  await check(
    "Grade valid UI create, detail edit, refresh and unreferenced deletion persist",
    async () => {
      await goto("grades");
      await page
        .locator(".w-toolbar")
        .getByRole("button", { name: "新增", exact: true })
        .click();
      await select("sequence", bootstrap.sequences[0]);
      await dialog()
        .getByLabel("职级编码", { exact: true })
        .fill("M3");
      await dialog()
        .getByLabel("职级名称", { exact: true })
        .fill(prefix + "职级");
      await dialog().getByLabel("对应层级", { exact: true }).fill("3");
      await dialog().getByLabel("参考经验年限", { exact: true }).fill("2");
      await dialog()
        .getByLabel("任职要求", { exact: true })
        .fill(prefix + "职级要求");
      grade = await save("/grades", "POST");
      created.push({ type: "grades", id: grade.id });
      let fresh = await api("GET", "/grades/" + grade.id);
      assert.equal(fresh.code, "M3");
      assert.equal(fresh.level, 3);
      await rowAction("grades", grade, "查看");
      await dialog()
        .locator(".modal-f")
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      await dialog()
        .getByLabel("职级名称", { exact: true })
        .fill(prefix + "职级新");
      await dialog().getByLabel("参考经验年限", { exact: true }).fill("4");
      await save("/grades/" + grade.id);
      fresh = await api("GET", "/grades/" + grade.id);
      assert.equal(fresh.name, prefix + "职级新");
      assert.equal(fresh.min, 4);
      await rowAction("grades", grade, "查看");
      assert.ok((await dialog().innerText()).includes(prefix + "职级新"));
      await dialog()
        .locator(".modal-f")
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await save("/grades/" + grade.id, "DELETE");
      await archived("grades", grade);
      return { id: grade.id };
    },
  );

  await check(
    "Empty recruitment request valid UI create and status edits; no invented delete action",
    async () => {
      await goto("reqs");
      await page
        .locator(".w-toolbar")
        .getByRole("button", { name: "新增", exact: true })
        .click();
      await dialog()
        .getByLabel("需求名称", { exact: true })
        .fill(prefix + "招聘需求");
      await select("job", hiringJob.name);
      await dialog().getByLabel("需求人数", { exact: true }).fill("2");
      await dialog().locator("#field-deadline").click();
      await page
        .locator(".ant-picker-dropdown:visible")
        .getByText("今天", { exact: true })
        .click();
      await dialog().getByLabel("最低月薪（K）", { exact: true }).fill("10");
      await dialog().getByLabel("最高月薪（K）", { exact: true }).fill("20");
      const dict = (key) =>
        bootstrap.baseSettings[key].find((v) => v.status === "启用").name;
      for (const key of ["workRegion", "workplace", "contractCompany"])
        await select(key, dict(key));
      const hr = bootstrap.emps.find(
        (e) => e.dept === "ORG_05" && active(e) && e.status !== "已离职",
      );
      const manager = bootstrap.emps.find(
        (e) => e.dept === "ORG_18" && active(e) && e.status !== "已离职",
      );
      assert.ok(hr && manager);
      for (const key of ["ownerIds", "screenerIds", "firstIds", "secondIds"]) {
        const person = key === "ownerIds" ? hr : manager;
        await select(key, person.name + " / " + person.id);
      }
      request = await save("/reqs", "POST");
      created.push({ type: "reqs", id: request.id });
      let fresh = await api("GET", "/reqs/" + request.id);
      assert.equal(fresh.job, hiringJob.id);
      assert.equal(fresh.count, 2);
      assert.deepEqual(fresh.ownerIds, [hr.id]);
      assert.equal(
        (await api("GET", "/bootstrap")).candidates.filter(
          (c) => active(c) && c.req === request.id,
        ).length,
        0,
      );
      for (const status of ["暂停", "已关闭", "招聘中"]) {
        await rowAction("reqs", request, "查看");
        assert.equal(
          await dialog()
            .getByRole("button", { name: "删除", exact: true })
            .count(),
          0,
        );
        await dialog()
          .locator(".modal-f")
          .getByRole("button", { name: "编辑", exact: true })
          .click();
        await select("status", status);
        await dialog()
          .getByLabel("招聘说明", { exact: true })
          .fill(prefix + status);
        await save("/reqs/" + request.id);
        fresh = await api("GET", "/reqs/" + request.id);
        assert.equal(fresh.status, status);
        assert.equal(fresh.description, prefix + status);
      }
      request = fresh;
      return {
        id: request.id,
        states: ["暂停", "已关闭", "招聘中"],
        candidateCountDuringEdits: 0,
      };
    },
  );

  await check(
    "Batch resume UI rejects TXT, parses two real DOCX files, previews and accepts manual corrections without writing",
    async () => {
      assert.ok(request, "UI-created request prerequisite");
      await goto("pool");
      await page
        .getByRole("button", { name: "批量录入简历", exact: true })
        .click();
      assert.equal(
        await dialog().getByLabel("批量选择简历文件").isDisabled(),
        true,
      );
      await select("resume-req", request.name + " / 开发部");
      await select("resume-source", "内部推荐");
      const input = dialog().getByLabel("批量选择简历文件");
      let parses = 0;
      const recordParse = (r) => {
        if (new URL(r.url()).pathname === "/api/resumes/parse") parses++;
      };
      page.on("request", recordParse);
      await input.setInputFiles({
        name: prefix + ".txt",
        mimeType: "text/plain",
        buffer: Buffer.from("姓名：不可上传"),
      });
      await dialog()
        .getByRole("alert")
        .getByText(/仅支持 PDF/)
        .waitFor();
      assert.equal(parses, 0);
      const basePhone = Number(String(Date.now()).slice(-8));
      resumes = [
        makeDocx("简历甲", "186" + String(basePhone).padStart(8, "0"), 1),
        makeDocx("简历乙", "186" + String(basePhone + 1).padStart(8, "0"), 2),
      ];
      await input.setInputFiles(
        resumes.map(({ name, mimeType, buffer }) => ({
          name,
          mimeType,
          buffer,
        })),
      );
      await dialog()
        .getByRole("button", { name: "确认录入待筛选", exact: true })
        .waitFor({ state: "visible" });
      await page.waitForFunction(
        () => !document.querySelector(".v-dialog button.pri-btn[disabled]"),
      );
      page.off("request", recordParse);
      assert.equal(parses, 2);
      for (let i = 0; i < resumes.length; i++) {
        assert.equal(
          await dialog()
            .getByLabel(`第${i + 1}份简历姓名`, { exact: true })
            .inputValue(),
          resumes[i].originalName,
        );
        assert.equal(
          await dialog()
            .getByLabel(`第${i + 1}份简历手机号`, { exact: true })
            .inputValue(),
          resumes[i].phone,
        );
        await dialog()
          .locator(".v-mini-table tbody tr")
          .nth(i)
          .getByRole("button", { name: "预览", exact: true })
          .click();
        await dialog()
          .locator("#batch-inline-preview .v-document")
          .getByText(prefix + "文档核对" + (i + 1), { exact: false })
          .waitFor();
        await dialog()
          .getByLabel(`第${i + 1}份简历姓名`, { exact: true })
          .fill(resumes[i].reviewedName);
      }
      assert.equal(
        (await api("GET", "/bootstrap")).candidates.filter(
          (c) => active(c) && c.req === request.id,
        ).length,
        0,
        "Parse and manual correction must not persist candidates",
      );
    },
  );

  await check(
    "Batch resume confirm commits both reviewed candidates and original attachments exactly once",
    async () => {
      assert.ok(resumes?.length === 2 && request);
      let submissions = 0;
      const count = (r) => {
        if (
          new URL(r.url()).pathname === "/api/resumes" &&
          r.method() === "POST"
        )
          submissions++;
      };
      page.on("request", count);
      await dialog()
        .getByRole("button", { name: "确认录入待筛选", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "完成", exact: true })
        .waitFor();
      page.off("request", count);
      assert.equal(submissions, 2);
      assert.equal(await dialog().locator(".resume-success").count(), 2);
      await dialog().getByRole("button", { name: "完成", exact: true }).click();
      candidates = (await api("GET", "/bootstrap")).candidates.filter(
        (c) => active(c) && c.req === request.id,
      );
      assert.equal(candidates.length, 2);
      for (const resume of resumes) {
        const candidate = candidates.find((c) => c.phone === resume.phone);
        assert.ok(candidate);
        assert.equal(candidate.name, resume.reviewedName);
        assert.equal(candidate.stage, "待 HR 筛选");
        assert.equal(candidate.source, "内部推荐");
        const fresh = await api("GET", "/candidates/" + candidate.id);
        assert.equal(fresh.files.length, 1);
        assert.equal(fresh.files[0].name, resume.name);
        const file = await ctx.request.get(
          base + "/api/candidates/files/" + fresh.files[0].id,
        );
        assert.equal(file.status(), 200);
        assert.deepEqual(await file.body(), resume.buffer);
        created.push({
          type: "candidates",
          id: candidate.id,
          fileId: fresh.files[0].id,
        });
      }
      await goto("pool");
      await search(prefix);
      assert.equal(
        await page.locator(".tbl tbody input[type=checkbox]").count(),
        2,
      );
      return {
        ids: candidates.map((c) => c.id),
        committedFiles: 2,
        submissions,
      };
    },
  );

  await check(
    "Reloaded candidate detail previews and downloads the exact original DOCX from batch submission",
    async () => {
      assert.equal(candidates?.length, 2);
      const record = candidates.find((c) => c.phone === resumes[0].phone);
      await rowAction("pool", record, "查看");
      const fileRow = dialog()
        .locator(".v-file-row")
        .filter({ hasText: resumes[0].name });
      await fileRow.getByRole("button", { name: "预览", exact: true }).click();
      await dialog()
        .locator(".v-document")
        .getByText(prefix + "文档核对1", { exact: false })
        .waitFor();
      await dialog()
        .locator(".modal-h")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      const download = page.waitForEvent("download");
      await dialog()
        .locator(".v-file-row")
        .filter({ hasText: resumes[0].name })
        .getByRole("button", { name: "下载", exact: true })
        .click();
      const file = await download;
      assert.equal(file.suggestedFilename(), resumes[0].name);
      assert.deepEqual(await fs.readFile(await file.path()), resumes[0].buffer);
      return { candidateId: record.id, file: resumes[0].name };
    },
  );
} catch (error) {
  results.push({
    name: "Isolated module setup",
    status: "FAIL",
    error: error.stack,
  });
} finally {
  await browser.close();
  const value = await report();
  console.log(JSON.stringify(value.summary));
  if (value.summary.failed || errors.length) process.exitCode = 1;
}
