#!/usr/bin/env node
// Republishes FIAREP on Replit the way you would: open the deployment page in a
// browser on this Mac that is signed in to Replit, click Republish.
// Replit has no documented API for this, so if Replit redesigns the page the
// button text below may need updating.
//
//   node republish.mjs --login   one time: a window opens, sign in to Replit, open your
//                                 FIAREP deployment page, then close the window
//   node republish.mjs --run     what the agent runs (no window)
//   node republish.mjs --check   opens the page and finds the button, without clicking
//
// Needs Playwright in ~/.fiarep-agent (install-mac.sh installs it).
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const DIR = process.env.FIAREP_AGENT_DIR || path.join(os.homedir(), ".fiarep-agent");
const PROFILE = path.join(DIR, "replit-profile");
const CONFIG = path.join(DIR, "replit.json");
const LOGIN = /\/login|\/signup|\/auth/;

const require = createRequire(path.join(DIR, "package.json"));
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.error("Playwright is not installed in ~/.fiarep-agent — run install-mac.sh again."); process.exit(4); }

const mode = process.argv.includes("--login") ? "login" : process.argv.includes("--check") ? "check" : "run";
const fileCfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {};
// --site NAME picks one app (FIAREP, SetupRides…); each keeps its own Replit page in replit.json "sites".
const siteArg = process.argv.indexOf("--site");
const SITE = siteArg > 0 ? String(process.argv[siteArg + 1] || "FIAREP") : "FIAREP";
const cfg = { ...fileCfg, ...(fileCfg.sites?.[SITE] || {}) };
if (!fileCfg.sites?.[SITE]?.deploymentUrl && SITE !== "FIAREP") delete cfg.deploymentUrl;
mkdirSync(PROFILE, { recursive: true });

// Moving to another computer (e.g. the always-on server): copy the Replit sign-in.
//   node republish.mjs --export-session FILE   on the computer already signed in
//   node republish.mjs --import-session FILE   on the new one
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
const exportTo = argAfter("--export-session"), importFrom = argAfter("--import-session");
if (exportTo || importFrom) {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, executablePath: cfg.browserPath || undefined });
  if (exportTo) {
    const cookies = (await ctx.cookies()).filter((c) => /(^|\.)replit\.com$/.test(c.domain.replace(/^\./, "")));
    writeFileSync(exportTo, JSON.stringify({ cookies }), { mode: 0o600 });
    console.log(`Saved ${cookies.length} Replit sign-in cookies.`);
  } else {
    const keep = Math.floor(Date.now() / 1000) + 30 * 86_400; // session-only cookies would vanish when the browser closes
    const cookies = (JSON.parse(readFileSync(importFrom, "utf8")).cookies || [])
      .filter((c) => /(^|\.)replit\.com$/.test(String(c.domain).replace(/^\./, "")))
      .map((c) => (c.expires > 0 ? c : { ...c, expires: keep }));
    await ctx.addCookies(cookies);
    console.log(`Loaded ${cookies.length} Replit sign-in cookies.`);
  }
  await ctx.close();
  process.exit(0);
}

if (mode === "login") {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: null, executablePath: cfg.browserPath || undefined });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(cfg.deploymentUrl || "https://replit.com/login");
  console.log(`Sign in to Replit, open the ${SITE} Replit page (where you press Republish), then close the window.`);
  let lastUrl = page.url();
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) lastUrl = f.url(); });
  await new Promise((resolve) => ctx.on("close", resolve));
  if (/replit\.com\/.+/.test(lastUrl) && !LOGIN.test(lastUrl)) {
    const next = { ...fileCfg, sites: { ...(fileCfg.sites || {}), [SITE]: { ...(fileCfg.sites?.[SITE] || {}), deploymentUrl: lastUrl } } };
    if (SITE === "FIAREP") delete next.deploymentUrl;
    writeFileSync(CONFIG, JSON.stringify(next, null, 2));
    console.log(`Saved ${SITE} page: ${lastUrl}`);
  } else console.log("No deployment page saved — open it before closing the window next time.");
  process.exit(0);
}

if (!cfg.deploymentUrl) { console.error(`No ${SITE} page saved yet. Run: node ~/.fiarep-agent/republish.mjs --login --site ${SITE}`); process.exit(2); }
// What to click, in order. Default: just "Republish". If Replit hides it behind a tab
// (e.g. the Publishing pane in the workspace), add the tab first in ~/.fiarep-agent/replit.json:
//   "steps": ["Publishing", "Republish"]
const steps = Array.isArray(cfg.steps) && cfg.steps.length ? cfg.steps.map(String) : ["Republish"];
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SHOT = path.join(DIR, "replit-check.png");

async function find(page, label, timeout) {
  const name = new RegExp(`^\\s*${esc(label)}\\s*$`, "i");
  const candidates = [
    page.getByRole("button", { name }), page.getByRole("tab", { name }), page.getByRole("link", { name }),
    page.getByRole("menuitem", { name }), page.getByText(name),
  ];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const c of candidates) {
      const el = c.first();
      if (await el.isVisible().catch(() => false)) return el;
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

async function report(page) {
  await page.screenshot({ path: SHOT, fullPage: false }).catch(() => undefined);
  const labels = await page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll('button,[role="button"],[role="tab"],a,[role="menuitem"]')) {
      const r = el.getBoundingClientRect(); const t = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
      if (t && t.length < 40 && r.width > 0 && r.height > 0) out.add(t);
    }
    return [...out].slice(0, 60);
  }).catch(() => []);
  console.error(`Screenshot: ${SHOT}`);
  console.error(`Clickable things on the page: ${labels.join(" | ") || "(none found)"}`);
}

// Replit's security check (Cloudflare) blocks invisible browsers and may ask
// "Verify you are human". So the window is visible, and when Replit asks you to
// sign in or verify, the script waits for YOU to do it on the Mac (up to
// humanWaitSec, default 10 min), then carries on by itself.
const HUMAN_WAIT_MS = Math.min(Math.max(Number(cfg.humanWaitSec) || 600, 30), 1800) * 1000;
const CHALLENGE = /verify you are human|performing security verification|checking your browser|just a moment/i;
const BLOCKED = /you have been blocked|unable to access replit/i;

async function waitForHuman(page) {
  const deadline = Date.now() + HUMAN_WAIT_MS;
  let told = false;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const loginPage = LOGIN.test(page.url());
    if (BLOCKED.test(text)) return "blocked";
    if (!CHALLENGE.test(text) && !loginPage) {
      if (told) { console.log("Thanks — carrying on."); await page.goto(cfg.deploymentUrl, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => undefined); await page.waitForTimeout(6_000); }
      return "ok";
    }
    if (!told) {
      told = true;
      await page.bringToFront().catch(() => undefined);
      console.log(`WAITING_FOR_YOU: Replit is asking you to ${loginPage ? "sign in" : "verify you are human"} — do it in the window on the Mac (waiting up to ${Math.round(HUMAN_WAIT_MS / 60000)} min).`);
    }
    await page.waitForTimeout(2_000);
  }
  return "timeout";
}

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: cfg.headless === true, executablePath: cfg.browserPath || undefined, viewport: { width: 1440, height: 900 } });
let code = 1;
const page = ctx.pages()[0] || (await ctx.newPage());
try {
  await page.goto(cfg.deploymentUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(8_000);
  const human = await waitForHuman(page);
  if (human === "blocked") { console.error("Replit blocked this browser outright (not a check a person can pass). Republish from your phone instead."); await report(page); code = 5; }
  else if (human === "timeout") { console.error("Nobody signed in / verified in time."); await report(page); code = 3; }
  else {
    let ok = true;
    for (let i = 0; i < steps.length; i++) {
      const last = i === steps.length - 1;
      const el = await find(page, steps[i], i === 0 ? 60_000 : 30_000);
      if (!el) { console.error(`Could not find "${steps[i]}" on ${page.url()}`); await report(page); ok = false; break; }
      if (last && mode === "check") { console.log(`Found "${steps[i]}" on ${page.url()} — not clicked (check mode).`); break; }
      await el.click();
      if (!last) await page.waitForTimeout(3_000);
    }
    if (ok && mode !== "check") {
      // Replit may ask to confirm with a second button of the same name.
      const confirm = page.getByRole("dialog").getByRole("button", { name: new RegExp(`^\\s*${esc(steps[steps.length - 1])}\\s*$`, "i") }).first();
      if (await confirm.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) await confirm.click();
      await page.waitForTimeout(10_000);
      console.log(`Clicked ${steps.map((t) => `"${t}"`).join(" → ")} on ${page.url()}`);
    }
    code = ok ? 0 : 1;
  }
} catch (err) {
  console.error(`Republish failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  await report(page);
  code = 1;
} finally {
  await ctx.close().catch(() => undefined);
}
process.exit(code);
