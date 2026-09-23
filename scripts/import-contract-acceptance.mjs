import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base = "http://127.0.0.1:8091/api";
const prefix = "FIXQAIMP" + Date.now().toString(36).toUpperCase();
const startedAt = new Date().toISOString();
const results = [];
function client() {
  let cookie = "";
  return async (method, resource, body, expected = 200) => {
    const response = await fetch(base + resource, {
      method,
      headers: {
        Origin: "http://127.0.0.1:5175",
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length)
      cookie = cookies.map((item) => item.split(";")[0]).join("; ");
    const data = await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${resource}: ${JSON.stringify(data)}`,
    );
    return data;
  };
}
const admin = client(),
  manager = client();
async function check(name, fn) {
  try {
    const evidence = await fn();
    results.push({ name, status: "PASS", evidence });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.error("FAIL " + name + ": " + error.message);
  }
}
function request(rows, preview = false, suffix = "") {
  return {
    rows,
    mode: "update",
    validateOnly: preview,
    fileName: prefix + suffix + ".xlsx",
    fileHash: crypto
      .createHash("sha256")
      .update(prefix + suffix + JSON.stringify(rows))
      .digest("hex"),
  };
}
let imported, req, bootstrap, employee;
try {
  await admin("POST", "/auth/login", {
    username: "admin",
    password: "admin123",
  });
  await manager("POST", "/auth/login", {
    username: "manager",
    password: "manager123",
  });
  bootstrap = await admin("GET", "/bootstrap");
  const job = await admin("POST", "/jobs", {
    id: prefix + "J",
    name: prefix + "岗位",
    dept: "ORG_18",
    headcount: 50,
    status: "启用",
    description: "隔离导入契约验收",
  });
  const dict = (key) =>
    bootstrap.baseSettings[key].find((item) => item.status === "启用").name;
  const row = {
    id: prefix + "R",
    name: prefix + "需求",
    dept: "开发部",
    job: job.id,
    count: 2,
    salaryMin: 10,
    salaryMax: 20,
    location: dict("workRegion"),
    office: dict("workplace"),
    company: dict("contractCompany"),
    deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    screener: "E0002",
    first: "E0002",
    second: "E0002",
  };
  await check(
    "Original 14-column demand import defaults owner to the bound admin employee",
    async () => {
      const before = await admin("GET", "/imports/reqs/logs?page=1&size=1");
      const preview = await admin(
        "POST",
        "/imports/reqs",
        request([row], true),
      );
      assert.equal(preview.errorCount, 0, JSON.stringify(preview.rows));
      assert.equal(
        (await admin("GET", "/imports/reqs/logs?page=1&size=1")).total,
        before.total,
      );
      await admin("GET", "/reqs/" + row.id, undefined, 404);
      imported = await admin("POST", "/imports/reqs", request([row]));
      assert.equal(imported.added, 1, JSON.stringify(imported));
      assert.equal(imported.errorCount, 0);
      req = await admin("GET", "/reqs/" + row.id);
      assert.deepEqual(req.ownerIds, ["E0005"]);
      return {
        importId: imported.importId,
        requestId: req.id,
        ownerIds: req.ownerIds,
      };
    },
  );
  await check(
    "Missing owner during an update preserves a deliberately changed owner",
    async () => {
      assert.ok(req);
      req = await admin("PUT", "/reqs/" + req.id, {
        version: req.version,
        ownerIds: ["E0002"],
      });
      const update = await admin(
        "POST",
        "/imports/reqs",
        request(
          [{ id: req.id, name: req.name, salaryMin: 12 }],
          false,
          "-update",
        ),
      );
      assert.equal(update.updated, 1, JSON.stringify(update));
      const saved = await admin("GET", "/reqs/" + req.id);
      assert.deepEqual(saved.ownerIds, ["E0002"]);
      assert.equal(Number(saved.salaryMin), 12);
    },
  );
  await check(
    "Explicit invalid owner is an error and is never silently replaced",
    async () => {
      const bad = await admin(
        "POST",
        "/imports/reqs",
        request(
          [{ ...row, id: prefix + "BAD", owner: "NO_SUCH_EMPLOYEE" }],
          true,
          "-bad-owner",
        ),
      );
      assert.equal(bad.errorCount, 1);
      assert.equal(bad.added, 0);
      await admin("GET", "/reqs/" + prefix + "BAD", undefined, 404);
    },
  );
  await check(
    "Import history persists result labels but not raw employee sensitive cells",
    async () => {
      employee = await admin("POST", "/emps", {
        id: prefix + "E",
        name: prefix + "员工",
        dept: "ORG_18",
        job: job.id,
        status: "正式",
        householdType: "城镇",
        fundAccount: "FIXQA_PRIVATE_ACCOUNT",
      });
      const saved = await admin(
        "POST",
        "/imports/emps",
        request(
          [{ id: employee.id, name: employee.name, householdType: "农村" }],
          false,
          "-sensitive",
        ),
      );
      assert.equal(saved.updated, 1, JSON.stringify(saved));
      const log = await admin("GET", "/imports/emps/logs/" + saved.importId);
      assert.equal(log.rows.length, 1);
      assert.match(log.rows[0].label, new RegExp(prefix));
      assert.ok(
        !JSON.stringify(log).includes("农村") &&
          !JSON.stringify(log).includes("FIXQA_PRIVATE_ACCOUNT"),
      );
      const normal = await admin("GET", "/emps/" + employee.id);
      assert.notEqual(normal.householdType, "农村");
      const sensitive = await admin(
        "GET",
        "/emps/" + employee.id + "/sensitive",
      );
      assert.equal(sensitive.householdType, "农村");
      assert.equal(sensitive.fundAccount, "FIXQA_PRIVATE_ACCOUNT");
      return { importId: saved.importId, employeeId: employee.id };
    },
  );
  await check(
    "Import history pagination and type isolation enforce exact records",
    async () => {
      assert.ok(imported?.importId);
      const list = await admin("GET", "/imports/reqs/logs?page=1&size=1");
      assert.equal(list.items.length, 1);
      assert.equal(list.size, 1);
      const detail = await admin(
        "GET",
        "/imports/reqs/logs/" + imported.importId,
      );
      assert.equal(detail.rows[0].action, "新增");
      assert.equal(Number(detail.added), 1);
      await admin(
        "GET",
        "/imports/assets/logs/" + imported.importId,
        undefined,
        404,
      );
      await admin("GET", "/imports/reqs/logs?page=0&size=20", undefined, 400);
      await admin("GET", "/imports/reqs/logs?page=1&size=101", undefined, 400);
    },
  );
  await check(
    "Manager cannot read company import logs or household sensitive data",
    async () => {
      await manager("GET", "/imports/reqs/logs", undefined, 403);
      await manager(
        "GET",
        "/imports/reqs/logs/" + imported.importId,
        undefined,
        403,
      );
      await manager(
        "GET",
        "/emps/" + employee.id + "/sensitive",
        undefined,
        403,
      );
      const scoped = await manager("GET", "/emps/" + employee.id);
      assert.notEqual(scoped.householdType, "农村");
    },
  );
} catch (error) {
  results.push({ name: "Setup and run", status: "FAIL", error: error.message });
}
const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  base,
  prefix,
  results,
};
await fs.mkdir(path.join(root, ".local/verification"), { recursive: true });
await fs.writeFile(
  path.join(root, ".local/verification/import-contract.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
  }),
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
