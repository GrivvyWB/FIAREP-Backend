// FIAREP Command Center.
//   Phone   /v1/command/*            signed-in FIAREP administrator + an approved device key on every request
//   Agent   /v1/command/agent/*      desktop agent token (outbound only: the agent calls in, nothing calls the agent)
//   Owner   /v1/platform/command/*   Platform Control: switches, device approvals, agents, audit
import { randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import { requireAuth, requirePlatformOwner, actorFrom } from "../middlewares/auth";
import { isFiarepAdmin } from "../lib/fiarepAdminNames";
import { rateLimit } from "../lib/rateLimit";
import { actorFromStaff } from "../lib/auth";
import { notify } from "../lib/audit";
import { commandActions, commandAgents, commandDevices, commandRuns, commandWorkOrders, type AgentTask } from "../lib/command/tables";
import { isEd25519Key, requestMessage, sha256hex, verifyEd25519 } from "../lib/command/crypto";
import { commandAuditLog, recentAudit, verifyAuditChain } from "../lib/command/audit";
import { ACTIONS } from "../lib/command/actions";
import { getSwitches, saveSwitches, DEFAULT_MODEL } from "../lib/command/switches";
import { confirmMessageFor, executeAction, publicAction, runCommand, runView, type ActionRow } from "../lib/command/engine";
import { ONLINE_WINDOW_MS, signalResult, waitForEvent } from "../lib/command/agentBus";
import { relayUrl, syncRelayDevices } from "../lib/command/relay";

const router: IRouter = Router();
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const tokenHash = (t: string) => sha256hex(t);
type Device = typeof commandDevices.$inferSelect;
type Agent = typeof commandAgents.$inferSelect;

// ── Phone: FIAREP administrator + approved device ──────────────────────────
function requireCommandAdmin(req: Request, res: Response, next: NextFunction) {
  const actor = actorFrom(res);
  if (!isFiarepAdmin(actor)) { res.status(403).json({ error: "The Command Center is for FIAREP's administrators." }); return; }
  next();
}

const seenSignatures = new Map<string, number>();
const SKEW_MS = 120_000;

/** Every phone request carries the device id, a timestamp and an Ed25519
 *  signature over method, path, timestamp and the exact body bytes. */
async function requireCommandDevice(req: Request, res: Response, next: NextFunction) {
  const switches = await getSwitches();
  if (!switches.enabled) { res.status(403).json({ error: "The Command Center is switched off in Platform Control." }); return; }
  const actor = actorFrom(res);
  const deviceId = str(req.header("x-command-device"), 80);
  const time = str(req.header("x-command-time"), 20);
  const sig = str(req.header("x-command-sig"), 200);
  if (!deviceId || !time || !sig) { res.status(401).json({ error: "This phone is not set up for the Command Center.", code: "device_required" }); return; }
  if (!/^\d{10,16}$/.test(time) || Math.abs(Date.now() - Number(time)) > SKEW_MS) { res.status(401).json({ error: "The phone's clock is off, or the request is stale.", code: "stale" }); return; }
  const [device] = await db.select().from(commandDevices).where(eq(commandDevices.id, deviceId)).limit(1);
  if (!device || device.staffId !== actor.id) { res.status(401).json({ error: "Unknown device.", code: "device_unknown" }); return; }
  if (device.status !== "active") { res.status(403).json({ error: device.status === "pending" ? "Waiting for approval in Platform Control." : "This device was revoked.", code: `device_${device.status}` }); return; }
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
  if (pending.length >= 3) { res.status(429).json({ error: "Three phones are already waiting for approval in Platform Control." }); return; }
  const id = randomUUID();
  await db.insert(commandDevices).values({ id, tenantId: actor.tenantId, staffId: actor.id, staffName: actor.name, name, deviceKey, confirmKey, status: "pending" });
  await commandAuditLog({ actor: actor.name, event: "device.enrolled", deviceId: id, detail: { name } });
  res.status(201).json({ id, status: "pending" });
});

router.get("/v1/command/devices/:id/status", ...phone, async (req, res) => {
  const [d] = await db.select().from(commandDevices).where(eq(commandDevices.id, String(req.params["id"]))).limit(1);
  if (!d || d.staffId !== actorFrom(res).id) { res.status(404).json({ error: "Unknown device" }); return; }
  res.json({ id: d.id, status: d.status, name: d.name });
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
    await commandAuditLog({ actor: actor.name, event: "action.confirm_rejected", deviceId: d.id, runId: row.runId, actionId: row.id, detail: { reason: "bad signature" } });
    res.status(401).json({ error: "Face ID signature did not verify." }); return;
  }
  const [claimed] = await db.update(commandActions).set({ status: "approved", signature, confirmedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(commandActions.id, row.id), eq(commandActions.status, "proposed"))).returning();
  if (!claimed) { res.status(409).json({ error: "Already handled." }); return; }
  await commandAuditLog({ actor: actor.name, event: "action.approved", deviceId: d.id, runId: row.runId, actionId: row.id, detail: { action: row.action, params: row.params, signature } });
  const done = await executeAction(claimed, actor.name);
  res.json(publicAction(done));
});

router.post("/v1/command/actions/:id/deny", ...phone, requireCommandDevice, async (req, res) => {
  const actor = actorFrom(res);
  const [row] = await db.update(commandActions).set({ status: "denied", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(commandActions.id, String(req.params["id"])), eq(commandActions.staffId, actor.id), eq(commandActions.status, "proposed"))).returning();
  if (!row) { res.status(404).json({ error: "Nothing to deny." }); return; }
  await commandAuditLog({ actor: actor.name, event: "action.denied", deviceId: device(res).id, runId: row.runId, actionId: row.id, detail: { action: row.action } });
  res.json(publicAction(row));
});

// The backup relay's address, cached on the phone for when fiarep.com is down.
router.get("/v1/command/relay", ...phone, requireCommandDevice, async (_req, res) => {
  res.json({ url: relayUrl() });
});

router.get("/v1/command/work-orders", ...phone, requireCommandDevice, async (req, res) => {
  const status = str(req.query["status"], 20) || "draft";
  const rows = await db.select().from(commandWorkOrders).where(status === "any" ? undefined : eq(commandWorkOrders.status, status)).orderBy(desc(commandWorkOrders.createdAt)).limit(200);
  res.json(rows);
});

router.get("/v1/command/audit", ...phone, requireCommandDevice, async (req, res) => {
  res.json(await recentAudit(Number(req.query["limit"]) || 50));
});

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
  await commandAuditLog({ actor: `agent:${agent.name}`, event: ok ? "action.done" : "action.failed", deviceId: row.deviceId, runId: row.runId, actionId: row.id, detail: { action: row.action, result: json.slice(0, 2000), error: row.error } });
  signalResult(row.id);
  if (row.risk === "write") {
    const view = publicAction(row);
    void pushToStaff(row.staffId, ok ? `Done on ${agent.name}: ${row.summary}` : `Failed on ${agent.name}: ${row.summary}`, view.spoken ?? row.error ?? "");
  }
  res.json({ ok: true });
});

// ── Platform Control ───────────────────────────────────────────────────────
router.use("/v1/platform/command", requirePlatformOwner);
const ownerName = (res: Response) => (res.locals["platformOwner"] as { name: string }).name;

router.get("/v1/platform/command", async (_req, res) => {
  const [switches, devices, agents, chain] = await Promise.all([
    getSwitches(),
    db.select().from(commandDevices).orderBy(desc(commandDevices.createdAt)),
    db.select().from(commandAgents).orderBy(desc(commandAgents.createdAt)),
    verifyAuditChain(),
  ]);
  res.json({
    switches, defaultModel: DEFAULT_MODEL, relay: { url: relayUrl(), serverTokenSet: Boolean(process.env["RELAY_SERVER_TOKEN"]) }, claudeKeyConfigured: Boolean(process.env["ANTHROPIC_API_KEY"]), voiceKeyConfigured: Boolean(process.env["OPENAI_API_KEY"]),
    actions: ACTIONS.map((a) => ({ name: a.name, label: a.label, risk: a.risk, confirmDefault: a.confirmDefault, target: a.target })),
    devices: devices.map((d) => ({ id: d.id, name: d.name, staffName: d.staffName, status: d.status, confirmKey: d.confirmKey, createdAt: d.createdAt, approvedAt: d.approvedAt, approvedBy: d.approvedBy, lastUsedAt: d.lastUsedAt })),
    agents: agents.map((a) => ({ id: a.id, name: a.name, status: a.status, online: a.status === "active" && !!a.lastSeenAt && Date.now() - a.lastSeenAt.getTime() < ONLINE_WINDOW_MS, lastSeenAt: a.lastSeenAt, info: a.info, tasks: a.tasks, folders: a.folders, apps: a.apps, createdAt: a.createdAt })),
    audit: chain,
  });
});

router.put("/v1/platform/command/switches", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const before = await getSwitches();
  const bools = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === "object" ? (v as Record<string, unknown>) : {})
    .filter(([k, x]) => ACTIONS.some((a) => a.name === k) && typeof x === "boolean")) as Record<string, boolean>;
  const next = {
    enabled: typeof b["enabled"] === "boolean" ? b["enabled"] : before.enabled,
    actions: "actions" in b ? bools(b["actions"]) : before.actions,
    confirm: "confirm" in b ? bools(b["confirm"]) : before.confirm,
    model: typeof b["model"] === "string" && /^[a-z0-9.-]{3,60}$/.test(b["model"].trim()) ? b["model"].trim() : before.model,
  };
  await saveSwitches(next);
  await commandAuditLog({ actor: `owner:${ownerName(res)}`, event: "switches.changed", detail: { before, after: next } });
  res.json(next);
});

router.post("/v1/platform/command/devices/:id/:decision", async (req, res) => {
  const decision = String(req.params["decision"]);
  if (decision !== "approve" && decision !== "revoke") { res.status(404).json({ error: "Not found" }); return; }
  const id = String(req.params["id"]);
  const now = new Date();
  const [row] = await db.update(commandDevices)
    .set(decision === "approve" ? { status: "active", approvedAt: now, approvedBy: ownerName(res) } : { status: "revoked", revokedAt: now })
    .where(and(eq(commandDevices.id, id), decision === "approve" ? eq(commandDevices.status, "pending") : undefined)).returning();
  if (!row) { res.status(404).json({ error: decision === "approve" ? "No pending device with that id" : "Unknown device" }); return; }
  await commandAuditLog({ actor: `owner:${ownerName(res)}`, event: `device.${decision === "approve" ? "approved" : "revoked"}`, deviceId: id, detail: { name: row.name, staffName: row.staffName } });
  const relay = await syncRelayDevices();
  res.json({ id: row.id, status: row.status, relaySynced: relay.ok, relayError: relay.error });
});

router.post("/v1/platform/command/agents", async (req, res) => {
  const name = str((req.body as Record<string, unknown> | undefined)?.["name"], 60);
  if (!/^[\w .'-]{2,60}$/.test(name)) { res.status(400).json({ error: "Give the computer a short name (letters, numbers, spaces)." }); return; }
  const token = `fca_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  await db.insert(commandAgents).values({ id, name, tokenHash: tokenHash(token), status: "active", createdBy: ownerName(res) });
  await commandAuditLog({ actor: `owner:${ownerName(res)}`, event: "agent.created", detail: { id, name } });
  res.status(201).json({ id, name, token });
});

router.post("/v1/platform/command/agents/:id/revoke", async (req, res) => {
  const [row] = await db.update(commandAgents).set({ status: "revoked", revokedAt: new Date() }).where(eq(commandAgents.id, String(req.params["id"]))).returning();
  if (!row) { res.status(404).json({ error: "Unknown agent" }); return; }
  await db.update(commandActions).set({ status: "failed", error: "Agent revoked", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(commandActions.target, row.id), inArray(commandActions.status, ["queued", "running"])));
  await commandAuditLog({ actor: `owner:${ownerName(res)}`, event: "agent.revoked", detail: { id: row.id, name: row.name } });
  res.json({ id: row.id, status: row.status });
});

router.post("/v1/platform/command/relay/sync", async (_req, res) => {
  res.json(await syncRelayDevices());
});

router.get("/v1/platform/command/audit", async (req, res) => {
  res.json({ rows: await recentAudit(Number(req.query["limit"]) || 200), chain: await verifyAuditChain() });
});

router.get("/v1/platform/command/work-orders", async (req, res) => {
  const status = str(req.query["status"], 20) || "any";
  res.json(await db.select().from(commandWorkOrders).where(status === "any" ? undefined : eq(commandWorkOrders.status, status)).orderBy(desc(commandWorkOrders.createdAt)).limit(500));
});

export default router;
