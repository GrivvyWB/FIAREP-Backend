// Text messaging with FIAREP Services (see lib/fiarepMessages.ts for who may
// talk to whom). Three doors: the coordinator's, a plan client's, and the
// public one a code opens.
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { rateLimit } from "../lib/rateLimit";
import { audit } from "../lib/audit";
import { FIAREP_TENANT } from "../lib/fiarepDispatch";
import {
  THREAD_ENTITY, clientMessagingEnabled, clientThread, contactView, isFiarepServices,
  issueCode, loadThread, markRead, postMessage, revokeCode, threadForCode, threadOf,
} from "../lib/fiarepMessages";

const router: IRouter = Router();
const text = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);

// ── The coordinator's side ────────────────────────────────────────────────
router.use("/v1/fiarep/messages", requireAuth);

/** Every conversation this coordinator is part of: their own code threads,
 *  plus the plan clients, which the whole unit answers. */
router.get("/v1/fiarep/messages", async (_req, res) => {
  const actor = actorFrom(res);
  if (!isFiarepServices(actor)) { res.status(403).json({ error: "FIAREP Services only." }); return; }
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, THREAD_ENTITY), eq(entityRecords.tenantId, FIAREP_TENANT),
    eq(entityRecords.deleted, false),
  )).orderBy(desc(entityRecords.updatedAt)).limit(300);
  const mine = rows
    .map((row) => ({ id: row.id, thread: threadOf(row.state) }))
    .filter(({ thread }) => thread.kind === "client" || thread.coordinatorId === actor.id)
    .map(({ id, thread }) => ({
      id,
      kind: thread.kind,
      who: thread.kind === "client" ? thread.clientCompany : thread.contactName,
      address: thread.address,
      apartment: thread.apartment,
      last: thread.messages[thread.messages.length - 1]?.body ?? "",
      lastAt: thread.lastAt,
      unread: thread.openForFiarep,
      closed: Boolean(thread.closedAt),
    }));
  res.setHeader("Cache-Control", "no-store");
  res.json(mine);
});

/** Hand someone a code at the door. Shown once; only its hash is kept. */
router.post("/v1/fiarep/messages/codes", async (req, res) => {
  const actor = actorFrom(res);
  if (!isFiarepServices(actor)) { res.status(403).json({ error: "FIAREP Services only." }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const issued = await issueCode(actor, body);
  await audit(actor, "fiarep-messages.code-issued", text(body["contactName"], 120), issued.threadId);
  res.status(201).json({ code: issued.code, threadId: issued.threadId });
});

router.post("/v1/fiarep/messages/:id/close", async (req, res) => {
  const actor = actorFrom(res);
  if (!isFiarepServices(actor)) { res.status(403).json({ error: "FIAREP Services only." }); return; }
  const id = String(req.params["id"] || "");
  if (!(await revokeCode(actor, id))) { res.status(404).json({ error: "That conversation is not yours." }); return; }
  await audit(actor, "fiarep-messages.code-closed", "", id);
  res.json({ ok: true });
});

router.get("/v1/fiarep/messages/:id", async (req, res) => {
  const actor = actorFrom(res);
  if (!isFiarepServices(actor)) { res.status(403).json({ error: "FIAREP Services only." }); return; }
  const row = await loadThread(String(req.params["id"] || ""));
  if (!row) { res.status(404).json({ error: "No such conversation." }); return; }
  const thread = threadOf(row.state);
  // A code thread belongs to the coordinator who issued it and to nobody else
  // at FIAREP - supervisor included.
  if (thread.kind === "code" && thread.coordinatorId !== actor.id) {
    res.status(403).json({ error: "That conversation is not yours." });
    return;
  }
  await markRead(row.id, row.version ?? 1, thread, "fiarep");
  res.setHeader("Cache-Control", "no-store");
  res.json({
    id: row.id, kind: thread.kind, closed: Boolean(thread.closedAt),
    who: thread.kind === "client" ? thread.clientCompany : thread.contactName,
    address: thread.address, apartment: thread.apartment,
    messages: thread.messages,
  });
});

router.post("/v1/fiarep/messages/:id", async (req, res) => {
  const actor = actorFrom(res);
  if (!isFiarepServices(actor)) { res.status(403).json({ error: "FIAREP Services only." }); return; }
  const row = await loadThread(String(req.params["id"] || ""));
  if (!row) { res.status(404).json({ error: "No such conversation." }); return; }
  const thread = threadOf(row.state);
  if (thread.kind === "code" && thread.coordinatorId !== actor.id) {
    res.status(403).json({ error: "That conversation is not yours." });
    return;
  }
  const result = await postMessage(row.id, row.version ?? 1, thread, "fiarep", actor, String((req.body ?? {})["body"] ?? ""));
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.message);
});

// ── A plan client's side ──────────────────────────────────────────────────
router.use("/v1/client/messages", requireAuth);

async function clientGate(res: Parameters<typeof actorFrom>[0]) {
  const actor = actorFrom(res);
  if (!["administrator", "management"].includes(actor.role)) return null;
  if (!(await clientMessagingEnabled(actor.tenantId))) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations)
    .where(eq(organizations.id, actor.tenantId)).limit(1);
  return { actor, company: org?.name || actor.tenantId };
}

router.get("/v1/client/messages", async (_req, res) => {
  const gate = await clientGate(res);
  if (!gate) { res.status(403).json({ error: "Messaging FIAREP Services is not part of your plan." }); return; }
  const { id, version, thread } = await clientThread(gate.actor.tenantId, gate.company);
  await markRead(id, version, thread, "contact");
  res.setHeader("Cache-Control", "no-store");
  res.json({ id, messages: thread.messages.map((m) => ({ ...m, mine: m.from === "contact" })) });
});

router.post("/v1/client/messages", async (req, res) => {
  const gate = await clientGate(res);
  if (!gate) { res.status(403).json({ error: "Messaging FIAREP Services is not part of your plan." }); return; }
  const { id, version, thread } = await clientThread(gate.actor.tenantId, gate.company);
  const result = await postMessage(id, version, thread, "contact", gate.actor, String((req.body ?? {})["body"] ?? ""));
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.message);
});

// ── The code door: no account, no plan, nothing but the conversation ──────
router.use("/v1/public/messages", rateLimit("public-messages", 60));

router.post("/v1/public/messages/open", async (req, res) => {
  const found = await threadForCode(String((req.body ?? {})["code"] ?? ""));
  if (!found) { res.status(404).json({ error: "That code does not open anything. Check it with the coordinator who gave it to you." }); return; }
  await markRead(found.id, found.version, found.thread, "contact");
  res.setHeader("Cache-Control", "no-store");
  res.json(contactView(found.thread));
});

router.post("/v1/public/messages/send", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const found = await threadForCode(String(body["code"] ?? ""));
  if (!found) { res.status(404).json({ error: "That code does not open anything." }); return; }
  const name = text(body["name"], 120) || found.thread.contactName;
  const thread = name === found.thread.contactName ? found.thread : { ...found.thread, contactName: name };
  const result = await postMessage(found.id, found.version, thread, "contact", { id: "", name }, String(body["body"] ?? ""));
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.message);
});

export default router;
