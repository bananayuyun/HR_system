import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const frontendUrl = process.env.HR_FRONTEND_URL || "http://127.0.0.1:5180";
const require = createRequire(import.meta.url);
const modules =
  process.env.HR_NODE_MODULES || path.join(root, "frontend", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const { PNG } = require(path.join(modules, "pngjs"));
const pixelmatchModule = require(path.join(modules, "pixelmatch"));
const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const baseline = JSON.parse(
  await fs.readFile(path.join(root, ".local/prototype/state.json"), "utf8"),
);
const out = path.join(root, ".local/visual");
const selectedRoutes = process.env.HR_VISUAL_ROUTES?.split(",").filter(Boolean);
const includeRoute = (route) =>
  !selectedRoutes || selectedRoutes.includes(route);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.HR_BROWSER_PATH
    ? { executablePath: process.env.HR_BROWSER_PATH }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
// Visual tests deliberately use the exact reference dataset. Business persistence is
// separately tested against the real MySQL API by api-acceptance.mjs.
const user = {
  id: 1,
  username: "admin",
  displayName: "许 HR",
  role: "hr",
  roles: ["HR_ADMIN"],
  menus: Object.keys(baseline.routes),
  permissions: ["*"],
  dataScope: "ALL",
  managerDept: "ORG_18",
};
const fixture = structuredClone(baseline.data);
fixture.user = user;
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
fixture.baseSettings = Object.fromEntries(
  Object.entries(dictionaries).map(([k, values]) => [
    k,
    values.map((name, i) => ({ id: i + 1, name, status: "启用", aliases: [] })),
  ]),
);
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname.slice(4);
  let data;
  if (p === "/auth/me" || p === "/me") data = { user };
  else if (p.startsWith("/preferences/")) data = {};
  else if (p === "/bootstrap") data = fixture;
  else if (p.startsWith("/settings/"))
    data = fixture.baseSettings[p.split("/")[2]] || [];
  else if (
    p.match(/^\/(emps|orgs|jobs|grades|reqs|candidates|assets)\/[^/]+$/)
  ) {
    const [, type, id] = p.split("/");
    data = fixture[type].find((r) => r.id === decodeURIComponent(id));
  } else {
    requests.push({ method: route.request().method(), path: p });
    data = {};
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data || {}),
  });
});
const metrics = [];
for (const route of Object.keys(baseline.routes).filter(includeRoute)) {
  await page.goto(`${frontendUrl}/#/${route}`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const image = await page.screenshot({
    path: path.join(out, `${route}.png`),
    fullPage: true,
  });
  const reference = PNG.sync.read(
    await fs.readFile(path.join(root, ".local/prototype", `${route}.png`)),
  );
  const actual = PNG.sync.read(image);
  let difference = null;
  if (reference.width === actual.width && reference.height === actual.height) {
    const diff = new PNG({ width: actual.width, height: actual.height });
    // Ignore the top 48px: the requested account controls replace prototype role selectors.
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < actual.width; x++) {
        const p = (y * actual.width + x) * 4;
        reference.data.copy(actual.data, p, p, p + 4);
      }
    const changed = pixelmatch(
      reference.data,
      actual.data,
      diff.data,
      actual.width,
      actual.height,
      { threshold: 0.12 },
    );
    difference = Number(
      ((changed / (actual.width * (actual.height - 48))) * 100).toFixed(3),
    );
    await fs.writeFile(
      path.join(out, `${route}-diff.png`),
      PNG.sync.write(diff),
    );
  }
  const layout = await page.evaluate(() =>
    Object.fromEntries(
      [
        ".v-top",
        ".v-side",
        ".v-work",
        ".v-content",
        ".v-org",
        ".v-table-host",
        ".w-toolbar",
        ".tw",
        ".pager",
      ].map((selector) => {
        const el = document.querySelector(selector);
        const r = el?.getBoundingClientRect();
        return [
          selector,
          r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
        ];
      }),
    ),
  );
  metrics.push({
    route,
    differencePercent: difference,
    width: actual.width,
    height: actual.height,
    layout,
  });
}
const dialogs = [];
for (const route of [
  "roster",
  "jobs",
  "reqs",
  "interviews",
  "offers",
  "assets",
].filter(includeRoute)) {
  await page.goto(`${frontendUrl}/#/${route}`, {
    waitUntil: "networkidle",
  });
  await page
    .locator(".v-actions button")
    .filter({ hasText: /^查看$/ })
    .first()
    .click();
  await page.locator(".v-dialog").waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(out, route + "-detail.png"),
    fullPage: true,
  });
  dialogs.push({
    route,
    kind: "detail",
    html: await page.locator(".v-dialog").innerHTML(),
  });
}
for (const route of ["jobs", "grades", "reqs", "roster", "assets"].filter(
  includeRoute,
)) {
  await page.goto(`${frontendUrl}/#/${route}`, {
    waitUntil: "networkidle",
  });
  if (route === "assets")
    await page
      .locator(".v-actions button")
      .filter({ hasText: /^编辑$/ })
      .first()
      .click();
  else await page.getByRole("button", { name: "新增", exact: true }).click();
  await page.locator(".v-dialog").waitFor();
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(
      out,
      route + (route === "assets" ? "-edit" : "-add") + ".png",
    ),
    fullPage: true,
  });
  dialogs.push({
    route,
    kind: "form",
    html: await page.locator(".v-dialog").innerHTML(),
  });
}
if (dialogs.length)
  await fs.writeFile(
    path.join(out, "dialogs.json"),
    JSON.stringify(dialogs, null, 2),
  );
await browser.close();
const previous = selectedRoutes
  ? JSON.parse(
      await fs
        .readFile(path.join(out, "report.json"), "utf8")
        .catch(() => '{"metrics":[]}'),
    )
  : null;
const result = {
  mode: "exact prototype fixture, not persistence test",
  viewport: { width: 1440, height: 1000 },
  metrics: previous
    ? Object.keys(baseline.routes)
        .map(
          (route) =>
            metrics.find((item) => item.route === route) ||
            previous.metrics.find((item) => item.route === route),
        )
        .filter(Boolean)
    : metrics,
  errors,
  unhandledRequests: requests,
};
await fs.writeFile(
  path.join(out, "report.json"),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    {
      metrics: metrics.map(({ route, differencePercent }) => ({
        route,
        differencePercent,
      })),
      errors,
      unhandledRequests: requests,
    },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;
