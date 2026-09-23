import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, ".."),
  require = createRequire(import.meta.url);
const frontendUrl = process.env.HR_FRONTEND_URL || "http://127.0.0.1:5180";
const modules =
  process.env.HR_NODE_MODULES || path.join(root, "frontend", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const { PNG } = require(path.join(modules, "pngjs"));
const pm = require(path.join(modules, "pixelmatch")),
  pixelmatch = pm.default || pm;
const fixture = JSON.parse(
  await fs.readFile(path.join(root, ".local/prototype/state.json"), "utf8"),
);
const user = {
  username: "admin",
  displayName: "许 HR",
  role: "hr",
  roles: ["HR_ADMIN"],
  permissions: ["*"],
  menus: Object.keys(fixture.routes),
  dataScope: "ALL",
  managerDept: "ORG_18",
};
const dictionaries = {
  workRegion: ["上海", "南京"],
  workplace: ["上海", "南京", "宁波", "西安", "长沙", "郑州", "诸暨"],
  contractCompany: [
    "微间",
    "旦尺",
    "方之达",
    "佛豪斯",
    "宁波舜变",
    "青衿智创",
    "上海数寰",
    "上海有间",
    "致臻",
    "中数求索",
    "中数求索（外包）",
    "中数信息",
  ],
};
fixture.data.baseSettings = Object.fromEntries(
  Object.entries(dictionaries).map(([key, names]) => [
    key,
    names.map((name, i) => ({ id: i + 1, name, status: "启用" })),
  ]),
);
const out = path.join(root, ".local/visual/controls");
await fs.mkdir(out, { recursive: true });
// Keep the accepted prototype captures immutable during routine regression.
// Explicit recapture is only for an intentionally updated reference baseline.
const captureSource = process.env.HR_RECAPTURE_PROTOTYPE === "1";
const referenceReport = captureSource
  ? null
  : JSON.parse(await fs.readFile(path.join(out, "report.json"), "utf8"));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.HR_BROWSER_PATH
    ? { executablePath: process.env.HR_BROWSER_PATH }
    : {}),
});
const errors = [],
  results = [],
  interactions = [];
const cases = [
  {
    name: "columns",
    selector: ".w-columns",
    source: '[data-act="columns"]',
    actual: '[aria-label="列设置"]',
  },
  {
    name: "column-reset",
    selector: ".w-column-reset-dialog",
    source: '[data-act="columns"]',
    actual: '[aria-label="列设置"]',
    next: "恢复默认",
  },
  {
    name: "advanced",
    selector: ".w3-advanced",
    source: '[data-act="advancedDialog"]',
    actual: '[aria-label="高级筛选"]',
  },
  {
    name: "expanded-filters",
    source: '[data-act="advanced"]',
    actual: ".w-toggle",
  },
  {
    name: "sequences",
    route: "grades",
    selector: ".v-dialog",
    source: '[data-act="sequences"]',
    actual: 'button:has-text("管理职务序列")',
  },
  {
    name: "sequence-rename",
    route: "grades",
    selector: ".v-dialog",
    source: '[data-act="sequences"]',
    actual: 'button:has-text("管理职务序列")',
    next: "重命名",
  },
];
try {
  for (const entry of cases) {
    const shots = [];
    for (const mode of ["source", "actual"]) {
      if (mode === "source" && !captureSource) {
        const prior = referenceReport.results.find(
          (item) => item.case === entry.name,
        );
        if (!prior?.source)
          throw new Error(`Missing accepted reference bounds: ${entry.name}`);
        shots.push({
          png: PNG.sync.read(
            await fs.readFile(path.join(out, entry.name + "-source.png")),
          ),
          box: prior.source,
        });
        continue;
      }
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
      });
      page.on("pageerror", (e) =>
        errors.push({ case: entry.name, mode, error: e.message }),
      );
      if (mode === "source") {
        await page.goto(
          pathToFileURL(path.join(root, "..", "人力资源平台原型-v1.html")).href,
          {
            waitUntil: "load",
          },
        );
        await page.evaluate((route) => routeTo(route), entry.route || "jobs");
      } else {
        await page.route("**/api/**", async (route) => {
          const p = new URL(route.request().url()).pathname.slice(4);
          const data =
            p === "/auth/me"
              ? { user }
              : p === "/bootstrap"
                ? { ...fixture.data, user }
                : p === "/settings/sequences"
                  ? { items: fixture.data.sequences }
                  : {};
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(data),
          });
        });
        await page.goto(frontendUrl + "/#/" + (entry.route || "jobs"), {
          waitUntil: "networkidle",
        });
      }
      await page.evaluate(() => document.fonts.ready);
      await page.locator(entry[mode]).click();
      if (entry.next)
        await page
          .getByRole("button", { name: entry.next, exact: true })
          .first()
          .click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      const target = entry.selector ? page.locator(entry.selector) : page;
      const box = entry.selector
        ? await target.boundingBox()
        : { x: 0, y: 0, width: 1440, height: 1000 };
      const shot = await target.screenshot({
        path: path.join(out, entry.name + "-" + mode + ".png"),
      });
      shots.push({ png: PNG.sync.read(shot), box });
      if (mode === "actual" && entry.name === "expanded-filters") {
        await page.getByRole("button", { name: "下一页", exact: true }).click();
        assert.equal(
          await page.locator('.pager [aria-current="page"]').innerText(),
          "2",
        );
        const keyword = page.getByRole("textbox", {
          name: "关键词搜索",
          exact: true,
        });
        await keyword.fill("工程师");
        await keyword.press("Enter");
        assert.equal(
          await page.locator('.pager [aria-current="page"]').innerText(),
          "1",
        );
        interactions.push({
          name: "Changing list filters resets pagination to page one",
          status: "PASS",
        });
        await page.goto(frontendUrl + "/#/interviews", {
          waitUntil: "networkidle",
        });
        await page.locator('.v-content[data-page="interviews"]').waitFor();
        await page.locator('tbody input[type="checkbox"]').first().check();
        await page.waitForFunction(() =>
          document
            .querySelector(".v-current-count")
            ?.textContent.includes("已选 1 条"),
        );
        assert.match(
          await page.locator(".v-current-count").innerText(),
          /已选 1 条/,
        );
        await page
          .locator(".v-tabs")
          .getByRole("button", { name: /^复试/ })
          .click();
        assert.equal(
          (await page.locator(".v-current-count").innerText()).trim(),
          "",
        );
        interactions.push({
          name: "Changing workflow stage clears the prior selected rows",
          status: "PASS",
        });
      }
      await page.close();
    }
    const [ref, actual] = shots;
    let differencePercent = null;
    if (
      ref.png.width === actual.png.width &&
      ref.png.height === actual.png.height
    ) {
      if (!entry.selector)
        for (let y = 0; y < 48; y++)
          for (let x = 0; x < ref.png.width; x++) {
            const i = (y * ref.png.width + x) * 4;
            ref.png.data.copy(actual.png.data, i, i, i + 4);
          }
      const diff = new PNG({ width: ref.png.width, height: ref.png.height });
      const changed = pixelmatch(
        ref.png.data,
        actual.png.data,
        diff.data,
        ref.png.width,
        ref.png.height,
        { threshold: 0.12 },
      );
      differencePercent = Number(
        ((changed / (ref.png.width * ref.png.height)) * 100).toFixed(3),
      );
      await fs.writeFile(
        path.join(out, entry.name + "-diff.png"),
        PNG.sync.write(diff),
      );
    }
    results.push({
      case: entry.name,
      source: ref.box,
      actual: actual.box,
      differencePercent,
    });
  }
} finally {
  await browser.close();
}
const report = {
  mode: "exact prototype fixture; visual controls and local UI state only",
  reference: captureSource
    ? "explicitly recaptured"
    : "existing accepted prototype captures",
  results,
  interactions,
  errors,
};
await fs.writeFile(
  path.join(out, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
