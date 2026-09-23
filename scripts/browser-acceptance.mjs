import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.HR_BROWSER_URL || "http://127.0.0.1:5175";
const target = new URL(base);
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  target.port !== "5175"
)
  throw new Error(
    "Browser acceptance is restricted to the isolated localhost:5175 frontend proxied to 8091.",
  );
const require = createRequire(import.meta.url);
const modules =
  process.env.HR_NODE_MODULES || path.join(root, "frontend", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const ExcelJS = require(path.join(root, "frontend", "node_modules", "exceljs"));
const metadata = JSON.parse(
  await fs.readFile(
    path.join(root, "frontend", "src", "config", "prototype-metadata.json"),
    "utf8",
  ),
);
const out = path.join(root, ".local", "verification", "browser");
await fs.mkdir(out, { recursive: true });
const prefix = `UI${Date.now().toString(36).toUpperCase()}`;
const adminPassword = process.env.HR_INITIAL_ADMIN_PASSWORD || "admin123",
  managerPassword = process.env.HR_INITIAL_MANAGER_PASSWORD || "manager123";
const passwordOnly = process.env.HR_BROWSER_ONLY === "password";
const extensionOnly = ["exports", "preferences", "manager-detail"].includes(
  process.env.HR_BROWSER_ONLY,
);
const runPassword = process.env.HR_BROWSER_TEST_PASSWORD === "1";
const results = [],
  errors = [],
  created = [];
let executablePath = process.env.HR_BROWSER_PATH;
if (!executablePath) {
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  try {
    await fs.access(edge);
    executablePath = edge;
  } catch {}
}
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(error.message));
async function json(ctx, method, resource, data, expected = 200) {
  const response = await ctx.request.fetch(base + "/api" + resource, {
    method,
    headers: { Origin: base },
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(
      response.status(),
    ),
    `${method} ${resource}: ${response.status()} ${JSON.stringify(body).slice(0, 600)}`,
  );
  return body;
}
async function check(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, status: "PASS", ms: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      ms: Date.now() - start,
      error: error.message,
    });
    console.error(`FAIL ${name}: ${error.message}`);
  }
  try {
    await page.screenshot({
      path: path.join(
        out,
        `${process.env.HR_BROWSER_ONLY ? process.env.HR_BROWSER_ONLY + "-" : ""}${String(results.length).padStart(2, "0")}.png`,
      ),
      fullPage: true,
    });
  } catch {}
}
async function login(p, username, password) {
  await p.goto(base + "/#/roster");
  await p.getByLabel("账号", { exact: true }).waitFor();
  await p.getByLabel("账号", { exact: true }).fill(username);
  await p.getByLabel("密码", { exact: true }).fill(password);
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.locator(".v-side").waitFor();
  // Cookies are host-scoped, so the same session must be recognized by 8091.
  // This prevents a mistakenly configured proxy from writing into the dev DB.
  const isolated = await p
    .context()
    .request.get("http://127.0.0.1:8091/api/auth/me");
  assert.equal(
    isolated.status(),
    200,
    "Frontend session is not owned by the isolated 8091 backend.",
  );
  assert.equal((await isolated.json()).user.username, username);
}
async function nav(label, route) {
  await page
    .locator(".v-nav")
    .getByRole("link", { name: label, exact: true })
    .click();
  await page.locator(`.v-content[data-page="${route}"]`).waitFor();
}
async function search(p, term) {
  await p.getByRole("textbox", { name: "关键词搜索" }).fill(term);
  await p.getByRole("textbox", { name: "关键词搜索" }).press("Enter");
}
async function select(key, label, dialog = page.getByRole("dialog").last()) {
  await dialog
    .locator(".ant-select-selector")
    .filter({ has: page.locator("#field-" + key) })
    .click();
  const popup = page
    .locator(".ant-select-dropdown:visible")
    .filter({ has: page.locator("#field-" + key + "_list") });
  await popup
    .locator(".ant-select-item-option-content")
    .getByText(label, { exact: true })
    .click();
}
function responseFor(method, suffix, predicate = () => true) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api" + suffix &&
      response.request().method() === method &&
      predicate(response.request()),
    { timeout: 20000 },
  );
}
async function assertOk(response) {
  assert.ok(
    response.ok(),
    `${response.request().method()} ${response.url()}: ${response.status()} ${await response.text()}`,
  );
  return response.json();
}
let bootstrap, job, employee;

try {
  if (!passwordOnly && !extensionOnly) {
    await check(
      "Login page has no account hints or perspective switch; invalid login is rejected",
      async () => {
        await page.goto(base + "/#/roster");
        await page.getByRole("heading", { name: "登录人力资源平台" }).waitFor();
        const text = await page.locator("body").innerText();
        assert.ok(!/admin123|manager123|快速登录|切换视角/.test(text));
        await page.getByLabel("账号", { exact: true }).fill("admin");
        await page
          .getByLabel("密码", { exact: true })
          .fill("wrong-browser-password");
        const rejected = responseFor("POST", "/auth/login");
        await page.getByRole("button", { name: "登录", exact: true }).click();
        assert.equal((await rejected).status(), 401);
        await page
          .getByRole("alert")
          .filter({ hasText: "用户名或密码错误" })
          .waitFor();
      },
    );
    await check(
      "Admin logs in through real UI and receives all 11 server-authorized menus",
      async () => {
        await login(page, "admin", adminPassword);
        bootstrap = await json(context, "GET", "/bootstrap");
        assert.ok(
          bootstrap.orgs.some(
            (row) => row.id === "ORG_ROOT" && row.name === "中数股份",
          ),
        );
        assert.equal(bootstrap.user.role, "hr");
        assert.equal(await page.locator(".v-nav a").count(), 11);
        assert.ok(
          !(await page.locator(".v-top").innerText()).includes("切换视角"),
        );
      },
    );
    if (bootstrap) {
      await check(
        "Real list search, empty state and reset operate on loaded data",
        async () => {
          await nav("员工花名册", "roster");
          const first = bootstrap.emps.find(
            (row) => !row.deleted && !row.deletedAt,
          );
          await search(page, first.id);
          await page
            .locator(".tbl tbody tr")
            .filter({ hasText: first.id })
            .waitFor();
          assert.equal(await page.locator(".tbl tbody tr").count(), 1);
          await search(page, `${prefix}_NO_MATCH`);
          await page.getByText("暂无符合条件的记录", { exact: true }).waitFor();
          await page.getByRole("button", { name: "重置", exact: true }).click();
          assert.ok((await page.locator(".tbl tbody tr").count()) > 1);
        },
      );
      await check(
        "Column visibility persists after page reload and restores to default",
        async () => {
          await nav("岗位管理", "jobs");
          await page
            .getByRole("button", { name: "列设置", exact: true })
            .click();
          let popup = page.getByRole("dialog", { name: "列设置", exact: true });
          await popup
            .getByRole("checkbox", { name: "显示序号", exact: true })
            .uncheck();
          let saved = responseFor("PUT", "/preferences/jobs");
          await popup
            .getByRole("button", { name: "确认", exact: true })
            .click();
          await assertOk(await saved);
          await page.reload();
          await page.locator('.v-content[data-page="jobs"]').waitFor();
          await page.waitForLoadState("networkidle");
          assert.equal(
            await page.locator('.tbl thead [data-list-key="__index"]').count(),
            0,
          );
          await page
            .getByRole("button", { name: "列设置", exact: true })
            .click();
          popup = page.getByRole("dialog", { name: "列设置", exact: true });
          await popup
            .getByRole("button", { name: "恢复默认", exact: true })
            .click();
          await page
            .getByRole("dialog", { name: "确认恢复默认列配置?" })
            .getByRole("button", { name: "确认", exact: true })
            .click();
          saved = responseFor("PUT", "/preferences/jobs");
          await popup
            .getByRole("button", { name: "确认", exact: true })
            .click();
          await assertOk(await saved);
          await page.locator('.tbl thead [data-list-key="__index"]').waitFor();
        },
      );
      await check(
        "Create a job through the actual Vue form and verify durable data",
        async () => {
          await page.goto(base + "/#/jobs");
          await page
            .locator(".w-toolbar")
            .getByRole("button", { name: "新增", exact: true })
            .click();
          const dialog = page.getByRole("dialog", {
            name: "新增岗位",
            exact: true,
          });
          await dialog
            .getByRole("textbox", { name: "岗位名称", exact: true })
            .fill(`浏览器岗位${prefix}`);
          await select("mainDept", "开发部", dialog);
          await select("dept", "直属部门（无组别）", dialog);
          await dialog
            .getByRole("spinbutton", { name: "岗位编制", exact: true })
            .fill("20");
          await dialog
            .getByRole("textbox", { name: "岗位职责", exact: true })
            .fill("仅隔离验收用岗位");
          await dialog
            .getByRole("textbox", { name: "任职要求", exact: true })
            .fill("真实浏览器表单持久化检查");
          const saved = responseFor("POST", "/jobs");
          await dialog
            .getByRole("button", { name: "确定", exact: true })
            .click();
          job = await assertOk(await saved);
          created.push({ type: "jobs", id: job.id });
          await dialog.waitFor({ state: "hidden" });
          await search(page, job.id);
          await page
            .locator(".tbl tbody tr")
            .filter({ hasText: job.id })
            .waitFor();
          await page.reload();
          await page.locator(".v-side").waitFor();
          await search(page, job.id);
          await page
            .locator(".tbl tbody tr")
            .filter({ hasText: job.id })
            .waitFor();
          assert.equal(
            (await json(context, "GET", `/jobs/${job.id}`)).headcount,
            20,
          );
        },
      );
      if (job) {
        await check(
          "Employee detail edits persist after a real refresh",
          async () => {
            const dict = (key) =>
              bootstrap.baseSettings[key].find((row) => row.status === "启用")
                .name;
            employee = await json(
              context,
              "POST",
              "/emps",
              {
                id: `${prefix}E`,
                name: `浏览器员工${prefix}`,
                dept: "ORG_18",
                job: job.id,
                status: "正式",
                workType: "全职",
                phone: `18${String(Date.now()).slice(-9)}`,
                entry: new Date().toISOString().slice(0, 10),
                workRegion: dict("workRegion"),
                workplace: dict("workplace"),
                contractCompany: dict("contractCompany"),
                notes: "Before UI edit",
              },
              [200, 201],
            );
            created.push({ type: "emps", id: employee.id });
            await page.goto(base + "/#/roster");
            await page.reload();
            await page.locator(".v-side").waitFor();
            await search(page, employee.id);
            await page
              .locator(".tbl tbody tr")
              .filter({ hasText: employee.id })
              .getByRole("button", { name: "查看", exact: true })
              .click();
            const detail = page.getByRole("dialog", {
              name: "员工档案",
              exact: true,
            });
            await detail
              .getByRole("button", { name: "编辑基本信息", exact: true })
              .click();
            const editor = page.getByRole("dialog", {
              name: "编辑基本信息",
              exact: true,
            });
            await editor
              .getByRole("textbox", { name: "备注", exact: true })
              .fill(`UI_EDIT_PERSISTED_${prefix}`);
            const saved = responseFor("PUT", `/emps/${employee.id}`);
            await editor
              .getByRole("button", { name: "确定", exact: true })
              .click();
            await assertOk(await saved);
            await editor.waitFor({ state: "hidden" });
            await page.reload();
            await page.locator(".v-side").waitFor();
            await search(page, employee.id);
            await page
              .locator(".tbl tbody tr")
              .filter({ hasText: employee.id })
              .getByRole("button", { name: "查看", exact: true })
              .click();
            await page
              .getByRole("dialog", { name: "员工档案", exact: true })
              .getByText(`UI_EDIT_PERSISTED_${prefix}`, { exact: true })
              .waitFor();
            assert.equal(
              (await json(context, "GET", `/emps/${employee.id}`)).notes,
              `UI_EDIT_PERSISTED_${prefix}`,
            );
            await page
              .getByRole("dialog", { name: "员工档案", exact: true })
              .getByRole("button", { name: "关闭", exact: true })
              .first()
              .click();
          },
        );
        await check(
          "Actual XLSX upload previews without writing, then commits one employee",
          async () => {
            await page.goto(base + "/#/roster");
            await page.reload();
            await page.locator(".v-side").waitFor();
            await page
              .locator(".w-toolbar")
              .getByRole("button", { name: /^导入/ })
              .click();
            await page
              .getByRole("menu", { name: "导入选项" })
              .getByRole("button", { name: "导入花名册", exact: true })
              .click();
            const workbook = new ExcelJS.Workbook(),
              sheet = workbook.addWorksheet("文档花名册");
            const fields = metadata.importConfig.emps.fields;
            const values = {
              id: `${prefix}IMPORT`,
              name: `表格导入${prefix}`,
              department: "开发部",
              job: job.id,
              phone: `17${String(Date.now()).slice(-9)}`,
              workRegion: bootstrap.baseSettings.workRegion.find(
                (row) => row.status === "启用",
              ).name,
              workplace: bootstrap.baseSettings.workplace.find(
                (row) => row.status === "启用",
              ).name,
              contractCompany: bootstrap.baseSettings.contractCompany.find(
                (row) => row.status === "启用",
              ).name,
            };
            sheet.addRow(fields.map(([, label]) => label));
            sheet.addRow(fields.map(([key]) => values[key] || ""));
            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
            const preview = responseFor(
              "POST",
              "/imports/emps",
              (request) => request.postDataJSON().validateOnly === true,
            );
            await page.getByLabel("上传导入文件").setInputFiles({
              name: `${prefix}.xlsx`,
              mimeType:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              buffer,
            });
            const checked = await assertOk(await preview);
            assert.equal(checked.added, 1);
            assert.equal(checked.errorCount, 0);
            await json(context, "GET", `/emps/${values.id}`, undefined, 404);
            await page
              .getByRole("button", { name: "确认导入", exact: true })
              .waitFor();
            const committed = responseFor(
              "POST",
              "/imports/emps",
              (request) => request.postDataJSON().validateOnly === false,
            );
            await page
              .getByRole("button", { name: "确认导入", exact: true })
              .click();
            const report = await assertOk(await committed);
            assert.equal(report.added, 1);
            assert.equal(report.errorCount, 0);
            const persisted = await json(context, "GET", `/emps/${values.id}`);
            assert.equal(persisted.name, values.name);
            created.push({ type: "emps", id: persisted.id });
            await page
              .getByRole("button", { name: "完成", exact: true })
              .click();
            await page.reload();
            await page.locator(".v-side").waitFor();
            await search(page, persisted.id);
            await page
              .locator(".tbl tbody tr")
              .filter({ hasText: persisted.id })
              .waitFor();
          },
        );
      }
      await check(
        "Manager UI hides HR mutations and cannot reveal another department",
        async () => {
          const managerContext = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
          });
          const managerPage = await managerContext.newPage();
          managerPage.setDefaultTimeout(15000);
          try {
            await login(managerPage, "manager", managerPassword);
            const managerData = await json(managerContext, "GET", "/bootstrap");
            assert.equal(
              await managerPage
                .locator(".v-nav")
                .getByRole("link", { name: "基础信息设置", exact: true })
                .count(),
              0,
            );
            assert.equal(
              await managerPage
                .locator(".w-toolbar")
                .getByRole("button", { name: "新增", exact: true })
                .count(),
              0,
            );
            assert.equal(
              await managerPage
                .locator(".w-toolbar")
                .getByRole("button", { name: /^导入/ })
                .count(),
              0,
            );
            const allowed = new Set(managerData.orgs.map((row) => row.id)),
              outsider = bootstrap.emps.find(
                (row) => !allowed.has(row.dept) && !row.deleted,
              );
            assert.ok(outsider);
            await search(managerPage, outsider.id);
            await managerPage
              .getByText("暂无符合条件的记录", { exact: true })
              .waitFor();
            await json(
              managerContext,
              "GET",
              `/emps/${outsider.id}`,
              undefined,
              403,
            );
            if (employee) {
              await search(managerPage, employee.id);
              await managerPage
                .locator(".tbl tbody tr")
                .filter({ hasText: employee.id })
                .getByRole("button", { name: "查看", exact: true })
                .click();
              assert.equal(
                await managerPage
                  .getByRole("button", { name: "编辑基本信息", exact: true })
                  .count(),
                0,
              );
            }
            await managerPage.screenshot({
              path: path.join(out, "manager.png"),
              fullPage: true,
            });
          } finally {
            await managerContext.close();
          }
        },
      );
    }
  }
  if (process.env.HR_BROWSER_ONLY === "exports") {
    await check(
      "Selected roster export is a real XLSX with exactly 58 headers and one employee",
      async () => {
        await login(page, "admin", adminPassword);
        await page.waitForLoadState("networkidle");
        const rows = page.locator(".tbl tbody tr");
        assert.ok(
          (await rows.count()) > 1,
          "Selection test needs multiple visible records.",
        );
        await rows.first().getByRole("checkbox").check();
        const download = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "导出当前筛选结果", exact: true })
          .click();
        const file = await download;
        assert.ok(file.suggestedFilename().endsWith(".xlsx"));
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(await fs.readFile(await file.path()));
        assert.equal(book.worksheets.length, 1);
        const sheet = book.worksheets[0];
        assert.equal(sheet.columnCount, 58);
        assert.equal(sheet.rowCount, 2);
        assert.deepEqual(
          sheet.getRow(1).values.slice(1),
          metadata.importConfig.emps.fields.map(([, label]) => label),
        );
        await rows.first().getByRole("checkbox").uncheck();
      },
    );
    await check(
      "Employee profile download contains four real detail worksheets",
      async () => {
        await page
          .locator(".tbl tbody tr")
          .first()
          .getByRole("button", { name: "查看", exact: true })
          .click();
        const detail = page.getByRole("dialog", {
          name: "员工档案",
          exact: true,
        });
        await detail.locator(".employee-more summary").click();
        const download = page.waitForEvent("download");
        await detail
          .getByRole("button", { name: "导出档案", exact: true })
          .click();
        const file = await download,
          book = new ExcelJS.Workbook();
        await book.xlsx.load(await fs.readFile(await file.path()));
        assert.deepEqual(
          book.worksheets.map((sheet) => sheet.name),
          ["员工档案", "工作经历", "材料清单", "成长记录"],
        );
        assert.ok(book.getWorksheet("员工档案").rowCount > 50);
        assert.equal(
          book.getWorksheet("员工档案").getRow(1).values.slice(1).join(","),
          "模块,字段,内容",
        );
        await detail
          .getByRole("button", { name: "关闭", exact: true })
          .first()
          .click();
      },
    );
    await check(
      "Manager roster does not expose sensitive roster export",
      async () => {
        const managerContext = await browser.newContext(),
          managerPage = await managerContext.newPage();
        try {
          await login(managerPage, "manager", managerPassword);
          assert.equal(
            await managerPage
              .getByRole("button", { name: "导出当前筛选结果", exact: true })
              .count(),
            0,
          );
        } finally {
          await managerContext.close();
        }
      },
    );
  }
  if (process.env.HR_BROWSER_ONLY === "preferences") {
    await check(
      "Saved filter schemes and column preferences survive each other and reload",
      async () => {
        await login(page, "admin", adminPassword);
        await nav("岗位管理", "jobs");
        await page.getByRole("button", { name: "列设置", exact: true }).click();
        let columns = page.getByRole("dialog", { name: "列设置", exact: true });
        await columns
          .getByRole("checkbox", { name: "显示序号", exact: true })
          .uncheck();
        let saved = responseFor("PUT", "/preferences/jobs");
        await columns
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await assertOk(await saved);
        await page
          .getByRole("button", { name: "高级筛选", exact: true })
          .click();
        let advanced = page.getByRole("dialog", {
          name: "高级筛选",
          exact: true,
        });
        await advanced
          .getByRole("button", { name: "添加", exact: true })
          .click();
        await advanced
          .getByPlaceholder("请输入方案名称", { exact: true })
          .fill(prefix);
        await advanced.getByLabel("筛选值 1", { exact: true }).fill("开发");
        saved = responseFor("PUT", "/preferences/jobs");
        await advanced
          .getByRole("button", { name: "保存方案", exact: true })
          .click();
        await assertOk(await saved);
        let prefs = await json(context, "GET", "/preferences/jobs");
        assert.equal(
          prefs.columns.find((column) => column.key === "__index").show,
          false,
        );
        assert.ok(prefs.schemes.some((scheme) => scheme.name === prefix));
        await page.reload();
        await page.locator(".v-side").waitFor();
        await page
          .getByRole("button", { name: "高级筛选", exact: true })
          .click();
        advanced = page.getByRole("dialog", { name: "高级筛选", exact: true });
        await advanced
          .getByRole("button", { name: prefix, exact: true })
          .waitFor();
        await advanced
          .getByRole("button", { name: "关闭", exact: true })
          .click();
        await page.getByRole("button", { name: "列设置", exact: true }).click();
        columns = page.getByRole("dialog", { name: "列设置", exact: true });
        await columns
          .getByRole("checkbox", { name: "显示序号", exact: true })
          .check();
        saved = responseFor("PUT", "/preferences/jobs");
        await columns
          .getByRole("button", { name: "确认", exact: true })
          .click();
        await assertOk(await saved);
        prefs = await json(context, "GET", "/preferences/jobs");
        assert.ok(prefs.schemes.some((scheme) => scheme.name === prefix));
        await page
          .getByRole("button", { name: "高级筛选", exact: true })
          .click();
        advanced = page.getByRole("dialog", { name: "高级筛选", exact: true });
        saved = responseFor("PUT", "/preferences/jobs");
        await advanced
          .getByRole("button", { name: "删除方案" + prefix, exact: true })
          .click();
        await assertOk(await saved);
        await advanced
          .getByRole("button", { name: "关闭", exact: true })
          .click();
        assert.equal(
          (await json(context, "GET", "/preferences/jobs")).columns.find(
            (column) => column.key === "__index",
          ).show,
          true,
        );
      },
    );
  }
  if (process.env.HR_BROWSER_ONLY === "manager-detail") {
    await check(
      "Manager request detail displays server-resolved responsible person names",
      async () => {
        await login(page, "manager", managerPassword);
        const scoped = await json(context, "GET", "/bootstrap");
        const req =
          scoped.reqs.find(
            (row) =>
              /^REQ\d+$/.test(row.id) &&
              row.owner &&
              row.screener &&
              row.first &&
              row.second,
          ) ||
          scoped.reqs.find(
            (row) =>
              !row.id.startsWith("SEC") &&
              row.owner &&
              row.screener &&
              row.first &&
              row.second,
          );
        assert.ok(
          req,
          "A seed request with all four responsible roles is required.",
        );
        const actual = await json(
          context,
          "GET",
          "/reqs/" + encodeURIComponent(req.id),
        );
        await nav("招聘需求", "reqs");
        await search(page, req.id);
        await page
          .locator('.tbl tbody [data-list-key="id"]')
          .getByRole("button", { name: req.id, exact: true })
          .click();
        const detail = page.getByRole("dialog", {
          name: "招聘需求详情",
          exact: true,
        });
        await detail.waitFor();
        const rendered = await detail.innerText();
        assert.ok(!rendered.includes("人员不存在"));
        for (const role of ["owner", "screener", "first", "second"]) {
          assert.ok(actual[role]);
          assert.ok(
            rendered.includes(actual[role]),
            `${role}: expected server-resolved name in detail.`,
          );
        }
        assert.ok(
          (actual.ownerIds || []).some(
            (id) => !scoped.emps.some((employee) => employee.id === id),
          ),
          "Test must cover an HR owner outside the manager employee list.",
        );
      },
    );
  }
  if (runPassword) {
    await check(
      "Manager changes password in UI, old password is rejected, and original password is restored",
      async () => {
        const passwordContext = await browser.newContext(),
          passwordPage = await passwordContext.newPage(),
          staleContext = await browser.newContext();
        passwordPage.setDefaultTimeout(15000);
        passwordPage.on("pageerror", (error) => errors.push(error.message));
        const temporary = `Ui-Only-${prefix}-9!`;
        let activePassword = managerPassword;
        async function change(oldPassword, newPassword) {
          await passwordPage
            .getByRole("button", { name: "修改密码", exact: true })
            .click();
          const dialog = passwordPage.getByRole("dialog", {
            name: "修改密码",
            exact: true,
          });
          await dialog
            .getByLabel("当前密码", { exact: true })
            .fill(oldPassword);
          await dialog.getByLabel("新密码", { exact: true }).fill(newPassword);
          await dialog
            .getByLabel("确认新密码", { exact: true })
            .fill(newPassword);
          const response = passwordPage.waitForResponse(
            (r) =>
              new URL(r.url()).pathname === "/api/auth/password" &&
              r.request().method() === "POST",
          );
          await dialog
            .getByRole("button", { name: "确定", exact: true })
            .click();
          await assertOk(await response);
          activePassword = newPassword;
          await passwordPage
            .getByRole("heading", { name: "登录人力资源平台" })
            .waitFor();
        }
        try {
          await login(passwordPage, "manager", managerPassword);
          await staleContext.addCookies(await passwordContext.cookies());
          await change(managerPassword, temporary);
          await json(staleContext, "GET", "/bootstrap", undefined, 401);
          await json(
            passwordContext,
            "POST",
            "/auth/login",
            { username: "manager", password: managerPassword },
            401,
          );
          await login(passwordPage, "manager", temporary);
          await change(temporary, managerPassword);
          await login(passwordPage, "manager", managerPassword);
          await passwordPage.screenshot({
            path: path.join(out, "password-restored.png"),
            fullPage: true,
          });
        } finally {
          if (activePassword !== managerPassword) {
            await json(passwordContext, "POST", "/auth/login", {
              username: "manager",
              password: activePassword,
            });
            await json(passwordContext, "POST", "/auth/password", {
              oldPassword: activePassword,
              newPassword: managerPassword,
            });
          }
          await staleContext.close();
          await passwordContext.close();
        }
      },
    );
  } else if (!extensionOnly)
    results.push({
      name: "Password rotation and restoration",
      status: "SKIP",
      reason:
        "Set HR_BROWSER_TEST_PASSWORD=1 only when parallel acceptance is not using the accounts.",
    });
} finally {
  await browser.close();
  const report = {
    base,
    backend: "http://127.0.0.1:8091/api",
    prefix,
    generatedAt: new Date().toISOString(),
    mode: "real browser UI and real isolated MySQL API; no mocked routes",
    results,
    errors,
    created,
  };
  await fs.writeFile(
    path.join(
      out,
      passwordOnly || extensionOnly
        ? `${process.env.HR_BROWSER_ONLY}-report.json`
        : "report.json",
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: results.filter((row) => row.status === "PASS").length,
      failed: results.filter((row) => row.status === "FAIL").length,
      skipped: results.filter((row) => row.status === "SKIP").length,
      errors,
      prefix,
    }),
  );
  if (errors.length || results.some((row) => row.status === "FAIL"))
    process.exitCode = 1;
}
