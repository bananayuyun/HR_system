import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const frontend = "http://127.0.0.1:5175",
  backend = "http://127.0.0.1:8091/api";
const require = createRequire(import.meta.url),
  ExcelJS = require(path.join(root, "frontend/node_modules/exceljs"));
const { chromium } = require(
  path.join(
    process.env.HR_NODE_MODULES || path.join(root, "frontend/node_modules"),
    "playwright",
  ),
);
const metadata = JSON.parse(
  await fs.readFile(
    path.join(root, "frontend/src/config/prototype-metadata.json"),
    "utf8",
  ),
);
const prefix = "QAIMPORT" + Date.now().toString(36).toUpperCase(),
  out = path.join(root, ".local/verification");
const result = {
    name: "Employee 58-column XLSX field round-trip including household type",
    status: "PASS",
    prefix,
  },
  errors = [];
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.HR_BROWSER_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(error.message));
async function json(resource) {
  const response = await context.request.get(backend + resource);
  assert.equal(response.status(), 200);
  return response.json();
}
try {
  await page.goto(frontend + "/#/roster");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.HR_INITIAL_ADMIN_PASSWORD || "admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".v-side").waitFor();
  const db = await json("/bootstrap");
  assert.equal(db.user.role, "hr");
  assert.ok(
    db.orgs.some((row) => row.id === "ORG_ROOT" && row.name === "中数股份"),
  );
  const job = db.jobs.find(
      (row) => row.dept === "ORG_18" && row.status === "启用" && !row.deleted,
    ),
    dict = (key) =>
      db.baseSettings[key].find((row) => row.status === "启用").name;
  const grade = db.grades.find(
    (row) => row.status === "启用" && row.scope === "全部部门" && !row.deleted,
  );
  assert.ok(job && grade);
  const values = {
    sourceIndex: 88,
    id: prefix + "FIELDS",
    name: "全字段导入" + prefix,
    contractCompany: dict("contractCompany"),
    workRegion: dict("workRegion"),
    workplace: dict("workplace"),
    department: "开发部",
    job: job.id,
    identityNumber: "11010519491231002X",
    identityExpiry: "2035-01-01",
    birthday: "1949-12-31",
    sourceAge: "76",
    birthMonth: "12",
    gender: "男",
    ethnicity: "汉族",
    political: "群众",
    marital: "已婚",
    phone: "19" + String(Date.now()).slice(-9),
    entry: "2026-09-01",
    sourceTenure: "1",
    probationMonths: "3",
    regular: "2026-12-01",
    actualRegular: "2026-09-01",
    contractType: "固定期限",
    firstContractStart: "2026-09-01",
    contractYears: "3",
    contractEnd: "2029-08-31",
    grade: grade.code,
    insuranceNotes: "QAIMPORT 五险一金",
    constellation: "摩羯座",
    nativePlace: "北京市",
    householdType: "城镇",
    education: "本科",
    school: "QAIMPORT测试大学",
    major: "计算机",
    identityAddress: "QAIMPORT 身份证测试地址",
    address: "QAIMPORT 测试住址",
    email: prefix.toLowerCase() + "@example.test",
    emergency: "QAIMPORT测试联系人",
    emergencyPhone: "19900000123",
    socialStatus: "已缴纳",
    fundStatus: "已缴纳",
    materialMedical: "已提交",
    materialRegistration: "已提交",
    materialIdentity: "已提交",
    materialLeaving: "已提交",
    materialContract: "已提交",
    materialNda: "已提交",
    materialOther: "已提交",
    fundAccount: "123456789012",
    bankName: "QAIMPORT测试银行",
    bankNumber: "622200000000000019",
    titleLevel: "中级",
    titleSpecialty: "软件",
    notes: "QAIMPORT 全字段回读",
    archiveNumber: prefix + "ARCHIVE",
  };
  await page
    .locator(".w-toolbar")
    .getByRole("button", { name: /^导入/ })
    .click();
  await page
    .getByRole("menu", { name: "导入选项" })
    .getByRole("button", { name: "导入花名册", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "导入花名册", exact: true });
  const pendingDownload = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "下载导入模板", exact: true })
    .click();
  const template = await pendingDownload;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await fs.readFile(await template.path()));
  const fields = metadata.importConfig.emps.fields;
  assert.equal(fields.length, 58);
  assert.deepEqual(
    book.worksheets[0].getRow(1).values.slice(1),
    fields.map(([, label]) => label),
  );
  book.worksheets[0].addRow(fields.map(([key]) => values[key] ?? ""));
  const buffer = Buffer.from(await book.xlsx.writeBuffer()),
    fileName = prefix + "-58-fields.xlsx";
  await fs.writeFile(path.join(out, fileName), buffer);
  const pendingPreview = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/imports/emps" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.validateOnly === true,
  );
  await dialog.getByLabel("上传导入文件", { exact: true }).setInputFiles({
    name: fileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  const previewResponse = await pendingPreview;
  assert.equal(previewResponse.status(), 200);
  const preview = await previewResponse.json();
  assert.equal(preview.errorCount, 0);
  assert.equal(preview.added, 1);
  const sent = previewResponse.request().postDataJSON();
  assert.equal(sent.rows[0].householdType, "城镇");
  assert.equal(
    sent.fileHash,
    crypto.createHash("sha256").update(buffer).digest("hex"),
  );
  const pendingCommit = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/imports/emps" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.validateOnly === false,
  );
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  const committedResponse = await pendingCommit;
  assert.equal(committedResponse.status(), 200);
  const committed = await committedResponse.json();
  assert.equal(committed.added, 1);
  assert.equal(committed.errorCount, 0);
  const record = await json("/emps/" + values.id),
    sensitive = await json("/emps/" + values.id + "/sensitive"),
    restored = { ...record, ...sensitive };
  const compared = Object.entries(values).map(([key, expected]) => ({
    key,
    label: fields.find((field) => field[0] === key)?.[1],
    expected: String(expected),
    actual: restored[key] === undefined ? null : String(restored[key]),
    same: String(restored[key]) === String(expected),
  }));
  const mismatch = compared.filter((field) => !field.same);
  result.evidence = {
    fileName,
    employeeId: values.id,
    importId: committed.importId,
    sentHouseholdType: sent.rows[0].householdType,
    normalizedHouseholdType: committed.rows[0].data.householdType,
    savedHouseholdType: record.householdType ?? null,
    sensitiveHouseholdType: sensitive.householdType ?? null,
    checkedPopulatedFields: compared.length,
    mismatch,
    passedFieldKeys: compared
      .filter((field) => field.same)
      .map((field) => field.key),
  };
  assert.deepEqual(
    mismatch,
    [],
    "Import reported success but fields failed to round-trip: " +
      JSON.stringify(mismatch),
  );
} catch (error) {
  result.status = "FAIL";
  result.error = error.message;
} finally {
  await browser.close();
  const output = {
    generatedAt: new Date().toISOString(),
    target: backend,
    frontend,
    result,
    errors,
  };
  await fs.writeFile(
    path.join(out, "local-round-import-fields.json"),
    JSON.stringify(output, null, 2),
  );
  const matrixPath = path.join(out, "local-round-import.json");
  try {
    const matrix = JSON.parse(await fs.readFile(matrixPath, "utf8"));
    matrix.results = matrix.results.filter((row) => row.name !== result.name);
    matrix.results.push(result);
    matrix.passed = matrix.results.filter(
      (row) => row.status === "PASS",
    ).length;
    matrix.failed = matrix.results.filter(
      (row) => row.status === "FAIL",
    ).length;
    matrix.fieldRoundTripReport =
      ".local/verification/local-round-import-fields.json";
    await fs.writeFile(matrixPath, JSON.stringify(matrix, null, 2));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(JSON.stringify(output));
  if (result.status === "FAIL" || errors.length) process.exitCode = 1;
}
