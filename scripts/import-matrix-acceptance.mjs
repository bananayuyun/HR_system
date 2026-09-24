import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const base = "http://127.0.0.1:8091/api",
  frontend = "http://127.0.0.1:5175";
const prefix = "QAIMPORT" + Date.now().toString(36).toUpperCase();
const require = createRequire(import.meta.url);
const ExcelJS = require(path.join(root, "frontend/node_modules/exceljs"));
const modules =
  process.env.HR_NODE_MODULES || path.join(root, "frontend", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const metadata = JSON.parse(
  await fs.readFile(
    path.join(root, "frontend/src/config/prototype-metadata.json"),
    "utf8",
  ),
);
const types = ["emps", "grades", "assets", "reqs", "timeline"];
const out = path.join(root, ".local/verification"),
  files = path.join(out, prefix);
await fs.mkdir(files, { recursive: true });
const results = [],
  created = [],
  browserErrors = [],
  templates = new Map(),
  persisted = new Map();
const hash = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
class Client {
  cookie = "";
  csrf = "";
  async call(method, resource, body, expected = 200) {
    const multipart = body instanceof FormData;
    const response = await fetch(base + resource, {
      method,
      headers: {
        Origin: frontend,
        Accept: "application/json",
        Cookie: this.cookie,
        ...(this.csrf ? { "X-CSRF-TOKEN": this.csrf } : {}),
        ...(body === undefined || multipart
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body === undefined
          ? undefined
          : multipart
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (response.headers.getSetCookie().length)
      this.cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    if (data?.csrfToken) this.csrf = data.csrfToken;
    assert.ok(
      (Array.isArray(expected) ? expected : [expected]).includes(
        response.status,
      ),
      `${method} ${resource}: HTTP ${response.status}, ${JSON.stringify(data).slice(0, 1200)}`,
    );
    return data;
  }
  get(resource, expected) {
    return this.call("GET", resource, undefined, expected);
  }
  post(resource, body, expected) {
    return this.call("POST", resource, body, expected);
  }
}
const admin = new Client(),
  manager = new Client();
async function check(name, run) {
  const start = Date.now();
  try {
    const evidence = await run();
    results.push({
      name,
      status: "PASS",
      ms: Date.now() - start,
      ...(evidence ? { evidence } : {}),
    });
    console.log("PASS " + name);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      ms: Date.now() - start,
      error: error.message,
    });
    console.error("FAIL " + name + ": " + error.message);
  }
}
function record(type, row) {
  created.push({ type, id: row.id });
  return row;
}
let bootstrap,
  job,
  actor,
  region,
  workplace,
  company,
  sequence,
  browser,
  context,
  page;
const route = {
  emps: "roster",
  grades: "grades",
  assets: "assets",
  reqs: "reqs",
  timeline: "roster",
};
function values(type, suffix = "") {
  const gradeCode = ({ '': 'P9', MIXOK: 'P10', MIXBAD: 'P11', MISSING: 'P12', FORBIDDEN: 'S9' })[suffix] || 'S10';
  switch (type) {
    case "emps":
      return {
        id: prefix + "E" + suffix,
        name: "导入员工" + prefix + suffix,
        department: "开发部",
        job: job.id,
        phone: "18" + String(Date.now()).slice(-9),
        workRegion: region,
        workplace,
        contractCompany: company,
        entry: today,
        notes: "QAIMPORT_KEEP_NOTES",
      };
    case "grades":
      return {
        code: gradeCode,
        name: "导入职级" + prefix + suffix,
        sequence: '专业 P',
        level: Number(gradeCode.slice(1)),
        scope: "全部部门",
        requirements: "QAIMPORT_KEEP_REQUIREMENTS",
        min: 3,
      };
    case "assets":
      return {
        id: prefix + "A" + suffix,
        name: "导入资产" + prefix + suffix,
        category: "电子设备",
        model: "QAIMPORT_MODEL",
        location: region,
        office: "QAIMPORT库房",
        public: "否",
        owner: actor.id,
        status: "使用中",
        purchased: today,
        cost: 100.5,
      };
    case "reqs":
      return {
        id: prefix + "R" + suffix,
        name: "导入需求" + prefix + suffix,
        dept: "开发部",
        job: job.id,
        count: 2,
        salaryMin: 10,
        salaryMax: 20,
        location: region,
        workRegion: region,
        office: workplace,
        workplace,
        company,
        contractCompany: company,
        deadline: tomorrow,
        owner: actor.id,
        screener: actor.id,
        first: actor.id,
        second: actor.id,
        type: "新增",
        status: "招聘中",
      };
    case "timeline":
      return {
        date: today,
        type: "培训",
        title: prefix + "成长" + suffix,
        detail: "QAIMPORT 成长记录真实导入 " + suffix,
      };
  }
}
function body(type, buffer, rows, validateOnly = true, extra = {}) {
  return {
    fileName: prefix + "-" + type + ".xlsx",
    fileHash: hash(buffer),
    rows,
    mode: "update",
    validateOnly,
    ...(type === "timeline" ? { employeeId: actor.id } : {}),
    ...extra,
  };
}
function fileBody(buffer, name = prefix + ".xlsx") {
  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    name,
  );
  return form;
}
async function makeWorkbook(
  type,
  rows,
  { omit = [], leading = 0, gap = false } = {},
) {
  const book = new ExcelJS.Workbook();
  if (templates.has(type) && !omit.length && !leading)
    await book.xlsx.load(templates.get(type));
  const sheet =
    book.worksheets[0] ||
    book.addWorksheet(type === "emps" ? "文档花名册" : "数据");
  const fields = metadata.importConfig[type].fields.filter(
    ([key]) => !omit.includes(key),
  );
  if (!sheet.rowCount) {
    for (let i = 0; i < leading; i++) sheet.addRow([]);
    sheet.addRow(fields.map(([, label]) => label));
  }
  for (let i = 0; i < rows.length; i++) {
    if (gap && i > 0) sheet.addRow([]);
    sheet.addRow(fields.map(([key]) => rows[i][key] ?? ""));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
function mapped(type, parsed) {
  const norm = (text) =>
    String(text)
      .trim()
      .replace(/[\s*＊]/g, "")
      .toUpperCase();
  return parsed.rows
    .filter((row) => row.some((value) => String(value).trim()))
    .map((row) => {
      const result = {};
      for (const [key, label, , aliases = []] of metadata.importConfig[type]
        .fields) {
        const index = parsed.headers.findIndex((header) =>
          [label, ...aliases].some((value) => norm(header) === norm(value)),
        );
        if (index >= 0 && String(row[index] ?? "").trim())
          result[key] = String(row[index]).trim();
      }
      return result;
    });
}
async function parse(type, buffer, expected = 200) {
  return admin.post("/imports/" + type + "/parse", fileBody(buffer), expected);
}
async function openImport(type) {
  // A rejected file still leaves an unsaved import dialog. Exercise its normal
  // discard flow before moving to the next case; do not bypass the route guard.
  for (let depth = 0; depth < 4; depth++) {
    const dialog = page.locator(".v-dialog").last();
    if (!(await dialog.isVisible())) break;
    await dialog.locator('.modal-h button[aria-label="关闭"]').click();
    const discard = page.getByRole("alertdialog").getByRole("button", {
      name: "放弃更改",
      exact: true,
    });
    if (await discard.isVisible()) await discard.click();
    await page.waitForTimeout(100);
  }
  if (await page.locator(".v-dialog").count())
    throw new Error("上一导入场景的对话框未能正常关闭");
  await page.goto(frontend + "/?importcase=" + Date.now() + "#/" + route[type]);
  await page.locator(".v-side").waitFor();
  await page.locator(`.v-content[data-page="${route[type]}"]`).waitFor();
  if (type === "timeline") {
    const search = page.getByRole("textbox", { name: "关键词搜索" });
    await search.fill(actor.id);
    await search.press("Enter");
    await page
      .locator(".tbl tbody tr")
      .filter({ hasText: actor.id })
      .getByRole("button", { name: "查看", exact: true })
      .click();
    const detail = page.getByRole("dialog", { name: "员工档案", exact: true });
    await detail.getByRole("button", { name: "成长记录", exact: true }).click();
    await detail
      .getByRole("button", { name: "导入成长记录", exact: true })
      .click();
  } else {
    await page
      .locator(".w-toolbar")
      .getByRole("button", { name: /^导入/ })
      .click();
    await page
      .getByRole("menu", { name: "导入选项" })
      .getByRole("button", {
        name:
          type === "emps"
            ? "导入花名册"
            : type === "reqs"
              ? "导入招聘需求"
              : "导入数据",
        exact: true,
      })
      .click();
  }
  return page.getByRole("dialog", {
    name: metadata.importConfig[type].title,
    exact: true,
  });
}
async function getEntity(type, row, expected = 200) {
  return admin.get("/" + type + "/" + (row.id || row.code), expected);
}
async function uiRefreshVisible(type, row) {
  await page.goto(frontend + "/#/" + route[type]);
  await page.reload();
  await page.locator(".v-side").waitFor();
  const search = page.getByRole("textbox", { name: "关键词搜索" });
  await search.fill(type === "timeline" ? actor.id : row.id || row.code);
  await search.press("Enter");
  const tableRow = page
    .locator(".tbl tbody tr")
    .filter({ hasText: type === "timeline" ? actor.id : row.id || row.code });
  await tableRow.waitFor();
  if (type === "timeline") {
    await tableRow.getByRole("button", { name: "查看", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "员工档案", exact: true });
    await detail.getByRole("button", { name: "成长记录", exact: true }).click();
    await detail.locator('.v-timeline b').filter({ hasText: row.title }).waitFor();
  }
}

try {
  await check(
    "Isolated 8091 service identity and new QAIMPORT fixtures",
    async () => {
      await admin.post("/auth/login", {
        username: "admin",
        password: process.env.HR_INITIAL_ADMIN_PASSWORD || "admin123",
      });
      await manager.post("/auth/login", {
        username: "manager",
        password: process.env.HR_INITIAL_MANAGER_PASSWORD || "manager123",
      });
      bootstrap = await admin.get("/bootstrap");
      assert.equal(bootstrap.user.role, "hr");
      assert.ok(
        bootstrap.orgs.some(
          (row) => row.id === "ORG_ROOT" && row.name === "中数股份",
        ),
      );
      region = bootstrap.baseSettings.workRegion.find(
        (row) => row.status === "启用",
      ).name;
      workplace = bootstrap.baseSettings.workplace.find(
        (row) => row.status === "启用",
      ).name;
      company = bootstrap.baseSettings.contractCompany.find(
        (row) => row.status === "启用",
      ).name;
      sequence = bootstrap.sequences[0];
      job = record(
        "jobs",
        await admin.post("/jobs", {
          id: prefix + "JOB",
          name: prefix + "导入岗位",
          dept: "ORG_18",
          headcount: 100,
          status: "启用",
        }),
      );
      actor = record(
        "emps",
        await admin.post("/emps", {
          id: prefix + "ACTOR",
          name: prefix + "负责人",
          dept: "ORG_18",
          job: job.id,
          status: "正式",
          workType: "全职",
          entry: today,
          workRegion: region,
          workplace,
          contractCompany: company,
        }),
      );
      browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.HR_BROWSER_PATH ||
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      });
      context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => browserErrors.push(error.message));
      await page.goto(frontend);
      await page.getByLabel("账号", { exact: true }).fill("admin");
      await page
        .getByLabel("密码", { exact: true })
        .fill(process.env.HR_INITIAL_ADMIN_PASSWORD || "admin123");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.locator(".v-side").waitFor();
      assert.equal(
        (await context.request.get(base + "/auth/me")).status(),
        200,
        "Frontend must proxy to the same isolated 8091 backend.",
      );
    },
  );
  if (page && actor) {
    for (const type of types)
      await check(
        `${type}: browser downloads a real XLSX template with the declared columns`,
        async () => {
          const dialog = await openImport(type),
            pending = page.waitForEvent("download");
          await dialog
            .getByRole("button", { name: "下载导入模板", exact: true })
            .click();
          const downloaded = await pending;
          assert.ok(downloaded.suggestedFilename().endsWith(".xlsx"));
          const buffer = await fs.readFile(await downloaded.path()),
            book = new ExcelJS.Workbook();
          await book.xlsx.load(buffer);
          assert.equal(book.worksheets.length, 1);
          assert.deepEqual(
            book.worksheets[0].getRow(1).values.slice(1),
            metadata.importConfig[type].fields.map(([, label]) => label),
          );
          if (type === "emps") assert.equal(book.worksheets[0].columnCount, 58);
          templates.set(type, buffer);
          await fs.writeFile(path.join(files, type + "-template.xlsx"), buffer);
          return {
            columns: book.worksheets[0].columnCount,
            filename: downloaded.suggestedFilename(),
          };
        },
      );
    // Prioritize the known contract risk before the other happy paths.
    for (const type of ["reqs", "emps", "grades", "assets", "timeline"])
      await check(
        `${type}: template XLSX upload, read-only preview, real commit, idempotence and refreshed UI`,
        async () => {
          const row = values(type),
            buffer = await makeWorkbook(type, [row]);
          await fs.writeFile(path.join(files, type + "-valid.xlsx"), buffer);
          const parsed = await parse(type, buffer);
          assert.equal(parsed.rows.length, 1);
          assert.equal(parsed.headerRow, 1);
          const before =
            type === "timeline"
              ? (await getEntity("emps", actor)).timeline.length
              : null;
          const dialog = await openImport(type);
          const previewResponse = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/imports/" + type &&
              response.request().method() === "POST" &&
              response.request().postDataJSON()?.validateOnly === true,
          );
          await dialog
            .getByLabel("上传导入文件", { exact: true })
            .setInputFiles({
              name: prefix + "-" + type + ".xlsx",
              mimeType:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              buffer,
            });
          if (type !== "emps")
            await dialog
              .getByRole("button", { name: "校验数据", exact: true })
              .click();
          const response = await previewResponse;
          assert.equal(response.status(), 200);
          const preview = await response.json();
          assert.equal(
            response.request().postDataJSON().fileHash,
            hash(buffer),
          );
          assert.equal(
            preview.errorCount,
            0,
            "Template cannot be imported: " + JSON.stringify(preview),
          );
          assert.equal(preview.added, 1);
          if (type === "timeline")
            assert.equal(
              (await getEntity("emps", actor)).timeline.length,
              before,
            );
          else await getEntity(type, row, 404);
          const committedResponse = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/imports/" + type &&
              response.request().method() === "POST" &&
              response.request().postDataJSON()?.validateOnly === false,
          );
          await dialog
            .getByRole("button", { name: "确认导入", exact: true })
            .click();
          const committed = await committedResponse;
          assert.equal(committed.status(), 200);
          const report = await committed.json();
          assert.equal(report.added, 1);
          assert.equal(report.errorCount, 0);
          const payload = committed.request().postDataJSON(),
            once =
              type === "timeline"
                ? await getEntity("emps", actor)
                : await getEntity(type, row);
          const duplicate = await admin.post("/imports/" + type, payload);
          assert.equal(duplicate.duplicate, true);
          const twice =
            type === "timeline"
              ? await getEntity("emps", actor)
              : await getEntity(type, row);
          assert.equal(
            type === "timeline" ? twice.timeline.length : twice.version,
            type === "timeline" ? once.timeline.length : once.version,
          );
          if (type === "timeline") {
            assert.equal(twice.timeline.length, before + 1);
            assert.ok(
              twice.timeline.some((event) => event.title === row.title),
            );
          } else {
            assert.equal(twice.name, row.name);
            record(type, twice);
            persisted.set(type, twice);
          }
          await dialog
            .getByRole("button", { name: "完成", exact: true })
            .click();
          await uiRefreshVisible(type, row);
          return {
            id: type === "timeline" ? actor.id : row.id || row.code,
            hash: hash(buffer),
            importId: report.importId,
          };
        },
      );
    for (const type of types)
      await check(
        `${type}: missing required XLSX columns are blocked before API submission`,
        async () => {
          const missing =
            type === "emps"
              ? "name"
              : metadata.importConfig[type].fields.find(
                  ([, , required]) => required,
                )[0];
          const buffer = await makeWorkbook(type, [values(type, "MISSING")], {
              omit: [missing],
            }),
            dialog = await openImport(type);
          let submissions = 0;
          const onRequest = (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname === "/api/imports/" + type
            )
              submissions++;
          };
          page.on("request", onRequest);
          try {
            await dialog
              .getByLabel("上传导入文件", { exact: true })
              .setInputFiles({
                name: prefix + "-missing.xlsx",
                mimeType:
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                buffer,
              });
            if (type !== "emps")
              await dialog
                .getByRole("button", { name: "校验数据", exact: true })
                .click();
            await dialog
              .getByRole("alert")
              .filter({
                hasText: type === "emps" ? "未找到包含" : "请映射必填列",
              })
              .waitFor();
            assert.equal(submissions, 0);
            assert.equal(
              await dialog
                .getByRole("button", { name: "确认导入", exact: true })
                .isDisabled(),
              true,
            );
          } finally {
            page.off("request", onRequest);
          }
        },
      );
    for (const type of types)
      await check(
        `${type}: mixed valid/invalid rows preserve valid transactions and report exact row failures`,
        async () => {
          const good = values(type, "MIXOK"),
            bad = values(type, "MIXBAD");
          if (type === "emps") bad.name = "";
          if (type === "grades") bad.level = "not-a-number";
          if (type === "assets") bad.cost = -1;
          if (type === "reqs") bad.count = -1;
          if (type === "timeline") bad.date = "2026-99-99";
          const buffer = await makeWorkbook(type, [good, bad]),
            parsed = await parse(type, buffer),
            rows = mapped(type, parsed);
          // Direct API tests can supply participant IDs. This does not conceal the separate downloaded-template test.
          if (type === "reqs")
            for (const row of rows) row.ownerIds = [actor.id];
          const before =
            type === "timeline"
              ? (await getEntity("emps", actor)).timeline.length
              : null;
          const preview = await admin.post(
            "/imports/" + type,
            body(type, buffer, rows),
          );
          assert.equal(preview.added, 1, JSON.stringify(preview));
          assert.equal(preview.errorCount, 1);
          assert.equal(preview.rows[1].action, "错误");
          assert.ok(preview.rows[1].errors.length);
          if (type === "timeline")
            assert.equal(
              (await getEntity("emps", actor)).timeline.length,
              before,
            );
          else {
            await getEntity(type, good, 404);
            await getEntity(type, bad, 404);
          }
          const report = await admin.post(
            "/imports/" + type,
            body(type, buffer, rows, false),
          );
          assert.equal(report.added, 1);
          assert.equal(report.errorCount, 1);
          if (type === "timeline") {
            const latest = await getEntity("emps", actor);
            assert.equal(latest.timeline.length, before + 1);
            assert.ok(latest.timeline.some((row) => row.title === good.title));
            assert.ok(!latest.timeline.some((row) => row.title === bad.title));
          } else {
            const saved = await getEntity(type, good);
            record(type, saved);
            if (!persisted.has(type)) persisted.set(type, saved);
            await getEntity(type, bad, 404);
          }
          return {
            rejectedIndex: report.rows[1].index,
            errors: report.rows[1].errors,
            note:
              type === "reqs"
                ? "API-only ownerIds supplement; downloaded-template contract is independently tested above."
                : undefined,
          };
        },
      );
    for (const type of ["grades", "assets", "reqs"])
      await check(
        `${type}: blank updates preserve existing values and skip mode does not modify records`,
        async () => {
          const before = persisted.get(type);
          assert.ok(before, "A valid isolated imported row is required.");
          const row =
            type === "grades"
              ? {
                  code: before.code,
                  name: before.name,
                  sequence: "",
                  requirements: null,
                  level: "",
                  min: "",
                }
              : type === "assets"
                ? {
                    id: before.id,
                    name: before.name,
                    owner: null,
                    status: "",
                    cost: "",
                    model: " ",
                    office: null,
                  }
                : {
                    id: before.id,
                    name: before.name,
                    dept: null,
                    job: "",
                    count: "",
                    salaryMin: null,
                    salaryMax: "",
                    owner: "",
                    screener: "",
                    first: "",
                    second: "",
                    location: "",
                    company: null,
                  };
          const fields =
            type === "grades"
              ? ["sequence", "requirements", "level", "min"]
              : type === "assets"
                ? ["owner", "status", "cost", "model", "office"]
                : [
                    "dept",
                    "job",
                    "count",
                    "salaryMin",
                    "salaryMax",
                    "ownerIds",
                    "screenerIds",
                    "firstIds",
                    "secondIds",
                    "location",
                    "company",
                  ];
          const request = body(
            type,
            Buffer.from(prefix + type + "blank"),
            [row],
            false,
          );
          const report = await admin.post("/imports/" + type, request);
          assert.equal(report.updated, 1, JSON.stringify(report));
          assert.equal(report.errorCount, 0);
          const after = await getEntity(type, before);
          for (const field of fields)
            assert.deepEqual(
              after[field],
              before[field],
              field + " was erased by a blank cell",
            );
          const skipped = await admin.post("/imports/" + type, {
            ...request,
            fileHash: hash(prefix + type + "skip"),
            mode: "skip",
          });
          assert.equal(skipped.skipped, 1);
          assert.equal(skipped.errorCount, 0);
          assert.equal((await getEntity(type, before)).version, after.version);
        },
      );
    await check(
      "POI parser preserves leading/middle blank rows and genuine Excel dates",
      async () => {
        const book = new ExcelJS.Workbook(),
          sheet = book.addWorksheet("空行与日期");
        sheet.addRow([]);
        sheet.addRow([]);
        sheet.addRow(["工号", "姓名", "入职时间"]);
        sheet.addRow([
          prefix + "DATE1",
          "日期测试",
          new Date("2026-01-02T00:00:00Z"),
        ]);
        sheet.getCell("C4").numFmt = "yyyy-mm-dd";
        sheet.addRow([]);
        sheet.addRow([
          prefix + "DATE2",
          "第二行",
          new Date("2026-02-03T00:00:00Z"),
        ]);
        sheet.getCell("C6").numFmt = "yyyy-mm-dd";
        const parsed = await parse(
          "emps",
          Buffer.from(await book.xlsx.writeBuffer()),
        );
        assert.equal(parsed.headerRow, 3);
        assert.equal(parsed.rows.length, 3);
        assert.ok(parsed.rows[1].every((value) => !value));
        assert.equal(parsed.rows[0][2], "2026-01-02");
        assert.equal(parsed.rows[2][2], "2026-02-03");
      },
    );
    await check(
      "XLSX parser rejects corrupt, empty, over-20MB, over-2000-row and over-150-column files",
      async () => {
        await parse("emps", Buffer.from("This is not an XLSX ZIP."), 400);
        await parse("emps", Buffer.alloc(0), 400);
        await parse("emps", Buffer.alloc(20 * 1024 * 1024 + 1), [400, 413]);
        const excess = await makeWorkbook(
          "emps",
          Array.from({ length: 2001 }, (_, i) => ({
            id: prefix + "LIMIT" + i,
            name: "不应写入",
          })),
        );
        await parse("emps", excess, 400);
        const book = new ExcelJS.Workbook(),
          sheet = book.addWorksheet("超列");
        sheet.addRow(Array.from({ length: 151 }, (_, i) => "列" + i));
        sheet.addRow(["row"]);
        await parse("emps", Buffer.from(await book.xlsx.writeBuffer()), 400);
      },
    );
    await check(
      "Browser rejects unsupported file extension and over-2000-row XLSX without submitting rows",
      async () => {
        const dialog = await openImport("emps");
        let requests = 0;
        const onRequest = (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === "/api/imports/emps"
          )
            requests++;
        };
        page.on("request", onRequest);
        try {
          await dialog.getByLabel("上传导入文件").setInputFiles({
            name: prefix + ".txt",
            mimeType: "text/plain",
            buffer: Buffer.from("test"),
          });
          await dialog
            .getByRole("alert")
            .filter({ hasText: "请选择 Excel" })
            .waitFor();
          const buffer = await makeWorkbook(
            "emps",
            Array.from({ length: 2001 }, (_, i) => ({
              id: prefix + "FRONTLIMIT" + i,
              name: "不应写入",
            })),
          );
          await dialog.getByLabel("上传导入文件").setInputFiles({
            name: prefix + "-limit.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            buffer,
          });
          await dialog
            .getByRole("alert")
            .filter({ hasText: "单次最多导入" })
            .waitFor();
          assert.equal(requests, 0);
        } finally {
          page.off("request", onRequest);
        }
      },
    );
    await check(
      "Every import/parse type rejects department manager writes",
      async () => {
        for (const type of types) {
          const buffer = await makeWorkbook(type, [values(type, "FORBIDDEN")]);
          await manager.post(
            "/imports/" + type + "/parse",
            fileBody(buffer),
            403,
          );
          await manager.post(
            "/imports/" + type,
            body(type, buffer, [values(type, "FORBIDDEN")], false),
            403,
          );
        }
      },
    );
    await check(
      "Import endpoint rejects unsupported type, malformed row list and invalid file hashes",
      async () => {
        await admin.post(
          "/imports/not-a-type",
          { rows: [], fileHash: hash(prefix) },
          404,
        );
        await admin.post(
          "/imports/emps",
          { rows: "not-an-array", fileHash: hash(prefix), validateOnly: true },
          400,
        );
        await admin.post(
          "/imports/emps",
          { rows: [], fileHash: "not-sha256", validateOnly: true },
          400,
        );
      },
    );
  }
} finally {
  if (browser) await browser.close();
  const report = {
    generatedAt: new Date().toISOString(),
    target: base,
    frontend,
    prefix,
    results,
    browserErrors,
    created,
    passed: results.filter((row) => row.status === "PASS").length,
    failed: results.filter((row) => row.status === "FAIL").length,
    reusedCoverage: [
      "scripts/security-acceptance.mjs: employee blank/null preservation, duplicate file idempotence, duplicate source ID handling, 2000 JSON-row limit",
      "scripts/browser-acceptance.mjs: employee XLSX automatic mapping and preview rollback",
    ],
    scope:
      "Only QAIMPORT synthetic records in isolated 8091; no account, global dictionary, sequence, or dev8090 writes.",
    files,
  };
  await fs.writeFile(
    path.join(out, "local-round-import.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      failed: report.failed,
      browserErrors,
      report: ".local/verification/local-round-import.json",
      prefix,
    }),
  );
  if (report.failed || browserErrors.length) process.exitCode = 1;
}
