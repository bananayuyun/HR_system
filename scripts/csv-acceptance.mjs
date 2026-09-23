import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.HR_BROWSER_URL || "http://127.0.0.1:5175";
const target = new URL(base);
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  target.port !== "5175"
) {
  throw new Error(
    "CSV acceptance is restricted to the isolated local 5175 frontend / 8091 backend.",
  );
}
const require = createRequire(import.meta.url);
const modules =
  process.env.HR_NODE_MODULES || path.join(root, "frontend", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const out = path.join(root, ".local/verification/browser");
await fs.mkdir(out, { recursive: true });
const prefix = "QAIMPORTCSV" + Date.now();
const employeeId = "00" + Date.now();
const results = [],
  errors = [],
  requests = [],
  created = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.HR_BROWSER_PATH
    ? { executablePath: process.env.HR_BROWSER_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    new URL(request.url()).pathname === "/api/imports/emps" &&
    request.method() === "POST"
  )
    requests.push(request.postDataJSON());
});
async function json(resource, expected = 200) {
  const response = await context.request.get(base + "/api" + resource);
  assert.equal(
    response.status(),
    expected,
    resource + ": " + (await response.text()),
  );
  return response.json();
}
async function check(name, callback) {
  const start = Date.now();
  try {
    await callback();
    results.push({ name, status: "PASS", ms: Date.now() - start });
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
  await page
    .screenshot({
      path: path.join(
        out,
        "csv-" + String(results.length).padStart(2, "0") + ".png",
      ),
      fullPage: true,
    })
    .catch(() => {});
}
const quoted = (value) => '"' + String(value).replaceAll('"', '""') + '"';
try {
  await page.goto(base + "/#/roster");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.HR_INITIAL_ADMIN_PASSWORD || "admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".v-side").waitFor();
  const isolated = await context.request.get(
    "http://127.0.0.1:8091/api/auth/me",
  );
  assert.equal(
    isolated.status(),
    200,
    "Frontend session belongs to isolated test backend",
  );
  assert.equal((await isolated.json()).user.username, "admin");
  const bootstrap = await json("/bootstrap");
  await page
    .locator(".w-toolbar")
    .getByRole("button", { name: /^导入/ })
    .click();
  await page
    .getByRole("menu", { name: "导入选项" })
    .getByRole("button", { name: "导入花名册", exact: true })
    .click();
  const input = page.getByLabel("上传导入文件");
  async function rejectedFile(name, buffer, message) {
    const previous = requests.length;
    await input.setInputFiles({
      name,
      mimeType: name.endsWith(".csv") ? "text/csv" : "application/octet-stream",
      buffer,
    });
    await page.getByRole("alert").getByText(message, { exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    assert.equal(
      requests.length,
      previous,
      "Invalid file must not call import API",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "确认导入", exact: true })
        .isDisabled(),
      true,
    );
  }
  await check("Invalid extension is rejected before an import request", () =>
    rejectedFile(
      prefix + ".exe",
      Buffer.from("not a spreadsheet"),
      "请选择 Excel（.xlsx / .xls）或 CSV 文件。",
    ),
  );
  await check("Empty CSV is rejected before an import request", () =>
    rejectedFile(
      prefix + "-empty.csv",
      Buffer.alloc(0),
      "文件为空，请重新选择。",
    ),
  );
  await check("CSV missing the employee-code header is rejected", () =>
    rejectedFile(
      prefix + "-missing-header.csv",
      Buffer.from("\uFEFF姓名,备注\r\n" + prefix + ",缺少工号\r\n", "utf8"),
      "未找到包含“工号、姓名”的表头。",
    ),
  );
  await check(
    "BOM UTF-8 CSV preserves Chinese commas, quotes, multiline notes and leading-zero codes across preview and commit",
    async () => {
      const org = bootstrap.orgs.find((row) => row.name === "开发部");
      const job = bootstrap.jobs.find(
        (row) => row.dept === org.id && row.status === "启用",
      );
      assert.ok(
        job,
        "Existing active test job in development department is required",
      );
      const active = (key) =>
        bootstrap.baseSettings[key].find((row) => row.status === "启用").name;
      const name = prefix + '中文,"甲"';
      const notes = prefix + ' 第一行,包含"双引号"\n第二行中文备注';
      const headers = [
        "工号",
        "姓名",
        "部门",
        "职位",
        "手机号码",
        "工作片区",
        "工作所在地",
        "合同归属",
        "备注",
      ];
      const values = [
        employeeId,
        name,
        org.name,
        job.id,
        "19" + String(Date.now()).slice(-9),
        active("workRegion"),
        active("workplace"),
        active("contractCompany"),
        notes,
      ];
      const csv =
        "\uFEFF" +
        headers.map(quoted).join(",") +
        "\r\n" +
        values.map(quoted).join(",") +
        "\r\n";
      assert.ok(/^00\d+$/.test(employeeId));
      await json("/emps/" + employeeId, 404);
      const previewResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/imports/emps" &&
          response.request().postDataJSON()?.validateOnly === true,
      );
      await input.setInputFiles({
        name: prefix + ".csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });
      const preview = await previewResponse;
      assert.equal(preview.status(), 200, await preview.text());
      const payload = preview.request().postDataJSON();
      assert.equal(
        payload.rows.length,
        1,
        "Quoted multiline note is one CSV row",
      );
      assert.equal(payload.rows[0].id, employeeId);
      assert.equal(typeof payload.rows[0].id, "string");
      assert.equal(payload.rows[0].name, name);
      assert.equal(payload.rows[0].notes, notes);
      const checked = await preview.json();
      assert.equal(checked.added, 1);
      assert.equal(checked.errorCount, 0);
      await json("/emps/" + employeeId, 404);
      const commitResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/imports/emps" &&
          response.request().postDataJSON()?.validateOnly === false,
      );
      await page.getByRole("button", { name: "确认导入", exact: true }).click();
      const commit = await commitResponse;
      assert.equal(commit.status(), 200, await commit.text());
      const committed = await commit.json();
      assert.equal(committed.added, 1);
      assert.equal(committed.errorCount, 0);
      created.push({ type: "emps", id: employeeId, marker: prefix });
      const persisted = await json("/emps/" + employeeId);
      assert.equal(persisted.id, employeeId);
      assert.equal(persisted.name, name);
      assert.equal(persisted.notes, notes);
      await page.getByRole("button", { name: "完成", exact: true }).click();
      await page.reload();
      await page.locator(".v-side").waitFor();
      await page.getByRole("textbox", { name: "关键词搜索" }).fill(employeeId);
      await page.getByRole("textbox", { name: "关键词搜索" }).press("Enter");
      await page
        .locator(".tbl tbody tr")
        .filter({ hasText: employeeId })
        .waitFor();
      const reread = await json("/emps/" + employeeId);
      assert.equal(reread.id, employeeId);
      assert.equal(reread.notes, notes);
    },
  );
} catch (error) {
  results.push({
    name: "CSV acceptance setup",
    status: "FAIL",
    error: error.message,
  });
} finally {
  const report = {
    generatedAt: new Date().toISOString(),
    base,
    backend: "http://127.0.0.1:8091/api",
    prefix,
    employeeId,
    mode: "real UI and real isolated API; no mocks; no global settings or passwords changed",
    results,
    errors,
    importRequests: requests.map((row) => ({
      validateOnly: row.validateOnly,
      rowCount: row.rows.length,
      fileName: row.fileName,
      fileHash: row.fileHash,
    })),
    created,
    cleanup:
      "Dedicated test record retained as evidence; identifiers recorded for the root acceptance cleanup.",
  };
  await fs.writeFile(
    path.join(out, "csv-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  const failed = results.filter((row) => row.status === "FAIL").length;
  console.log(
    JSON.stringify({
      passed: results.filter((row) => row.status === "PASS").length,
      failed,
      errors,
      created,
    }),
  );
  if (failed || errors.length) process.exitCode = 1;
}
