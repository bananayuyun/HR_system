import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(root, "frontend/node_modules/playwright"),
);
const base = "http://127.0.0.1:5175";
const id = `UILEFT${Date.now().toString(36).toUpperCase()}`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
let context;
let created = false;

try {
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(12000);
  await page.goto(`${base}/#/roster`);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page
    .locator('.v-content[data-page="roster"]')
    .waitFor()
    .catch(async (error) => {
      console.error(
        "Login page state:",
        (await page.locator("body").innerText()).slice(0, 800),
      );
      throw error;
    });
  await page.locator(".v-busy").waitFor({ state: "hidden" });

  const api = async (method, suffix, body, expected = 200) => {
    const response = await context.request.fetch(`${base}/api${suffix}`, {
      method,
      headers: { Origin: base },
      ...(body === undefined ? {} : { data: body }),
    });
    const result = await response.json();
    assert.equal(
      response.status(),
      expected,
      `${method} ${suffix}: ${JSON.stringify(result)}`,
    );
    return result;
  };
  const employee = await api("POST", "/emps", {
    id,
    name: "页面离职验收",
    dept: "ORG_18",
    status: "正式",
    entry: "2026-01-01",
    identityNumber: "11010519491231002X",
  });
  assert.equal(employee.identityNumber, "••••••");
  created = true;
  assert.match(
    (await api("DELETE", `/emps/${id}/permanent`, undefined, 409)).message,
    /请先办理离职/,
  );

  await page.reload();
  await page.locator(".v-busy").waitFor({ state: "hidden" });
  const search = page.getByRole("textbox", { name: "关键词搜索" });
  await search.fill(id);
  await search.press("Enter");
  let row = page.locator(".tbl tbody tr").filter({ hasText: id });
  await row.waitFor();
  assert.deepEqual(await row.locator(".v-actions button").allTextContents(), [
    "查看",
    "办理离职",
  ]);
  await row.getByRole("button", { name: "办理离职" }).click();
  const leave = page.getByRole("dialog", { name: "办理离职" });
  await leave.getByLabel("离职原因").fill("页面验收");
  await leave.getByRole("button", { name: "确定" }).click();
  await leave.waitFor({ state: "hidden" });
  await row.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "离职人员档案", exact: true }).click();
  await row.waitFor();
  assert.deepEqual(await row.locator(".v-actions button").allTextContents(), [
    "查看",
    "复职",
    "彻底删除",
  ]);
  await row.getByRole("button", { name: "查看" }).click();
  const detail = page.getByRole("dialog", { name: "离职人员档案" });
  await detail.waitFor();
  await detail
    .locator("h2 .v-badge")
    .getByText("已离职", { exact: true })
    .waitFor();
  assert.equal(await detail.getByRole("button", { name: /^编辑/ }).count(), 0);
  const identity = detail
    .locator(".employee-fields > div")
    .filter({ hasText: "身份证号码" });
  await identity.getByRole("button", { name: "显示" }).click();
  await identity.getByText("11010519491231002X").waitFor();
  assert.ok(
    (await api("GET", `/emps/${id}/audit`)).some(
      (entry) => entry.action === "查看敏感信息",
    ),
  );
  await detail.getByText("成长记录", { exact: true }).first().click();
  await detail.getByText("离职", { exact: true }).first().waitFor();
  assert.equal(
    await detail.getByRole("button", { name: "新增成长记录" }).count(),
    0,
  );
  await detail.getByRole("button", { name: "关闭" }).last().click();

  await row.getByRole("button", { name: "复职" }).click();
  const reinstate = page.getByRole("dialog", { name: "复职" });
  await reinstate.getByRole("button", { name: "确定" }).click();
  await reinstate.waitFor({ state: "hidden" });
  await row.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "在职花名册", exact: true }).click();
  await row.waitFor();
  assert.equal((await api("GET", `/emps/${id}`)).status, "正式");

  await row.getByRole("button", { name: "办理离职" }).click();
  await leave.getByLabel("离职原因").fill("验收清理");
  await leave.getByRole("button", { name: "确定" }).click();
  await leave.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "离职人员档案", exact: true }).click();
  await row.waitFor();
  await row.getByRole("button", { name: "彻底删除" }).click();
  await page
    .getByRole("dialog", { name: "彻底删除员工档案" })
    .getByRole("button", { name: "确定" })
    .click();
  await row.waitFor({ state: "hidden" });
  await api("GET", `/emps/${id}`, undefined, 404);
  created = false;
  assert.deepEqual(errors, []);
  console.log(
    "PASS roster leave archive view, read-only detail, reinstate, permanent deletion",
  );
} finally {
  if (created && context) {
    try {
      const current = await context.request.get(`${base}/api/emps/${id}`);
      if (current.ok()) {
        const employee = await current.json();
        if (employee.status !== "已离职")
          await context.request.post(`${base}/api/emps/${id}/actions/leave`, {
            headers: { Origin: base },
            data: { reason: "验收清理", version: employee.version },
          });
        await context.request.delete(`${base}/api/emps/${id}/permanent`, {
          headers: { Origin: base },
        });
      }
    } catch (error) {
      console.error(`Cleanup failed for ${id}:`, error);
    }
  }
  await browser.close();
}
