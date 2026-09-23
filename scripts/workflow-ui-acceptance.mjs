import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.HR_WORKFLOW_UI_URL || "http://127.0.0.1:5175";
const target = new URL(base);
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  target.port !== "5175"
)
  throw new Error("Workflow UI writes require isolated localhost:5175 → 8091.");
const require = createRequire(import.meta.url),
  modules =
    process.env.HR_NODE_MODULES || path.join(root, "frontend", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const prefix = `FIXQAUI${Date.now().toString(36).toUpperCase()}`;
const out = path.join(root, ".local", "verification", "workflow-ui");
await fs.mkdir(out, { recursive: true });
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
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const managerCtx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage(),
  managerPage = await managerCtx.newPage();
const results = [],
  errors = [],
  created = [],
  requests = [];
for (const p of [page, managerPage]) {
  p.setDefaultTimeout(12000);
  p.on("pageerror", (e) => errors.push(e.message));
  // A forced fresh navigation between independent checks intentionally discards
  // any failed check's synthetic form. Unsaved-dialog semantics have their own suite.
  p.on("dialog", async (d) => {
    if (d.type() === "beforeunload") await d.accept();
    else await d.dismiss();
  });
}
let serial = 0;
const id = (tag) => prefix + tag + ++serial,
  phone = () =>
    `18${String(Date.now()).slice(-6)}${String(++serial).padStart(3, "0")}`;
const day = (time) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
const time = (value) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
const today = day(Date.now()),
  tomorrow = day(Date.now() + 86400000);
const dialog = (p = page) => p.getByRole("dialog").last();
async function api(method, url, body, expected = 200, context = ctx) {
  const r = await context.request.fetch(base + "/api" + url, {
    method,
    headers: { Origin: base },
    ...(body === undefined ? {} : { data: body }),
  });
  const data = await r.json();
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(r.status()),
    `${method} ${url}: ${r.status()} ${JSON.stringify(data).slice(0, 600)}`,
  );
  return data;
}
async function create(type, body) {
  const row = await api("POST", "/" + type, body, [200, 201]);
  created.push({ type, id: row.id });
  return row;
}
async function read(type, row) {
  assert.ok(row, "fixture not ready");
  return api("GET", `/${type}/${row.id}`);
}
async function check(module, branch, fn, p = page) {
  const begin = Date.now(),
    errorStart = errors.length;
  try {
    const evidence = await fn();
    assert.equal(
      errors.length,
      errorStart,
      "Browser pageerror during action: " + errors.slice(errorStart).join("; "),
    );
    results.push({
      module,
      branch,
      status: "PASS",
      ms: Date.now() - begin,
      evidence,
    });
    console.log(`PASS ${module}: ${branch}`);
  } catch (e) {
    results.push({
      module,
      branch,
      status: "FAIL",
      ms: Date.now() - begin,
      error: e.message,
    });
    console.error(`FAIL ${module}: ${branch}: ${e.message}`);
  }
  const shot = String(results.length).padStart(2, "0") + ".png";
  try {
    await p.screenshot({ path: path.join(out, shot), fullPage: true });
    results.at(-1).screenshot = shot;
  } catch {}
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        prefix,
        base,
        running: true,
        summary: Object.fromEntries(
          ["PASS", "FAIL"].map((s) => [
            s,
            results.filter((r) => r.status === s).length,
          ]),
        ),
        results,
        errors,
        created,
        requests,
      },
      null,
      2,
    ),
  );
}
async function login(p, username) {
  await p.goto(base + "/#/roster");
  await p.getByLabel("账号", { exact: true }).fill(username);
  await p
    .getByLabel("密码", { exact: true })
    .fill(
      username === "admin"
        ? process.env.HR_INITIAL_ADMIN_PASSWORD || "admin123"
        : process.env.HR_INITIAL_MANAGER_PASSWORD || "manager123",
    );
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.locator(".v-side").waitFor();
  const r = await p.context().request.get("http://127.0.0.1:8091/api/auth/me");
  assert.equal(
    r.status(),
    200,
    "5175 session must be recognized by isolated 8091",
  );
  assert.equal((await r.json()).user.username, username);
}
async function openRow(route, row, action, p = page) {
  await p.goto(
    base + "/?workflow=" + Date.now() + "-" + ++serial + "#/" + route,
  );
  await p.locator(`.v-content[data-page="${route}"]`).waitFor();
  const search = p.getByRole("textbox", { name: "关键词搜索" });
  await search.fill(row.name);
  await search.press("Enter");
  const tr = p.locator("tbody tr").filter({ hasText: row.name }).first();
  await tr.waitFor();
  if (action)
    await tr.getByRole("button", { name: action, exact: true }).click();
  return tr;
}
async function select(key, label, p = page) {
  const field = dialog(p).locator("#field-" + key);
  await dialog(p)
    .locator(`.ant-select:has(#field-${key}) .ant-select-selector`)
    .click();
  await field.fill(label);
  const popup = p.locator(".ant-select-dropdown:visible");
  await popup
    .locator(".ant-select-item-option-content")
    .filter({ hasText: label })
    .first()
    .click();
}
async function chooseTime(key, value, p = page) {
  await dialog(p)
    .locator("#field-" + key)
    .click();
  const popup = p.locator(".ant-picker-dropdown:visible");
  const [hh, mm] = value.split(":");
  for (const [index, text] of [
    [0, hh],
    [1, mm],
  ]) {
    const column = popup.locator(".ant-picker-time-panel-column").nth(index);
    if (
      (await column
        .locator(".ant-picker-time-panel-cell-selected")
        .innerText()
        .catch(() => "")) === text
    )
      continue;
    const option = column.getByText(text, { exact: true });
    await option.scrollIntoViewIfNeeded();
    await option.click();
  }
  await popup.locator(".ant-picker-ok button").click();
  await p.locator(".ant-picker-dropdown:visible").waitFor({ state: "hidden" });
}
async function chooseDate(key, value, p = page) {
  await dialog(p)
    .locator("#field-" + key)
    .click();
  await p
    .locator(".ant-picker-dropdown:visible")
    .locator(`td[title="${value}"]`)
    .click();
}
async function submit(
  resource,
  { method = "POST", label = "确定", p = page } = {},
) {
  const waiting = p.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api" + resource &&
      r.request().method() === method,
    { timeout: 16000 },
  );
  await dialog(p).getByRole("button", { name: label, exact: true }).click();
  const r = await waiting;
  const body = await r.json();
  requests.push({
    method,
    resource,
    status: r.status(),
    request: r.request().postDataJSON(),
    result: {
      id: body.id,
      stage: body.stage,
      status: body.status,
      version: body.version,
    },
  });
  assert.ok(
    r.ok(),
    `${method} ${resource}: ${r.status()} ${JSON.stringify(body).slice(0, 900)}`,
  );
  return body;
}
let db,
  employee,
  employee2,
  job,
  job2,
  req,
  interviewer,
  candidate,
  grade,
  region,
  workplace,
  company;
function employeeBody(tag) {
  const code = id(tag);
  return {
    id: code,
    name: code,
    dept: "ORG_18",
    job: job.id,
    grade: grade.id,
    phone: phone(),
    status: "试用",
    entry: today,
    workRegion: region,
    workplace,
    contractCompany: company,
    workType: "全职",
  };
}
async function newCandidate(tag) {
  const code = id(tag);
  return create("candidates", {
    id: code,
    name: code,
    req: req.id,
    phone: phone(),
    education: "本科",
    years: 3,
    source: "内部推荐",
    workRegion: region,
    workplace,
    contractCompany: company,
  });
}
async function screenUi(row, label, expected, p = page) {
  await openRow("screening", row, "查看", p);
  await dialog(p).getByRole("button", { name: label, exact: true }).click();
  if (["HR 筛选", "部门筛选"].includes(label))
    await dialog(p)
      .getByLabel("处理说明", { exact: true })
      .fill(prefix + " UI通过");
  await submit(`/candidates/${row.id}/actions/screening`, { p });
  const saved = await read("candidates", row);
  assert.equal(saved.stage, expected);
  return saved;
}
async function interviewUi(row, outcome) {
  await openRow("interviews", row, "录入结果");
  await select("result", outcome);
  if (["通过", "未通过"].includes(outcome)) {
    await dialog().getByLabel("备注", { exact: true }).fill("");
    await dialog().getByRole("button", { name: "确定", exact: true }).click();
    await dialog()
      .getByText(/请填写备注/)
      .waitFor();
    assert.equal(
      (await read("candidates", row)).stage,
      row.stage,
      "Empty required evaluation must not advance stage",
    );
  }
  await dialog()
    .getByLabel("备注", { exact: true })
    .fill(prefix + " UI " + outcome);
  await submit(`/candidates/${row.id}/actions/interview-result`);
  return read("candidates", row);
}
async function scheduleUi(row, action = "安排面试") {
  await openRow("interviews", row, action);
  // Five minutes into the next hour avoids scrolling rapidly through virtual
  // minute columns while still scheduling a genuinely future same-day slot.
  const from = Math.ceil(Date.now() / 3600000) * 3600000 + 5 * 60000;
  assert.equal(
    day(from + 60 * 60000),
    today,
    "Run same-day UI interview test before 22:45 Shanghai time",
  );
  await chooseTime("start", time(from));
  await chooseTime("end", time(from + 60 * 60000));
  await dialog()
    .getByLabel("面试地点 / 会议链接", { exact: true })
    .fill(prefix + " meeting");
  const check = page.waitForResponse(
    (r) =>
      r.url().includes("/actions/interview-check") &&
      r.request().method() === "POST",
  );
  await dialog()
    .getByRole("button", { name: "检查时间冲突", exact: true })
    .click();
  assert.equal((await check).status(), 200);
  await dialog()
    .getByText("未发现时间冲突，可以保存安排。", { exact: true })
    .waitFor();
  await submit(`/candidates/${row.id}/actions/schedule`);
  return read("candidates", row);
}
async function offerUi(row, action, stage) {
  const saved = await read("candidates", row);
  await openRow(
    "offers",
    row,
    ["待入职", "延期入职"].includes(saved.stage) ? "确认入职" : "办理",
  );
  await select("action", action);
  await select("grade", grade.code);
  await dialog()
    .getByLabel("处理说明", { exact: true })
    .fill(prefix + " UI " + action);
  await submit(`/candidates/${row.id}/actions/onboarding`);
  const changed = await read("candidates", row);
  assert.equal(changed.stage, stage);
  return changed;
}
async function employeeSection(label) {
  await openRow("roster", employee, "查看");
  await dialog()
    .getByRole("button", { name: "编辑" + label, exact: true })
    .click();
}
async function assetUi(row, mode, owner) {
  await openRow("assets", row, "编辑");
  await dialog().getByRole("button", { name: mode, exact: true }).click();
  if (owner) await select("owner", owner.name);
  await select("workRegion", region);
  await dialog()
    .getByLabel(mode === "归还" ? "存放位置" : "使用位置", { exact: true })
    .fill(prefix + " " + mode);
  await dialog()
    .getByLabel("办理说明", { exact: true })
    .fill(prefix + " " + mode);
  await submit(
    `/assets/${row.id}/actions/${{ 领用: "assign", 转移: "transfer", 归还: "return" }[mode]}`,
    { label: "确认" + mode },
  );
  return read("assets", row);
}
try {
  await check(
    "setup",
    "Both UI logins and synthetic API fixtures in isolated service",
    async () => {
      await login(page, "admin");
      await login(managerPage, "manager");
      db = await api("GET", "/bootstrap");
      region = db.baseSettings.workRegion.find((x) => x.status === "启用").name;
      workplace = db.baseSettings.workplace.find(
        (x) => x.status === "启用",
      ).name;
      company = db.baseSettings.contractCompany.find(
        (x) => x.status === "启用",
      ).name;
      grade = db.grades.find(
        (x) => x.status === "启用" && x.scope === "全部部门",
      );
      assert.ok(grade);
      const managerPerson = db.emps
        .filter(
          (e) =>
            e.mainDept === "ORG_18" &&
            !["待离职", "已离职"].includes(e.status) &&
            !e.deleted,
        )
        .sort((a, b) => a.dbId - b.dbId)[0];
      const hr = db.emps.find(
        (e) =>
          !e.deleted &&
          !["待离职", "已离职"].includes(e.status) &&
          /人事|人力|行政/.test(
            db.orgs.find((o) => o.id === e.mainDept)?.name || "",
          ),
      );
      assert.ok(hr);
      job = await create("jobs", {
        id: id("J"),
        name: id("岗位"),
        dept: "ORG_18",
        headcount: 50,
        status: "启用",
      });
      job2 = await create("jobs", {
        id: id("J2"),
        name: id("转入岗位"),
        dept: "ORG_18",
        headcount: 10,
        status: "启用",
      });
      employee = await create("emps", employeeBody("E"));
      employee2 = await create("emps", employeeBody("E2"));
      interviewer = await create("emps", employeeBody("I"));
      req = await create("reqs", {
        id: id("R"),
        name: id("需求"),
        dept: "ORG_18",
        job: job.id,
        count: 10,
        salaryMin: 10,
        salaryMax: 20,
        status: "招聘中",
        type: "新增",
        deadline: tomorrow,
        workRegion: region,
        workplace,
        contractCompany: company,
        ownerIds: [hr.id],
        screenerIds: [managerPerson.id],
        firstIds: [interviewer.id],
        secondIds: [interviewer.id],
      });
      candidate = await newCandidate("C");
      return {
        candidate: candidate.id,
        employee: employee.id,
        request: req.id,
      };
    },
  );
  await check(
    "screening",
    "HR hold button and pass form persist independently",
    async () => {
      candidate = await screenUi(candidate, "暂缓筛选", "暂缓筛选");
      candidate = await screenUi(candidate, "HR 筛选", "待部门筛选");
    },
  );
  await check(
    "screening",
    "Department hold and pass use authenticated manager UI",
    async () => {
      candidate = await screenUi(
        candidate,
        "暂缓筛选",
        "暂缓筛选",
        managerPage,
      );
      candidate = await screenUi(candidate, "部门筛选", "初试", managerPage);
    },
    managerPage,
  );
  for (const [label, status] of [
    ["筛选不通过", "未通过"],
    ["候选人取消", "候选人取消"],
  ])
    await check(
      "screening",
      `HR detail ${label} button persists terminal stage`,
      async () => {
        const row = await newCandidate("TERM");
        await screenUi(row, label, status);
      },
    );
  for (const [label, status] of [
    ["筛选不通过", "未通过"],
    ["候选人取消", "候选人取消"],
  ])
    await check(
      "screening",
      `Department detail ${label} uses manager authority and persists`,
      async () => {
        const row = await newCandidate("DEPTEND");
        await api("POST", `/candidates/${row.id}/screening`, {
          result: "通过",
          reason: prefix + " fixture HR handoff",
        });
        await screenUi(row, label, status, managerPage);
      },
      managerPage,
    );
  await check(
    "interviews",
    "Schedule form and conflict-check button persist first round",
    async () => {
      candidate = await scheduleUi(candidate);
      assert.equal(candidate.interviews.at(-1).status, "待面试");
    },
  );
  await check(
    "interviews",
    "Reschedule row button updates existing round without duplication",
    async () => {
      candidate = await scheduleUi(candidate, "改期");
      assert.equal(candidate.interviews.length, 1);
    },
  );
  await check(
    "interviews",
    "Existing pool interview-detail cancel button persists and permits re-arrange",
    async () => {
      await openRow("pool", candidate, "查看");
      await dialog()
        .getByRole("button", { name: "面试记录", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "取消安排", exact: true })
        .click();
      await dialog()
        .getByLabel("取消原因", { exact: true })
        .fill(prefix + " UI取消安排");
      await submit(`/candidates/${candidate.id}/actions/interview-cancel`);
      candidate = await read("candidates", candidate);
      assert.equal(candidate.interviews.at(-1).status, "已取消");
      candidate = await scheduleUi(candidate);
    },
  );
  await check(
    "interviews",
    "No-show result re-exposes arrange button; re-arrange persists",
    async () => {
      candidate = await interviewUi(candidate, "未到场 / 改期");
      assert.equal(candidate.interviews.at(-1).status, "待改期");
      candidate = await scheduleUi(candidate);
    },
  );
  await check(
    "interviews",
    "Pending result form persists without advancing stage",
    async () => {
      candidate = await interviewUi(candidate, "待定");
      assert.equal(candidate.interviews.at(-1).status, "待评价");
    },
  );
  await check(
    "interviews",
    "Reopening current operator pending feedback prefills result and evaluation",
    async () => {
      await openRow("interviews", candidate, "录入结果");
      assert.equal(
        await dialog()
          .locator(".ant-select:has(#field-result) .ant-select-selection-item")
          .innerText(),
        "待定",
      );
      assert.equal(
        await dialog().getByLabel("备注", { exact: true }).inputValue(),
        prefix + " UI 待定",
      );
    },
  );
  await check(
    "interviews",
    "First-round pass form advances to second round",
    async () => {
      candidate = await interviewUi(candidate, "通过");
      assert.equal(candidate.stage, "复试");
    },
  );
  await check(
    "interviews",
    "Second-round UI schedule and pass reach onboarding",
    async () => {
      candidate = await scheduleUi(candidate);
      candidate = await interviewUi(candidate, "通过");
      assert.equal(candidate.stage, "待入职");
      assert.equal(candidate.interviews.length, 2);
    },
  );
  for (const outcome of ["未通过", "候选人取消"])
    await check(
      "interviews",
      `Result option ${outcome} persists terminal stage`,
      async () => {
        let row = await newCandidate("INTERVIEWEND");
        await api("POST", `/candidates/${row.id}/screening`, {
          result: "通过",
          reason: prefix + " fixture HR",
        });
        row = await api(
          "POST",
          `/candidates/${row.id}/screening`,
          { result: "通过", reason: prefix + " fixture dept" },
          200,
          managerCtx,
        );
        row = await scheduleUi(row);
        row = await interviewUi(row, outcome);
        assert.equal(row.stage, outcome);
      },
    );
  for (const [action, stage] of [
    ["延期入职", "延期入职"],
    ["调整入职日期", "延期入职"],
    ["未到岗", "未到岗"],
    ["重新安排入职", "待入职"],
    ["放弃入职", "放弃入职"],
    ["重新安排入职", "待入职"],
  ])
    await check("offers", `UI ${action} → ${stage}`, async () => {
      candidate = await offerUi(candidate, action, stage);
    });
  await check(
    "offers",
    "Cancel-entry row button and re-arrange form preserve history",
    async () => {
      await openRow("offers", candidate, "取消入职");
      await dialog()
        .getByLabel("取消原因", { exact: true })
        .fill(prefix + " cancel UI");
      await submit(`/candidates/${candidate.id}/actions/onboarding`);
      assert.equal((await read("candidates", candidate)).stage, "取消入职");
      candidate = await offerUi(candidate, "重新安排入职", "待入职");
      assert.ok(candidate.history.some((h) => h.detail.includes("取消入职")));
    },
  );
  let asset;
  await check(
    "assets",
    "Editor receive tab submits real assign transaction",
    async () => {
      asset = await create("assets", {
        id: id("A"),
        name: id("资产"),
        category: "电子设备",
        model: "FIXQA UI",
        dept: "ORG_18",
        location: region,
        office: "FIXQA store",
        public: "否",
        status: "闲置",
        cost: 100,
      });
      asset = await assetUi(asset, "领用", employee);
      assert.equal(asset.owner, employee.id);
    },
  );
  await check(
    "assets",
    "Editor transfer tab persists second owner",
    async () => {
      asset = await assetUi(asset, "转移", employee2);
      assert.equal(asset.owner, employee2.id);
    },
  );
  await check(
    "assets",
    "Editor return tab clears owner and persists idle",
    async () => {
      asset = await assetUi(asset, "归还");
      assert.ok(!asset.owner);
      assert.equal(asset.status, "闲置");
    },
  );
  await check(
    "roster",
    "Basic section job transfer persists and refreshes",
    async () => {
      await employeeSection("基本信息");
      await select("job", job2.name);
      await submit(`/emps/${employee.id}`, { method: "PUT" });
      assert.equal((await read("emps", employee)).job, job2.id);
    },
  );
  for (const status of ["正式", "待离职", "正式"])
    await check(
      "roster",
      `Employment section status ${status} (including pending-leave cancellation)`,
      async () => {
        await employeeSection("任职信息");
        await select("status", status);
        await submit(`/emps/${employee.id}`, { method: "PUT" });
        assert.equal((await read("emps", employee)).status, status);
      },
    );
  await check(
    "roster",
    "Growth add/edit/delete buttons roundtrip persisted records",
    async () => {
      await openRow("roster", employee, "查看");
      await dialog()
        .getByRole("button", { name: "成长记录", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "新增成长记录", exact: true })
        .click();
      await dialog()
        .getByLabel("事件标题", { exact: true })
        .fill(prefix + "成长");
      await dialog().getByLabel("事件说明", { exact: true }).fill("UI新增说明");
      await submit(`/emps/${employee.id}/actions/timeline`);
      await openRow("roster", employee, "查看");
      await dialog()
        .getByRole("button", { name: "成长记录", exact: true })
        .click();
      await dialog()
        .locator(".v-timeline li")
        .filter({ hasText: prefix + "成长" })
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      await dialog().getByLabel("事件说明", { exact: true }).fill("UI修改说明");
      await submit(`/emps/${employee.id}/actions/timeline-update`);
      assert.ok(
        (await read("emps", employee)).timeline.some(
          (x) => x.title === prefix + "成长" && x.detail === "UI修改说明",
        ),
      );
      await openRow("roster", employee, "查看");
      await dialog()
        .getByRole("button", { name: "成长记录", exact: true })
        .click();
      await dialog()
        .locator(".v-timeline li")
        .filter({ hasText: prefix + "成长" })
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await submit(`/emps/${employee.id}/actions/timeline-delete`);
      assert.ok(
        !(await read("emps", employee)).timeline.some(
          (x) => x.title === prefix + "成长",
        ),
      );
    },
  );
  await check(
    "roster",
    "Employment section leave persists after return of assets",
    async () => {
      await employeeSection("任职信息");
      await select("status", "已离职");
      await chooseDate("leaveDate", today);
      await submit(`/emps/${employee.id}`, { method: "PUT" });
      assert.equal((await read("emps", employee)).status, "已离职");
    },
  );
  await check(
    "roster",
    "Archive then archived-list restore buttons roundtrip the same employee",
    async () => {
      await openRow("roster", employee, "删除");
      await dialog()
        .getByLabel("归档原因", { exact: true })
        .fill(prefix + " UI archive");
      await submit(`/emps/${employee.id}`, { method: "DELETE" });
      const archived = await api("GET", `/emps?archived=true&q=${employee.id}`);
      assert.ok(archived.items.some((e) => e.id === employee.id));
      await page.goto(
        base + "/?workflow=" + Date.now() + "-" + ++serial + "#/roster",
      );
      await page
        .getByRole("button", { name: "查看已归档", exact: true })
        .click();
      const search = page.getByRole("textbox", { name: "关键词搜索" });
      await search.fill(employee.name);
      await search.press("Enter");
      await page
        .locator("tbody tr")
        .filter({ hasText: employee.name })
        .first()
        .getByRole("button", { name: "恢复档案", exact: true })
        .click();
      await submit(`/emps/${employee.id}/restore`);
      const restored = await read("emps", employee);
      assert.ok(!restored.archived && !restored.deletedAt && !restored.deleted);
      assert.equal(restored.status, "已离职");
    },
  );
} finally {
  const summary = Object.fromEntries(
    ["PASS", "FAIL"].map((s) => [
      s,
      results.filter((r) => r.status === s).length,
    ]),
  );
  const report = {
    prefix,
    finishedAt: new Date().toISOString(),
    base,
    running: false,
    summary,
    scope:
      "Real visible UI actions; API is used only for synthetic initial fixtures and post-action persisted read-back. No mocks. No account/global dictionary/sequence changes.",
    results,
    errors,
    created,
    requests,
  };
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await fs.writeFile(
    path.join(out, `report-${prefix}.json`),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(
    JSON.stringify({ report: path.join(out, "report.json"), summary }),
  );
  process.exitCode = summary.FAIL || errors.length ? 1 : 0;
}
