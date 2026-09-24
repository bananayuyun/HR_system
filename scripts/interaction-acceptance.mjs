import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.HR_BROWSER_URL || "http://127.0.0.1:5175";
const url = new URL(base);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5175")
  throw new Error(
    "Interaction acceptance is restricted to isolated frontend 5175 / backend 8091.",
  );
const require = createRequire(import.meta.url);
const metadata = JSON.parse(
  await fs.readFile(
    path.join(root, "frontend/src/config/prototype-metadata.json"),
    "utf8",
  ),
);
const { chromium } = require(
  path.join(
    process.env.HR_NODE_MODULES || path.join(root, "frontend/node_modules"),
    "playwright",
  ),
);
const selection = process.env.HR_INTERACTION_ONLY || "";
const selectedCase = selection ? new RegExp(selection) : null;
const out = path.join(
  root,
  ".local/verification/interactions",
  selection ? "targeted" : "",
);
await fs.mkdir(out, { recursive: true });
const prefix = `QAINTERACTION${Date.now().toString(36).toUpperCase()}`;
const phase = process.env.HR_INTERACTION_PHASE || "all";
const results = [],
  errors = [],
  created = [],
  originalPreferences = {};
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
page.setDefaultTimeout(12000);
page.on("pageerror", (e) => errors.push(e.message));
let bootstrap, employee;
const routes = {
  roster: "员工花名册",
  orgs: "组织管理",
  jobs: "岗位管理",
  grades: "职级体系",
  settings: "基础信息设置",
  reqs: "招聘需求",
  pool: "简历库",
  screening: "简历筛选",
  interviews: "面试管理",
  offers: "入职管理",
  assets: "资产台账",
};
async function api(method, resource, data, expected = [200, 201]) {
  const response = await context.request.fetch(base + "/api" + resource, {
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
    expected.includes(response.status()),
    `${method} ${resource}: ${response.status()} ${text.slice(0, 700)}`,
  );
  return body;
}
async function run(name, fn) {
  if (selectedCase && !selectedCase.test(name)) return;
  const started = Date.now();
  try {
    const evidence = await fn();
    results.push({ name, status: "PASS", ms: Date.now() - started, evidence });
    console.log("PASS " + name);
  } catch (e) {
    results.push({
      name,
      status: "FAIL",
      ms: Date.now() - started,
      error: e.stack,
    });
    await fs.writeFile(
      path.join(out, String(results.length).padStart(2, "0") + "-failure.html"),
      await page.content(),
    );
    console.error("FAIL " + name + ": " + e.message);
  }
  await page
    .screenshot({
      path: path.join(out, String(results.length).padStart(2, "0") + ".png"),
      fullPage: true,
    })
    .catch(() => {});
}
async function goto(route) {
  if (await page.getByRole("alertdialog", { name: "未保存的更改" }).count())
    await page.getByRole("button", { name: "放弃更改", exact: true }).click();
  const dialog = page.locator(".v-dialog");
  if (await dialog.count()) {
    await dialog
      .locator(".modal-h")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    if (await page.getByRole("alertdialog", { name: "未保存的更改" }).count())
      await page.getByRole("button", { name: "放弃更改", exact: true }).click();
  }
  await page.goto(base + "/?interaction=" + Date.now() + "#/" + route);
  await page.locator(`.v-content[data-page="${route}"]`).waitFor();
  await page.locator(".v-busy").waitFor({ state: "hidden" });
}
async function search(term) {
  await page
    .getByRole("textbox", { name: "关键词搜索", exact: true })
    .fill(term);
  await page
    .getByRole("textbox", { name: "关键词搜索", exact: true })
    .press("Enter");
}
async function selectedOrgTitle() {
  return page.locator(".w3-org-detail h2").evaluate((element) =>
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim(),
  );
}
async function select(label, value, scope = page) {
  const selectBox = scope.locator('.ant-select[aria-label="' + label + '"]');
  await selectBox.locator(".ant-select-selector").click();
  const control = selectBox.locator('input[role="combobox"]');
  const id = await control.getAttribute("aria-controls");
  const popup = page
    .locator(".ant-select-dropdown:visible")
    .filter({ has: page.locator('[id="' + id + '"]') });
  await popup
    .locator(".ant-select-item-option-content")
    .getByText(value, { exact: true })
    .click();
}
async function openEmployee() {
  assert.ok(employee);
  await goto("roster");
  await search(employee.id);
  await page
    .locator("tbody tr")
    .filter({ hasText: employee.id })
    .getByRole("button", { name: "查看", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "员工档案", exact: true });
  await detail.waitFor();
  return detail;
}
async function submit(dialog, resource) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api" + resource &&
      ["POST", "PUT", "DELETE"].includes(r.request().method()),
  );
  await dialog
    .locator(".modal-f")
    .getByRole("button", { name: /^(确定|保存|确认)$/ })
    .click();
  const result = await response;
  assert.ok(result.ok(), await result.text());
  await page.locator(".v-busy").waitFor({ state: "hidden" });
  return result.json();
}

try {
  await page.goto(base);
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
    "5175 session must belong to test backend 8091 before any mutation.",
  );
  bootstrap = await api("GET", "/bootstrap");
  for (const key of ["jobs", "roster"])
    originalPreferences[key] = await api("GET", "/preferences/" + key);

  await run(
    "All 12 routes, navigation search, collapse and refresh route restoration",
    async () => {
      for (const [route, label] of Object.entries(routes)) {
        await page
          .locator(".v-nav")
          .getByRole("link", { name: label, exact: true })
          .click();
        await page.locator(`.v-content[data-page="${route}"]`).waitFor();
      }
      await page
        .getByRole("textbox", { name: "搜索菜单", exact: true })
        .fill("面试");
      assert.equal(await page.locator(".v-nav a").count(), 12);
      assert.equal(await page.locator(".v-nav-search-result").count(), 1);
      await page.getByRole("button", { name: "招聘管理 / 面试管理" }).click();
      await page.locator('.v-content[data-page="interviews"]').waitFor();
      assert.equal(await page.getByLabel("搜索菜单", { exact: true }).inputValue(), "");
      await page
        .getByRole("textbox", { name: "搜索菜单", exact: true })
        .fill("");
      await page
        .getByRole("button", { name: "展开或收起侧栏", exact: true })
        .click();
      assert.equal(await page.locator("body.collapsed").count(), 1);
      await page
        .getByRole("button", { name: "展开或收起侧栏", exact: true })
        .click();
      await goto("grades");
      await page.reload();
      await page.locator('.v-content[data-page="grades"]').waitFor();
    },
  );

  await run(
    "Navigation group summaries collapse and expand their own links without changing route",
    async () => {
      await goto("roster");
      const groups = page.locator(".v-nav details.v-group");
      assert.equal(await groups.count(), 3);
      for (let i = 0; i < (await groups.count()); i++) {
        const group = groups.nth(i);
        const links = group.locator("a");
        assert.ok(await links.count());
        assert.equal(await group.evaluate((el) => el.open), true);
        await group.locator("summary").click();
        assert.equal(await group.evaluate((el) => el.open), false);
        assert.equal(await links.first().isVisible(), false);
        assert.equal(
          await page.locator(".v-content").getAttribute("data-page"),
          "roster",
        );
        await group.locator("summary").click();
        assert.equal(await group.evaluate((el) => el.open), true);
        for (const link of await links.all())
          assert.equal(await link.isVisible(), true);
      }
      await page
        .getByLabel("搜索菜单", { exact: true })
        .fill(prefix + "不存在菜单");
      assert.equal(await page.locator(".v-nav a").count(), 12);
      assert.equal(await page.locator(".v-nav-search-result").count(), 0);
      await page.getByText("没有匹配的菜单", { exact: true }).waitFor();
      await page.getByLabel("搜索菜单", { exact: true }).fill("");
      assert.equal(await page.locator(".v-nav a:visible").count(), 12);
    },
  );

  await run(
    "List pagination, page size, jump bounds and cross-page checkbox states",
    async () => {
      await goto("roster");
      const first = page.locator(".tbl tbody tr").first();
      await first.locator('input[type="checkbox"]').check();
      assert.equal(
        await page
          .getByLabel("选择本页全部记录")
          .evaluate((e) => e.indeterminate),
        true,
      );
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      assert.equal(
        await page
          .getByLabel("选择本页全部记录")
          .evaluate((e) => e.indeterminate),
        false,
      );
      assert.equal(await page.locator(".pager .current").innerText(), "2");
      await page.getByLabel("跳转页码").fill("9999");
      await page.getByLabel("跳转页码").press("Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "下一页", exact: true })
          .isDisabled(),
        true,
      );
      await select("每页条数", "30");
      assert.equal(await page.locator(".pager .current").innerText(), "1");
      assert.equal(await page.locator(".tbl tbody tr").count(), 30);
      await page.getByLabel("选择本页全部记录").check();
      assert.equal(
        await page.locator('.tbl tbody input[type="checkbox"]:checked').count(),
        30,
      );
      await page.getByLabel("选择本页全部记录").uncheck();
      for (const size of [50, 100, 15]) {
        await select("每页条数", String(size));
        assert.equal(await page.locator(".tbl tbody tr").count(), size);
        assert.equal(await page.locator(".pager .current").innerText(), "1");
        await page.getByRole("button", { name: "下一页", exact: true }).click();
        assert.equal(await page.locator(".pager .current").innerText(), "2");
        await page.getByRole("button", { name: "上一页", exact: true }).click();
        assert.equal(await page.locator(".pager .current").innerText(), "1");
      }
      await page.getByLabel("跳转页码").fill("0");
      await page.getByLabel("跳转页码").press("Tab");
      assert.equal(await page.locator(".pager .current").innerText(), "1");
    },
  );

  await run(
    "Sort ascending and descending, fullscreen title and Escape",
    async () => {
      await goto("jobs");
      await select("每页条数", "100");
      const getNames = () =>
        page.locator('tbody [data-list-key="name"]').allTextContents();
      await page.locator('th[data-list-key="name"] button').click();
      const asc = await getNames();
      assert.deepEqual(
        asc,
        [...asc].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true })),
      );
      await page.locator('th[data-list-key="name"] button').click();
      const desc = await getNames();
      assert.deepEqual(
        desc,
        [...desc].sort((a, b) =>
          b.localeCompare(a, "zh-CN", { numeric: true }),
        ),
      );
      await page.getByRole("button", { name: "表格全屏", exact: true }).click();
      await page
        .getByRole("button", { name: "退出表格全屏", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".w-fullscreen").count(), 0);
    },
  );

  await run(
    "Column cancel, minimum visibility, keyboard order, cumulative pin offsets and reset",
    async () => {
      await goto("jobs");
      await page.getByRole("button", { name: "列设置", exact: true }).click();
      let popup = page.getByRole("dialog", { name: "列设置", exact: true });
      await popup.getByLabel("显示岗位名称", { exact: true }).uncheck();
      await popup.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(
        await page.locator('th[data-list-key="__index"]').count(),
        1,
      );
      await page.getByRole("button", { name: "列设置", exact: true }).click();
      popup = page.getByRole("dialog", { name: "列设置", exact: true });
      await popup
        .getByRole("checkbox", { name: "全部", exact: true })
        .uncheck();
      assert.equal(
        await popup
          .getByRole("button", { name: "确认", exact: true })
          .isDisabled(),
        true,
      );
      await popup.getByRole("checkbox", { name: "全部", exact: true }).check();
      await popup
        .getByRole("button", { name: "调整岗位名称顺序", exact: true })
        .press("ArrowDown");
      const firstTwo = popup.locator(".w-column-row");
      await firstTwo
        .nth(0)
        .getByRole("button", { name: "固定到左侧", exact: true })
        .click();
      await firstTwo
        .nth(1)
        .getByRole("button", { name: "固定到左侧", exact: true })
        .click();
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/preferences/jobs") &&
          r.request().method() === "PUT",
      );
      await popup.getByRole("button", { name: "确认", exact: true }).click();
      assert.ok((await saved).ok());
      const pins = await page
        .locator('thead .w3-pinned[data-pin-side="left"]')
        .evaluateAll((cells) =>
          cells.map((cell) => ({
            left: parseFloat(cell.style.left),
            width: cell.getBoundingClientRect().width,
          })),
        );
      assert.equal(pins.length, 2);
      assert.equal(pins[0].left, 0);
      assert.ok(Math.abs(pins[1].left - pins[0].width) < 1);
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "列设置", exact: true }).click();
      popup = page.getByRole("dialog", { name: "列设置", exact: true });
      await popup
        .getByRole("button", { name: "恢复默认", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "确认恢复默认列配置?" })
        .getByRole("button", { name: "取消", exact: true })
        .click();
      assert.equal(await popup.count(), 1);
      await popup
        .getByRole("button", { name: "恢复默认", exact: true })
        .click();
      const resetSaved = page.waitForResponse(
        (r) => r.url().endsWith('/preferences/jobs') && r.request().method() === 'PUT',
      );
      await page
        .getByRole("dialog", { name: "确认恢复默认列配置?" })
        .getByRole("button", { name: "确认", exact: true })
        .click();
      assert.ok((await resetSaved).ok());
    },
  );

  await run(
    "Column native drag reorder persists exact new order through reload",
    async () => {
      await goto("jobs");
      await page.getByRole("button", { name: "列设置", exact: true }).click();
      const popup = page.getByRole("dialog", { name: "列设置", exact: true });
      const before = await popup
        .locator(".w-column-row > span")
        .allTextContents();
      const source = before.indexOf("岗位名称"),
        destination = before.indexOf("编制");
      assert.ok(source >= 0 && destination > source);
      const expected = [...before];
      expected.splice(destination, 0, expected.splice(source, 1)[0]);
      const target = popup
        .locator(".w-column-row")
        .filter({ has: page.getByLabel("显示编制", { exact: true }) });
      await popup
        .getByRole("button", { name: "调整岗位名称顺序", exact: true })
        .dragTo(target);
      assert.deepEqual(
        await popup.locator(".w-column-row > span").allTextContents(),
        expected,
      );
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/preferences/jobs") &&
          r.request().method() === "PUT",
      );
      await popup.getByRole("button", { name: "确认", exact: true }).click();
      assert.ok((await saved).ok());
      const preference = await api("GET", "/preferences/jobs");
      assert.deepEqual(
        preference.columns.map((c) => c.label),
        expected,
      );
      const loaded = page.waitForResponse(
        (r) =>
          r.url().endsWith("/preferences/jobs") &&
          r.request().method() === "GET",
      );
      await page.reload();
      assert.ok((await loaded).ok());
      await page.locator('.v-content[data-page="jobs"]').waitFor();
      await page.getByRole("button", { name: "列设置", exact: true }).click();
      await popup.waitFor();
      assert.deepEqual(
        await popup.locator(".w-column-row > span").allTextContents(),
        expected,
      );
      assert.deepEqual(
        await page
          .locator("thead th[data-list-key]")
          .evaluateAll((nodes) => nodes.map((n) => n.dataset.listKey)),
        ['__select', '__index', ...preference.columns.filter((c) => c.show).map((c) => c.key), '__actions'],
      );
      await popup.getByRole("button", { name: "取消", exact: true }).click();
    },
  );

  await run(
    "Advanced filter validation, empty operator, add/remove conditions and saved scheme",
    async () => {
      await goto("jobs");
      await page.getByRole("button", { name: "高级筛选", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "高级筛选",
        exact: true,
      });
      await dialog
        .getByRole("button", { name: "应用方案", exact: true })
        .click();
      await dialog.getByRole("alert").getByText("请填写筛选值").waitFor();
      await select("条件1关系", "为空", dialog);
      assert.equal(
        await dialog.getByLabel("筛选值 1", { exact: true }).isDisabled(),
        true,
      );
      await select("条件1关系", "包含", dialog);
      await dialog.getByLabel("筛选值 1", { exact: true }).fill("开发");
      await dialog
        .getByRole("button", { name: "新增条件", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "删除条件 2", exact: true })
        .click();
      await dialog.getByRole("button", { name: "添加", exact: true }).click();
      await dialog.getByPlaceholder("请输入方案名称").fill(prefix);
      let saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/preferences/jobs") &&
          r.request().method() === "PUT",
      );
      await dialog
        .getByRole("button", { name: "保存方案", exact: true })
        .click();
      assert.ok((await saved).ok());
      await dialog.getByRole("button", { name: "添加", exact: true }).click();
      await dialog.getByPlaceholder("请输入方案名称").fill(prefix);
      await dialog
        .getByRole("button", { name: "保存方案", exact: true })
        .click();
      await dialog.getByRole("alert").getByText("方案名称已存在").waitFor();
      await dialog.getByRole("button", { name: prefix, exact: true }).click();
      await dialog
        .getByRole("button", { name: "应用方案", exact: true })
        .click();
      assert.ok(
        (
          await page.locator('tbody [data-list-key="name"]').allTextContents()
        ).every((name) => name.includes("开发")),
      );
      await page.reload();
      await page.getByRole("button", { name: "高级筛选", exact: true }).click();
      await page.getByRole("button", { name: prefix, exact: true }).waitFor();
      saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/preferences/jobs") &&
          r.request().method() === "PUT",
      );
      await page
        .getByRole("button", { name: "删除方案" + prefix, exact: true })
        .click();
      assert.ok((await saved).ok());
      await page.keyboard.press("Escape");
    },
  );

  await run(
    "All six advanced filter operators and all/any modes return exact fixture IDs",
    async () => {
      const fixtures = [];
      for (const suffix of ["Alpha", "Beta", "AlphaBeta"]) {
        const job = await api("POST", "/jobs", {
          name: prefix + suffix,
          dept: "ORG_18",
          headcount: 1,
          status: "启用",
          duties: "独立筛选验收",
          requirements: "独立筛选验收",
        });
        fixtures.push(job);
        created.push({ type: "jobs", id: job.id });
      }
      const cases = [
        ["包含", "aLpHa", [0, 2]],
        ["等于", (prefix + "Alpha").toLowerCase(), [0]],
        ["不等于", prefix + "Alpha", [1, 2]],
        ["不包含", "alpha", [1]],
        ["为空", "", []],
        ["不为空", "", [0, 1, 2]],
      ];
      const check = async (rules, mode, indices) => {
        await goto("jobs");
        await search(prefix);
        await page
          .getByRole("button", { name: "高级筛选", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "高级筛选",
          exact: true,
        });
        await select("条件匹配方式", mode, dialog);
        for (let i = 0; i < rules.length; i++) {
          if (i)
            await dialog
              .getByRole("button", { name: "新增条件", exact: true })
              .click();
          await select("条件" + (i + 1) + "字段", "岗位名称", dialog);
          await select("条件" + (i + 1) + "关系", rules[i][0], dialog);
          if (!["为空", "不为空"].includes(rules[i][0]))
            await dialog
              .getByLabel("筛选值 " + (i + 1), { exact: true })
              .fill(rules[i][1]);
        }
        await dialog
          .getByRole("button", { name: "应用方案", exact: true })
          .click();
        await dialog.waitFor({ state: "hidden" });
        const actual = (
          await page.locator('tbody td[data-list-key="id"]').allTextContents()
        )
          .map((value) => value.trim())
          .sort();
        assert.deepEqual(
          actual,
          indices.map((i) => fixtures[i].id).sort(),
          JSON.stringify({ rules, mode }),
        );
        await page
          .locator(".w3-advanced-strip")
          .getByRole("button", { name: "清空", exact: true })
          .click();
        assert.deepEqual(
          (await page.locator('tbody td[data-list-key="id"]').allTextContents())
            .map((value) => value.trim())
            .sort(),
          fixtures.map((f) => f.id).sort(),
        );
      };
      for (const [operator, value, indices] of cases)
        await check([[operator, value]], "全部条件", indices);
      await check(
        [
          ["包含", "Alpha"],
          ["包含", "Beta"],
        ],
        "全部条件",
        [2],
      );
      await check(
        [
          ["等于", prefix + "Alpha"],
          ["等于", prefix + "Beta"],
        ],
        "任一条件",
        [0, 1],
      );
      return {
        fixtures: fixtures.map((f) => f.id),
        operators: 6,
        modes: ["全部条件", "任一条件"],
      };
    },
  );

  await run(
    "Organization people query/reset/pagination and hierarchy-preserving tree search",
    async () => {
      await goto("orgs");
      await page.getByRole("button", { name: "组织人员", exact: true }).click();
      await page
        .getByRole("button", { name: "组织人员下一页", exact: true })
        .click();
      assert.equal(
        await page
          .locator(".w3-org-person-table tbody tr")
          .first()
          .locator("td")
          .first()
          .innerText(),
        "16",
      );
      await page
        .getByLabel("组织人员搜索", { exact: true })
        .fill(prefix + "NO_MATCH");
      await page
        .getByRole("button", { name: "查询组织人员", exact: true })
        .click();
      await page.getByText("暂无人员", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "重置组织人员", exact: true })
        .click();
      assert.equal(
        await page.locator(".w3-org-person-table tbody tr").count(),
        15,
      );
      await page.getByLabel("搜索组织", { exact: true }).fill("前端开发组");
      const rows = await page.locator(".w3-org-row").allTextContents();
      assert.ok(rows.some((t) => t.includes("中数股份")));
      assert.ok(rows.some((t) => t.includes("开发部")));
      assert.ok(rows.some((t) => t.includes("前端开发组")));
    },
  );

  await run(
    "Recruitment candidate entry retains the selected request filter after navigation",
    async () => {
      await goto("reqs");
      const req = bootstrap.reqs.find((r) =>
        bootstrap.candidates.some((c) => c.req === r.id),
      );
      assert.ok(req);
      await search(req.id);
      await page
        .locator('td[data-list-key="candidates"] button')
        .first()
        .click();
      await page.locator('.v-content[data-page="pool"]').waitFor();
      const rows = await page
        .locator('td[data-list-key="req"]')
        .allTextContents();
      assert.ok(rows.length > 0);
      assert.ok(
        rows.every((text) => text.includes(req.name)),
        JSON.stringify(rows),
      );
      assert.match(
        await page.locator(".pager").innerText(),
        new RegExp(
          "共 " +
            bootstrap.candidates.filter(
              (c) =>
                c.req === req.id &&
                !c.deletedAt &&
                !c.deleted_at &&
                !c.deleted &&
                !c.archived,
            ).length +
            " 条记录",
        ),
      );
    },
  );

  await run(
    "Form required validation, department linkage, dirty close and dirty hash navigation",
    async () => {
      await goto("jobs");
      await page
        .locator(".w-toolbar")
        .getByRole("button", { name: "新增", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "新增岗位",
        exact: true,
      });
      await dialog.getByRole("button", { name: "确定", exact: true }).click();
      assert.equal(
        await dialog.locator("form").evaluate((form) => form.checkValidity()),
        false,
      );
      await dialog
        .getByLabel("岗位名称", { exact: true })
        .fill(prefix + "未保存");
      await dialog
        .locator(".modal-h")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page.getByRole("alertdialog", { name: "未保存的更改" }).waitFor();
      await page.getByRole("button", { name: "继续编辑", exact: true }).click();
      assert.equal(
        await dialog.getByLabel("岗位名称", { exact: true }).inputValue(),
        prefix + "未保存",
      );
      await page.evaluate(() => {
        location.hash = "#/assets";
      });
      await page.getByRole("alertdialog", { name: "未保存的更改" }).waitFor();
      assert.ok(page.url().endsWith("#/jobs"));
      await page.getByRole("button", { name: "继续编辑", exact: true }).click();
      await select("所属部门", "产品部", dialog);
      assert.equal(
        await dialog
          .locator('.ant-select[aria-label="所属组织"]')
          .innerText()
          .then((x) => x.includes("开发部")),
        false,
      );
      await page.evaluate(() => {
        location.hash = "#/assets";
      });
      await page.getByRole("button", { name: "放弃更改", exact: true }).click();
      await page.locator('.v-content[data-page="assets"]').waitFor();
      assert.equal(
        (await api("GET", "/bootstrap")).jobs.some(
          (r) => r.name === prefix + "未保存",
        ),
        false,
      );
    },
  );

  await run(
    "Create isolated employee fixture for archive, nested detail and growth UI checks",
    async () => {
      const job = bootstrap.jobs.find(
        (j) => j.status === "启用" && j.dept === "ORG_18",
      );
      assert.ok(job);
      employee = await api("POST", "/emps", {
        id: prefix + "E",
        name: prefix + "员工",
        phone: "198" + String(Date.now()).slice(-8),
        dept: job.dept,
        job: job.id,
        grade: bootstrap.grades.find(
          (g) => g.status === "启用" && g.scope === "全部部门",
        ).code,
        status: "正式",
        workType: "全职",
        entry: "2026-01-01",
        workRegion: "上海",
        workplace: "上海",
        contractCompany: "微间",
        supervisorId: bootstrap.emps.find(
          (e) => e.dept === "ORG_18" && e.status === "正式" && !e.deletedAt,
        ).id,
        graduated: "2020-06-30",
      });
      created.push({ type: "emps", id: employee.id });
      return { id: employee.id };
    },
  );

  await run(
    "Employee detail tabs, fullscreen and nested upload/edit/import return to original tab",
    async () => {
      let detail = await openEmployee();
      await detail
        .getByRole("button", { name: "弹窗全屏", exact: true })
        .click();
      assert.equal(await page.locator(".w-dialog-full").count(), 1);
      await detail
        .getByRole("button", { name: "退出弹窗全屏", exact: true })
        .click();
      await detail
        .getByRole("button", { name: "档案材料", exact: true })
        .click();
      await detail
        .getByRole("button", { name: "上传材料", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "上传档案材料", exact: true })
        .locator(".modal-h")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      detail = page.getByRole("dialog", { name: "员工档案", exact: true });
      assert.equal(
        await detail.locator(".v-tabs button.on").innerText(),
        "档案材料",
      );
      await detail
        .getByRole("button", { name: "成长记录", exact: true })
        .click();
      await detail
        .getByRole("button", { name: "导入成长记录", exact: true })
        .click();
      await page
        .getByRole("dialog", {
          name: metadata.importConfig.timeline.title,
          exact: true,
        })
        .locator(".modal-h")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("dialog", { name: "员工档案", exact: true })
          .locator(".v-tabs button.on")
          .innerText(),
        "成长记录",
      );
      await detail
        .getByRole("button", { name: "领用资产", exact: true })
        .click();
      await detail
        .getByRole("button", { name: "个人信息", exact: true })
        .click();
      await detail
        .getByRole("button", { name: "编辑基本信息", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "编辑基本信息", exact: true })
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "员工档案", exact: true })
        .waitFor();
    },
  );

  await run(
    "Growth events create, edit and delete through UI with durable readback",
    async () => {
      let detail = await openEmployee();
      await detail
        .getByRole("button", { name: "成长记录", exact: true })
        .click();
      await detail
        .getByRole("button", { name: "新增成长记录", exact: true })
        .click();
      let dialog = page.getByRole("dialog", {
        name: "新增成长记录",
        exact: true,
      });
      await dialog
        .getByLabel("事件标题", { exact: true })
        .fill(prefix + "培训");
      await dialog
        .getByLabel("事件说明", { exact: true })
        .fill("真实UI新增成长记录");
      await submit(dialog, "/emps/" + employee.id + "/actions/timeline");
      let record = await api("GET", "/emps/" + employee.id);
      assert.ok(record.timeline.some((t) => t.title === prefix + "培训"));
      detail = await openEmployee();
      await detail
        .getByRole("button", { name: "成长记录", exact: true })
        .click();
      await detail
        .locator(".v-timeline li")
        .filter({ hasText: prefix + "培训" })
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: "编辑成长记录", exact: true });
      await dialog
        .getByLabel("事件标题", { exact: true })
        .fill(prefix + "已编辑");
      await submit(dialog, "/emps/" + employee.id + "/actions/timeline-update");
      record = await api("GET", "/emps/" + employee.id);
      assert.ok(record.timeline.some((t) => t.title === prefix + "已编辑"));
      detail = await openEmployee();
      await detail
        .getByRole("button", { name: "成长记录", exact: true })
        .click();
      await detail
        .locator(".v-timeline li")
        .filter({ hasText: prefix + "已编辑" })
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await submit(
        page.getByRole("dialog", { name: "删除成长记录", exact: true }),
        "/emps/" + employee.id + "/actions/timeline-delete",
      );
      record = await api("GET", "/emps/" + employee.id);
      assert.equal(
        record.timeline.some((t) => t.title === prefix + "已编辑"),
        false,
      );
    },
  );

  await run(
    "Leave and reinstate preserve the employee identity",
    async () => {
      await goto("roster");
      await search(employee.id);
      await page
        .locator(".tbl tbody tr")
        .first()
        .getByRole("button", { name: "办理离职", exact: true })
        .click();
      await page.getByRole("dialog", { name: "办理离职", exact: true })
        .getByLabel("离职原因", { exact: true }).fill(prefix + "验收离职");
      await submit(
        page.getByRole("dialog", { name: "办理离职", exact: true }),
        "/emps/" + employee.id + "/actions/leave",
      );
      assert.equal((await api("GET", "/emps/" + employee.id)).status, "已离职");
      await page
        .getByRole("button", { name: "离职人员档案", exact: true })
        .click();
      await search(employee.id);
      await page
        .locator("tbody tr")
        .filter({ hasText: employee.id })
        .getByRole("button", { name: "复职", exact: true })
        .click();
      await submit(
        page.getByRole("dialog", { name: "复职", exact: true }),
        "/emps/" + employee.id + "/actions/reinstate",
      );
      const restored = await api("GET", "/emps/" + employee.id);
      assert.equal(restored.id, employee.id);
      assert.equal(restored.status, "正式");
    },
  );

  await run(
    "Grade map/list switch and grid edit entry, settings tab dirty cancellation",
    async () => {
      await goto("grades");
      await page.getByRole("button", { name: "职级图谱", exact: true }).click();
      await page.locator(".v-rank-cell").first().click();
      await page
        .getByRole("dialog", { name: "编辑职级", exact: true })
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page.getByRole("button", { name: "列表视图", exact: true }).click();
      await page.locator(".v-table-host").waitFor();
      await goto("settings");
      await page
        .locator(".v-tabs")
        .getByRole("button", { name: /^工作所在地/ })
        .click();
      await page
        .getByRole("button", { name: "新增工作所在地", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "新增工作所在地",
        exact: true,
      });
      await dialog.getByLabel("工作所在地", { exact: true }).fill(prefix);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("alertdialog", { name: "未保存的更改" }).waitFor();
      await page.getByRole("button", { name: "放弃更改", exact: true }).click();
      assert.equal(
        (await api("GET", "/settings/workplace")).items.some(
          (x) => x.name === prefix,
        ),
        false,
      );
    },
  );

  await run(
    "Import menus expose the original per-module action and records entry",
    async () => {
      for (const [route, title] of [
        ["roster", "导入花名册"],
        ["reqs", "导入招聘需求"],
        ["grades", "导入数据"],
        ["assets", "导入数据"],
      ]) {
        await goto(route);
        await page
          .getByRole("button", { name: "导入菜单", exact: true })
          .click();
        const menu = page.getByRole("menu", { name: "导入选项", exact: true });
        assert.equal(
          await menu
            .getByRole("button", { name: "导入记录", exact: true })
            .count(),
          1,
        );
        await menu.getByRole("button", { name: title, exact: true }).click();
        await page.getByLabel("上传导入文件").waitFor();
        await page
          .locator(".v-dialog .modal-h")
          .getByRole("button", { name: "关闭", exact: true })
          .click();
      }
    },
  );

  if (phase === "all") {
    await run(
      "Organization create, edit, parent options and delete maintain tree selection",
      async () => {
        await goto("orgs");
        await page
          .getByRole("button", { name: "新增组织", exact: true })
          .click();
        await page
          .getByRole("menu")
          .getByRole("button", { name: "部门", exact: true })
          .click();
        let dialog = page.getByRole("dialog", {
          name: "新增组织",
          exact: true,
        });
        await dialog
          .getByLabel("组织名称", { exact: true })
          .fill(prefix + "组织");
        await dialog
          .getByLabel("负责人", { exact: true })
          .fill(prefix + "未绑定联系人");
        const org = await submit(dialog, "/orgs");
        created.push({ type: "orgs", id: org.id });
        assert.equal(await selectedOrgTitle(), prefix + "组织");
        assert.equal(
          (await api("GET", "/orgs/" + org.id)).manager,
          prefix + "未绑定联系人",
        );
        await page
          .getByRole("button", { name: prefix + "组织组织操作", exact: true })
          .click();
        await page
          .getByRole("menu")
          .getByRole("button", { name: "编辑", exact: true })
          .click();
        dialog = page.getByRole("dialog", { name: "编辑组织", exact: true });
        assert.equal(
          await dialog
            .getByLabel("组织编码", { exact: true })
            .getAttribute("readonly"),
          "",
        );
        await dialog
          .getByLabel("组织名称", { exact: true })
          .fill(prefix + "组织新");
        await dialog
          .getByLabel("组织职责", { exact: true })
          .fill("独有验收组织职责");
        await submit(dialog, "/orgs/" + org.id);
        assert.equal(await selectedOrgTitle(), prefix + "组织新");
        assert.equal(
          (await api("GET", "/orgs/" + org.id)).description,
          "独有验收组织职责",
        );
        await page
          .getByRole("button", { name: prefix + "组织新组织操作", exact: true })
          .click();
        const menuBox = await page.getByRole("menu").boundingBox();
        const viewport = page.viewportSize();
        assert.ok(
          menuBox.x >= 0 &&
            menuBox.y >= 0 &&
            menuBox.x + menuBox.width <= viewport.width &&
            menuBox.y + menuBox.height <= viewport.height,
          JSON.stringify(menuBox),
        );
        await page.screenshot({
          path: path.join(out, "organization-bottom-menu.png"),
          fullPage: true,
        });
        await page
          .getByRole("menu")
          .getByRole("button", { name: "删除", exact: true })
          .click();
        await submit(
          page.getByRole("dialog", { name: "删除记录", exact: true }),
          "/orgs/" + org.id,
        );
        const archived = (await api("GET", "/bootstrap")).orgs.find(
          (o) => o.id === org.id,
        );
        assert.equal(archived.deleted, true);
        assert.ok(archived.deletedAt);
        assert.equal(
          await page
            .getByRole("button", {
              name: prefix + "组织新组织操作",
              exact: true,
            })
            .count(),
          0,
        );
        assert.notEqual(await selectedOrgTitle(), prefix + "组织新");
      },
    );

    for (const [route, title, required] of [
      ["jobs", "新增岗位", "岗位名称"],
      ["grades", "新增职级", "职级编码"],
      ["reqs", "新增招聘需求", "需求名称"],
    ])
      await run(
        title + " required and invalid numeric input block submission",
        async () => {
          await goto(route);
          await page
            .locator(".w-toolbar")
            .getByRole("button", { name: "新增", exact: true })
            .click();
          const dialog = page.getByRole("dialog", { name: title, exact: true });
          let writes = 0;
          const count = (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname === "/api/" + route
            )
              writes++;
          };
          page.on("request", count);
          try {
            await dialog
              .getByRole("button", { name: "确定", exact: true })
              .click();
            assert.equal(
              await dialog
                .getByLabel(required, { exact: true })
                .evaluate((e) => e.validity.valueMissing),
              true,
            );
            assert.equal(writes, 0);
            await dialog
              .getByLabel(required, { exact: true })
              .fill(prefix + route);
            const numeric = dialog.locator('input[type="number"]').first();
            await numeric.fill("-1");
            await dialog
              .getByRole("button", { name: "确定", exact: true })
              .click();
            assert.equal(
              await numeric.evaluate((e) => e.validity.rangeUnderflow),
              true,
            );
            assert.equal(writes, 0);
            if (route === "reqs")
              assert.ok(
                (
                  await dialog
                    .locator('.ant-select[aria-label="需求部门"]')
                    .innerText()
                ).includes("开发部"),
              );
          } finally {
            page.off("request", count);
          }
        },
      );

    await run(
      "Drawer focus trap, dirty confirmation focus and Escape retain input",
      async () => {
        await goto("jobs");
        await page
          .locator(".w-toolbar")
          .getByRole("button", { name: "新增", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "新增岗位",
          exact: true,
        });
        await dialog.focus();
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
          true,
        );
        assert.equal(await page.locator(":focus").innerText(), "确定");
        await page.keyboard.press("Tab");
        assert.equal(
          await page.locator(":focus").getAttribute("aria-label"),
          "弹窗全屏",
        );
        await dialog
          .getByLabel("岗位名称", { exact: true })
          .fill(prefix + "FOCUS");
        await dialog
          .locator(".modal-h")
          .getByRole("button", { name: "关闭", exact: true })
          .click();
        const confirmation = page.getByRole("alertdialog", {
          name: "未保存的更改",
          exact: true,
        });
        await confirmation.waitFor();
        assert.equal(await page.locator(":focus").innerText(), "继续编辑");
        await page.keyboard.press("Shift+Tab");
        assert.equal(await page.locator(":focus").innerText(), "放弃更改");
        await page.keyboard.press("Tab");
        assert.equal(await page.locator(":focus").innerText(), "继续编辑");
        await page.keyboard.press("Escape");
        assert.equal(await confirmation.count(), 0);
        assert.equal(
          await dialog.getByLabel("岗位名称", { exact: true }).inputValue(),
          prefix + "FOCUS",
        );
        await dialog
          .locator(".modal-h")
          .getByRole("button", { name: "关闭", exact: true })
          .click();
        await confirmation
          .getByRole("button", { name: "放弃更改", exact: true })
          .click();
      },
    );

    await run(
      "1280 and narrow viewports retain navigation, horizontal scroll and drawer close access",
      async () => {
        try {
          for (const viewport of [
            { width: 1280, height: 720 },
            { width: 390, height: 844 },
          ]) {
            await page.setViewportSize(viewport);
            await goto("roster");
            if (viewport.width < 760) {
              await page
                .getByRole("button", { name: "展开导航", exact: true })
                .click();
              assert.equal(await page.locator("body.mobile-nav").count(), 1);
              await page
                .locator(".v-nav")
                .getByRole("link", { name: "岗位管理", exact: true })
                .click();
              await page.locator('.v-content[data-page="jobs"]').waitFor();
              assert.equal(await page.locator("body.mobile-nav").count(), 0);
            } else await goto("jobs");
            const scroll = page.locator(".v-table-host .tw");
            const dimensions = await scroll.evaluate((e) => ({
              width: e.clientWidth,
              content: e.scrollWidth,
            }));
            assert.ok(
              dimensions.content > dimensions.width,
              JSON.stringify(dimensions),
            );
            assert.ok(
              await scroll.evaluate((e) => {
                e.scrollLeft = 100;
                return e.scrollLeft > 0;
              }),
            );
            await page
              .locator(".w-toolbar")
              .getByRole("button", { name: "新增", exact: true })
              .click();
            const close = page
              .getByRole("dialog", { name: "新增岗位", exact: true })
              .locator(".modal-h")
              .getByRole("button", { name: "关闭", exact: true });
            const box = await close.boundingBox();
            assert.ok(
              box.x >= 0 &&
                box.y >= 0 &&
                box.x + box.width <= viewport.width &&
                box.y + box.height <= viewport.height,
              JSON.stringify(box),
            );
            await close.click();
          }
        } finally {
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
      },
    );

    await run(
      "Import footer cancel shares keyboard-safe unsaved confirmation without writing data",
      async () => {
        await goto("roster");
        await page
          .getByRole("button", { name: "导入菜单", exact: true })
          .click();
        await page
          .getByRole("menu", { name: "导入选项" })
          .getByRole("button", { name: "导入花名册", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: metadata.importConfig.emps.title,
          exact: true,
        });
        const fileName = prefix + "未提交.csv";
        await dialog.locator('input[type="file"]').setInputFiles({
          name: fileName,
          mimeType: "text/csv",
          buffer: Buffer.from("工号,姓名\r\n" + prefix + "NOSAVE,未提交\r\n"),
        });
        await dialog.getByText(fileName, { exact: false }).first().waitFor();
        await dialog
          .locator(".modal-f")
          .getByRole("button", { name: "取消", exact: true })
          .click();
        const confirm = page.getByRole("alertdialog", {
          name: "未保存的更改",
          exact: true,
        });
        await confirm.waitFor();
        assert.equal(await page.locator(":focus").innerText(), "继续编辑");
        await page.keyboard.press("Shift+Tab");
        assert.equal(await page.locator(":focus").innerText(), "放弃更改");
        await page.keyboard.press("Escape");
        assert.equal(await confirm.count(), 0);
        assert.equal(await dialog.count(), 1);
        await dialog
          .locator(".modal-f")
          .getByRole("button", { name: "取消", exact: true })
          .click();
        await confirm
          .getByRole("button", { name: "放弃更改", exact: true })
          .click();
        assert.equal(
          (await api("GET", "/bootstrap")).emps.some(
            (e) => e.id === prefix + "NOSAVE",
          ),
          false,
        );
      },
    );

    await run(
      "Asset editing mode change reuses a single discard confirmation and Escape retains basic input",
      async () => {
        const asset = bootstrap.assets.find(
          (a) =>
            a.public !== "是" &&
            a.status === "闲置" &&
            !a.owner &&
            !a.deletedAt,
        );
        assert.ok(asset);
        await goto("assets");
        await search(asset.id);
        await page
          .locator("tbody tr")
          .filter({ hasText: asset.id })
          .getByRole("button", { name: "编辑", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "编辑资产 · " + asset.name,
          exact: true,
        });
        await dialog
          .getByLabel("资产名称", { exact: true })
          .fill(prefix + "不保存资产");
        await dialog.getByRole("button", { name: "领用", exact: true }).click();
        const confirm = page.getByRole("alertdialog", {
          name: "未保存的更改",
          exact: true,
        });
        await confirm.waitFor();
        assert.equal(await page.locator(".w3-leave-confirm").count(), 1);
        assert.equal(await page.locator(":focus").innerText(), "继续编辑");
        await page.keyboard.press("Escape");
        assert.equal(await confirm.count(), 0);
        assert.equal(
          await dialog.getByLabel("资产名称", { exact: true }).inputValue(),
          prefix + "不保存资产",
        );
        await dialog.getByRole("button", { name: "领用", exact: true }).click();
        await confirm
          .getByRole("button", { name: "放弃更改", exact: true })
          .click();
        assert.equal(
          await dialog
            .locator('.v-tabs[aria-label="资产编辑方式"] button.on')
            .innerText(),
          "领用",
        );
        await dialog
          .locator(".modal-h")
          .getByRole("button", { name: "关闭", exact: true })
          .click();
        assert.equal(
          (await api("GET", "/assets/" + asset.id)).name,
          asset.name,
        );
      },
    );

    for (const [section, field, value, sensitive = false] of [
      ["basic", "notes", prefix + "基本信息"],
      ["work", "titleLevel", prefix + "职称"],
      ["personal", "householdType", "城镇户籍" + prefix, true],
      ["education", "school", prefix + "大学"],
      ["contract", "contractYears", 3],
      ["insurance", "insuranceNotes", prefix + "五险一金"],
      ["bank", "bankNumber", "622200000000000018", true],
      ["emergency", "emergency", prefix + "联系人", true],
      ["materials", "materialOther", "已登记" + prefix],
    ]) {
      const meta = metadata.employeeSections.find((s) => s[0] === section);
      await run(
        "Employee section " +
          meta[1] +
          " persists its fields without overwriting other sections",
        async () => {
          const before = await api("GET", "/emps/" + employee.id);
          const detail = await openEmployee();
          await detail
            .getByRole("button", { name: "编辑" + meta[1], exact: true })
            .click();
          const editor = page.getByRole("dialog", {
            name: "编辑" + meta[1],
            exact: true,
          });
          await editor.locator(".modal-f .pri-btn:not([disabled])").waitFor();
          const label = meta[2].find((f) => f[0] === field)[1];
          if (section === "work") {
            const supervisor = bootstrap.emps.find(
              (e) => e.id === before.supervisorId,
            );
            assert.ok(supervisor, "Fixture has an existing real supervisor");
            assert.ok(
              (
                await editor
                  .locator('.ant-select[aria-label="直属主管"]')
                  .innerText()
              ).includes(supervisor.name),
            );
          }
          if (section === "education") {
            assert.equal(
              await editor.locator("#field-graduated").inputValue(),
              "2020-06-30",
            );
          }
          await editor.getByLabel(label, { exact: true }).fill(String(value));
          await submit(editor, "/emps/" + employee.id);
          const after = await api("GET", "/emps/" + employee.id);
          assert.equal(after.job, before.job);
          assert.equal(after.phone, before.phone);
          assert.equal(after.entry, before.entry);
          assert.equal(
            after.supervisorId,
            before.supervisorId,
            "Unrelated edits retain supervisor FK",
          );
          if (section === "education")
            assert.equal(after.graduated, "2020-06-30");
          if (sensitive) {
            assert.notEqual(after[field], value);
            const revealed = await api(
              "GET",
              "/emps/" + employee.id + "/sensitive",
            );
            assert.equal(revealed[field], value);
          } else assert.equal(String(after[field]), String(value));
        },
      );
    }
    await run(
      "Employee work history adds/removes a real structured row and validates missing dates",
      async () => {
        const detail = await openEmployee();
        await detail
          .getByRole("button", { name: "编辑工作经历", exact: true })
          .click();
        const editor = page.getByRole("dialog", {
          name: "编辑工作经历",
          exact: true,
        });
        await editor
          .getByRole("button", { name: "添加工作经历", exact: true })
          .click();
        await editor
          .getByLabel("就职公司", { exact: true })
          .fill(prefix + "公司");
        await editor.getByRole("button", { name: "确定", exact: true }).click();
        await editor
          .getByRole("alert")
          .filter({ hasText: "就职时间" })
          .waitFor();
        await editor
          .locator(".v-field")
          .filter({ has: page.getByText("就职时间", { exact: true }) })
          .locator(".ant-picker")
          .click();
        await page
          .locator(".ant-picker-dropdown:visible")
          .getByText("今天", { exact: true })
          .click();
        await submit(editor, "/emps/" + employee.id);
        assert.equal(
          (await api("GET", "/emps/" + employee.id)).workHistory[0].company,
          prefix + "公司",
        );
        const updated = await openEmployee();
        await updated
          .getByRole("button", { name: "编辑工作经历", exact: true })
          .click();
        await editor.getByRole("button", { name: "删除", exact: true }).click();
        await submit(editor, "/emps/" + employee.id);
        assert.deepEqual(
          (await api("GET", "/emps/" + employee.id)).workHistory,
          [],
        );
      },
    );

    for (const [key, label] of [
      ["workRegion", "工作片区"],
      ["workplace", "工作所在地"],
      ["contractCompany", "合同归属"],
    ]) {
      await run(
        "Dictionary " +
          label +
          " create, rename, disable, enable and delete through UI",
        async () => {
          await goto("settings");
          await page
            .locator(".v-tabs")
            .getByRole("button", { name: new RegExp("^" + label) })
            .click();
          await page
            .getByRole("button", { name: "新增" + label, exact: true })
            .click();
          let dialog = page.getByRole("dialog", {
            name: "新增" + label,
            exact: true,
          });
          const value = prefix + label;
          await dialog.getByLabel(label, { exact: true }).fill(value);
          await submit(dialog, "/settings/" + key);
          let row = page
            .locator(".settings-table tbody tr")
            .filter({ hasText: value });
          await row.getByRole("button", { name: "编辑", exact: true }).click();
          dialog = page.getByRole("dialog", {
            name: "编辑" + label,
            exact: true,
          });
          await dialog.getByLabel(label, { exact: true }).fill(value + "新");
          await submit(dialog, "/settings/" + key);
          row = page
            .locator(".settings-table tbody tr")
            .filter({ hasText: value + "新" });
          for (const action of ["停用", "启用"]) {
            await row
              .getByRole("button", { name: action, exact: true })
              .click();
            await submit(
              page.getByRole("dialog", { name: action + label, exact: true }),
              "/settings/" + key,
            );
            assert.equal(
              (await api("GET", "/settings/" + key)).items.find(
                (r) => r.name === value + "新",
              ).status,
              action,
            );
          }
          const record = (await api("GET", "/settings/" + key)).items.find(
            (r) => r.name === value + "新",
          );
          await row.getByRole("button", { name: "删除", exact: true }).click();
          await submit(
            page.getByRole("dialog", { name: "删除" + label, exact: true }),
            "/settings/" + key + "/" + record.id,
          );
          assert.equal(
            (await api("GET", "/settings/" + key)).items.some(
              (r) => r.name === value + "新",
            ),
            false,
          );
        },
      );
    }

    await run(
      "Sequence rename cancellation returns to sequence management",
      async () => {
        await goto("grades");
        await page
          .getByRole("button", { name: "管理职务序列", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "管理职务序列", exact: true })
          .getByRole("button", { name: "重命名", exact: true })
          .first()
          .click();
        await page
          .getByRole("dialog", { name: "重命名职务序列", exact: true })
          .getByRole("button", { name: "取消", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "管理职务序列", exact: true })
          .waitFor();
      },
    );

    await run(
      "Atomic batch screening is one request, flows all selected candidates and rolls back stale selection",
      async () => {
        const owner =
          bootstrap.emps.find(
            (e) => e.dept === "ORG_05" && e.status !== "已离职" && !e.deletedAt,
          ) || employee;
        const job = await api("POST", "/jobs", {
          name: prefix + "批量岗位",
          dept: "ORG_18",
          headcount: 8,
          status: "启用",
          duties: "验收批量",
          requirements: "验收批量",
        });
        created.push({ type: "jobs", id: job.id });
        const req = await api("POST", "/reqs", {
          id: prefix + "R",
          name: prefix + "批量需求",
          dept: "ORG_18",
          job: job.id,
          count: 4,
          salaryMin: 10,
          salaryMax: 20,
          type: "新增",
          deadline: new Date(Date.now() + 86400000).toLocaleDateString("sv-SE"),
          workRegion: "上海",
          workplace: "上海",
          contractCompany: "微间",
          status: "招聘中",
          ownerIds: [owner.id],
          screenerIds: [employee.id],
          firstIds: [employee.id],
          secondIds: [employee.id],
        });
        created.push({ type: "reqs", id: req.id });
        const candidates = [];
        for (let i = 0; i < 4; i++) {
          const candidate = await api("POST", "/candidates", {
            id: prefix + "B" + i,
            req: req.id,
            name: prefix + (i < 2 ? "成功" : "回滚") + i,
            phone:
              "187" +
              String(Number(String(Date.now()).slice(-8)) + i).padStart(8, "0"),
            source: "内部推荐",
            education: "本科",
            years: 2,
            workRegion: "上海",
            workplace: "上海",
            contractCompany: "微间",
          });
          created.push({ type: "candidates", id: candidate.id });
          candidates.push(candidate);
        }
        await goto("screening");
        await search(prefix + "成功");
        await page.getByLabel("选择本页全部记录").check();
        await page
          .getByRole("button", { name: "批量筛选", exact: true })
          .click();
        const result = await submit(
          page.getByRole("dialog", { name: "批量筛选 · 2 人", exact: true }),
          "/candidates/actions/batch-screening",
        );
        assert.equal(result.count, 2);
        for (const c of candidates.slice(0, 2))
          assert.equal(
            (await api("GET", "/candidates/" + c.id)).stage,
            "待部门筛选",
          );
        await goto("screening");
        await search(prefix + "回滚");
        await page.getByLabel("选择本页全部记录").check();
        const stale = candidates[3];
        await api("POST", "/candidates/" + stale.id + "/actions/screening", {
          result: "通过",
        });
        await api("POST", "/candidates/" + stale.id + "/actions/screening", {
          result: "通过",
        });
        await page
          .getByRole("button", { name: "批量筛选", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "批量筛选 · 2 人",
          exact: true,
        });
        const failed = page.waitForResponse(
          (r) =>
            r.url().endsWith("/candidates/actions/batch-screening") &&
            r.request().method() === "POST",
        );
        await dialog.getByRole("button", { name: "确定", exact: true }).click();
        assert.equal((await failed).status(), 409);
        await dialog.getByRole("alert").waitFor();
        assert.equal(
          (await api("GET", "/candidates/" + candidates[2].id)).stage,
          "待 HR 筛选",
        );
        assert.equal(
          await page.locator(".v-current-count").innerText(),
          "已选 2 条",
        );
      },
    );

    await run(
      "Durable import records and detail return use authorized backend metadata",
      async () => {
        await goto("roster");
        const hash = (await import("node:crypto"))
          .createHash("sha256")
          .update(prefix)
          .digest("hex");
        await api("POST", "/imports/emps", {
          fileName: prefix + ".csv",
          fileHash: hash,
          mode: "skip",
          validateOnly: false,
          rows: [{ id: employee.id, name: employee.name }],
        });
        await page
          .getByRole("button", { name: "导入菜单", exact: true })
          .click();
        await page
          .getByRole("menu", { name: "导入选项" })
          .getByRole("button", { name: "导入记录", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "导入记录",
          exact: true,
        });
        const row = dialog
          .locator("tbody tr")
          .filter({ hasText: prefix + ".csv" });
        await row
          .getByRole("button", { name: "查看明细", exact: true })
          .click();
        const details = page.getByRole("dialog", {
          name: "导入明细",
          exact: true,
        });
        assert.match(await details.innerText(), /跳过/);
        await details
          .getByRole("button", { name: "返回记录", exact: true })
          .click();
        await dialog.waitFor();
      },
    );
  } else
    results.push({
      name: "New import-log and atomic-batch endpoints",
      status: "PENDING_DEPLOYMENT",
      reason:
        "Common phase deliberately does not call endpoints absent from the old test JAR.",
    });

  await run(
    "Manager manual login hides HR-only import/archive/settings controls",
    async () => {
      const managerContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      try {
        const manager = await managerContext.newPage();
        manager.on("pageerror", (e) => errors.push(e.message));
        await manager.goto(base);
        await manager.getByLabel("账号", { exact: true }).fill("manager");
        await manager
          .getByLabel("密码", { exact: true })
          .fill(process.env.HR_INITIAL_MANAGER_PASSWORD || "manager123");
        await manager
          .getByRole("button", { name: "登录", exact: true })
          .click();
        await manager.locator(".v-side").waitFor();
        assert.equal(
          await manager
            .locator(".v-nav")
            .getByRole("link", { name: "基础信息设置", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await manager
            .locator(".v-nav")
            .getByRole("link", { name: "员工花名册", exact: true })
            .count(),
          0,
        );
        await manager.goto(base + "/#/roster");
        await manager.locator(".v-content").waitFor();
        assert.notEqual(await manager.locator(".v-content").getAttribute("data-page"), "roster");
        await manager.goto(base + "/#/settings");
        await manager.locator(".v-content").waitFor();
        assert.notEqual(
          await manager.locator(".v-content").getAttribute("data-page"),
          "settings",
        );
      } finally {
        await managerContext.close();
      }
    },
  );
} catch (e) {
  results.push({ name: "Interaction setup", status: "FAIL", error: e.stack });
} finally {
  for (const [key, value] of Object.entries(originalPreferences)) {
    try {
      const columns = value.columns?.length
        ? value.columns
        : [
            { key: "__select", label: "选择" },
            { key: "__index", label: "序号" },
            ...metadata.schemas[key],
            { key: "__actions", label: "操作", pin: "right" },
          ].map((c) => ({ ...c, show: true }));
      await api("PUT", "/preferences/" + key, {
        columns,
        schemes: value.schemes || [],
      });
    } catch (e) {
      results.push({
        name: "Restore preferences " + key,
        status: "FAIL",
        error: e.message,
      });
    }
  }
  await browser.close();
  const report = {
    mode: "Real Vue UI and isolated MySQL backend; no request mocks",
    target: base,
    backend: "8091",
    phase,
    selection: selection || null,
    prefix,
    created,
    results,
    errors,
    summary: {
      passed: results.filter((x) => x.status === "PASS").length,
      failed: results.filter((x) => x.status === "FAIL").length,
      pending: results.filter((x) => x.status === "PENDING_DEPLOYMENT").length,
    },
  };
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report.summary));
  if (report.summary.failed || errors.length) process.exitCode = 1;
}
