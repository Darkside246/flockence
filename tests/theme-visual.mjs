import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(process.env.VISUAL_DEPS + "/package.json");
const { chromium } = require("playwright");
const origin = process.env.VISUAL_ORIGIN || "http://localhost:3000";
const output = process.env.VISUAL_OUTPUT;
const themes = (process.env.VISUAL_THEMES ? process.env.VISUAL_THEMES.split(",") : null) || ["poultry", "crystal", "aero", "heritage", "workhorse", "sol", "terra"];
const pages = [
  ["/", "dashboard"], ["/pens", "housing"], ["/batches", "flocks"],
  ["/layers", "eggs"], ["/layers/performance", "layer-performance"], ["/inventory", "inventory-feed"], ["/reports", "reports"],
  ["/settings", "appearance"], ["/farm-setup", "farm-setup"], ["/team", "team"],
  ["/operations", "daily-round"], ["/health", "health"], ["/health/treatments", "treatments"], ["/health/tests", "diagnostics"],
  ["/layers/packing", "packing"], ["/house", "house"], ["/finances", "finances"], ["/performance", "performance"],
  ["/planning", "planning"], ["/trace", "trace"], ["/account", "account"], ["/vision", "vision"], ["/cameras", "cameras"],
];
const devices = { desktop: { width: 1440, height: 1000 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };
const report = [];

async function seedDashboard() {
  const db = new URL(process.env.DATABASE_URL);
  assert.equal(db.pathname, "/flockence_visual_test");
  assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  const { PrismaClient } = require(join(process.cwd(), "node_modules", "@prisma", "client"));
  const prisma = new PrismaClient();
  try {
    const { farmId } = await prisma.user.findUniqueOrThrow({ where: { email: "desktop@visual.example.test" }, select: { farmId: true } });
    await prisma.batch.create({
      data: {
        farmId, name: "VISUAL TEST Broilers", species: "CHICKEN", productionType: "BROILER", status: "ACTIVE",
        startDate: new Date("2024-01-01"), initialChicks: 23, chickCostMinor: 0,
        mortalityEvents: { create: { date: new Date("2024-01-02"), quantity: 2 } },
      },
    });
    await prisma.batch.create({
      data: { farmId, name: "VISUAL TEST Layers", species: "CHICKEN", productionType: "LAYER", layerStage: "LAYING",
        status: "ACTIVE", startDate: new Date("2024-01-01"), initialChicks: 17, chickCostMinor: 0 },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyKeyboardSearch(page) {
  const trigger = page.getByRole("button", { name: "Search Flockence" });
  if (!await trigger.isVisible()) return;
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Flockence search" });
  const input = dialog.getByRole("textbox", { name: "Search Flockence" });
  await input.waitFor();
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await dialog.getByRole("link").last().evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Tab");
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("ArrowDown");
  assert.equal(await dialog.getByRole("link").first().evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
}

const browser = await chromium.launch();
await mkdir(output, { recursive: true });

async function snapshot(page, name) {
  await page.screenshot({ path: join(output, name + ".png"), animations: "disabled", fullPage: true, timeout: 15000 });
}

try {
  for (const [device, viewport] of Object.entries(devices)) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const email = device + "@visual.example.test";
    const password = "Flockence-V1sual!";
    const response = await context.request.post(origin + (device === "desktop" ? "/api/auth/signup" : "/api/auth/login"), {
      data: { name: "Visual Test Owner", email: device === "desktop" ? email : "desktop@visual.example.test", password, inviteCode: process.env.FARM_OWNER_SETUP_CODE },
    });
    assert.ok(response.ok(), "Could not authenticate visual test: " + await response.text());
    if (device === "desktop" && process.env.VISUAL_SEED_DASHBOARD === "true") await seedDashboard();
    const page = await context.newPage();
    for (const theme of themes) {
      // A fresh page startup exercises the real first-paint bootstrap and persisted-preference path.
      await page.goto(origin + "/settings");
      await page.locator(".theme-grid button").first().waitFor();
      const label = { poultry: "Poultry Farm", crystal: "Cyber Crystal", aero: "Aero Glass",
        heritage: "Heritage Sovereign", workhorse: "Field Workhorse", sol: "Sol Tactical", terra: "Terra Flora" }[theme];
      const choice = page.getByRole("button", { name: new RegExp(label) });
      await choice.click();
      await page.waitForFunction((id) => document.documentElement.dataset.theme === id, theme);
      assert.equal(await choice.getAttribute("aria-pressed"), "true");

      for (const [route, name] of pages) {
        const response = await page.goto(origin + route);
        assert.ok(response?.ok(), route + " returned " + response?.status());
        await page.locator("main").filter({ hasNotText: "Checking your session" }).first().waitFor({ state: "visible" });
        await page.waitForFunction((id) => document.documentElement.dataset.theme === id, theme);
        if (route === "/" && process.env.VISUAL_SEED_DASHBOARD === "true") {
          await page.locator(".pipe-col").filter({ hasText: "Live birds" }).getByText("38", { exact: true }).waitFor();
          await page.locator(".pipe-col").filter({ hasText: "Losses" }).getByText("2", { exact: true }).waitFor();
          report.push({ device, theme, route, dashboardTotals: { liveBirds: 38, losses: 2 } });
        }
        if (route === "/settings" && process.env.VISUAL_REVISION === "after" && process.env.VISUAL_SEED_DASHBOARD === "true") {
          await verifyKeyboardSearch(page);
        }
        const metrics = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          theme: document.documentElement.dataset.theme,
          photography: [...document.querySelectorAll(".theme-photo")].map((photo) => ({
            source: getComputedStyle(photo, "::before").backgroundImage,
            grade: getComputedStyle(photo, "::before").filter,
            width: Math.round(photo.getBoundingClientRect().width),
          })),
        }));
        if (process.env.VISUAL_REVISION === "after" && (route === "/" || route === "/farm-setup")) {
          assert.equal(metrics.photography.length, 1, "Missing theme photograph on " + route);
          assert.ok(metrics.photography[0].width > 100, "Photo panel collapsed on " + route);
          const expectedAsset = route === "/farm-setup" ? "poultry-housing.webp" : theme === "crystal" ? "chick-eggs.jpg" : "hen-chicks.jpg";
          assert.ok(metrics.photography[0].source.includes(expectedAsset), "Unexpected photo on " + route);
          assert.notEqual(metrics.photography[0].grade, "none");
          const asset = await context.request.get(origin + "/brand/" + expectedAsset, { maxRetries: 2 });
          assert.ok(asset.ok(), "Missing image asset: " + expectedAsset);
        }
        report.push({ device, theme, route, ...metrics, overflow: metrics.documentWidth > metrics.viewportWidth + 2 });
        await snapshot(page, device + "-" + theme + "-" + name);
      }

      if (device === "mobile") {
        const menu = page.getByRole("button", { name: /Open menu|More destinations/ }).filter({ visible: true }).first();
        if (await menu.isVisible()) {
          await menu.click();
          if (theme === "poultry" && process.env.VISUAL_REVISION === "after") {
            const widths = await page.locator('.mobile-drawer.open .drawer-links a > span:not(.nav-glyph)').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().width));
            assert.ok(widths.length > 0 && widths.every(width => width >= 80), "Mobile destination labels are constrained to icon width");
          }
          await snapshot(page, device + "-" + theme + "-navigation");
          await page.getByRole("button", { name: /Find anything/ }).filter({ visible: true }).click();
          await page.getByRole("dialog", { name: "Flockence search" }).waitFor();
          await snapshot(page, device + "-" + theme + "-search");
          await page.keyboard.press("Escape");
        } else report.push({ device, theme, finding: "Mobile drawer trigger not visible on farm setup" });
      }
      const search = page.getByRole("button", { name: "Search Flockence" });
      if (await search.isVisible()) {
        await search.click();
        await page.getByRole("dialog", { name: "Flockence search" }).waitFor();
        await snapshot(page, device + "-" + theme + "-search");
        await page.keyboard.press("Escape");
      }
    }
    await context.close();
  }
} finally {
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
