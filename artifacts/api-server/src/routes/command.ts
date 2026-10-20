// FIAREP Command Center — FIAREP's own (Platform Control) and one per client.
//   Phone   /v1/command/*            signed-in administrator + an approved device key on every request
//                                    (FIAREP: Timothy / Emily Winn; a client: its administrators)
//   Agent   /v1/command/agent/*      desktop agent token (outbound only: the agent calls in, nothing calls the agent)
//   Files   /v1/command/agent-files  the agent and its Windows / Mac / Linux installers (no secrets in them)
//   Client  /v1/org/command/*        the client's own control panel: its phones, computers, switches, audit
//   Owner   /v1/platform/command/*   Platform Control: FIAREP's own, plus every client's on/off, usage and cap
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { db, organizations, staffAccounts } from "@workspace/db";
import { requireAuth, requirePlatformOwner, actorFrom } from "../middlewares/auth";
import { isFiarepAdmin } from "../lib/fiarepAdminNames";
import { rateLimit } from "../lib/rateLimit";
import { actorFromStaff } from "../lib/auth";
import { notify } from "../lib/audit";
import { commandActions, commandAgents, commandDevices, commandRuns, commandWorkOrders, type AgentTask } from "../lib/command/tables";
import { isEd25519Key, requestMessage, sha256hex, verifyEd25519 } from "../lib/command/crypto";
import { commandAuditLog, recentAudit, verifyAuditChain } from "../lib/command/audit";
import { ACTIONS, actionsFor, isPlatform } from "../lib/command/actions";
import { effectiveSwitches, getSwitches, moduleOn, saveSwitches, DEFAULT_GEMINI_MODEL, DEFAULT_MODEL, PLATFORM_TENANT, type CommandSwitches } from "../lib/command/switches";
import { callName, capProblem, confirmMessageFor, executeAction, publicAction, runCommand, runView, type ActionRow } from "../lib/command/engine";
import { monthUsage, MODEL_PRICES } from "../lib/command/usage";
import { bookingView, getSchedule, saveSchedule, staffBookings } from "../lib/command/scheduling";
import { recentConversations, residentAiOn, residentComplaint, residentView, residentWrites, staffWrites } from "../lib/command/residentChat";
import { entityRecords } from "@workspace/db";
import { checkClientKey, checkKey, clientKeyStatus, geminiKeyStatus, KEY_ENV, keyFor, keyStatus, saveClientKey, saveKey, type ClientKeyName, type KeyName } from "../lib/command/keys";
import { ONLINE_WINDOW_MS, signalResult, waitForEvent } from "../lib/command/agentBus";
import { relayUrl, syncRelayDevices } from "../lib/command/relay";
import { getReport, listReports } from "../lib/command/scopes";
import { connectMailbox, disconnectMailbox, mailStatus, presetFor } from "../lib/command/mail";
import { loadFile, MAX_FILE_BYTES, saveFile } from "../lib/command/files";
import { getLanguage, greetingFor } from "../lib/command/language";

const router: IRouter = Router();
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const tokenHash = (t: string) => sha256hex(t);
type Device = typeof commandDevices.$inferSelect;
type Agent = typeof commandAgents.$inferSelect;

// ── Who has a Command Center ───────────────────────────────────────────────
// FIAREP's own: Timothy / Emily Winn. A client's: its administrators, once the
// platform owner has switched it on for that client (off for every client until then).
async function commandAdminProblem(actor: { tenantId: string; role: string; name: string }): Promise<string | null> {
  if (isPlatform(actor.tenantId)) return isFiarepAdmin(actor) ? null : "The Command Center is for FIAREP's administrators.";
  if (actor.role !== "administrator") return "The Command Center is for your company's administrators.";
  if (!(await moduleOn(actor.tenantId))) return "The Command Center is switched off for your company.";
  return null;
}
async function requireCommandAdmin(_req: Request, res: Response, next: NextFunction) {
  const problem = await commandAdminProblem(actorFrom(res));
  if (problem) { res.status(403).json({ error: problem }); return; }
  next();
}
/** Where this phone gets approved, in words for the phone. */
const approveWhere = (tenantId: string) => isPlatform(tenantId) ? "fiarep.com → Platform Control → Command Center → Phones" : "fiarep.com → Command Center (in your menu) → Phones";

const seenSignatures = new Map<string, number>();
const SKEW_MS = 120_000;

/** Every phone request carries the device id, a timestamp and an Ed25519
 *  signature over method, path, timestamp and the exact body bytes. */
async function requireCommandDevice(req: Request, res: Response, next: NextFunction) {
  const actor = actorFrom(res);
  const switches = await effectiveSwitches(actor.tenantId);
  if (!switches.enabled) { res.status(403).json({ error: !switches.platformEnabled || !switches.moduleOn ? "The Command Center is switched off by FIAREP." : "The Command Center is switched off on your Command Center page." }); return; }
  const deviceId = str(req.header("x-command-device"), 80);
  const time = str(req.header("x-command-time"), 20);
  const sig = str(req.header("x-command-sig"), 200);
  if (!deviceId || !time || !sig) { res.status(401).json({ error: "This phone is not set up for the Command Center.", code: "device_required" }); return; }
  if (!/^\d{10,16}$/.test(time) || Math.abs(Date.now() - Number(time)) > SKEW_MS) { res.status(401).json({ error: "The phone's clock is off, or the request is stale.", code: "stale" }); return; }
  const [device] = await db.select().from(commandDevices).where(eq(commandDevices.id, deviceId)).limit(1);
  if (!device || device.staffId !== actor.id || device.tenantId !== actor.tenantId) { res.status(401).json({ error: "Unknown device.", code: "device_unknown" }); return; }
  if (device.status !== "active") { res.status(403).json({ error: device.status === "pending" ? `Waiting for approval on ${approveWhere(actor.tenantId)}.` : "This device was revoked.", code: `device_${device.status}` }); return; }
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const message = requestMessage(req.method, req.originalUrl, time, sha256hex(raw ?? Buffer.alloc(0)));
  if (!verifyEd25519(device.deviceKey, message, sig)) { res.status(401).json({ error: "Device signature did not verify.", code: "bad_signature" }); return; }
  const now = Date.now();
  if (seenSignatures.has(sig)) { res.status(401).json({ error: "Replayed request.", code: "replay" }); return; }
  seenSignatures.set(sig, now);
  if (seenSignatures.size > 5000) for (const [k, at] of seenSignatures) if (now - at > SKEW_MS * 2) seenSignatures.delete(k);
  if (!device.lastUsedAt || now - device.lastUsedAt.getTime() > 60_000) {
    await db.update(commandDevices).set({ lastUsedAt: new Date() }).where(eq(commandDevices.id, device.id));
  }
  res.locals["commandDevice"] = device;
  next();
}

const phone = [requireAuth, requireCommandAdmin, rateLimit("command", 60, (_req, res) => actorFrom(res).id)];
const device = (res: Response) => res.locals["commandDevice"] as Device;

router.post("/v1/command/devices/enroll", ...phone, async (req, res) => {
  const actor = actorFrom(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const name = str(b["name"], 80) || "Phone";
  const deviceKey = str(b["deviceKey"], 100);
  const confirmKey = str(b["confirmKey"], 100);
  if (!isEd25519Key(deviceKey) || !isEd25519Key(confirmKey) || deviceKey === confirmKey) { res.status(400).json({ error: "Two different Ed25519 public keys are required." }); return; }
  // Proof that the phone holds both private keys.
  const proofMessage = `FIAREP-CMD-ENROLL\n${actor.id}\n${deviceKey}\n${confirmKey}`;
  if (!verifyEd25519(deviceKey, proofMessage, str(b["deviceProof"], 200)) || !verifyEd25519(confirmKey, proofMessage, str(b["confirmProof"], 200))) {
    res.status(400).json({ error: "Key proof did not verify." }); return;
  }
  const pending = await db.select({ id: commandDevices.id }).from(commandDevices).where(and(eq(commandDevices.staffId, actor.id), eq(commandDevices.status, "pending")));
  if (pending.length >= 3) { res.status(429).json({ error: `Three phones are already waiting for approval on ${approveWhere(actor.tenantId)}.` }); return; }
  const id = randomUUID();
  await db.insert(commandDevices).values({ id, tenantId: actor.tenantId, staffId: actor.id, staffName: actor.name, name, deviceKey, confirmKey, status: "pending" });
  await commandAuditLog({ tenantId: actor.tenantId, actor: actor.name, event: "device.enrolled", deviceId: id, detail: { name } });
  res.status(201).json({ id, status: "pending", approveWhere: approveWhere(actor.tenantId) });
});

router.get("/v1/command/devices/:id/status", ...phone, async (req, res) => {
  const [d] = await db.select().from(commandDevices).where(eq(commandDevices.id, String(req.params["id"]))).limit(1);
  if (!d || d.staffId !== actorFrom(res).id) { res.status(404).json({ error: "Unknown device" }); return; }
  // What the Command Center says when it opens, to the person by name.
  // In their language; on a client's first use it asks which language they want. languageCode: what the phone listens for ("" = any).
  const lang = await getLanguage(d.tenantId, d.staffId);
  const greeting = greetingFor(lang, callName(d.staffName || actorFrom(res).name, isPlatform(d.tenantId)));
  res.json({ id: d.id, status: d.status, name: d.name, approveWhere: approveWhere(d.tenantId), platform: isPlatform(d.tenantId), greeting, language: lang?.language ?? null, languageCode: lang?.code ?? "" });
});

router.post("/v1/command/runs", ...phone, requireCommandDevice, async (req, res) => {
  const actor = actorFrom(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const text = str(b["text"], 2000);
  if (!text) { res.status(400).json({ error: "Say or type a command." }); return; }
  try {
    res.json(await runCommand({ text, threadId: str(b["threadId"], 64) || undefined, staffId: actor.id, tenantId: actor.tenantId, deviceId: device(res).id, actorName: actor.name }));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    res.status(status).json({ error: err instanceof Error ? err.message : "Command failed" });
  }
});

router.get("/v1/command/runs", ...phone, requireCommandDevice, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query["limit"]) || 20));
  const runs = await db.select({ id: commandRuns.id }).from(commandRuns).where(eq(commandRuns.staffId, actorFrom(res).id)).orderBy(desc(commandRuns.createdAt)).limit(limit);
  res.json((await Promise.all(runs.map((r) => runView(r.id)))).filter(Boolean));
});

router.get("/v1/command/actions/pending", ...phone, requireCommandDevice, async (_req, res) => {
  const rows = await db.select().from(commandActions).where(and(eq(commandActions.staffId, actorFrom(res).id), eq(commandActions.status, "proposed"))).orderBy(asc(commandActions.createdAt));
  res.json(rows.filter((r) => r.expiresAt.getTime() > Date.now()).map(publicAction));
});

router.get("/v1/command/actions/:id", ...phone, requireCommandDevice, async (req, res) => {
  const [row] = await db.select().from(commandActions).where(eq(commandActions.id, String(req.params["id"]))).limit(1);
  if (!row || row.staffId !== actorFrom(res).id) { res.status(404).json({ error: "Not found" }); return; }
  res.json(publicAction(row));
});

router.post("/v1/command/actions/:id/confirm", ...phone, requireCommandDevice, async (req, res) => {
  const actor = actorFrom(res);
  const d = device(res);
  const [row] = await db.select().from(commandActions).where(eq(commandActions.id, String(req.params["id"]))).limit(1);
  if (!row || row.staffId !== actor.id) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status !== "proposed") { res.status(409).json({ error: `Already ${row.status}.` }); return; }
  if (row.expiresAt.getTime() < Date.now()) { res.status(410).json({ error: "This approval expired. Ask again." }); return; }
  const signature = str((req.body as Record<string, unknown> | undefined)?.["signature"], 200);
  if (!verifyEd25519(d.confirmKey, confirmMessageFor(row), signature)) {
    await commandAuditLog({ tenantId: actor.tenantId, actor: actor.name, event: "action.confirm_rejected", deviceId: d.id, runId: row.runId, actionId: row.id, detail: { reason: "bad signature" } });
    res.status(401).json({ error: "Face ID signature did not verify." }); return;
  }
  const [claimed] = await db.update(commandActions).set({ status: "approved", signature, confirmedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(commandActions.id, row.id), eq(commandActions.status, "proposed"))).returning();
  if (!claimed) { res.status(409).json({ error: "Already handled." }); return; }
  await commandAuditLog({ tenantId: actor.tenantId, actor: actor.name, event: "action.approved", deviceId: d.id, runId: row.runId, actionId: row.id, detail: { action: row.action, params: row.params, signature } });
  const done = await executeAction(claimed, actor.name);
  res.json(publicAction(done));
});

router.post("/v1/command/actions/:id/deny", ...phone, requireCommandDevice, async (req, res) => {
  const actor = actorFrom(res);
  const [row] = await db.update(commandActions).set({ status: "denied", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(commandActions.id, String(req.params["id"])), eq(commandActions.staffId, actor.id), eq(commandActions.status, "proposed"))).returning();
  if (!row) { res.status(404).json({ error: "Nothing to deny." }); return; }
  await commandAuditLog({ tenantId: actor.tenantId, actor: actor.name, event: "action.denied", deviceId: device(res).id, runId: row.runId, actionId: row.id, detail: { action: row.action } });
  res.json(publicAction(row));
});

// The backup relay's address, cached on the phone for when fiarep.com is down.
// FIAREP's own phones only: the relay is for republishing FIAREP's servers.
router.get("/v1/command/relay", ...phone, requireCommandDevice, async (_req, res) => {
  res.json({ url: isPlatform(device(res).tenantId) ? relayUrl() : null });
});

const workOrdersWhere = (tenantId: string, status: string) => and(
  isPlatform(tenantId) ? undefined : eq(commandWorkOrders.tenantId, tenantId),
  status === "any" ? undefined : eq(commandWorkOrders.status, status));

router.get("/v1/command/work-orders", ...phone, requireCommandDevice, async (req, res) => {
  const status = str(req.query["status"], 20) || "draft";
  res.json(await db.select().from(commandWorkOrders).where(workOrdersWhere(actorFrom(res).tenantId, status)).orderBy(desc(commandWorkOrders.createdAt)).limit(200));
});

router.get("/v1/command/audit", ...phone, requireCommandDevice, async (req, res) => {
  res.json(await recentAudit(Number(req.query["limit"]) || 50, actorFrom(res).tenantId));
});

// ── Agent files: the agent and its installers, for any computer ────────────
// Served from the API so a client installs with one line from their control
// panel. Nothing secret is in them; the token comes with the install line.
const AGENT_FILES: Record<string, string> = {
  "agent.mjs": "text/javascript; charset=utf-8",
  "install.sh": "text/x-shellscript; charset=utf-8",
  "install.ps1": "text/plain; charset=utf-8",
};
function agentFile(name: string): string | null {
  for (const base of ["./agent-files/", "../agent-files/", "../../fiarep-agent/", "../../../fiarep-agent/"]) {
    const file = fileURLToPath(new URL(base + name, import.meta.url));
    if (existsSync(file)) return file;
  }
  return null;
}
router.get("/v1/command/agent-files/:file", (req, res) => {
  const name = String(req.params["file"]);
  const type = AGENT_FILES[name];
  const file = type ? agentFile(name) : null;
  if (!type || !file) { res.status(404).json({ error: "Not found" }); return; }
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.send(readFileSync(file, "utf8"));
});

/** The API address as the browser reached it (fiarep.com/api in production). */
function publicApiBase(req: Request): string {
  const host = String(req.get("x-forwarded-host") || req.get("host") || "fiarep.com").split(",")[0]!.trim();
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
  const proto = local ? (String(req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0]!.trim()) : "https";
  return `${proto}://${host}/api`;
}
/** One line per operating system that installs the agent with this token and pins these phones' Face ID keys. */
function installLines(apiBase: string, token: string | null, confirmKeys: string[]) {
  const keys = confirmKeys.join(",");
  const files = `${apiBase}/v1/command/agent-files`;
  const env = (sep: string, set: (k: string, v: string) => string) => [token ? set("FIAREP_TOKEN", token) : null, set("FIAREP_KEYS", keys), set("FIAREP_API", apiBase)].filter(Boolean).join(sep);
  return {
    windows: `${env("; ", (k, v) => `$env:${k}='${v}'`)}; irm ${files}/install.ps1 | iex`,
    mac: `curl -fsSL ${files}/install.sh | ${env(" ", (k, v) => `${k}='${v}'`)} bash`,
    linux: `curl -fsSL ${files}/install.sh | ${env(" ", (k, v) => `${k}='${v}'`)} bash`,
  };
}
const activeConfirmKeys = async (tenantId: string) =>
  (await db.select({ k: commandDevices.confirmKey }).from(commandDevices).where(and(eq(commandDevices.tenantId, tenantId), eq(commandDevices.status, "active")))).map((r) => r.k);

// ── Desktop agent ──────────────────────────────────────────────────────────
async function requireAgent(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith("fca_")) { res.status(401).json({ error: "Agent token required" }); return; }
  const [agent] = await db.select().from(commandAgents).where(and(eq(commandAgents.tokenHash, tokenHash(token)), eq(commandAgents.status, "active"), isNull(commandAgents.revokedAt))).limit(1);
  if (!agent) { res.status(401).json({ error: "Agent token is not valid (revoked?)" }); return; }
  res.locals["agent"] = agent;
  next();
}

function cleanTasks(value: unknown): AgentTask[] {
  if (!Array.isArray(value)) return [];
  const out: AgentTask[] = [];
  for (const t of value.slice(0, 50)) {
    if (!t || typeof t !== "object") continue;
    const x = t as Record<string, unknown>;
    const name = str(x["name"], 40);
    if (!/^[a-z0-9_-]{1,40}$/i.test(name)) continue;
    const params: AgentTask["params"] = {};
    const raw = x["params"] && typeof x["params"] === "object" ? (x["params"] as Record<string, unknown>) : {};
    let ok = true;
    for (const [k, v] of Object.entries(raw).slice(0, 10)) {
      const spec = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      const pattern = str(spec["pattern"], 200);
      try { new RegExp(pattern); } catch { ok = false; }
      if (!/^[a-z0-9_]{1,30}$/i.test(k) || !pattern) ok = false;
      params[k] = { description: str(spec["description"], 200), pattern };
    }
    if (ok) out.push({ name, description: str(x["description"], 300), confirm: x["confirm"] !== false, params });
  }
  return out;
}

async function claimJobs(agentId: string) {
  const queued = await db.select({ id: commandActions.id }).from(commandActions).where(and(eq(commandActions.target, agentId), eq(commandActions.status, "queued"))).limit(5);
  if (!queued.length) return [];
  return db.update(commandActions).set({ status: "running", updatedAt: new Date() })
    .where(and(inArray(commandActions.id, queued.map((q) => q.id)), eq(commandActions.status, "queued"))).returning();
}

const jobView = (a: ActionRow) => ({ id: a.id, action: a.action, params: a.params, target: a.target, nonce: a.nonce, expiresAt: a.expiresAt.getTime(), needsConfirm: a.needsConfirm, signature: a.signature });

router.post("/v1/command/agent/heartbeat", rateLimit("command-agent", 120), requireAgent, async (req, res) => {
  const agent = res.locals["agent"] as Agent;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const rawInfo = b["info"] && typeof b["info"] === "object" && !Array.isArray(b["info"]) ? (b["info"] as Record<string, unknown>) : {};
  const info = JSON.stringify(rawInfo).length <= 4000 ? rawInfo : { truncated: true };
  const folders = Array.isArray(b["folders"]) ? b["folders"].map((f) => str(f, 300)).filter(Boolean).slice(0, 20) : [];
  const apps = Array.isArray(b["apps"]) ? b["apps"].map((f) => str(f, 120)).filter(Boolean).slice(0, 50) : [];
  await db.update(commandAgents).set({ info, tasks: cleanTasks(b["tasks"]), folders, apps, lastSeenAt: new Date() }).where(eq(commandAgents.id, agent.id));
  let jobs = await claimJobs(agent.id);
  if (!jobs.length && b["wait"] === true) {
    await waitForEvent(`agent:${agent.id}`, 25_000);
    jobs = await claimJobs(agent.id);
    await db.update(commandAgents).set({ lastSeenAt: new Date() }).where(eq(commandAgents.id, agent.id));
  }
  res.json({ jobs: jobs.map(jobView) });
});

async function pushToStaff(staffId: string, message: string, detail: string) {
  const [staff] = await db.select().from(staffAccounts).where(eq(staffAccounts.id, staffId)).limit(1);
  if (staff) await notify(actorFromStaff(staff), staff.id, message, detail).catch(() => undefined);
}

router.post("/v1/command/agent/jobs/:id/result", requireAgent, async (req, res) => {
  const agent = res.locals["agent"] as Agent;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const ok = b["ok"] === true;
  const output = b["output"] ?? null;
  const json = JSON.stringify(output);
  const result = json.length > 60_000 ? { truncated: true, preview: json.slice(0, 60_000) } : output;
  const [row] = await db.update(commandActions).set({
    status: ok ? "done" : "failed", result: result as never, error: ok ? null : str(b["error"], 1000) || "Failed on the computer", finishedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(commandActions.id, String(req.params["id"])), eq(commandActions.target, agent.id), eq(commandActions.status, "running"))).returning();
  if (!row) { res.status(404).json({ error: "No running job with that id for this agent" }); return; }
  await commandAuditLog({ tenantId: agent.tenantId, actor: `agent:${agent.name}`, event: ok ? "action.done" : "action.failed", deviceId: row.deviceId, runId: row.runId, actionId: row.id, detail: { action: row.action, result: json.slice(0, 2000), error: row.error } });
  signalResult(row.id);
  if (row.risk === "write") {
    const view = publicAction(row);
    void pushToStaff(row.staffId, ok ? `Done on ${agent.name}: ${row.summary}` : `Failed on ${agent.name}: ${row.summary}`, view.spoken ?? row.error ?? "");
  }
  res.json({ ok: true });
});

// A file the computer sends to the phone (desktop_send_file): the raw bytes come up here,
// the phone opens them from the private link in the result (24 hours).
router.post("/v1/command/agent/files", rateLimit("command-agent-files", 30), requireAgent, async (req, res) => {
  const agent = res.locals["agent"] as Agent;
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) { res.status(400).json({ error: "No file" }); return; }
  if (body.length > MAX_FILE_BYTES) { res.status(413).json({ error: "Over 25 MB" }); return; }
  const [job] = await db.select().from(commandActions).where(and(eq(commandActions.id, str(req.query["job"], 80)), eq(commandActions.target, agent.id), eq(commandActions.status, "running"), eq(commandActions.action, "desktop_send_file"))).limit(1);
  if (!job) { res.status(404).json({ error: "No running send-file job with that id for this agent" }); return; }
  const f = await saveFile({ tenantId: agent.tenantId, agentId: agent.id, actionId: job.id, name: str(req.query["name"], 200) || "file", data: body });
  res.json({ name: f.name, size: f.size, url: `${publicApiBase(req)}/v1/command/files/${f.id}?k=${f.key}` });
});

router.get("/v1/command/files/:id", async (req, res) => {
  const f = await loadFile(String(req.params["id"]), str(req.query["k"], 100));
  if (!f) { res.status(404).type("text/plain").send("This link has expired. Ask the Command Center for the file again."); return; }
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Content-Disposition", `inline; filename="${f.name.replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(f.data);
});

// ── Shared by Platform Control and each client's control panel ─────────────
const actionMeta = (tenantId: string) => actionsFor(tenantId).map((a) => ({ name: a.name, label: a.label, risk: a.risk, confirmDefault: a.confirmDefault, target: a.target }));
const deviceMeta = (d: Device) => ({ id: d.id, name: d.name, staffName: d.staffName, status: d.status, confirmKey: d.confirmKey, createdAt: d.createdAt, approvedAt: d.approvedAt, approvedBy: d.approvedBy, lastUsedAt: d.lastUsedAt });
const agentMeta = (a: Agent) => ({ id: a.id, name: a.name, status: a.status, online: a.status === "active" && !!a.lastSeenAt && Date.now() - a.lastSeenAt.getTime() < ONLINE_WINDOW_MS, lastSeenAt: a.lastSeenAt, info: a.info, tasks: a.tasks, folders: a.folders, apps: a.apps, createdAt: a.createdAt });
const bools = (v: unknown, tenantId: string) => Object.fromEntries(Object.entries(v && typeof v === "object" ? (v as Record<string, unknown>) : {})
  .filter(([k, x]) => actionsFor(tenantId).some((a) => a.name === k) && typeof x === "boolean")) as Record<string, boolean>;

async function decideDevice(tenantId: string | null, id: string, decision: string, by: string) {
  const now = new Date();
  const [row] = await db.update(commandDevices)
    .set(decision === "approve" ? { status: "active", approvedAt: now, approvedBy: by } : { status: "revoked", revokedAt: now })
    .where(and(eq(commandDevices.id, id), tenantId ? eq(commandDevices.tenantId, tenantId) : undefined, decision === "approve" ? eq(commandDevices.status, "pending") : undefined)).returning();
  if (!row) return null;
  await commandAuditLog({ tenantId: row.tenantId, actor: by, event: `device.${decision === "approve" ? "approved" : "revoked"}`, deviceId: id, detail: { name: row.name, staffName: row.staffName } });
  const relay = isPlatform(row.tenantId) ? await syncRelayDevices() : { ok: true as const, error: undefined };
  return { id: row.id, status: row.status, relaySynced: relay.ok, relayError: relay.error };
}

async function createAgent(req: Request, tenantId: string, by: string) {
  const name = str((req.body as Record<string, unknown> | undefined)?.["name"], 60);
  if (!/^[\w .'-]{2,60}$/.test(name)) return { error: "Give the computer a short name (letters, numbers, spaces)." };
  const token = `fca_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  await db.insert(commandAgents).values({ id, tenantId, name, tokenHash: tokenHash(token), status: "active", createdBy: by });
  await commandAuditLog({ tenantId, actor: by, event: "agent.created", detail: { id, name } });
  return { id, name, token, install: installLines(publicApiBase(req), token, await activeConfirmKeys(tenantId)) };
}

async function revokeAgent(tenantId: string | null, id: string, by: string) {
  const [row] = await db.update(commandAgents).set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(commandAgents.id, id), tenantId ? eq(commandAgents.tenantId, tenantId) : undefined)).returning();
  if (!row) return null;
  await db.update(commandActions).set({ status: "failed", error: "Agent revoked", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(commandActions.target, row.id), inArray(commandActions.status, ["queued", "running"])));
  await commandAuditLog({ tenantId: row.tenantId, actor: by, event: "agent.revoked", detail: { id: row.id, name: row.name } });
  return { id: row.id, status: row.status };
}

/** Take a revoked computer off the list (only once revoked; its audit entries stay). */
async function removeAgent(tenantId: string | null, id: string, by: string) {
  const [row] = await db.delete(commandAgents)
    .where(and(eq(commandAgents.id, id), eq(commandAgents.status, "revoked"), tenantId ? eq(commandAgents.tenantId, tenantId) : undefined)).returning();
  if (!row) return null;
  await commandAuditLog({ tenantId: row.tenantId, actor: by, event: "agent.removed", detail: { id: row.id, name: row.name } });
  return { id: row.id, removed: true };
}

// ── Platform Control ───────────────────────────────────────────────────────
router.use("/v1/platform/command", requirePlatformOwner);
const ownerName = (res: Response) => (res.locals["platformOwner"] as { name: string }).name;

router.get("/v1/platform/command", async (req, res) => {
  const [switches, devices, agents, chain, orgs, usage, clientDevices, clientAgents, gemKey, mapsKey, schedule] = await Promise.all([
    getSwitches(PLATFORM_TENANT),
    db.select().from(commandDevices).where(eq(commandDevices.tenantId, PLATFORM_TENANT)).orderBy(desc(commandDevices.createdAt)),
    db.select().from(commandAgents).where(eq(commandAgents.tenantId, PLATFORM_TENANT)).orderBy(desc(commandAgents.createdAt)),
    verifyAuditChain(),
    db.select({ id: organizations.id, name: organizations.name, status: organizations.status, features: organizations.features }).from(organizations).where(ne(organizations.id, PLATFORM_TENANT)).orderBy(asc(organizations.name)),
    monthUsage(),
    db.select({ tenantId: commandDevices.tenantId, status: commandDevices.status }).from(commandDevices).where(ne(commandDevices.tenantId, PLATFORM_TENANT)),
    db.select().from(commandAgents).where(and(ne(commandAgents.tenantId, PLATFORM_TENANT), eq(commandAgents.status, "active"))),
    geminiKeyStatus(),
    keyStatus("googleMaps"),
    getSchedule(PLATFORM_TENANT),
  ]);
  const usageOf = new Map(usage.map((u) => [u.tenantId, u]));
  res.json({
    switches, defaultModel: DEFAULT_MODEL, defaultGeminiModel: DEFAULT_GEMINI_MODEL, geminiKeyConfigured: gemKey.set, geminiKey: gemKey, mapsKey, schedule, prices: MODEL_PRICES, relay: { url: relayUrl(), serverTokenSet: Boolean(process.env["RELAY_SERVER_TOKEN"]) }, claudeKeyConfigured: Boolean(process.env["ANTHROPIC_API_KEY"]), voiceKeyConfigured: Boolean(process.env["OPENAI_API_KEY"]),
    actions: actionMeta(PLATFORM_TENANT),
    devices: devices.map(deviceMeta),
    agents: agents.map(agentMeta),
    install: installLines(publicApiBase(req), null, devices.filter((d) => d.status === "active").map((d) => d.confirmKey)),
    usage: usageOf.get(PLATFORM_TENANT) ?? null,
    clients: orgs.map((o) => {
      const modules = o.features && typeof o.features === "object" ? (o.features as Record<string, unknown>)["modules"] : null;
      const on = !!(modules && typeof modules === "object" && (modules as Record<string, unknown>)["command-center"] === true);
      const mine = clientDevices.filter((d) => d.tenantId === o.id);
      const comps = clientAgents.filter((a) => a.tenantId === o.id);
      return {
        id: o.id, name: o.name, status: o.status, on, cap: switches.caps?.[o.id] ?? null, usage: usageOf.get(o.id) ?? null, paysOwn: switches.ownKeys?.[o.id] === true,
        phones: { active: mine.filter((d) => d.status === "active").length, pending: mine.filter((d) => d.status === "pending").length },
        computers: { total: comps.length, online: comps.filter((a) => agentMeta(a).online).length },
      };
    }),
    audit: chain,
  });
});

router.put("/v1/platform/command/switches", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const before = await getSwitches(PLATFORM_TENANT);
  const next: CommandSwitches = {
    enabled: typeof b["enabled"] === "boolean" ? b["enabled"] : before.enabled,
    actions: "actions" in b ? bools(b["actions"], PLATFORM_TENANT) : before.actions,
    confirm: "confirm" in b ? bools(b["confirm"], PLATFORM_TENANT) : before.confirm,
    model: typeof b["model"] === "string" && /^[a-z0-9.-]{3,60}$/.test(b["model"].trim()) ? b["model"].trim() : before.model,
    provider: b["provider"] === "gemini" || b["provider"] === "claude" ? b["provider"] : before.provider,
    residentChat: typeof b["residentChat"] === "boolean" ? b["residentChat"] : before.residentChat,
    autoWorkOrders: typeof b["autoWorkOrders"] === "boolean" ? b["autoWorkOrders"] : before.autoWorkOrders,
    mailFallback: typeof b["mailFallback"] === "boolean" ? b["mailFallback"] : before.mailFallback,
    geminiModel: typeof b["geminiModel"] === "string" && /^[a-z0-9.-]{3,60}$/.test(b["geminiModel"].trim()) ? b["geminiModel"].trim() : before.geminiModel,
    caps: before.caps ?? {},
    ownKeys: before.ownKeys ?? {},
  };
  await saveSwitches(next, PLATFORM_TENANT);
  await commandAuditLog({ actor: `owner:${ownerName(res)}`, event: "switches.changed", detail: { before, after: next } });
  res.json(next);
});

/** One client's Command Center: on/off (Platform -> Modules "Command Center") and its monthly cap. */
router.put("/v1/platform/command/clients/:id", async (req, res) => {
  const id = String(req.params["id"]);
  if (id === PLATFORM_TENANT) { res.status(400).json({ error: "That is FIAREP's own." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) { res.status(404).json({ error: "Unknown client" }); return; }
  const changes: Record<string, unknown> = {};
  if (typeof b["on"] === "boolean") {
    const features = (org.features && typeof org.features === "object" ? org.features : {}) as Record<string, unknown>;
    const modules = (features["modules"] && typeof features["modules"] === "object" ? features["modules"] : {}) as Record<string, unknown>;
    await db.update(organizations).set({ features: { ...features, modules: { ...modules, "command-center": b["on"] } }, updatedAt: new Date() }).where(eq(organizations.id, id));
    changes["on"] = b["on"];
  }
  if ("cap" in b) {
    const cap = b["cap"] === null || b["cap"] === "" ? null : Number(b["cap"]);
    if (cap !== null && (!Number.isFinite(cap) || cap < 0 || cap > 100_000)) { res.status(400).json({ error: "The cap is a dollar amount per month (or empty for none)." }); return; }
    const sw = await getSwitches(PLATFORM_TENANT);
    const caps = { ...(sw.caps ?? {}) };
    if (cap === null) delete caps[id]; else caps[id] = Math.round(cap * 100) / 100;
    await saveSwitches({ ...sw, caps }, PLATFORM_TENANT);
    changes["cap"] = cap;
  }
  if (typeof b["paysOwn"] === "boolean") {
    // Who pays for this client's AI: FIAREP (false) or the client with its own keys (true).
    const sw = await getSwitches(PLATFORM_TENANT);
    const ownKeys = { ...(sw.ownKeys ?? {}) };
    if (b["paysOwn"]) ownKeys[id] = true; else delete ownKeys[id];
    await saveSwitches({ ...sw, ownKeys }, PLATFORM_TENANT);
    changes["paysOwn"] = b["paysOwn"];
  }
  await commandAuditLog({ tenantId: id, actor: `owner:${ownerName(res)}`, event: "client.changed", detail: { client: org.name, ...changes } });
  res.json({ id, ...changes });
});

router.post("/v1/platform/command/devices/:id/:decision", async (req, res) => {
  const decision = String(req.params["decision"]);
  if (decision !== "approve" && decision !== "revoke") { res.status(404).json({ error: "Not found" }); return; }
  const out = await decideDevice(null, String(req.params["id"]), decision, `owner:${ownerName(res)}`);
  if (!out) { res.status(404).json({ error: decision === "approve" ? "No pending device with that id" : "Unknown device" }); return; }
  res.json(out);
});

router.post("/v1/platform/command/agents", async (req, res) => {
  const out = await createAgent(req, PLATFORM_TENANT, `owner:${ownerName(res)}`);
  if ("error" in out) { res.status(400).json(out); return; }
  res.status(201).json(out);
});

router.post("/v1/platform/command/agents/:id/revoke", async (req, res) => {
  const out = await revokeAgent(null, String(req.params["id"]), `owner:${ownerName(res)}`);
  if (!out) { res.status(404).json({ error: "Unknown agent" }); return; }
  res.json(out);
});

/** Set (or clear, with null) an API key from the Terminal: set-gemini-key.sh (gemini), set-maps-key.sh (maps). Checked with Google first; stored encrypted. */
const KEY_NAMES: Record<string, { name: KeyName; label: string; where: string }> = {
  gemini: { name: "gemini", label: "Gemini", where: "aistudio.google.com → Get API key" },
  maps: { name: "googleMaps", label: "Google Maps", where: "console.cloud.google.com → APIs & Services → Credentials, with Routes API enabled" },
};
router.put("/v1/platform/command/keys/:which", async (req, res) => {
  const k = KEY_NAMES[String(req.params["which"])];
  if (!k) { res.status(404).json({ error: "Unknown key" }); return; }
  const raw = (req.body as Record<string, unknown> | undefined)?.["key"];
  if (raw === null) { await saveKey(k.name, null, ownerName(res)); await commandAuditLog({ actor: `owner:${ownerName(res)}`, event: `key.${k.name}.cleared` }); res.json(await keyStatus(k.name)); return; }
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!/^[\w.-]{20,200}$/.test(key)) { res.status(400).json({ error: `That doesn't look like a ${k.label} API key (${k.where}).` }); return; }
  const problem = await checkKey(k.name, key);
  if (problem) { res.status(400).json({ error: problem }); return; }
  await saveKey(k.name, key, ownerName(res));
  await commandAuditLog({ actor: `owner:${ownerName(res)}`, event: `key.${k.name}.set`, detail: { last4: key.slice(-4) } });
  res.json({ ...(await keyStatus(k.name)), note: process.env[KEY_ENV[k.name]] ? `${KEY_ENV[k.name]} in Replit Secrets is set and is used instead.` : undefined });
});

router.delete("/v1/platform/command/agents/:id", async (req, res) => {
  const out = await removeAgent(null, String(req.params["id"]), `owner:${ownerName(res)}`);
  if (!out) { res.status(404).json({ error: "Only a revoked computer can be removed" }); return; }
  res.json(out);
});

router.put("/v1/platform/command/schedule", async (req, res) => {
  const next = await saveSchedule(PLATFORM_TENANT, (req.body ?? {}) as Record<string, unknown>);
  await commandAuditLog({ actor: `owner:${ownerName(res)}`, event: "schedule.changed", detail: next });
  res.json(next);
});

router.post("/v1/platform/command/relay/sync", async (_req, res) => {
  res.json(await syncRelayDevices());
});

router.get("/v1/platform/command/audit", async (req, res) => {
  res.json({ rows: await recentAudit(Number(req.query["limit"]) || 200), chain: await verifyAuditChain() });
});

router.get("/v1/platform/command/work-orders", async (req, res) => {
  const status = str(req.query["status"], 20) || "any";
  res.json(await db.select().from(commandWorkOrders).where(workOrdersWhere(PLATFORM_TENANT, status)).orderBy(desc(commandWorkOrders.createdAt)).limit(500));
});

// ── A client's own control panel (fiarep.com → Command Center) ─────────────
// Its administrators approve its phones, add its computers, switch its actions
// and read its audit trail. FIAREP's own is Platform Control, above.
async function requireOrgCommand(_req: Request, res: Response, next: NextFunction) {
  const actor = actorFrom(res);
  if (isPlatform(actor.tenantId)) { res.status(400).json({ error: "FIAREP's own Command Center is in Platform Control." }); return; }
  const problem = await commandAdminProblem(actor);
  if (problem) { res.status(403).json({ error: problem }); return; }
  next();
}
const org = [requireAuth, requireOrgCommand];
const by = (res: Response) => actorFrom(res).name;

router.get("/v1/org/command", ...org, async (req, res) => {
  const tenantId = actorFrom(res).tenantId;
  const [own, effective, platform, devices, agents, usage, chain, auditRows] = await Promise.all([
    getSwitches(tenantId), effectiveSwitches(tenantId), getSwitches(PLATFORM_TENANT),
    db.select().from(commandDevices).where(eq(commandDevices.tenantId, tenantId)).orderBy(desc(commandDevices.createdAt)),
    db.select().from(commandAgents).where(eq(commandAgents.tenantId, tenantId)).orderBy(desc(commandAgents.createdAt)),
    monthUsage(tenantId), verifyAuditChain(), recentAudit(1000, tenantId),
  ]);
  res.json({
    switches: own, platformEnabled: effective.platformEnabled,
    platformOff: Object.entries(platform.actions).filter(([, v]) => v === false).map(([k]) => k),
    actions: actionMeta(tenantId), devices: devices.map(deviceMeta), agents: agents.map(agentMeta),
    install: installLines(publicApiBase(req), null, devices.filter((d) => d.status === "active").map((d) => d.confirmKey)),
    usage: usage[0] ?? null, cap: platform.caps?.[tenantId] ?? null, capProblem: await capProblem(tenantId),
    schedule: await getSchedule(tenantId),
    // Who pays for the AI: FIAREP, or this client with its own keys (Platform Control → Clients).
    paysOwn: effective.paysOwn, provider: effective.provider,
    ownKeys: effective.paysOwn ? await clientKeyStatus(tenantId) : null,
    prices: effective.paysOwn ? MODEL_PRICES : undefined, models: effective.paysOwn ? { claude: effective.model, gemini: effective.geminiModel } : undefined,
    mapsKey: { set: effective.paysOwn ? (await clientKeyStatus(tenantId)).googleMaps.set : (await keyStatus("googleMaps")).set },
    // "Ready" for whichever engine is on (Claude or Gemini), with whoever's key pays.
    claudeKeyConfigured: !!(await keyFor(tenantId, effective.provider === "gemini" ? "gemini" : "anthropic", effective.paysOwn)).key,
    audit: { ok: chain.ok, rows: auditRows.length },
  });
});

router.put("/v1/org/command/switches", ...org, async (req, res) => {
  const tenantId = actorFrom(res).tenantId;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const before = await getSwitches(tenantId);
  const next: CommandSwitches = {
    enabled: typeof b["enabled"] === "boolean" ? b["enabled"] : before.enabled,
    actions: "actions" in b ? bools(b["actions"], tenantId) : before.actions,
    confirm: "confirm" in b ? bools(b["confirm"], tenantId) : before.confirm,
    // The engine is FIAREP's choice (Platform Control), unless this client pays for its own AI: then it picks the one its key is for.
    model: before.model, geminiModel: before.geminiModel,
    provider: (b["provider"] === "gemini" || b["provider"] === "claude") && (await effectiveSwitches(tenantId)).paysOwn ? b["provider"] : before.provider,
    residentChat: typeof b["residentChat"] === "boolean" ? b["residentChat"] : before.residentChat,
    autoWorkOrders: typeof b["autoWorkOrders"] === "boolean" ? b["autoWorkOrders"] : before.autoWorkOrders,
    mailFallback: typeof b["mailFallback"] === "boolean" ? b["mailFallback"] : before.mailFallback,
  };
  await saveSwitches(next, tenantId);
  await commandAuditLog({ tenantId, actor: by(res), event: "switches.changed", detail: { before, after: next } });
  res.json(next);
});

// A client that pays for its own AI adds its keys here (checked with the provider, stored encrypted).
const CLIENT_KEY_PATHS: Record<string, ClientKeyName> = { anthropic: "anthropic", gemini: "gemini", openai: "openai", maps: "googleMaps" };
router.put("/v1/org/command/own-keys/:which", ...org, async (req, res) => {
  const tenantId = actorFrom(res).tenantId;
  const name = CLIENT_KEY_PATHS[String(req.params["which"])];
  if (!name) { res.status(404).json({ error: "Unknown key" }); return; }
  if (!(await effectiveSwitches(tenantId)).paysOwn) { res.status(403).json({ error: "FIAREP pays for this organization's AI, so no keys are needed." }); return; }
  const key = str((req.body as Record<string, unknown> | undefined)?.["key"], 300);
  if (!key) { res.status(400).json({ error: "Paste the key." }); return; }
  const problem = await checkClientKey(name, key);
  if (problem) { res.status(400).json({ error: problem }); return; }
  await saveClientKey(tenantId, name, key, by(res));
  await commandAuditLog({ tenantId, actor: by(res), event: "own-key.set", detail: { key: name, last4: key.slice(-4) } });
  res.json((await clientKeyStatus(tenantId))[name]);
});
router.delete("/v1/org/command/own-keys/:which", ...org, async (req, res) => {
  const tenantId = actorFrom(res).tenantId;
  const name = CLIENT_KEY_PATHS[String(req.params["which"])];
  if (!name) { res.status(404).json({ error: "Unknown key" }); return; }
  await saveClientKey(tenantId, name, null, by(res));
  await commandAuditLog({ tenantId, actor: by(res), event: "own-key.removed", detail: { key: name } });
  res.json((await clientKeyStatus(tenantId))[name]);
});

router.post("/v1/org/command/devices/:id/:decision", ...org, async (req, res) => {
  const decision = String(req.params["decision"]);
  if (decision !== "approve" && decision !== "revoke") { res.status(404).json({ error: "Not found" }); return; }
  const out = await decideDevice(actorFrom(res).tenantId, String(req.params["id"]), decision, by(res));
  if (!out) { res.status(404).json({ error: decision === "approve" ? "No phone waiting with that id" : "Unknown phone" }); return; }
  res.json(out);
});

router.post("/v1/org/command/agents", ...org, async (req, res) => {
  const out = await createAgent(req, actorFrom(res).tenantId, by(res));
  if ("error" in out) { res.status(400).json(out); return; }
  res.status(201).json(out);
});

router.post("/v1/org/command/agents/:id/revoke", ...org, async (req, res) => {
  const out = await revokeAgent(actorFrom(res).tenantId, String(req.params["id"]), by(res));
  if (!out) { res.status(404).json({ error: "Unknown computer" }); return; }
  res.json(out);
});

router.delete("/v1/org/command/agents/:id", ...org, async (req, res) => {
  const out = await removeAgent(actorFrom(res).tenantId, String(req.params["id"]), by(res));
  if (!out) { res.status(404).json({ error: "Only a revoked computer can be removed" }); return; }
  res.json(out);
});

router.put("/v1/org/command/schedule", ...org, async (req, res) => {
  const tenantId = actorFrom(res).tenantId;
  const next = await saveSchedule(tenantId, (req.body ?? {}) as Record<string, unknown>);
  await commandAuditLog({ tenantId, actor: by(res), event: "schedule.changed", detail: next });
  res.json(next);
});

router.get("/v1/org/command/audit", ...org, async (req, res) => {
  res.json({ rows: await recentAudit(Number(req.query["limit"]) || 200, actorFrom(res).tenantId) });
});

router.get("/v1/org/command/work-orders", ...org, async (req, res) => {
  const status = str(req.query["status"], 20) || "any";
  res.json(await db.select().from(commandWorkOrders).where(workOrdersWhere(actorFrom(res).tenantId, status)).orderBy(desc(commandWorkOrders.createdAt)).limit(500));
});

// ── Calendar: staff bookings (every signed-in member; members see their own, management / administrators everyone's) ──
router.get("/v1/staff-bookings", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const from = new Date(String(req.query["from"] ?? "")); const to = new Date(String(req.query["to"] ?? ""));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 120 * 86_400_000) { res.status(400).json({ error: "from and to (ISO dates, up to 120 days apart) are required" }); return; }
  const everyone = ["administrator", "management"].includes(actor.role);
  const rows = await db.select().from(staffBookings).where(and(eq(staffBookings.tenantId, actor.tenantId), eq(staffBookings.status, "booked"),
    lt(staffBookings.startAt, to), gte(staffBookings.endAt, from), everyone ? undefined : eq(staffBookings.staffId, actor.id))).orderBy(asc(staffBookings.startAt)).limit(2000);
  res.setHeader("Cache-Control", "no-store");
  res.json(rows.map(bookingView));
});

// ── Resident chat (lib/command/residentChat.ts) ─────────────────────────────
// The resident: complaint number + the status token their phone / browser kept.
const residentAuth = async (req: Request) => residentComplaint(str(req.params["complaintNo"], 20), str(req.header("x-resident-token") ?? (req.body as Record<string, unknown> | undefined)?.["statusToken"], 200));
router.get("/v1/public/resident-reports/:complaintNo/messages", rateLimit("resident-chat-read", 120), async (req, res) => {
  const row = await residentAuth(req);
  if (!row) { res.status(404).json({ error: "Report not found" }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(residentView(row, await residentAiOn(row.tenantId)));
});
router.post("/v1/public/resident-reports/:complaintNo/messages", rateLimit("resident-chat", 20), async (req, res) => {
  const row = await residentAuth(req);
  if (!row) { res.status(404).json({ error: "Report not found" }); return; }
  const text = str((req.body as Record<string, unknown> | undefined)?.["text"], 2000);
  if (!text) { res.status(400).json({ error: "Write a message." }); return; }
  const aiOn = await residentAiOn(row.tenantId);
  if (!aiOn && !(Array.isArray(row.state["chat"]) && (row.state["chat"] as unknown[]).length)) { res.status(403).json({ error: "Messages aren't available for this complaint." }); return; }
  res.json(residentView(await residentWrites(row, text), aiOn));
});

// Staff: conversations on the Command Center page (FIAREP's own, or a client's).
async function chatScope(req: Request, res: Response): Promise<string | null> {
  if (req.path.startsWith("/v1/platform/")) return PLATFORM_TENANT;
  return actorFrom(res).tenantId;
}
for (const prefix of ["/v1/platform/command", "/v1/org/command"]) {
  const guard = prefix.startsWith("/v1/platform") ? [] : org;
  router.get(`${prefix}/resident-chats`, ...guard, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await recentConversations((await chatScope(req, res))!));
  });
  router.post(`${prefix}/resident-chats/:id`, ...guard, async (req, res) => {
    const tenantId = (await chatScope(req, res))!;
    const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params["id"])), eq(entityRecords.tenantId, tenantId), eq(entityRecords.entity, "resident-reports"))).limit(1);
    if (!row) { res.status(404).json({ error: "Unknown complaint" }); return; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const who = prefix.startsWith("/v1/platform") ? ownerName(res) : by(res);
    const next = await staffWrites(row, who, { text: str(b["text"], 2000) || undefined, takeOver: b["takeOver"] === true, giveBack: b["giveBack"] === true });
    await commandAuditLog({ tenantId, actor: who, event: "resident-chat.staff", detail: { complaint: row.state["complaintNo"], replied: !!str(b["text"], 10), takeOver: b["takeOver"] === true, giveBack: b["giveBack"] === true } });
    res.json({ ok: true, human: next.state["chatHuman"] === true });
  });
  // Email: this organization's mailbox (connect with address + app password).
  router.get(`${prefix}/mailbox`, ...guard, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await mailStatus((await chatScope(req, res))!));
  });
  router.get(`${prefix}/mailbox/preset`, ...guard, async (req, res) => { res.json(presetFor(str(req.query["email"], 200))); });
  router.put(`${prefix}/mailbox`, ...guard, async (req, res) => {
    const tenantId = (await chatScope(req, res))!;
    const who = prefix.startsWith("/v1/platform") ? ownerName(res) : by(res);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = await connectMailbox(tenantId, { email: str(b["email"], 200), name: str(b["name"], 120), user: str(b["user"], 200), imapHost: str(b["imapHost"], 200), imapPort: Number(b["imapPort"]) || undefined, smtpHost: str(b["smtpHost"], 200), smtpPort: Number(b["smtpPort"]) || undefined, password: typeof b["password"] === "string" ? b["password"] : "" }, who);
    if ("error" in r) { res.status(400).json(r); return; }
    res.json(await mailStatus(tenantId));
  });
  router.delete(`${prefix}/mailbox`, ...guard, async (req, res) => {
    const tenantId = (await chatScope(req, res))!;
    await disconnectMailbox(tenantId, prefix.startsWith("/v1/platform") ? ownerName(res) : by(res));
    res.json(await mailStatus(tenantId));
  });
  // Reports the Command Center wrote (write_report).
  router.get(`${prefix}/reports`, ...guard, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await listReports((await chatScope(req, res))!));
  });
  router.get(`${prefix}/reports/:id`, ...guard, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const r = await getReport((await chatScope(req, res))!, String(req.params["id"]));
    if (!r) { res.status(404).json({ error: "Unknown report" }); return; }
    res.json(r);
  });
}

export default router;
