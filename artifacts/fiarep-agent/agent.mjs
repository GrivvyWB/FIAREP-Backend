#!/usr/bin/env node
// FIAREP desktop agent — lets the Command Center on your phone run a fixed
// set of things on this computer. Windows, Mac and Linux.
//
// - Outbound only: it calls the FIAREP API (long-poll); nothing connects to it.
// - It can only do what this computer's config allows: named tasks (argv, no
//   shell), listing/reading files inside listed folders, opening listed apps.
// - With trustedConfirmKeys set, anything that needs approval must carry your
//   phone's Face ID signature, checked HERE — the server alone can't approve it.
//
// Node 20+, no dependencies.
//   node agent.mjs [--config path] [--log file] [--check] [--once]
//   node agent.mjs --setup     write / update the config from FIAREP_TOKEN, FIAREP_KEYS,
//                              FIAREP_API, FIAREP_NAME (what the one-line installers run)
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, statSync, statfsSync, readdirSync, openSync, readSync, closeSync, appendFileSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";

<<<<<<< ours
const VERSION = "1.2.1";
=======
const VERSION = "1.1.0";
>>>>>>> theirs
const WIN = process.platform === "win32";
const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const CONFIG_PATH = argValue("--config") || process.env.FIAREP_AGENT_CONFIG || path.join(os.homedir(), ".fiarep-agent", "config.json");

// --log file: the agent writes its own log (Windows has no launchd/systemd to capture it). Kept under ~5 MB.
const LOG_FILE = argValue("--log");
const log = (...m) => {
  const line = [new Date().toISOString(), ...m].join(" ");
  if (!LOG_FILE) { console.log(line); return; }
  try { if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 5e6) renameSync(LOG_FILE, `${LOG_FILE}.old`); appendFileSync(LOG_FILE, line + "\n"); } catch { console.log(line); }
};
const expandHome = (p) => (typeof p === "string" && (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) ? path.join(os.homedir(), p.slice(1)) : p);
// Windows paths are case-insensitive.
const samePath = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const under = (p, root) => samePath(p, root) || (WIN ? p.toLowerCase().startsWith(root.toLowerCase() + path.sep) : p.startsWith(root + path.sep));

// ── Signatures (identical strings to the API and the phone) ────────────────
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}
const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
const confirmMessage = (j) => `FIAREP-CMD-CONFIRM\n${j.id}\n${j.action}\n${j.target}\n${sha256hex(canonicalJson(j.params))}\n${j.nonce}\n${j.expiresAt}`;
function verifyEd25519(pubB64, message, sigB64) {
  try {
    const raw = Buffer.from(pubB64, "base64"); const sig = Buffer.from(sigB64 || "", "base64");
    if (raw.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(message, "utf8"), key, sig);
  } catch { return false; }
}

// ── Config ─────────────────────────────────────────────────────────────────
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error(`No config at ${CONFIG_PATH}. Copy config.example.json there and fill in the token.`);
  const c = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (typeof c.apiBase !== "string" || !/^https?:\/\//.test(c.apiBase)) throw new Error("config.apiBase must be the API URL, e.g. https://fiarep.com/api");
  if (typeof c.token !== "string" || !c.token.startsWith("fca_")) throw new Error("config.token must be the fca_… token from Command Center → Computers → Add computer");
  const tasks = {};
  for (const [name, t] of Object.entries(c.tasks || {})) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(name)) throw new Error(`Task name "${name}": letters, numbers, - and _ only`);
    if (!Array.isArray(t.command) || !t.command.length || t.command.some((x) => typeof x !== "string")) throw new Error(`Task "${name}": command must be an array of strings (no shell)`);
    const params = {};
    for (const [p, spec] of Object.entries(t.params || {})) {
      if (!/^[a-z0-9_]{1,30}$/i.test(p) || typeof spec?.pattern !== "string") throw new Error(`Task "${name}" param "${p}" needs a pattern`);
      new RegExp(spec.pattern);
      params[p] = { description: String(spec.description || ""), pattern: spec.pattern };
    }
    tasks[name] = { description: String(t.description || name), command: t.command, cwd: t.cwd ? expandHome(t.cwd) : undefined, timeoutSec: Math.min(Math.max(Number(t.timeoutSec) || 120, 1), 3600), confirm: t.confirm !== false, params };
  }
  const folders = (c.folders || []).map(expandHome).filter((f) => { try { return statSync(f).isDirectory(); } catch { log(`folder not found, skipped: ${f}`); return false; } }).map((f) => realpathSync(f));
  return {
    apiBase: c.apiBase.replace(/\/$/, ""), token: c.token, name: String(c.name || os.hostname()),
    trustedConfirmKeys: (c.trustedConfirmKeys || []).filter((k) => typeof k === "string" && Buffer.from(k, "base64").length === 32),
    folders, apps: (c.apps || []).filter((a) => typeof a === "string"), tasks,
    relay: c.relay?.url && c.relay?.token && !/PASTE|YOUR-SUBDOMAIN/.test(c.relay.url + c.relay.token) ? { url: String(c.relay.url).replace(/\/$/, ""), token: String(c.relay.token) } : null,
    // Sites to watch. Old configs with a single watch.url keep working as "FIAREP".
    watch: {
      sites: (Array.isArray(c.watch?.sites) && c.watch.sites.length ? c.watch.sites : [{ name: "FIAREP", url: c.watch?.url || c.apiBase.replace(/\/$/, "") + "/healthz" }])
        .map((x) => ({ name: String(x.name || "Site").replace(/[^\w .-]/g, "").slice(0, 40) || "Site", url: String(x.url || "") }))
        .filter((x) => /^https?:\/\//.test(x.url)),
      everySec: Math.min(Math.max(Number(c.watch?.everySec) || 60, 15), 3600),
      failuresBeforeAlert: Math.min(Math.max(Number(c.watch?.failuresBeforeAlert) || 3, 1), 30),
    },
    republish: {
      command: Array.isArray(c.republish?.command) ? c.republish.command.map(String) : [process.execPath, path.join(path.dirname(CONFIG_PATH), "republish.mjs"), "--run"],
      timeoutSec: Math.min(Math.max(Number(c.republish?.timeoutSec) || 900, 30), 2400),
      waitUpSec: Math.min(Math.max(Number(c.republish?.waitUpSec) || 300, 30), 1800),
    },
  };
}

// ── Built-in actions ───────────────────────────────────────────────────────
function run(file, argv, opts = {}) {
  return new Promise((resolve) => {
    // Windows: npm / pnpm / yarn and other .cmd / .bat programs only start through cmd.exe.
    if (WIN && /\.(cmd|bat)$/i.test(file)) { argv = ["/d", "/s", "/c", file, ...argv]; file = process.env.ComSpec || "cmd.exe"; }
    execFile(file, argv, { timeout: opts.timeoutMs ?? 30_000, cwd: opts.cwd, maxBuffer: 4 * 1024 * 1024, env: process.env, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : -1) : 0, timedOut: !!error?.killed, stdout: String(stdout), stderr: String(stderr), spawnError: error && typeof error.code === "string" ? error.message : undefined });
    });
  });
}
const tail = (s, n = 8000) => (s.length > n ? `…${s.slice(-n)}` : s);

function insideAllowed(cfg, requested) {
  const p = expandHome(String(requested || ""));
  if (!p || !path.isAbsolute(p)) throw new Error("Give a full path (or ~/…).");
  const real = realpathSync(p); // resolves symlinks, so a link can't point outside
  if (!cfg.folders.some((root) => under(real, root))) throw new Error(`Not inside an allowed folder: ${cfg.folders.join(", ") || "(none configured)"}`);
  return real;
}

async function status(cfg) {
  let diskFreeGb = null, diskUsed = null;
  try { const f = statfsSync(os.homedir()); diskFreeGb = +((f.bavail * f.bsize) / 1e9).toFixed(1); diskUsed = `${Math.round(100 - (f.bavail / f.blocks) * 100)}%`; } catch {}
  const battery = process.platform === "darwin" ? (await run("pmset", ["-g", "batt"])).stdout.split("\n")[1]?.trim() : undefined;
  return {
    host: os.hostname(), platform: `${process.platform} ${os.release()}`, agentVersion: VERSION, uptimeHours: +(os.uptime() / 3600).toFixed(1),
    load: WIN ? undefined : os.loadavg().map((x) => +x.toFixed(2)), cpus: os.cpus().length, memoryFreeGb: +(os.freemem() / 1e9).toFixed(1), memoryTotalGb: +(os.totalmem() / 1e9).toFixed(1),
    diskFreeGb, diskUsed, battery,
    tasks: Object.keys(cfg.tasks), folders: cfg.folders, apps: cfg.apps,
  };
}

function listFolder(cfg, p) {
  const real = insideAllowed(cfg, p);
  if (!statSync(real).isDirectory()) throw new Error("That is a file, not a folder.");
  const entries = readdirSync(real, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).slice(0, 200);
  return { path: real, entries: entries.map((e) => { let size = null, modified = null; try { const s = statSync(path.join(real, e.name)); size = e.isFile() ? s.size : null; modified = s.mtime.toISOString(); } catch {} return { name: e.name, type: e.isDirectory() ? "folder" : "file", size, modified }; }) };
}

function readFile(cfg, p) {
  const real = insideAllowed(cfg, p);
  const st = statSync(real);
  if (!st.isFile()) throw new Error("Not a file.");
  const fd = openSync(real, "r"); const buf = Buffer.alloc(Math.min(st.size, 20_000));
  try { readSync(fd, buf, 0, buf.length, 0); } finally { closeSync(fd); }
  if (buf.includes(0)) throw new Error("That looks like a binary file.");
  return { path: real, size: st.size, truncated: st.size > buf.length, text: buf.toString("utf8") };
}

<<<<<<< ours
// Send a file to the phone: uploaded to FIAREP, opened from a private 24-hour link.
async function sendFile(cfg, p, jobId) {
  const real = insideAllowed(cfg, p);
  const st = statSync(real);
  if (!st.isFile()) throw new Error("That is a folder, not a file.");
  if (st.size > 25 * 1024 * 1024) throw new Error("That file is over 25 MB.");
  const res = await fetch(`${cfg.apiBase}/v1/command/agent/files?job=${encodeURIComponent(jobId)}&name=${encodeURIComponent(path.basename(real))}`, {
    method: "POST", headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/octet-stream", "user-agent": `fiarep-agent/${VERSION}` },
    body: readFileSync(real), signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (HTTP ${res.status})`);
  return { name: data.name, size: data.size, url: data.url };
}

=======
>>>>>>> theirs
// Apps are named in the config. Mac: the app's name ("Microsoft Excel").
// Windows: what you'd type in Start → Run ("excel", "winword", "outlook", "explorer", or a full path to an .exe).
// Linux: the program's command ("libreoffice", "firefox").
function launchDetached(file, argv) {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, argv, { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", (e) => resolve({ ok: false, error: e.message }));
      child.once("spawn", () => { child.unref(); resolve({ ok: true }); });
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}
async function openApp(cfg, app) {
  if (!cfg.apps.includes(app)) throw new Error(`"${app}" is not in this computer's allowed apps.`);
  if (process.platform === "darwin") { const r = await run("open", ["-a", app]); return { ok: r.exitCode === 0, app, stderr: tail(r.stderr, 1000) }; }
  // Windows: "start" finds apps registered with Windows (App Paths), like Start → Run does.
  if (WIN) {
    if (/["&|<>^%!\r\n]/.test(app)) throw new Error("App names can't contain quotes or & | < > ^ % !");
    const r = await new Promise((resolve) => execFile(process.env.ComSpec || "cmd.exe", ["/d", "/c", `start "" "${app}"`], { windowsVerbatimArguments: true, windowsHide: true, timeout: 30_000 },
      (error, _out, stderr) => resolve({ ok: !error, stderr: String(stderr || error?.message || "") })));
    return { ok: r.ok, app, stderr: tail(r.stderr, 1000) };
  }
  const r = await launchDetached(app, []);
  return { ok: r.ok, app, stderr: r.error };
}

async function runTask(cfg, name, params) {
  const task = cfg.tasks[name];
  if (!task) throw new Error(`No task "${name}" on this computer.`);
  const given = params && typeof params === "object" ? params : {};
  for (const k of Object.keys(given)) if (!task.params[k]) throw new Error(`Task "${name}" has no parameter "${k}".`);
  const values = {};
  for (const [k, spec] of Object.entries(task.params)) {
    const v = String(given[k] ?? "");
    if (!new RegExp(`^(?:${spec.pattern})$`).test(v)) throw new Error(`Parameter "${k}" must match ${spec.pattern}.`);
    values[k] = v;
  }
  const argv = task.command.map((part) => expandHome(part.replace(/\{(\w+)\}/g, (_, k) => (k in values ? values[k] : `{${k}}`))));
  const started = Date.now();
  const r = await run(argv[0], argv.slice(1), { cwd: task.cwd, timeoutMs: task.timeoutSec * 1000 });
  return { ok: r.exitCode === 0 && !r.timedOut, task: name, exitCode: r.exitCode, timedOut: r.timedOut, seconds: +((Date.now() - started) / 1000).toFixed(1), stdout: tail(r.stdout), stderr: tail(r.stderr, 4000), error: r.spawnError };
}

// ── Approval check (local) ─────────────────────────────────────────────────
const handled = new Set();
function approvalProblem(cfg, job) {
  if (handled.has(job.id)) return "Job already handled on this computer (replay).";
  // What needs approval is decided HERE too: the server's flag, or the task's own confirm setting in this config.
  const localNeeds = job.action === "desktop_run_task" ? !!cfg.tasks[job.params?.task]?.confirm : job.action === "desktop_open_app";
  if (!(job.needsConfirm || localNeeds)) return null;
  if (!cfg.trustedConfirmKeys.length) return null; // trusting the server (no keys pinned)
  if (!job.signature) return "This needs your Face ID approval, and none came with it.";
  const msg = confirmMessage(job);
  return cfg.trustedConfirmKeys.some((k) => verifyEd25519(k, msg, job.signature)) ? null : "The approval signature is not from a trusted phone.";
}

async function handle(cfg, job) {
  const problem = approvalProblem(cfg, job);
  handled.add(job.id);
  if (problem) { log(`refused ${job.action} ${job.id}: ${problem}`); return { ok: false, error: problem }; }
  log(`run ${job.action} ${JSON.stringify(job.params)}`);
  try {
    switch (job.action) {
      case "desktop_status": return { ok: true, output: await status(cfg) };
      case "desktop_list_folder": return { ok: true, output: listFolder(cfg, job.params.path) };
      case "desktop_read_file": return { ok: true, output: readFile(cfg, job.params.path) };
      case "desktop_send_file": return { ok: true, output: await sendFile(cfg, job.params.path, job.id) };
      case "desktop_open_app": { const o = await openApp(cfg, String(job.params.app)); return { ok: o.ok, output: o, error: o.ok ? undefined : "open failed" }; }
      case "desktop_run_task": { const o = await runTask(cfg, String(job.params.task), job.params.params); return { ok: o.ok, output: o, error: o.ok ? undefined : o.error || (o.timedOut ? "timed out" : `exit code ${o.exitCode}`) }; }
      default: return { ok: false, error: `This agent does not know "${job.action}".` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Loop ───────────────────────────────────────────────────────────────────
async function api(cfg, p, body, timeoutMs = 40_000) {
  const res = await fetch(`${cfg.apiBase}${p}`, { method: "POST", headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", "user-agent": `fiarep-agent/${VERSION}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

async function poll(cfg, wait) {
  const tasks = Object.entries(cfg.tasks).map(([name, t]) => ({ name, description: t.description, confirm: t.confirm, params: t.params }));
  const { jobs } = await api(cfg, "/v1/command/agent/heartbeat", { wait, info: { host: os.hostname(), platform: process.platform, version: VERSION, pinnedKeys: cfg.trustedConfirmKeys.length }, tasks, folders: cfg.folders, apps: cfg.apps });
  // Jobs run alongside the heartbeat: a long one (sending a big file) must not make the
  // computer look offline (the server counts it offline after 90 s without a heartbeat).
  const work = (jobs || []).map(async (job) => {
    const r = await handle(cfg, job);
    try { await api(cfg, `/v1/command/agent/jobs/${encodeURIComponent(job.id)}/result`, r, 20_000); } catch (e) { log(`could not report ${job.id}: ${e.message}`); }
  });
  if (!wait) await Promise.all(work);
  return (jobs || []).length;
}

// ── Outage watch + backup relay ────────────────────────────────────────────
// When fiarep.com stops answering, the Mac reports it to the backup relay (a
// Cloudflare Worker, not on Replit), your phone gets a push, you approve with
// Face ID, and the Mac republishes on Replit. The approval is checked HERE
// against your pinned phone keys; without pinned keys the relay path does nothing.
const relayHandled = new Set();
let relaySettings = { autoFix: false };

async function relayApi(cfg, method, p, body) {
  const res = await fetch(`${cfg.relay.url}${p}`, { method, headers: { authorization: `Bearer ${cfg.relay.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `relay HTTP ${res.status}`);
  return data;
}
const autoFixVerified = (cfg, s) => s?.autoFix === true && cfg.trustedConfirmKeys.some((k) => verifyEd25519(k, `FIAREP-RELAY-AUTOFIX\ntrue\n${s.time}`, s.signature));
const incidentVerified = (cfg, i) => cfg.trustedConfirmKeys.some((k) => verifyEd25519(k, confirmMessage({ id: i.id, action: i.action, target: i.target, params: { incident: i.id, kind: i.kind }, nonce: i.nonce, expiresAt: i.expiresAt }), i.signature));

// The Replit page the Mac republishes a site from, also sent to the phone as "Open Replit".
// replit.json: { "sites": { "FIAREP": { "deploymentUrl": … }, "SetupRides": { … } } } (old: top-level deploymentUrl = FIAREP)
function replitUrl(site) {
  try {
    const j = JSON.parse(readFileSync(path.join(path.dirname(CONFIG_PATH), "replit.json"), "utf8"));
    const u = j.sites?.[site]?.deploymentUrl || (site === "FIAREP" ? j.deploymentUrl : undefined);
    return /^https:\/\/replit\.com\//.test(u || "") ? u : undefined;
  } catch { return undefined; }
}
const siteNamed = (cfg, name) => cfg.watch.sites.find((x) => x.name === name) || cfg.watch.sites[0];

async function siteUp(site) {
  try { const r = await fetch(site.url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": `fiarep-agent/${VERSION}` } }); return r.ok; }
  catch { return false; }
}

async function republishAndReport(cfg, incident) {
  const site = siteNamed(cfg, incident.site || "FIAREP");
  log(`republishing ${site.name} (incident ${incident.id})`);
  try { await relayApi(cfg, "POST", `/agent/incidents/${incident.id}/start`, {}); } catch (e) { log(`relay start: ${e.message}`); }
  const [file, ...argv] = cfg.republish.command.map(expandHome);
  const r = await run(file, [...argv, "--site", site.name], { timeoutMs: cfg.republish.timeoutSec * 1000 });
  const clicked = r.exitCode === 0 && !r.timedOut;
  let up = false;
  const deadline = Date.now() + cfg.republish.waitUpSec * 1000;
  while (Date.now() < deadline) { if ((up = await siteUp(site))) break; await new Promise((res) => setTimeout(res, 10_000)); }
  const detail = up ? `${site.name} back up${clicked ? " after republish" : " (republish step failed, but the site answered)"}.` : `${clicked ? "Republished, but" : "Republish failed and"} ${site.name} is still not answering. ${tail(r.stderr || r.stdout, 300).trim()}`;
  log(detail);
  try { await relayApi(cfg, "POST", `/agent/incidents/${incident.id}/result`, { ok: up, detail }); } catch (e) { log(`relay result: ${e.message}`); }
}

async function relayLoop(cfg) {
  for (;;) {
    try {
      const state = await relayApi(cfg, "GET", "/agent/poll");
      relaySettings = state.settings || { autoFix: false };
      for (const inc of state.approved || []) {
        if (relayHandled.has(inc.id)) continue;
        relayHandled.add(inc.id);
        if (!incidentVerified(cfg, inc)) { log(`refused relay approval ${inc.id}: not signed by a pinned phone`); await relayApi(cfg, "POST", `/agent/incidents/${inc.id}/result`, { ok: false, detail: "Refused on the Mac: approval not signed by a trusted phone." }).catch(() => undefined); continue; }
        await republishAndReport(cfg, inc);
      }
    } catch (e) { log(`relay unreachable: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

async function watchLoop(cfg, site) {
  let failures = 0;
  for (;;) {
    if (await siteUp(site)) failures = 0;
    else if (++failures === cfg.watch.failuresBeforeAlert) {
      const auto = autoFixVerified(cfg, relaySettings);
      log(`${site.name} down (${failures} checks in a row) — reporting${auto ? ", auto-fix is on" : ""}`);
      try {
        const inc = await relayApi(cfg, "POST", "/agent/incidents", { site: site.name, detail: `${site.url} stopped answering (${failures} checks, ${cfg.watch.everySec}s apart).`, autoFix: auto, replitUrl: replitUrl(site.name) });
        if (auto && inc.status === "running" && !relayHandled.has(inc.id)) { relayHandled.add(inc.id); await republishAndReport(cfg, inc); }
      } catch (e) { log(`could not report outage: ${e.message}`); failures -= 1; }
    }
    await new Promise((r) => setTimeout(r, cfg.watch.everySec * 1000));
  }
}

// ── --setup: first install, or a re-run that adds phones / replaces the token ─
function setup() {
  const env = process.env;
  const home = os.homedir();
  const existing = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : null;
  const token = (env.FIAREP_TOKEN || "").trim();
  if (!existing && !token.startsWith("fca_")) throw new Error("No FIAREP_TOKEN. Copy the install line from Command Center → Computers → Add computer.");
  const keys = (env.FIAREP_KEYS || "").split(",").map((k) => k.trim()).filter((k) => Buffer.from(k, "base64").length === 32);
  const docs = ["Documents", "Desktop"].flatMap((d) => [path.join(home, d), env.OneDrive ? path.join(env.OneDrive, d) : null]).filter((d) => d && existsSync(d));
  const apps = process.platform === "darwin" ? ["Microsoft Excel", "Microsoft Word", "Microsoft Outlook", "Finder", "Safari", "Google Chrome"]
    : WIN ? ["excel", "winword", "outlook", "explorer", "msedge", "chrome"] : [];
  const cfg = existing ?? {
    apiBase: (env.FIAREP_API || "https://fiarep.com/api").replace(/\/$/, ""),
    token, name: (env.FIAREP_NAME || os.hostname()).slice(0, 60),
    trustedConfirmKeys: [],
    // The only things the Command Center can touch on this computer. Edit this file to change them.
    folders: [...new Set(docs)], apps, tasks: {},
  };
  if (existing && token.startsWith("fca_")) cfg.token = token;
  if (existing && env.FIAREP_API) cfg.apiBase = env.FIAREP_API.replace(/\/$/, "");
  cfg.trustedConfirmKeys = [...new Set([...(cfg.trustedConfirmKeys || []), ...keys])];
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  console.log(`${existing ? "Updated" : "Wrote"} ${CONFIG_PATH} · ${cfg.trustedConfirmKeys.length} phone key(s) pinned · folders: ${(cfg.folders || []).join(", ") || "none"} · apps: ${(cfg.apps || []).join(", ") || "none"}`);
}

async function main() {
  if (args.includes("--setup")) { setup(); return; }
  const cfg = loadConfig();
  if (args.includes("--check")) {
    console.log(JSON.stringify({ config: CONFIG_PATH, apiBase: cfg.apiBase, folders: cfg.folders, apps: cfg.apps, tasks: Object.fromEntries(Object.entries(cfg.tasks).map(([k, t]) => [k, { command: t.command, confirm: t.confirm, params: t.params }])), trustedConfirmKeys: cfg.trustedConfirmKeys.length }, null, 2));
    return;
  }
  if (args.includes("--once")) { log(`handled ${await poll(cfg, false)} job(s)`); return; }
  log(`FIAREP agent ${VERSION} → ${cfg.apiBase} · ${Object.keys(cfg.tasks).length} tasks · ${cfg.folders.length} folders · ${cfg.trustedConfirmKeys.length ? `${cfg.trustedConfirmKeys.length} pinned phone key(s)` : "no pinned phone keys (trusting the server for approvals)"}`);
  if (cfg.relay) {
    if (!cfg.trustedConfirmKeys.length) log("backup relay configured, but no pinned phone keys — outages will be reported, nothing will be republished.");
    log(`watching ${cfg.watch.sites.map((x) => `${x.name} (${x.url})`).join(", ")} every ${cfg.watch.everySec}s · backup relay ${cfg.relay.url}`);
    void relayLoop(cfg);
    for (const site of cfg.watch.sites) void watchLoop(cfg, site);
  }
  let backoff = 5_000;
  for (;;) {
    try { await poll(cfg, true); backoff = 5_000; }
    catch (e) {
      if (e.status === 401) {
        log(`token rejected (${e.message}) — API connection stopped. Add the computer again in Command Center → Computers and run the new install line.`);
        if (cfg.relay) return; // keep watching the site through the backup relay
        process.exit(2);
      }
      log(`API unreachable: ${e.message}; retrying in ${backoff / 1000}s`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 15_000); // short: a long wait here makes the computer look offline
    }
  }
}

main().catch((e) => { log(`fatal: ${e.message}`); process.exit(1); });
