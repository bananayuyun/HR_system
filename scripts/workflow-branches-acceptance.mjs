import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Real persisted API checks, deliberately restricted to the isolated test service.
const root = path.resolve(import.meta.dirname, "..");
const base = process.env.HR_WORKFLOW_API_URL || "http://127.0.0.1:8091/api";
const target = new URL(base);
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  target.port !== "8091" ||
  target.pathname !== "/api"
)
  throw new Error(
    "Workflow acceptance writes require localhost:8091/api (isolated hrms_test).",
  );
const prefix = `FIXQA${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex")}`;
const output = path.join(
  root,
  ".local",
  "verification",
  "workflow-branches.json",
);
const startedAt = new Date().toISOString();
const results = [],
  created = [],
  trace = [];
let serial = 0;
const id = (tag) => `${prefix}${tag}${++serial}`;
const phone = () =>
  `19${String(Date.now()).slice(-6)}${String(++serial).padStart(3, "0")}`;
const localDate = (time) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
const localTime = (time) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(time));
const today = localDate(Date.now()),
  tomorrow = localDate(Date.now() + 86400000),
  yesterday = localDate(Date.now() - 86400000);
class Untested extends Error {}
const need = (value, message) => {
  if (!value) throw new Untested(message);
  return value;
};
class Client {
  cookie = "";
  constructor(role) {
    this.role = role;
  }
  async call(method, resource, body, expected = 200) {
    const multipart = body instanceof FormData;
    const response = await fetch(base + resource, {
      method,
      headers: {
        Accept: "application/json",
        Origin: "http://127.0.0.1:5175",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
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
    const cookies = response.headers.getSetCookie();
    if (cookies.length)
      this.cookie = cookies.map((v) => v.split(";")[0]).join("; ");
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    const responseEvidence =
      resource === "/bootstrap" && response.ok
        ? Object.fromEntries(
            Object.entries(data).map(([key, value]) => [
              key,
              Array.isArray(value)
                ? {
                    count: value.length,
                    fixtureIds: value
                      .filter((r) => String(r.id).startsWith(prefix))
                      .map((r) => r.id),
                  }
                : key === "baseSettings"
                  ? Object.fromEntries(
                      Object.entries(value).map(([k, v]) => [
                        k,
                        { count: v.length },
                      ]),
                    )
                  : "available",
            ]),
          )
        : data;
    trace.push({
      role: this.role,
      method,
      resource,
      status: response.status,
      ...(resource.includes("/auth/")
        ? {}
        : {
            input: multipart ? "multipart synthetic file" : body,
            response: responseEvidence,
          }),
    });
    if (expected !== null)
      assert.ok(
        (Array.isArray(expected) ? expected : [expected]).includes(
          response.status,
        ),
        `${method} ${resource}: expected ${expected}, received ${response.status}: ${JSON.stringify(data).slice(0, 1200)}`,
      );
    return { status: response.status, data };
  }
  async get(p, e) {
    return (await this.call("GET", p, undefined, e)).data;
  }
  async post(p, b, e) {
    return (await this.call("POST", p, b, e)).data;
  }
  async put(p, b, e) {
    return (await this.call("PUT", p, b, e)).data;
  }
  async delete(p, e) {
    return (await this.call("DELETE", p, undefined, e)).data;
  }
}
const admin = new Client("admin"),
  manager = new Client("manager");
function compactSuccessfulTrace(entry) {
  const data = entry.response;
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data)) {
    entry.response = {
      count: data.length,
      ids: data.map((x) => x.id).filter(Boolean),
    };
    return;
  }
  if (data.stableId) {
    const keys = new Set([
      "id",
      "dbId",
      "version",
      "status",
      "stage",
      "deleted",
      "parent",
      "dept",
      "job",
      "owner",
      "employeeId",
      "actualRegular",
      "leaveDate",
      "supervisorId",
      "screeningStep",
      "held",
      "returned",
      ...Object.keys(entry.input || {}),
    ]);
    entry.response = Object.fromEntries(
      Object.entries(data).filter(([key]) => keys.has(key)),
    );
    for (const key of [
      "timeline",
      "history",
      "workHistory",
      "files",
      "interviews",
    ])
      if (Array.isArray(data[key]))
        entry.response[key] = {
          count: data[key].length,
          ids: data[key].map((x) => x.id).filter(Boolean),
        };
  }
}
async function check(
  module,
  branch,
  fn,
  reference = "docs/prototype-acceptance.md",
) {
  const begin = Date.now(),
    traceStart = trace.length;
  try {
    const evidence = await fn();
    for (const entry of trace.slice(traceStart)) compactSuccessfulTrace(entry);
    results.push({
      module,
      branch,
      status: "PASS",
      reference,
      ms: Date.now() - begin,
      evidence,
      traceStart,
      traceEnd: trace.length,
    });
    console.log(`PASS ${module}: ${branch}`);
  } catch (error) {
    const status = error instanceof Untested ? "UNTESTED" : "FAIL";
    results.push({
      module,
      branch,
      status,
      reference,
      error: error.message,
      ms: Date.now() - begin,
      traceStart,
      traceEnd: trace.length,
    });
    console.error(`${status} ${module}: ${branch}: ${error.message}`);
  }
}
async function create(type, body) {
  const r = await admin.post(`/${type}`, body, [200, 201]);
  assert.ok(r.id);
  created.push({ type, id: r.id });
  return r;
}
async function fresh(type, row) {
  return admin.get(`/${type}/${need(row, "Fixture not created").id}`);
}
async function patch(type, row, fields, expected = 200) {
  const r = await fresh(type, row);
  return admin.put(
    `/${type}/${r.id}`,
    { version: r.version, ...fields },
    expected,
  );
}
async function act(
  type,
  row,
  action,
  body = {},
  client = admin,
  expected = 200,
) {
  return client.post(
    `/${type}/${need(row, "Fixture not created").id}/actions/${action}`,
    body,
    expected,
  );
}
async function deniedUnchanged(type, row, fields, keys = Object.keys(fields)) {
  const before = await fresh(type, row);
  const r = await admin.call(
    "PUT",
    `/${type}/${row.id}`,
    { version: before.version, ...fields },
    null,
  );
  const after = await fresh(type, row);
  assert.ok(
    [400, 403, 409, 422].includes(r.status),
    `Expected validation 4xx, received ${r.status}: ${JSON.stringify({ fields, response: r.data, after }).slice(0, 1100)}`,
  );
  for (const key of keys)
    assert.deepEqual(after[key], before[key], `Rejected write changed ${key}`);
  return { status: r.status, message: r.data.message };
}
async function expectArchiveDenied(type, row) {
  return admin.delete(
    `/${type}/${need(row, "Fixture not created").id}`,
    [400, 409, 422],
  );
}
let db,
  own,
  managerPerson,
  hrPerson,
  ownOrg,
  rootOrg,
  job,
  job2,
  employee,
  employee2,
  request,
  otherRequest,
  interviewer;
let region, workplace, company;
const active = (r) =>
  !r.deleted && !["已离职", "待离职", "停用"].includes(r.status);
function employeeBody(tag, extra = {}) {
  const code = id(tag);
  return {
    id: code,
    name: code,
    dept: ownOrg,
    job: job?.id,
    status: "试用",
    workType: "全职",
    phone: phone(),
    entry: yesterday,
    workRegion: region,
    workplace,
    contractCompany: company,
    ...extra,
  };
}
function requestBody(tag, extra = {}) {
  const code = id(tag);
  return {
    id: code,
    name: code,
    dept: ownOrg,
    job: job.id,
    count: 40,
    salaryMin: 10,
    salaryMax: 20,
    type: "新增",
    deadline: tomorrow,
    workRegion: region,
    workplace,
    contractCompany: company,
    status: "招聘中",
    ownerIds: [hrPerson.id],
    screenerIds: [managerPerson.id],
    firstIds: [interviewer.id, managerPerson.id],
    secondIds: [interviewer.id, managerPerson.id],
    ...extra,
  };
}
async function candidate(tag, req = request) {
  const code = id(tag);
  return create("candidates", {
    id: code,
    name: code,
    req: need(req, "Request fixture unavailable").id,
    phone: phone(),
    source: "内部推荐",
    education: "本科",
    years: 3,
    workRegion: region,
    workplace,
    contractCompany: company,
  });
}
async function screen(c, result, client = admin) {
  return act(
    "candidates",
    c,
    "screening",
    { result, reason: `${prefix} ${result}` },
    client,
  );
}
async function firstStage(tag) {
  let c = await candidate(tag);
  c = await screen(c, "通过");
  c = await screen(c, "通过", manager);
  assert.equal(c.stage, "初试");
  return c;
}
async function slot(c, people = [interviewer.id], day = today) {
  let from = Math.ceil((Date.now() + 20 * 60000) / 60000) * 60000;
  for (let attempt = 0; attempt < 80; attempt++, from += 6 * 60000) {
    if (day === today && localDate(from + 5 * 60000) !== today)
      throw new Untested(
        "No remaining same-day future interview slot; rerun before 23:30 Shanghai time.",
      );
    const body = {
      date: day,
      start: localTime(from),
      end: localTime(from + 5 * 60000),
      interviewerIds: people,
      method: "视频面试",
      place: `${prefix} meeting`,
    };
    const availability = await act("candidates", c, "interview-check", body);
    if (availability.available) return body;
  }
  throw new Untested(
    "No free test interview slot found without modifying existing interviews.",
  );
}
async function schedule(c, people = [interviewer.id], day = today) {
  return act("candidates", c, "schedule", await slot(c, people, day));
}
const latest = (c) =>
  [...c.interviews].reverse().find((i) => i.round === c.stage) ||
  c.interviews.at(-1);
async function result(c, value, client = admin) {
  return act(
    "candidates",
    c,
    "interview-result",
    {
      interviewId: latest(c).id,
      result: value,
      evaluation: `${prefix} ${client.role} ${value}`,
    },
    client,
  );
}
async function offerStage(tag) {
  let c = await firstStage(tag);
  c = await schedule(c);
  c = await result(c, "通过");
  c = await schedule(c);
  c = await result(c, "通过");
  assert.equal(c.stage, "待入职");
  return c;
}
async function onboard(c, action, extra = {}, expected = 200) {
  return act(
    "candidates",
    c,
    "onboarding",
    { action, onboard: tomorrow, entryNotes: `${prefix} ${action}`, ...extra },
    admin,
    expected,
  );
}

await check(
  "setup",
  "Authenticate admin/manager and create isolated fixtures",
  async () => {
    await admin.post("/auth/login", {
      username: "admin",
      password: process.env.HR_INITIAL_ADMIN_PASSWORD || "admin123",
    });
    const login = await manager.post("/auth/login", {
      username: "manager",
      password: process.env.HR_INITIAL_MANAGER_PASSWORD || "manager123",
    });
    ownOrg = login.user.managerDept;
    db = await admin.get("/bootstrap");
    own = await manager.get("/bootstrap");
    rootOrg = db.orgs.find((o) => !o.parent);
    // The isolated manager login is bound to E0002 by prepare-acceptance-database.ps1.
    managerPerson = own.emps.find(
      (e) => e.id === (process.env.HR_MANAGER_EMPLOYEE_NO || "E0002"),
    );
    need(managerPerson, "Cannot resolve the seeded manager account employee");
    hrPerson = db.emps.find(
      (e) =>
        active(e) &&
        /人事|人力|行政/.test(
          db.orgs.find((o) => o.id === e.mainDept)?.name || "",
        ),
    );
    need(hrPerson, "No HR fixture employee");
    region = db.baseSettings.workRegion.find((e) => e.status === "启用").name;
    workplace = db.baseSettings.workplace.find((e) => e.status === "启用").name;
    company = db.baseSettings.contractCompany.find(
      (e) => e.status === "启用",
    ).name;
    job = await create("jobs", {
      id: id("J"),
      name: id("岗位"),
      dept: ownOrg,
      headcount: 150,
      status: "启用",
    });
    job2 = await create("jobs", {
      id: id("J2"),
      name: id("调岗岗位"),
      dept: ownOrg,
      headcount: 10,
      status: "启用",
    });
    employee = await create("emps", employeeBody("E"));
    employee2 = await create("emps", employeeBody("E2", { status: "正式" }));
    interviewer = await create("emps", employeeBody("I", { status: "正式" }));
    request = await create("reqs", requestBody("R"));
    otherRequest = await create(
      "reqs",
      requestBody("R2", { count: 1, screenerIds: [interviewer.id] }),
    );
    return {
      ownOrg,
      manager: managerPerson.id,
      request: request.id,
      employee: employee.id,
    };
  },
);

let orgA, orgB, orgChild, orgInactive;
await check(
  "orgs",
  "Create organization then move child and read back",
  async () => {
    need(db, "Setup unavailable");
    orgA = await create("orgs", {
      id: id("OA"),
      name: id("组织A"),
      parent: ownOrg,
      orgType: "组",
      status: "启用",
    });
    orgB = await create("orgs", {
      id: id("OB"),
      name: id("组织B"),
      parent: ownOrg,
      orgType: "组",
      status: "启用",
    });
    orgChild = await create("orgs", {
      id: id("OC"),
      name: id("子组织"),
      parent: orgA.id,
      orgType: "组",
      status: "启用",
    });
    await patch("orgs", orgChild, { parent: orgB.id });
    assert.equal((await fresh("orgs", orgChild)).parent, orgB.id);
    return { ids: [orgA.id, orgB.id, orgChild.id] };
  },
  "prototype: 4290–4344",
);
await check(
  "orgs",
  "Reject self-parent and descendant-parent cycles",
  async () => {
    await deniedUnchanged("orgs", orgB, { parent: orgB.id });
    await deniedUnchanged("orgs", orgB, { parent: orgChild.id });
  },
);
await check("orgs", "Reject duplicate sibling organization name", async () => {
  need(orgA, "Organization fixture unavailable");
  await admin.post(
    "/orgs",
    {
      id: id("OD"),
      name: orgA.name,
      parent: ownOrg,
      orgType: "组",
      status: "启用",
    },
    [400, 409, 422],
  );
});
await check("orgs", "Reject creating under inactive parent", async () => {
  orgInactive = await create("orgs", {
    id: id("OI"),
    name: id("停用组织"),
    parent: ownOrg,
    orgType: "组",
    status: "启用",
  });
  await patch("orgs", orgInactive, { status: "停用" });
  await admin.post(
    "/orgs",
    {
      id: id("OBAD"),
      name: id("不应创建"),
      parent: orgInactive.id,
      orgType: "组",
      status: "启用",
    },
    [400, 409, 422],
  );
});
await check(
  "orgs",
  "Reject moving organization into inactive parent",
  async () => {
    await deniedUnchanged("orgs", orgA, {
      parent: need(orgInactive, "Inactive fixture missing").id,
    });
  },
);
await check(
  "orgs",
  "Reject disabling/deleting parent with active child",
  async () => {
    await deniedUnchanged("orgs", orgB, { status: "停用" });
    await expectArchiveDenied("orgs", orgB);
  },
);
await check(
  "orgs",
  "Reject deleting organization with inactive child reference",
  async () => {
    const parent = await create("orgs", {
      id: id("OP"),
      name: id("引用父"),
      parent: ownOrg,
      orgType: "组",
      status: "启用",
    });
    const child = await create("orgs", {
      id: id("OI"),
      name: id("停用子"),
      parent: parent.id,
      orgType: "组",
      status: "启用",
    });
    await patch("orgs", child, { status: "停用" });
    await expectArchiveDenied("orgs", parent);
  },
);
await check(
  "orgs",
  "Delete empty organization and verify archived list",
  async () => {
    const o = await create("orgs", {
      id: id("OX"),
      name: id("空组织"),
      parent: ownOrg,
      orgType: "组",
      status: "启用",
    });
    await admin.delete(`/orgs/${o.id}`);
    const list = await admin.get(`/orgs?archived=true&q=${o.id}`);
    assert.ok(list.items.some((r) => r.id === o.id));
  },
);
await check(
  "orgs",
  "Manager cannot create/edit/delete organization",
  async () => {
    need(orgA, "Organization fixture unavailable");
    await manager.post("/orgs", { name: id("越权"), parent: ownOrg }, 403);
    await manager.put(
      `/orgs/${orgA.id}`,
      { version: (await fresh("orgs", orgA)).version, name: id("越权") },
      403,
    );
    await manager.delete(`/orgs/${orgA.id}`, 403);
  },
);

await check(
  "jobs",
  "Used job cannot move organization or be archived",
  async () => {
    await deniedUnchanged("jobs", job, { dept: orgB.id });
    await expectArchiveDenied("jobs", job);
  },
);
await check(
  "jobs",
  "Used job cannot reduce capacity below staff or be disabled",
  async () => {
    await deniedUnchanged("jobs", job, { headcount: 1 });
    await deniedUnchanged("jobs", job, { status: "停用" });
  },
);
await check(
  "roster",
  "Transfer employee to second job and preserve change log",
  async () => {
    await patch("emps", employee, { job: job2.id });
    const e = await fresh("emps", employee);
    assert.equal(e.job, job2.id);
    assert.ok(e.timeline.some((t) => t.detail.includes("岗位")));
    assert.ok((await admin.get(`/emps/${e.id}/audit`)).length > 0);
    return { employee: e.id, job: e.job };
  },
);
await check(
  "roster",
  "Probation confirmation persists status and actual date",
  async () => {
    await patch("emps", employee, { status: "正式", actualRegular: today });
    const e = await fresh("emps", employee);
    assert.equal(e.status, "正式");
    assert.equal(e.actualRegular, today);
  },
);
await check(
  "roster",
  "Reject confirmation date before entry",
  async () => {
    try {
      await deniedUnchanged("emps", employee, { actualRegular: "2000-01-01" });
    } finally {
      await patch("emps", employee, { actualRegular: today });
    }
  },
  "prototype: 4403–4405",
);
await check(
  "roster",
  "Reject confirmation date after today",
  async () => {
    try {
      await deniedUnchanged("emps", employee, { actualRegular: tomorrow });
    } finally {
      await patch("emps", employee, { actualRegular: today });
    }
  },
  "prototype: 4403–4405",
);
await check(
  "roster",
  "Pending leave and cancellation return to active status",
  async () => {
    await patch("emps", employee, { status: "待离职", leaveDate: tomorrow });
    assert.equal((await fresh("emps", employee)).status, "待离职");
    await patch("emps", employee, { status: "正式", leaveDate: "" });
    const e = await fresh("emps", employee);
    assert.equal(e.status, "正式");
    assert.ok(!e.leaveDate);
  },
);
await check(
  "roster",
  "Reject supervisor self-reference and multi-person cycle",
  async () => {
    await deniedUnchanged("emps", employee, { supervisorId: employee.id });
    await patch("emps", employee, { supervisorId: employee2.id });
    try {
      await deniedUnchanged("emps", employee2, { supervisorId: employee.id });
    } finally {
      await patch("emps", employee, { supervisorId: "" });
      await patch("emps", employee2, { supervisorId: "" });
    }
  },
  "prototype: 4406",
);
await check(
  "roster",
  "Work-history add, edit, delete persists on detail refresh",
  async () => {
    const rows = [
      {
        company: prefix + "历史1",
        start: "2017-01-01",
        end: "2018-01-01",
        reason: "发展",
      },
      {
        company: prefix + "历史2",
        start: "2018-02-01",
        end: "2019-01-01",
        reason: "发展",
      },
    ];
    await patch("emps", employee, { workHistory: rows });
    let e = await fresh("emps", employee);
    assert.equal(e.workHistory.length, 2);
    rows[0].reason = "已编辑";
    await patch("emps", employee, { workHistory: rows.slice(0, 1) });
    e = await fresh("emps", employee);
    assert.equal(e.workHistory.length, 1);
    assert.equal(e.workHistory[0].reason, "已编辑");
  },
);
await check(
  "roster",
  "Reject reversed work-history dates atomically",
  async () => {
    const before = await fresh("emps", employee);
    try {
      await deniedUnchanged("emps", employee, {
        workHistory: [
          {
            company: prefix + "非法历史",
            start: "2020-02-01",
            end: "2019-01-01",
          },
        ],
      });
    } finally {
      await patch("emps", employee, { workHistory: before.workHistory });
    }
  },
  "prototype: 4398",
);
await check(
  "roster",
  "Reject future work-history dates atomically",
  async () => {
    const before = await fresh("emps", employee);
    try {
      await deniedUnchanged("emps", employee, {
        workHistory: [
          { company: prefix + "未来历史", start: tomorrow, end: "" },
        ],
      });
    } finally {
      await patch("emps", employee, { workHistory: before.workHistory });
    }
  },
  "prototype: 4398",
);
let growthId;
await check(
  "roster",
  "Manual growth create, edit, delete; audit remains",
  async () => {
    await act("emps", employee, "timeline", {
      date: today,
      type: "培训",
      title: prefix + "成长",
      detail: "新建成长说明",
    });
    let e = await fresh("emps", employee);
    const entry = e.timeline.find((t) => t.title === prefix + "成长");
    assert.ok(entry?.editable);
    growthId = entry.id;
    await act("emps", employee, "timeline-update", {
      timelineId: growthId,
      date: today,
      type: "奖励",
      title: prefix + "成长改",
      detail: "编辑说明",
    });
    e = await fresh("emps", employee);
    assert.equal(e.timeline.find((t) => t.id === growthId)?.detail, "编辑说明");
    await act("emps", employee, "timeline-delete", { timelineId: growthId });
    assert.ok(
      !(await fresh("emps", employee)).timeline.some((t) => t.id === growthId),
    );
    assert.ok(
      (await admin.get(`/emps/${employee.id}/audit`)).some((t) =>
        JSON.stringify(t).includes("timeline-delete"),
      ),
    );
  },
);
await check(
  "roster",
  "System-generated growth cannot be edited or deleted",
  async () => {
    const e = await fresh("emps", employee),
      t = need(
        e.timeline.find((x) => !x.editable),
        "No system growth fixture",
      );
    await act(
      "emps",
      employee,
      "timeline-update",
      {
        timelineId: t.id,
        date: today,
        type: "培训",
        title: "非法",
        detail: "非法",
      },
      admin,
      [400, 409],
    );
    await act(
      "emps",
      employee,
      "timeline-delete",
      { timelineId: t.id },
      admin,
      [400, 409],
    );
  },
);
await check(
  "roster",
  "Manual growth update validates required fields and date",
  async () => {
    await act("emps", employee, "timeline", {
      date: today,
      type: "培训",
      title: prefix + "校验",
      detail: "保留",
    });
    const t = (await fresh("emps", employee)).timeline.find(
      (x) => x.title === prefix + "校验",
    );
    try {
      await act(
        "emps",
        employee,
        "timeline-update",
        {
          timelineId: t.id,
          date: "not-a-date",
          type: "",
          title: "",
          detail: "invalid",
        },
        admin,
        [400, 409, 422],
      );
    } finally {
      await act("emps", employee, "timeline-delete", { timelineId: t.id });
    }
  },
);
let file;
await check(
  "roster",
  "Upload persisted attachment and leave/reinstate preserves file and history",
  async () => {
    const bytes = Buffer.from(prefix + " persisted attachment");
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: "text/plain" }),
      prefix + ".txt",
    );
    form.append("category", "其它材料");
    file = await admin.post(`/emps/${employee.id}/files`, form);
    assert.ok(
      (await fresh("emps", employee)).files.some((f) => f.id === file.id),
    );
    const e = await fresh("emps", employee);
    await act("emps", employee, "leave", { leaveDate: today });
    let r = await fresh("emps", employee);
    assert.equal(r.status, "已离职");
    await act("emps", employee, "reinstate", {});
    r = await fresh("emps", employee);
    assert.equal(r.status, e.status);
    assert.ok(r.files.some((f) => f.id === file.id));
    assert.equal(r.workHistory.length, e.workHistory.length);
    const downloaded = await admin.get(`/emps/files/${file.id}`);
    assert.equal(downloaded, bytes.toString());
  },
);
await check(
  "roster",
  "Attachment delete is authorized, disappears, and download rejects",
  async () => {
    need(file, "Attachment fixture unavailable");
    await manager.delete(`/emps/files/${file.id}`, 403);
    await admin.delete(`/emps/files/${file.id}`);
    assert.ok(
      !(await fresh("emps", employee)).files.some((f) => f.id === file.id),
    );
    await admin.get(`/emps/files/${file.id}`, 404);
  },
);

for (const phase of ["hr", "dept"])
  for (const outcome of ["暂缓", "未通过", "候选人取消"])
    await check(
      "screening",
      `${phase}: ${outcome} preserves stage owner or terminal state`,
      async () => {
        let c = await candidate("S");
        if (phase === "dept") c = await screen(c, "通过");
        c = await screen(c, outcome, phase === "hr" ? admin : manager);
        const saved = await fresh("candidates", c);
        assert.equal(saved.stage, outcome === "暂缓" ? "暂缓筛选" : outcome);
        assert.equal(
          saved.screeningStep,
          phase === "dept" && outcome === "暂缓" ? "dept" : "hr",
        );
        assert.ok(saved.history.some((h) => h.detail.includes(outcome)));
        if (outcome === "暂缓") {
          c = await screen(c, "通过", phase === "hr" ? admin : manager);
          assert.equal(c.stage, phase === "hr" ? "待部门筛选" : "初试");
        } else
          await act(
            "candidates",
            c,
            "screening",
            { result: "通过" },
            admin,
            [400, 409],
          );
        return { candidate: c.id, stage: saved.stage };
      },
    );
await check(
  "screening",
  "Department return to HR preserves feedback and next ownership",
  async () => {
    let c = await candidate("RET");
    c = await screen(c, "通过");
    c = await screen(c, "退回 HR", manager);
    const r = await fresh("candidates", c);
    assert.equal(r.stage, "待 HR 筛选");
    assert.equal(r.screeningStep, "hr");
    assert.equal(r.returned, true);
  },
);
await check(
  "screening",
  "Manager cannot process HR step or unassigned department request",
  async () => {
    let c = await candidate("AUTH");
    await act("candidates", c, "screening", { result: "通过" }, manager, 403);
    c = await candidate("UNASSIGNED", otherRequest);
    c = await screen(c, "通过");
    await act("candidates", c, "screening", { result: "通过" }, manager, 403);
    assert.equal((await fresh("candidates", c)).stage, "待部门筛选");
  },
);
await check(
  "screening",
  "Paused demand blocks screening; resume permits continuation",
  async () => {
    let c = await candidate("PAUSE");
    await patch("reqs", request, { status: "暂停" });
    try {
      await act("candidates", c, "screening", { result: "通过" }, admin, 409);
    } finally {
      await patch("reqs", request, { status: "招聘中" });
    }
    c = await screen(c, "通过");
    assert.equal(c.stage, "待部门筛选");
  },
);
await check(
  "screening",
  "Atomic HR and department batch success persists every candidate",
  async () => {
    const rows = [await candidate("BATCH1"), await candidate("BATCH2")],
      ids = rows.map((r) => r.id);
    let r = await admin.post("/candidates/actions/batch-screening", {
      ids,
      result: "通过",
      reason: prefix + " HR batch",
    });
    assert.equal(r.count, 2);
    for (const c of rows)
      assert.equal((await fresh("candidates", c)).stage, "待部门筛选");
    r = await manager.post("/candidates/actions/batch-screening", {
      ids,
      result: "通过",
      reason: prefix + " manager batch",
    });
    assert.equal(r.count, 2);
    for (const c of rows)
      assert.equal((await fresh("candidates", c)).stage, "初试");
    return { ids };
  },
  "prototype: 5092–5094",
);
await check(
  "screening",
  "Batch containing terminal candidate rejects before any row writes",
  async () => {
    const first = await candidate("BATGOOD"),
      last = await candidate("BATBAD");
    await screen(last, "未通过");
    const before = await fresh("candidates", first);
    await admin.post(
      "/candidates/actions/batch-screening",
      { ids: [first.id, last.id], result: "通过" },
      [400, 409],
    );
    const after = await fresh("candidates", first);
    assert.equal(after.version, before.version);
    assert.equal(after.stage, before.stage);
    assert.deepEqual(after.history, before.history);
  },
);
await check(
  "screening",
  "Manager batch with one unassigned request rolls all rows back",
  async () => {
    const first = await candidate("BATOWN"),
      last = await candidate("BATOTHER", otherRequest);
    await screen(first, "通过");
    await screen(last, "通过");
    const before = await fresh("candidates", first);
    await manager.post(
      "/candidates/actions/batch-screening",
      { ids: [first.id, last.id], result: "通过" },
      403,
    );
    const after = await fresh("candidates", first);
    assert.equal(after.version, before.version);
    assert.equal(after.stage, "待部门筛选");
    await admin.post(
      "/candidates/actions/batch-screening",
      { ids: [first.id, first.id], result: "通过" },
      [400, 409],
    );
  },
);
await check(
  "reqs",
  "Existing candidate prevents request reassignment and deletion",
  async () => {
    need(request, "Request fixture unavailable");
    await deniedUnchanged("reqs", request, { job: job2.id });
    await expectArchiveDenied("reqs", request);
  },
);
await check(
  "pool",
  "Initial and terminal candidate can archive and restore",
  async () => {
    let c = await candidate("ARCH");
    await admin.delete(`/candidates/${c.id}`);
    assert.equal((await fresh("candidates", c)).deleted, true);
    await admin.post(`/candidates/${c.id}/restore`, {});
    c = await screen(c, "未通过");
    await admin.delete(`/candidates/${c.id}`);
    await admin.post(`/candidates/${c.id}/restore`, {});
    assert.equal((await fresh("candidates", c)).stage, "未通过");
  },
);

let interviewCandidate, offer;
await check(
  "interviews",
  "Schedule, reschedule, cancel and schedule again keep one current round",
  async () => {
    let c = await firstStage("INT");
    interviewCandidate = c;
    c = await schedule(c);
    const old = latest(c);
    let body = await slot(c, [interviewer.id, managerPerson.id]);
    body.place = prefix + " moved";
    c = await act("candidates", c, "schedule", body);
    assert.equal(c.interviews.length, 1);
    assert.equal(latest(c).id, old.id);
    assert.equal(latest(c).place, body.place);
    await act(
      "candidates",
      c,
      "interview-cancel",
      { interviewId: old.id, reason: "" },
      admin,
      400,
    );
    c = await act("candidates", c, "interview-cancel", {
      interviewId: old.id,
      reason: prefix + " cancel",
    });
    assert.equal(latest(c).status, "已取消");
    c = await schedule(c);
    assert.equal(c.interviews.length, 1);
    assert.equal(latest(c).status, "待面试");
    interviewCandidate = c;
  },
);
await check(
  "interviews",
  "Reschedule history retains prior date/time/interviewers and operator",
  async () => {
    const i = latest(await fresh("candidates", interviewCandidate));
    assert.ok(i.changes?.length >= 2, "Missing persisted reschedule changes");
    const first = i.changes[0];
    assert.equal(first.before.date, today);
    assert.ok(/^\d{2}:\d{2}$/.test(first.before.start));
    assert.ok(/^\d{2}:\d{2}$/.test(first.before.end));
    assert.deepEqual(first.before.interviewerIds, [interviewer.id]);
    assert.equal(first.before.place, prefix + " meeting");
    assert.ok(first.date && first.operator);
    assert.ok(!Object.hasOwn(first.before, "changes"));
    return { interviewId: i.id, changes: i.changes };
  },
  "prototype: 3913 scheduleInterview pending.changes.push(before)",
);
await check(
  "interviews",
  "Active interview blocks candidate deletion",
  async () => {
    await expectArchiveDenied("candidates", interviewCandidate);
  },
);
await check(
  "interviews",
  "No-show creates reschedule state and cannot receive result until rescheduled",
  async () => {
    let c = need(interviewCandidate, "Interview fixture unavailable");
    c = await result(c, "未到场 / 改期");
    assert.equal(latest(c).status, "待改期");
    assert.equal(c.stage, "初试");
    await act(
      "candidates",
      c,
      "interview-result",
      { interviewId: latest(c).id, result: "通过", evaluation: "invalid" },
      admin,
      409,
    );
    c = await schedule(c);
    assert.equal(latest(c).status, "待面试");
    interviewCandidate = c;
  },
);
await check(
  "interviews",
  "Future-date result blocked and read-only conflict check has no write",
  async () => {
    let c = await firstStage("FUT");
    c = await schedule(c, [interviewer.id], tomorrow);
    const before = await fresh("candidates", c);
    await result(c, "待定").then(
      () => assert.fail("Future result accepted"),
      (e) => assert.match(e.message, /400|日期/),
    );
    await act("candidates", c, "interview-check", {
      ...latest(c),
      interviewerIds: [interviewer.id],
    });
    const after = await fresh("candidates", c);
    assert.equal(after.version, before.version);
    assert.deepEqual(after.interviews, before.interviews);
    await act("candidates", c, "interview-cancel", {
      interviewId: latest(c).id,
      reason: prefix + " release future slot",
    });
  },
);
await check(
  "interviews",
  "Pending feedback can update own vote without duplication",
  async () => {
    let c = need(interviewCandidate, "Interview fixture unavailable");
    c = await result(c, "待定");
    assert.equal(latest(c).status, "待评价");
    c = await act("candidates", c, "interview-result", {
      interviewId: latest(c).id,
      result: "待定",
      evaluation: prefix + " updated opinion",
    });
    const i = latest(await fresh("candidates", c));
    assert.equal(i.votes.length, 1);
    assert.equal(i.votes[0].evaluation, prefix + " updated opinion");
    interviewCandidate = c;
  },
  "prototype: 4465–4485",
);
await check(
  "interviews",
  "Feedback from both configured operators persists until final vote",
  async () => {
    let c = await firstStage("VOTES");
    c = await schedule(c, [managerPerson.id, interviewer.id]);
    c = await result(c, "待定", manager);
    c = await result(c, "待定", admin);
    let i = latest(await fresh("candidates", c));
    const pending = { candidate: c.id, votes: i.votes };
    c = await result(c, "通过", manager);
    i = (await fresh("candidates", c)).interviews.find(
      (x) => x.round === "初试",
    );
    assert.equal(
      pending.votes.length,
      2,
      `Second operator overwrote first vote: ${JSON.stringify(pending)}`,
    );
    assert.equal(i.votes.length, 2);
    assert.equal(c.stage, "复试");
    assert.equal(i.result, "通过");
    return {
      candidate: c.id,
      pendingVotes: pending.votes,
      finalVotes: i.votes,
    };
  },
  "prototype: 4472–4473",
);
for (const outcome of ["未通过", "候选人取消"])
  await check(
    "interviews",
    `First-round ${outcome} becomes terminal`,
    async () => {
      let c = await firstStage("END");
      c = await schedule(c);
      if (outcome === "未通过")
        await act(
          "candidates",
          c,
          "interview-result",
          { interviewId: latest(c).id, result: outcome, evaluation: "" },
          admin,
          400,
        );
      c = await result(c, outcome);
      assert.equal((await fresh("candidates", c)).stage, outcome);
      assert.equal(c.interviews[0].status, "已完成");
    },
  );
await check(
  "interviews",
  "Initial pass advances to second, second pass creates onboarding",
  async () => {
    let c = need(interviewCandidate, "Interview fixture unavailable");
    c = await result(c, "通过");
    assert.equal(c.stage, "复试");
    await act(
      "candidates",
      c,
      "interview-result",
      {
        interviewId: c.interviews[0].id,
        result: "通过",
        evaluation: "invalid stale round",
      },
      admin,
      409,
    );
    c = await schedule(c);
    c = await result(c, "通过");
    offer = c;
    assert.equal((await fresh("candidates", c)).stage, "待入职");
    assert.equal(c.interviews.length, 2);
  },
);

await check("offers", "Manager cannot process onboarding", async () => {
  need(offer, "Onboarding fixture unavailable");
  await act(
    "candidates",
    offer,
    "onboarding",
    { action: "延期入职", onboard: tomorrow, entryNotes: "forbidden" },
    manager,
    403,
  );
});
await check(
  "offers",
  "Delay, adjust date, no-show, re-arrange, decline, re-arrange and cancel loop",
  async () => {
    let c = need(offer, "Onboarding fixture unavailable");
    const steps = [
      ["延期入职", "延期入职"],
      ["调整入职日期", "延期入职"],
      ["未到岗", "未到岗"],
      ["重新安排入职", "待入职"],
      ["放弃入职", "放弃入职"],
      ["重新安排入职", "待入职"],
      ["取消入职", "取消入职"],
      ["重新安排入职", "待入职"],
    ];
    for (const [action, stage] of steps) {
      c = await onboard(c, action);
      assert.equal((await fresh("candidates", c)).stage, stage);
    }
    offer = c;
    return { candidate: c.id, steps: steps.map((x) => x[0]) };
  },
);
await check(
  "offers",
  "Abnormal processing requires notes and non-past new date",
  async () => {
    await onboard(offer, "延期入职", { entryNotes: "" }, 400);
    await onboard(offer, "延期入职", { onboard: yesterday }, 400);
  },
);
await check(
  "offers",
  "No-show cannot confirm directly; decline/cancel require re-arrange",
  async () => {
    let c = need(offer, "Onboarding fixture unavailable");
    c = await onboard(c, "未到岗");
    await onboard(c, "确认入职", {}, 409);
    c = await onboard(c, "放弃入职");
    await onboard(c, "取消入职", {}, 409);
    c = await onboard(c, "重新安排入职");
    c = await onboard(c, "取消入职");
    await onboard(c, "延期入职", {}, 409);
    offer = await onboard(c, "重新安排入职");
  },
);
for (const action of ["未到岗", "放弃入职", "取消入职"])
  await check(
    "offers",
    `${action} rejects supplied date before candidate creation`,
    async () => {
      need(offer, "Onboarding fixture unavailable");
      try {
        await onboard(offer, action, { onboard: "2000-01-01" }, 400);
        assert.equal((await fresh("candidates", offer)).stage, "待入职");
      } finally {
        const saved = await fresh("candidates", offer);
        if (saved.stage !== "待入职")
          offer = await onboard(saved, "重新安排入职");
      }
    },
    "prototype: 5392 all supplied onboard dates must be >= candidate.created",
  );
await check(
  "offers",
  "Dedicated cancel action without date preserves plan and can re-arrange",
  async () => {
    const before = await fresh("candidates", offer);
    const cancelled = await act("candidates", offer, "onboarding", {
      action: "取消入职",
      entryNotes: prefix + " cancel without date",
    });
    assert.equal(cancelled.stage, "取消入职");
    assert.equal(cancelled.onboard, before.onboard);
    offer = await onboard(cancelled, "重新安排入职");
  },
);
await check(
  "offers",
  "Confirm future entry creates one probation employee; duplicate rejected",
  async () => {
    const code = id("HIRE"),
      grade = need(
        db.grades.find(
          (g) => active(g) && (g.scope === "全部部门" || !g.scope),
        ),
        "No applicable active grade",
      );
    const body = {
      employeeId: code,
      grade: grade.id,
      workRegion: region,
      workplace,
      contractCompany: company,
    };
    const c = await onboard(offer, "确认入职", body);
    assert.equal(c.stage, "已入职");
    assert.equal(c.employeeId, code);
    const e = await admin.get(`/emps/${code}`);
    created.push({ type: "emps", id: code });
    assert.equal(e.entry, tomorrow);
    assert.equal(e.status, "试用");
    assert.equal(e.phone, c.phone);
    await onboard(c, "确认入职", body, 409);
    await expectArchiveDenied("candidates", c);
    return { candidate: c.id, employee: code };
  },
);

let asset;
await check(
  "assets",
  "Register, assign, reject repeated assign and reject same-owner transfer",
  async () => {
    asset = await create("assets", {
      id: id("A"),
      name: id("资产"),
      category: "电子设备",
      model: "FIXQA",
      dept: ownOrg,
      location: region,
      office: "FIXQA store",
      public: "否",
      status: "闲置",
      purchased: today,
      cost: 100,
    });
    asset = await act("assets", asset, "assign", {
      owner: employee.id,
      reason: "FIXQA assign",
    });
    assert.equal(asset.owner, employee.id);
    assert.equal((await fresh("assets", asset)).status, "使用中");
    await act("assets", asset, "assign", { owner: employee2.id }, admin, 409);
    await act("assets", asset, "transfer", { owner: employee.id }, admin, 400);
  },
);
await check(
  "assets",
  "Held asset blocks employee exit/archive and asset scrap/archive",
  async () => {
    await act("emps", employee, "leave", { leaveDate: today }, admin, 409);
    await expectArchiveDenied("emps", employee);
    await act("assets", asset, "scrap", {}, admin, 409);
    await expectArchiveDenied("assets", asset);
  },
);
await check(
  "assets",
  "Transfer and repair preserve owner; repair-end restores usage",
  async () => {
    asset = await act("assets", asset, "transfer", {
      owner: employee2.id,
      reason: "FIXQA transfer",
    });
    assert.equal(asset.owner, employee2.id);
    asset = await act("assets", asset, "repair-start", {
      reason: "FIXQA repair",
    });
    assert.equal(asset.status, "维修中");
    assert.equal(asset.owner, employee2.id);
    await act("assets", asset, "repair-start", {}, admin, 409);
    asset = await act("assets", asset, "repair-end", {});
    assert.equal(asset.status, "使用中");
  },
);
await check(
  "assets",
  "Return clears owner; idle repair/end and scrap are persisted in history",
  async () => {
    asset = await act("assets", asset, "return", {
      location: region,
      office: "FIXQA returned",
      reason: "FIXQA return",
    });
    assert.equal(asset.status, "闲置");
    assert.ok(!asset.owner);
    await act("assets", asset, "return", {}, admin, 409);
    asset = await act("assets", asset, "repair-start", {});
    asset = await act("assets", asset, "repair-end", {});
    assert.equal(asset.status, "闲置");
    asset = await act("assets", asset, "scrap", { reason: "FIXQA scrap" });
    assert.equal(asset.status, "已报废");
    const a = await fresh("assets", asset);
    for (const event of [
      "ASSIGN",
      "TRANSFER",
      "RETURN",
      "REPAIR_START",
      "REPAIR_END",
      "SCRAP",
    ])
      assert.ok(
        a.history.some((h) => h.type === event),
        `Missing ${event} history`,
      );
    await deniedUnchanged("assets", asset, { status: "闲置" });
  },
);
await check(
  "assets",
  "Public asset cannot have owner; pending-leave employee cannot receive asset",
  async () => {
    const a = await create("assets", {
      id: id("AP"),
      name: id("公共资产"),
      category: "其它",
      dept: ownOrg,
      location: region,
      public: "是",
      status: "使用中",
      cost: 0,
    });
    await deniedUnchanged("assets", a, { owner: employee.id });
    const b = await create("assets", {
      id: id("AI"),
      name: id("闲置资产"),
      category: "其它",
      dept: ownOrg,
      location: region,
      public: "否",
      status: "闲置",
      cost: 0,
    });
    await patch("emps", employee2, { status: "待离职" });
    try {
      await act("assets", b, "assign", { owner: employee2.id }, admin, 400);
    } finally {
      await patch("emps", employee2, { status: "正式" });
    }
  },
);
await check(
  "roster",
  "After asset release employee can leave, cannot directly revive or use legacy delete",
  async () => {
    await act("emps", employee, "leave", { leaveDate: today });
    assert.equal((await fresh("emps", employee)).status, "已离职");
    await deniedUnchanged("emps", employee, { status: "正式" });
    await admin.delete(`/emps/${employee.id}`, 400);
    const e = await fresh("emps", employee);
    assert.equal(e.status, "已离职");
    assert.equal(e.leaveDate, today);
  },
);

// Scope ownership is explicit; delegated coverage is never counted as this script's PASS.
for (const [module, branch, owner, scripts] of [
  [
    "grades",
    "Grade graph/sequence CRUD/scope forms",
    "frontend + root",
    [
      "interaction-acceptance.mjs",
      "configuration-acceptance.mjs",
      "sequence-acceptance.mjs",
    ],
  ],
  [
    "settings",
    "Dictionary CRUD/rename/alias UI",
    "frontend + root",
    [
      "settings-acceptance.mjs",
      "import-alias-acceptance.mjs",
      "interaction-acceptance.mjs",
    ],
  ],
  [
    "roster",
    "All 10 section editors, focus, cancel and unsaved prompts",
    "frontend",
    ["interaction-acceptance.mjs"],
  ],
  [
    "pool",
    "Batch resume parsing and original-file UI",
    "root",
    ["resume-acceptance.mjs"],
  ],
  [
    "shared",
    "11-module filters, pagination, column configuration and exports",
    "frontend + root",
    ["interaction-acceptance.mjs", "browser-acceptance.mjs"],
  ],
])
  results.push({
    module,
    branch,
    status: "DELEGATED",
    owner,
    scripts,
    reason: "Read named reports separately; not an implied PASS.",
  });
results.push({
  module: "interviews",
  branch: "ICS calendar download",
  status: "NOT_APPLICABLE",
  reference:
    "prototype: 3913 schedule footer has cancel/check/save; final rowActions 4449–4460 and simplified view 4487–4495 have no ICS action",
  reason:
    "Older function exists but no final visible entry; no extra UI is invented.",
});

await fs.mkdir(path.dirname(output), { recursive: true });
const summary = Object.fromEntries(
  ["PASS", "FAIL", "UNTESTED", "DELEGATED", "NOT_APPLICABLE"].map((s) => [
    s,
    results.filter((r) => r.status === s).length,
  ]),
);
const report = JSON.stringify(
  {
    startedAt,
    finishedAt: new Date().toISOString(),
    base,
    prefix,
    summary,
    scope:
      "Only synthetic FIXQA records in isolated 8091; no password/global dictionary/sequence writes; no mocks; writes intentionally retained for reproduction.",
    created,
    results,
    trace,
  },
  null,
  2,
);
await fs.writeFile(output, report);
await fs.writeFile(
  path.join(path.dirname(output), `workflow-branches-${prefix}.json`),
  report,
);
console.log(JSON.stringify({ output, prefix, summary }, null, 2));
process.exitCode = summary.FAIL ? 1 : 0;
