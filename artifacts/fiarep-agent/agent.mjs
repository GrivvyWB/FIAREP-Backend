#!/usr/bin/env node
// FIAREP desktop agent — lets the Command Center on your phone run a fixed
// set of things on this computer.
//
// - Outbound only: it calls the FIAREP API (long-poll); nothing connects to it.
// - It can only do what this computer's config allows: named tasks (argv, no
//   shell), listing/reading files inside listed folders, opening listed apps.
// - With trustedConfirmKeys set, anything that needs approval must carry your
//   phone's Face ID signature, checked HERE — the server alone can't approve it.
//
// Node 20+, no dependencies.   node agent.mjs [--config path] [--check] [--once]
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync, existsSync, realpathSync, statSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "1.0.0";
const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const CONFIG_PATH = argValue("--config") || process.env.FIAREP_AGENT_CONFIG || path.join(os.homedir(), ".fiarep-agent", "config.json");

const log = (...m) => console.log(new Date().toISOString(), ...m);
const expandHome = (p) => (typeof p === "string" && (p === "~" || p.startsWith("~/")) ? path.join(os.homedir(), p.slice(1)) : p);

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
  if (typeof c.token !== "string" || !c.token.startsWith("fca_")) throw new Error("config.token must be the fca_… token from Platform Control → Command Center → Agents");
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
  };
}

// ── Built-in actions ───────────────────────────────────────────────────────
function run(file, argv, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, argv, { timeout: opts.timeoutMs ?? 30_000, cwd: opts.cwd, maxBuffer: 4 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : -1) : 0, timedOut: !!error?.killed, stdout: String(stdout), stderr: String(stderr), spawnError: error && typeof error.code === "string" ? error.message : undefined });
    });
  });
}
const tail = (s, n = 8000) => (s.length > n ? `…${s.slice(-n)}` : s);

function insideAllowed(cfg, requested) {
  const p = expandHome(String(requested || ""));
  if (!p || !path.isAbsolute(p)) throw new Error("Give a full path (or ~/…).");
  const real = realpathSync(p); // resolves symlinks, so a link can't point outside
  if (!cfg.folders.some((root) => real === root || real.startsWith(root + path.sep))) throw new Error(`Not inside an allowed folder: ${cfg.folders.join(", ") || "(none configured)"}`);
  return real;
}

async function status(cfg) {
  const df = await run("df", ["-k", os.homedir()]);
  const line = df.stdout.trim().split("\n")[1]?.split(/\s+/) || [];
  const battery = process.platform === "darwin" ? (await run("pmset", ["-g", "batt"])).stdout.split("\n")[1]?.trim() : undefined;
  return {
    host: os.hostname(), platform: `${process.platform} ${os.release()}`, agentVersion: VERSION, uptimeHours: +(os.uptime() / 3600).toFixed(1),
    load: os.loadavg().map((x) => +x.toFixed(2)), memoryFreeGb: +(os.freemem() / 1e9).toFixed(1), memoryTotalGb: +(os.totalmem() / 1e9).toFixed(1),
    diskFreeGb: line[3] ? +(Number(line[3]) / 1e6).toFixed(1) : null, diskUsed: line[4] || null, battery,
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

async function openApp(cfg, app) {
  if (!cfg.apps.includes(app)) throw new Error(`"${app}" is not in this computer's allowed apps.`);
  if (process.platform !== "darwin") throw new Error("Opening apps is only set up for macOS.");
  const r = await run("open", ["-a", app]);
  return { ok: r.exitCode === 0, app, stderr: tail(r.stderr, 1000) };
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
  await Promise.all((jobs || []).map(async (job) => {
    const r = await handle(cfg, job);
    try { await api(cfg, `/v1/command/agent/jobs/${encodeURIComponent(job.id)}/result`, r, 20_000); } catch (e) { log(`could not report ${job.id}: ${e.message}`); }
  }));
  return (jobs || []).length;
}

async function main() {
  const cfg = loadConfig();
  if (args.includes("--check")) {
    console.log(JSON.stringify({ config: CONFIG_PATH, apiBase: cfg.apiBase, folders: cfg.folders, apps: cfg.apps, tasks: Object.fromEntries(Object.entries(cfg.tasks).map(([k, t]) => [k, { command: t.command, confirm: t.confirm, params: t.params }])), trustedConfirmKeys: cfg.trustedConfirmKeys.length }, null, 2));
    return;
  }
  if (args.includes("--once")) { log(`handled ${await poll(cfg, false)} job(s)`); return; }
  log(`FIAREP agent ${VERSION} → ${cfg.apiBase} · ${Object.keys(cfg.tasks).length} tasks · ${cfg.folders.length} folders · ${cfg.trustedConfirmKeys.length ? `${cfg.trustedConfirmKeys.length} pinned phone key(s)` : "no pinned phone keys (trusting the server for approvals)"}`);
  let backoff = 5_000;
  for (;;) {
    try { await poll(cfg, true); backoff = 5_000; }
    catch (e) {
      if (e.status === 401) { log(`token rejected (${e.message}) — stopping. Create a new agent token in Platform Control.`); process.exit(2); }
      log(`API unreachable: ${e.message}; retrying in ${backoff / 1000}s`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

main().catch((e) => { log(`fatal: ${e.message}`); process.exit(1); });
