import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// Serial by design: browser memory, shared demo accounts, and settings fixtures
// must not race. Each constituent suite retains its own detailed assertions.
const root = path.resolve(import.meta.dirname, "..");
const group = process.argv[2] || "all";
const groups = {
  imports: [
    ["scripts/import-matrix-acceptance.mjs"],
    ["scripts/import-field-roundtrip.mjs"],
    ["scripts/import-alias-acceptance.mjs"],
    ["scripts/import-contract-acceptance.mjs"],
    ["scripts/csv-acceptance.mjs"],
  ],
  api: [
    ["scripts/editor-contract-acceptance.mjs"],
    ["scripts/api-acceptance.mjs"],
    ["scripts/security-acceptance.mjs"],
    ["scripts/settings-acceptance.mjs"],
    ["scripts/configuration-acceptance.mjs"],
    ["scripts/workflow-branches-acceptance.mjs"],
    ["scripts/resume-acceptance.mjs"],
  ],
  browser: [
    ["scripts/browser-acceptance.mjs"],
    ["scripts/browser-acceptance.mjs", { HR_BROWSER_ONLY: "exports" }],
    ["scripts/browser-acceptance.mjs", { HR_BROWSER_ONLY: "preferences" }],
    ["scripts/browser-acceptance.mjs", { HR_BROWSER_ONLY: "manager-detail" }],
    ["scripts/sequence-acceptance.mjs"],
    ["scripts/reminder-acceptance.mjs"],
    ["frontend/scripts/verify-docx-preview.mjs"],
    ["frontend/scripts/verify-asset-qr.mjs"],
    ["scripts/interaction-acceptance.mjs"],
    ["scripts/workflow-ui-acceptance.mjs"],
    ["scripts/module-crud-acceptance.mjs"],
  ],
  visual: [
    ["scripts/visual-acceptance.mjs"],
    ["scripts/visual-controls.mjs"],
    ["frontend/scripts/verify-dialogs.mjs"],
  ],
  formats: [
    ["scripts/legacy-format-acceptance.mjs"],
    ["scripts/legacy-doc-acceptance.mjs"],
  ],
  auth: [["scripts/auth-contract-acceptance.mjs"]],
};
if (group !== "all" && !groups[group])
  throw new Error("Unknown regression group: " + group);
const selectedSuites =
  group === "all" ? Object.values(groups).flat() : groups[group];
const excluded = (process.env.HR_REGRESSION_EXCLUDE || "")
  .split(",")
  .filter(Boolean);
const suites = selectedSuites.filter(
  ([script]) => !excluded.includes(path.basename(script, ".mjs")),
);
const out = path.join(root, ".local/verification/full-regression");
await fs.mkdir(out, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  group,
  excluded,
  results: [],
};
for (const [script, overrides = {}] of suites) {
  const name =
    path.basename(script, ".mjs") +
    (overrides.HR_BROWSER_ONLY ? "-" + overrides.HR_BROWSER_ONLY : "");
  const startedAt = new Date().toISOString();
  console.log("\nRUN " + name);
  const env = {
    ...process.env,
    HR_FRONTEND_URL: "http://127.0.0.1:5175",
    ...overrides,
  };
  delete env.HR_VISUAL_ROUTES;
  delete env.HR_RECAPTURE_PROTOTYPE;
  delete env.HR_BROWSER_TEST_PASSWORD;
  if (!overrides.HR_BROWSER_ONLY) delete env.HR_BROWSER_ONLY;
  let output = "";
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=512", path.join(root, script)],
      {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output += chunk.toString();
        process.stdout.write(chunk);
      });
    child.once("error", (error) => {
      output += error.stack;
      resolve(-1);
    });
    child.once("close", (code) => resolve(code ?? -1));
  });
  const finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, name + ".log"), output);
  report.results.push({
    name,
    script,
    startedAt,
    finishedAt,
    exitCode,
    status: exitCode === 0 ? "PASS" : "FAIL",
  });
  report.updatedAt = finishedAt;
  await fs.writeFile(
    path.join(out, group + ".json"),
    JSON.stringify(report, null, 2),
  );
}
report.finishedAt = new Date().toISOString();
report.passedSuites = report.results.filter(
  (item) => item.status === "PASS",
).length;
report.failedSuites = report.results.length - report.passedSuites;
await fs.writeFile(
  path.join(out, group + ".json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    group,
    passedSuites: report.passedSuites,
    failedSuites: report.failedSuites,
  }),
);
if (report.failedSuites) process.exitCode = 1;
