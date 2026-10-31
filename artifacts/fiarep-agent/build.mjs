#!/usr/bin/env node
// Command Center builds: "build me …" from the phone → Claude Code makes the change on this
// computer (the Mac, or the AWS server when the Mac is asleep) → typecheck → your phone gets the
// summary → "ship it" (Face ID) → commit, push to GitHub, Republish on Replit (and the phone app
// update on the Mac).
//
//   node build.mjs start "<what to build>"   starts a build in the background, prints its id
//   node build.mjs status [id|latest]        where a build is, what changed, the typecheck
//   node build.mjs ship <id>                 commit, push, Republish (agent task needs Face ID)
//   node build.mjs discard <id>              throw a build away
//
// Never touches the folder you work in: each build is its own copy (git worktree) of GitHub main.
// Settings: ~/.fiarep-agent/build.json  { "repo": "...", "standalone": "...", "claude": "claude" }
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, readdirSync, cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.FIAREP_AGENT_DIR || path.join(os.homedir(), ".fiarep-agent");
const BUILDS = path.join(DIR, "builds");
const SETTINGS = (() => { try { return JSON.parse(readFileSync(path.join(DIR, "build.json"), "utf8")); } catch { return {}; } })();
const home = (p) => (p && p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
const REPO = home(SETTINGS.repo || (process.platform === "darwin" ? "~/Desktop/FIAREP-Backend" : "~/fiarep-build-repo"));
const STANDALONE = home(SETTINGS.standalone || (process.platform === "darwin" ? "~/Desktop/fiarep-standalone" : ""));
const CLAUDE = SETTINGS.claude || "claude";
const AGENT_CFG = (() => { try { return JSON.parse(readFileSync(path.join(DIR, "config.json"), "utf8")); } catch { return {}; } })();
mkdirSync(BUILDS, { recursive: true });
// The agent runs as a background service with a bare PATH: add where node, pnpm, claude and eas live.
process.env.PATH = [path.dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".npm-global/bin"), path.join(os.homedir(), ".local/bin"), process.env.PATH || ""].join(path.delimiter);
const COMPUTER = String(AGENT_CFG.name || os.hostname());

const sh = (file, args, opts = {}) => new Promise((resolve) => {
  execFile(file, args, { cwd: opts.cwd, timeout: opts.timeoutMs ?? 600_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...(opts.env || {}) } }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, out: String(stdout), err: String(stderr) });
  });
});
const statusFile = (id) => path.join(BUILDS, id, "status.json");
const read = (id) => { try { return JSON.parse(readFileSync(statusFile(id), "utf8")); } catch { return null; } };
const write = (id, s) => { mkdirSync(path.join(BUILDS, id), { recursive: true }); writeFileSync(statusFile(id), JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2)); };
const latest = () => readdirSync(BUILDS).filter((d) => existsSync(statusFile(d))).sort().pop() || null;
const say = (o) => { console.log(JSON.stringify(o, null, 2)); };

async function tell(title, detail) {
  if (!AGENT_CFG.apiBase || !AGENT_CFG.token) return;
  await fetch(`${AGENT_CFG.apiBase.replace(/\/$/, "")}/v1/command/agent/notify`, {
    method: "POST", headers: { authorization: `Bearer ${AGENT_CFG.token}`, "content-type": "application/json" },
    body: JSON.stringify({ title, detail: detail.slice(0, 1000) }), signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined);
}

const RULES = [
  "You are changing the FIAREP monorepo (artifacts/api-server: Express + Drizzle; artifacts/fiarep-web: Vite + React; artifacts/fiarep-mobile: Expo).",
  "Do exactly what is asked and nothing extra. Keep the change as small as it can be. Match the code style around it.",
  "Everything in FIAREP is controlled by switches in Platform Control: never hide or restrict something on your own.",
  "Prices must come from FIAREP's pricing ladder or a named official source; never make one up.",
  "Do not commit, push, deploy, or touch secrets, .env files or keys. Do not delete data.",
  "When you are done, answer with 2 to 4 plain sentences: what you changed and where it shows up.",
].join("\n");

async function run(id) {
  const s = read(id);
  const wt = path.join(BUILDS, id, "repo");
  const fail = async (why, extra = {}) => { write(id, { ...read(id), ...extra, state: "failed", error: why }); await tell("Build failed", `${s.request.slice(0, 120)} — ${why}`); };
  try {
    let r = await sh("git", ["-C", REPO, "fetch", "origin", "main"], { timeoutMs: 180_000 });
    if (r.code) return fail(`git fetch: ${r.err.slice(-300)}`);
    r = await sh("git", ["-C", REPO, "worktree", "add", "-b", `cc/${id}`, wt, "origin/main"]);
    if (r.code) return fail(`worktree: ${r.err.slice(-300)}`);
    write(id, { ...read(id), step: "installing packages" });
    r = await sh("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: wt, timeoutMs: 1_200_000 });
    if (r.code) return fail(`pnpm install: ${(r.err || r.out).slice(-400)}`);
    write(id, { ...read(id), step: "Claude Code is making the change" });
    r = await sh(CLAUDE, ["-p", `${RULES}\n\nThe task:\n${s.request}`, "--permission-mode", "acceptEdits", "--output-format", "json",
      "--allowedTools", "Read,Edit,Write,Glob,Grep,Bash(npx tsc:*),Bash(pnpm run typecheck:*),Bash(git diff:*),Bash(git status:*)"], { cwd: wt, timeoutMs: 2_400_000 });
    let summary = "";
    try { summary = String(JSON.parse(r.out).result || "").trim(); } catch { summary = r.out.trim().slice(-1500); }
    if (r.code && !summary) return fail(`Claude Code: ${(r.err || r.out).slice(-400)}`);
    const changed = (await sh("git", ["status", "--porcelain"], { cwd: wt })).out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    if (!changed.length) { write(id, { ...read(id), state: "nothing", summary: summary || "No change was needed." }); await tell("Build: nothing changed", summary.slice(0, 600)); return; }
    write(id, { ...read(id), step: "typecheck" });
    const errors = [];
    for (const pkg of ["api-server", "fiarep-web", "fiarep-mobile"]) {
      if (!changed.some((f) => f.startsWith(`artifacts/${pkg}/`))) continue;
      const t = await sh("npx", ["tsc", "-p", "tsconfig.json", "--noEmit"], { cwd: path.join(wt, "artifacts", pkg), timeoutMs: 900_000 });
      // Only errors in the files this build changed (the repo has a few old ones elsewhere).
      for (const line of (t.out + t.err).split("\n")) if (/error TS/.test(line) && changed.some((f) => line.startsWith(f.replace(`artifacts/${pkg}/`, "")))) errors.push(`${pkg}/${line}`);
    }
    const diffstat = (await sh("git", ["diff", "--stat"], { cwd: wt })).out.trim();
    const done = { ...read(id), step: "", summary, changed, diffstat, typecheck: errors.length ? errors.slice(0, 30) : "clean", mobile: changed.some((f) => f.startsWith("artifacts/fiarep-mobile/")) };
    if (errors.length) { write(id, { ...done, state: "failed", error: `${errors.length} typecheck error(s) in the changed files` }); await tell("Build has typecheck errors", `${s.request.slice(0, 100)} — ${errors[0]}`); return; }
    write(id, { ...done, state: "ready" });
    await tell(`Build ready (${id})`, `${summary.slice(0, 500)}\n${changed.length} file(s). Say "ship build ${id}" to put it live, or "discard build ${id}".`);
  } catch (e) { await fail(e instanceof Error ? e.message : "build crashed"); }
}

async function ship(id) {
  const s = read(id);
  if (!s) return say({ ok: false, error: `No build ${id}.` });
  if (s.state !== "ready") return say({ ok: false, error: `Build ${id} is ${s.state}${s.error ? ` (${s.error})` : ""}; only a ready build can ship.` });
  const wt = path.join(BUILDS, id, "repo");
  const steps = [];
  let r = await sh("git", ["add", "-A"], { cwd: wt });
  r = await sh("git", ["-c", "user.name=FIAREP Command Center", "-c", "user.email=fiarep@outlook.com", "commit", "-q", "-m", `Command Center build ${id}: ${s.request.slice(0, 120)}\n\n${(s.summary || "").slice(0, 1500)}`], { cwd: wt });
  if (r.code) return say({ ok: false, error: `commit: ${r.err.slice(-300)}` });
  r = await sh("git", ["fetch", "origin", "main"], { cwd: wt, timeoutMs: 180_000 });
  r = await sh("git", ["rebase", "origin/main"], { cwd: wt, timeoutMs: 180_000 });
  if (r.code) { await sh("git", ["rebase", "--abort"], { cwd: wt }); return say({ ok: false, error: "GitHub main changed in the same place since the build; build again." }); }
  r = await sh("git", ["push", "origin", "HEAD:main"], { cwd: wt, timeoutMs: 180_000 });
  if (r.code) return say({ ok: false, error: `push: ${r.err.slice(-300)}` });
  steps.push("pushed to GitHub main");
  // Your own working folder on the Mac follows GitHub when it has nothing of its own in progress.
  if (process.platform === "darwin" && !(await sh("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: REPO })).out.trim()) {
    if (!(await sh("git", ["pull", "--ff-only", "origin", "main"], { cwd: REPO, timeoutMs: 180_000 })).code) steps.push("Mac folder updated");
  }
  const rp = await sh(process.execPath, [path.join(DIR, "republish.mjs"), "--run"], { cwd: DIR, timeoutMs: 1_200_000 });
  steps.push(rp.code ? `Republish didn't finish (${(rp.err || rp.out).trim().slice(-200)}) — press Republish in Replit` : "Republished on Replit");
  if (s.mobile) {
    if (STANDALONE && existsSync(STANDALONE)) {
      for (const f of s.changed.filter((x) => x.startsWith("artifacts/fiarep-mobile/") && !x.endsWith("/"))) {
        const rel = f.replace("artifacts/fiarep-mobile/", "");
        if (existsSync(path.join(wt, f))) cpSync(path.join(wt, f), path.join(STANDALONE, rel)); else rmSync(path.join(STANDALONE, rel), { force: true });
      }
      const eas = await sh("npx", ["eas-cli", "update", "--channel", "production", "--message", `Command Center build ${id}`, "--non-interactive"], { cwd: STANDALONE, timeoutMs: 1_200_000 });
      steps.push(eas.code ? `phone update didn't go out (${(eas.err || eas.out).trim().slice(-200)})` : "phone update sent");
    } else steps.push("phone app part waits for the Mac (eas update)");
  }
  await sh("git", ["-C", REPO, "worktree", "remove", "--force", wt]);
  write(id, { ...s, state: "shipped", shipped: steps, shippedAt: new Date().toISOString() });
  await tell(`Shipped build ${id}`, steps.join(" · "));
  say({ ok: true, id, steps });
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "start") {
  const request = String(arg || "").trim();
  if (request.length < 3) { say({ ok: false, error: "Say what to build." }); process.exit(1); }
  const t = new Date(); const id = `b${t.toISOString().replace(/\D/g, "").slice(2, 12)}${Math.random().toString(36).slice(2, 5).padEnd(3, "0")}`;
  write(id, { id, request, state: "building", step: "starting", startedAt: t.toISOString(), computer: COMPUTER });
  const out = openSync(path.join(BUILDS, id, "build.log"), "a");
  spawn(process.execPath, [process.argv[1], "_run", id], { detached: true, stdio: ["ignore", out, out] }).unref();
  say({ ok: true, id, state: "building", note: "Building in the background; your phone is told when it's ready (usually 5–20 minutes)." });
} else if (cmd === "_run") {
  await run(arg);
} else if (cmd === "status") {
  const id = !arg || arg === "latest" ? latest() : arg;
  const s = id ? read(id) : null;
  say(s ? { id, computer: s.computer, state: s.state, step: s.step, request: s.request, summary: s.summary, changed: s.changed, diffstat: s.diffstat, typecheck: s.typecheck, error: s.error, shipped: s.shipped } : { ok: false, error: "No builds yet." });
} else if (cmd === "ship") {
  await ship(String(arg || ""));
} else if (cmd === "discard") {
  const s = read(String(arg || ""));
  if (!s) { say({ ok: false, error: `No build ${arg}.` }); process.exit(1); }
  await sh("git", ["-C", REPO, "worktree", "remove", "--force", path.join(BUILDS, arg, "repo")]);
  await sh("git", ["-C", REPO, "branch", "-D", `cc/${arg}`]);
  write(arg, { ...s, state: "discarded" });
  say({ ok: true, id: arg, state: "discarded" });
} else {
  say({ ok: false, error: "Use: start \"…\" | status [id] | ship <id> | discard <id>" }); process.exit(1);
}
