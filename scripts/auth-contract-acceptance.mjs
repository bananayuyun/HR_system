import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Run last and alone. Only the disposable test account on 8091 is changed;
// the original password is restored in finally. No browser credential entry.
const base = "http://127.0.0.1:8091/api";
const original = process.env.HR_INITIAL_MANAGER_PASSWORD || "manager123";
const temporary = "QA-Auth-" + crypto.randomBytes(12).toString("hex");
const results = [];
let changeAttempted = false;
function client() {
  let cookie = "";
  return async (method, route, body, expected = 200) => {
    const response = await fetch(base + route, {
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
      `${method} ${route}: ${JSON.stringify(data)}`,
    );
    return data;
  };
}
const active = client(),
  stale = client();
async function login(call, password, expected = 200) {
  return call(
    "POST",
    "/auth/login",
    { username: "manager", password },
    expected,
  );
}
try {
  await login(active, original);
  await login(stale, original);
  await active(
    "POST",
    "/auth/password",
    { oldPassword: "Wrong-Current", newPassword: temporary },
    400,
  );
  await active(
    "POST",
    "/auth/password",
    { oldPassword: original, newPassword: "short" },
    400,
  );
  assert.equal((await active("GET", "/auth/me")).user.username, "manager");
  results.push({
    name: "Wrong current password and too-short replacement reject without ending the valid session",
    status: "PASS",
  });
  changeAttempted = true;
  await active("POST", "/auth/password", {
    oldPassword: original,
    newPassword: temporary,
  });
  await active("GET", "/auth/me", undefined, 401);
  await stale("GET", "/auth/me", undefined, 401);
  await login(client(), original, 401);
  const next = await login(active, temporary);
  assert.equal(next.user.role, "manager");
  results.push({
    name: "Password change invalidates current and independent old sessions; only new password logs in",
    status: "PASS",
  });
} catch (error) {
  results.push({
    name: "Password API regression",
    status: "FAIL",
    error: error.message,
  });
} finally {
  try {
    if (changeAttempted) {
      const restore = client();
      let temporaryIsActive = false;
      try {
        await login(restore, temporary);
        temporaryIsActive = true;
      } catch {
        // A response can be lost after a successful password write. Check both
        // known credentials before deciding whether restoration is required.
        await login(client(), original);
      }
      if (temporaryIsActive) {
        await restore("POST", "/auth/password", {
          oldPassword: temporary,
          newPassword: original,
        });
      }
    }
    await login(client(), original);
    if (changeAttempted) await login(client(), temporary, 401);
    results.push({
      name: "Original test account password restored and verified",
      status: "PASS",
    });
  } catch (error) {
    results.push({
      name: "RESTORE FAILED: test manager account needs recovery",
      status: "FAIL",
      error: error.message,
    });
  }
  const out = path.resolve(
    import.meta.dirname,
    "../.local/verification/auth-contract.json",
  );
  await fs.writeFile(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        base,
        browserCredentialMutation: false,
        results,
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
  }),
);
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
