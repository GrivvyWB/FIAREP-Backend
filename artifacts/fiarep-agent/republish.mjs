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
const BUTTON = /^(re-?publish|redeploy|publish)$/i;
const LOGIN = /\/login|\/signup|\/auth/;

const require = createRequire(path.join(DIR, "package.json"));
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.error("Playwright is not installed in ~/.fiarep-agent — run install-mac.sh again."); process.exit(4); }

const mode = process.argv.includes("--login") ? "login" : process.argv.includes("--check") ? "check" : "run";
const cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {};
mkdirSync(PROFILE, { recursive: true });

if (mode === "login") {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: null, executablePath: cfg.browserPath || undefined });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(cfg.deploymentUrl || "https://replit.com/login");
  console.log("Sign in to Replit, open the FIAREP deployment page (the one with the Republish button), then close the window.");
  let lastUrl = page.url();
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) lastUrl = f.url(); });
  await new Promise((resolve) => ctx.on("close", resolve));
  if (/replit\.com\/.+/.test(lastUrl) && !LOGIN.test(lastUrl)) {
    writeFileSync(CONFIG, JSON.stringify({ ...cfg, deploymentUrl: lastUrl }, null, 2));
    console.log(`Saved deployment page: ${lastUrl}`);
  } else console.log("No deployment page saved — open it before closing the window next time.");
  process.exit(0);
}

if (!cfg.deploymentUrl) { console.error("No deployment page saved yet. Run: node ~/.fiarep-agent/republish.mjs --login"); process.exit(2); }
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: cfg.headless !== false, executablePath: cfg.browserPath || undefined });
let code = 1;
try {
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(cfg.deploymentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4_000);
  if (LOGIN.test(page.url())) { console.error("Replit sign-in expired. Run: node ~/.fiarep-agent/republish.mjs --login"); code = 3; }
  else {
    const button = page.getByRole("button", { name: BUTTON }).first();
    await button.waitFor({ state: "visible", timeout: 30_000 });
    const label = (await button.innerText()).trim();
    if (mode === "check") { console.log(`Found the "${label}" button on ${page.url()} — not clicked (check mode).`); code = 0; }
    else {
      await button.click();
      // Replit may ask to confirm with a second button of the same name.
      const confirm = page.getByRole("dialog").getByRole("button", { name: BUTTON }).first();
      if (await confirm.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) await confirm.click();
      await page.waitForTimeout(10_000);
      console.log(`Clicked "${label}" on ${page.url()}`);
      code = 0;
    }
  }
} catch (err) {
  console.error(`Republish failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  code = 1;
} finally {
  await ctx.close().catch(() => undefined);
}
process.exit(code);
