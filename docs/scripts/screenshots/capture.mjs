#!/usr/bin/env node
// Recapture every docs/landing screenshot in one format. See README.md.
//   BASE_URL=https://demo.supercheck.dev SC_EMAIL=... SC_PASSWORD=... node docs/scripts/screenshots/capture.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "./manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "../..");
// playwright is installed with the app; docs does not depend on it.
const { chromium } = createRequire(resolve(docsDir, "../app/package.json"))("playwright");

const { BASE_URL, SC_EMAIL, SC_PASSWORD, ONLY, OUT_DIR } = process.env;
if (!BASE_URL || !SC_EMAIL || !SC_PASSWORD) {
  console.error("Set BASE_URL, SC_EMAIL and SC_PASSWORD (optional: ONLY=a.png,b.png OUT_DIR=dir).");
  process.exit(2);
}
const base = BASE_URL.replace(/\/$/, "");
const outDir = resolve(OUT_DIR || join(docsDir, "public/screenshots"));
const only = ONLY ? new Set(ONLY.split(",").map((s) => s.trim().replace(/\.(png|webp)$/, ""))) : null;

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const SITE = { width: 1600, height: 1000 };

// Anything volatile that should not appear in marketing shots.
const HIDE_CSS = `
  nextjs-portal, [data-nextjs-dev-tools-button], [data-nextjs-toast], #__next-build-watcher,
  .woot-widget-bubble, .woot-widget-holder, .woot--bubble-holder, #cw-widget-holder, [class*="cw-widget"],
  [data-sonner-toaster], [data-sonner-toast], .Toastify { display: none !important; }
`;

// sharp when resolvable (docs or app), else the magick CLI.
let sharp = null;
for (const pkg of ["docs", "app"]) {
  try { sharp = createRequire(resolve(docsDir, pkg === "docs" ? "package.json" : "../app/package.json"))("sharp"); break; } catch { /* next */ }
}
async function toWebp(pngPath, webpPath) {
  if (sharp) await sharp(pngPath).resize(SITE.width, SITE.height, { fit: "fill" }).webp({ quality: 82 }).toFile(webpPath);
  else execFileSync("magick", [pngPath, "-resize", `${SITE.width}x${SITE.height}!`, "-quality", "82", webpPath]);
}

function target(page, t) {
  let loc;
  if (t.role) loc = page.getByRole(t.role, t.name !== undefined ? { name: t.name } : {});
  else if (t.text !== undefined) loc = page.getByText(t.text);
  else if (t.label !== undefined) loc = page.getByLabel(t.label);
  else if (t.placeholder !== undefined) loc = page.getByPlaceholder(t.placeholder);
  else if (t.selector) loc = page.locator(t.selector);
  else throw new Error(`bad target ${JSON.stringify(t)}`);
  return loc.nth(t.nth ?? 0);
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  // Route-level loading screens ("Loading dashboard...") must be gone before the shot.
  await page.waitForFunction(() => !/Loading[^\n]{0,40}(\.\.\.|…)/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  // Marker set by components/hydration-ready.tsx; absent on older builds, so do not fail on it.
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true", null, { timeout: 15000 }).catch(() => {});
}

async function runStep(page, step) {
  if (step.click) return target(page, step.click).click({ timeout: 15000 });
  if (step.fill) return target(page, step.fill).fill(step.fill.value, { timeout: 15000 });
  if (step.waitFor) return target(page, step.waitFor).waitFor({ state: "visible", timeout: step.waitFor.timeout ?? 15000 });
  if (step.press) return page.keyboard.press(step.press);
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

async function openLink(page, open) {
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => [a.getAttribute("href"), a.textContent || ""]));
  const hit = open.menu ? null : hrefs.find(([h, t]) =>
    h.startsWith(open.prefix) && !h.includes("create") && h.length > open.prefix.length && (!open.text || t.includes(open.text)));
  if (hit) {
    const id = hit[0].slice(open.prefix.length).split(/[/?#]/)[0];
    await page.goto(base + (open.to ? open.to.replace("{id}", id) : hit[0]), { waitUntil: "domcontentloaded" });
  } else {
    // Table rows without anchors: click the row (or its "..." menu entry when `menu` is set) and expect the URL to move.
    let row = page.locator("tbody tr");
    if (open.text) row = row.filter({ hasText: open.text });
    if (!(await row.count())) throw new Error(`no link or row ${open.prefix}* ${open.text ? `containing "${open.text}"` : ""} on page`);
    if (open.menu) {
      await row.first().locator("button").last().click({ timeout: 15000 });
      await page.getByRole("menuitem", { name: open.menu }).first().click({ timeout: 15000 });
    } else {
      await (open.text ? row.first().getByText(open.text).first() : row.first().locator("td").nth(1)).click({ timeout: 15000 });
    }
    await page.waitForURL((u) => u.pathname.startsWith(open.prefix), { timeout: 30000 });
    if (open.to) { const id = new URL(page.url()).pathname.slice(open.prefix.length).split("/")[0]; await page.goto(base + open.to.replace("{id}", id), { waitUntil: "domcontentloaded" }); }
  }
  await settle(page);
}

async function signIn(browser) {
  const ctx = await browser.newContext({ ...VIEWPORTS.desktop, colorScheme: "dark" });
  await ctx.addInitScript(() => localStorage.setItem("theme", "dark"));
  const page = await ctx.newPage();
  await page.goto(`${base}/sign-in`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await settle(page);
  await page.fill('input[name="email"]', SC_EMAIL);
  await page.fill('input[name="password"]', SC_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60000 });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

const rows = [];
const browser = await chromium.launch();
let fatal = false;
try {
  const state = await signIn(browser);
  const contexts = {};
  const ctxFor = async (kind) => {
    if (!contexts[kind]) {
      const c = await browser.newContext({ ...VIEWPORTS[kind], colorScheme: "dark", storageState: state });
      await c.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch { /* ignore */ } });
      await c.addInitScript((css) => {
        const add = () => { const s = document.createElement("style"); s.textContent = css; document.documentElement.appendChild(s); };
        document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", add) : add();
      }, HIDE_CSS);
      contexts[kind] = c;
    }
    return contexts[kind];
  };

  mkdirSync(join(outDir, "site"), { recursive: true });
  for (const e of manifest) {
    const name = e.file.replace(/\.png$/, "");
    if (only && !only.has(name)) continue;
    const row = { file: e.file, status: "", note: "" };
    rows.push(row);
    if (e.external || e.skip) { row.status = "skipped"; row.note = e.external ? `external app: ${e.external}` : e.skip; continue; }

    const page = await (await ctxFor(e.viewport || "desktop")).newPage();
    let stepNo = "goto";
    try {
      await page.goto(base + e.path, { waitUntil: "domcontentloaded", timeout: 90000 });
      await settle(page);
      if (e.open) { stepNo = "open"; await openLink(page, e.open); }
      for (const [i, step] of (e.actions || []).entries()) { stepNo = `step ${i + 1} ${JSON.stringify(step).slice(0, 90)}`; await runStep(page, step); }
      // The demo-mode "DEMO" pill (components/demo-badge.tsx) has no stable selector; hide it by text.
      await page.evaluate(() => document.querySelectorAll("header span").forEach((el) => { if (el.textContent?.trim() === "DEMO") el.parentElement.style.display = "none"; }));
      await page.waitForTimeout(500);
      const png = join(outDir, e.file);
      if (e.siteOnly) {
        const tmp = join(outDir, `.tmp-${e.file}`);
        await page.screenshot({ path: tmp, type: "png" });
        await toWebp(tmp, join(outDir, "site", `${name}.webp`));
        rmSync(tmp);
      } else {
        await page.screenshot({ path: png, type: "png" });
        if (e.site) await toWebp(png, join(outDir, "site", `${name}.webp`));
      }
      row.status = "captured";
      row.note = e.needs ? `needs: ${e.needs}` : "";
    } catch (err) {
      // A missing control usually means the demo lacks the data/permission noted in `needs`.
      row.status = e.needs ? "skipped(needs)" : "failed";
      row.note = `${stepNo}: ${String(err.message).split("\n")[0]}${e.needs ? ` | needs: ${e.needs}` : ""}`;
    } finally {
      await page.close();
    }
  }
} catch (err) {
  fatal = true;
  console.error("Unexpected error:", String(err.message).split("\n")[0]);
} finally {
  await browser.close();
}

const count = (s) => rows.filter((r) => r.status === s).length;
console.table(rows.map((r) => ({ file: r.file, status: r.status, note: r.note.slice(0, 140) })));
console.log(`captured ${count("captured")}, skipped ${count("skipped")}, skipped(needs) ${count("skipped(needs)")}, failed ${count("failed")} -> ${outDir}`);
process.exit(fatal ? 1 : 0);
