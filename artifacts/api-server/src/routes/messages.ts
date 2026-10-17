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
import { isFiarepFieldAdmin } from "../lib/fiarepAdminNames";
import {
  THREAD_ENTITY, mayMessage, clientMessagingEnabled, clientThread, contactView, isFiarepServices, messagingOpen,
  issueCode, loadThread, markRead, postMessage, rememberContactPhone, revokeCode, threadForCode, threadOf,
  personInbox, searchPeople, signUpPerson, startWithPerson, memberThread, answersForFiarep, clearContactSide, clearFiarepSide, fiarepMessages,
} from "../lib/fiarepMessages";

const router: IRouter = Router();

/** Is this person one side of the conversation? A code thread: only the
 *  person who issued the code. A client thread: FIAREP Services, or the
 *  administrators when the client wrote to the administrator. */
function canSee(actor: Parameters<typeof isFiarepServices>[0] & { id: string; name: string }, thread: ReturnType<typeof threadOf>): boolean {
  if (thread.kind === "code") return thread.coordinatorId === actor.id;
  return (thread.to || "services") === "admin" ? isFiarepFieldAdmin(actor) : isFiarepServices(actor);
}
const text = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);

// ── The coordinator's side ────────────────────────────────────────────────
router.use("/v1/fiarep/messages", requireAuth);

/** Every conversation this coordinator is part of: their own code threads,
 *  plus the plan clients, which the whole unit answers. */
router.get("/v1/fiarep/messages", async (_req, res) => {
  const actor = actorFrom(res);
  if (!(await mayMessage(actor))) { res.status(403).json({ error: "Messaging is not switched on for you. The administrator turns it on." }); return; }
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, THREAD_ENTITY), eq(entityRecords.tenantId, FIAREP_TENANT),
    eq(entityRecords.deleted, false),
  )).orderBy(desc(entityRecords.updatedAt)).limit(300);
  const mine = rows
    .map((row) => ({ id: row.id, thread: threadOf(row.state) }))
    // Only the conversations this person is part of: the codes they handed
    // out, and the plan clients writing to their side (FIAREP Services, or
    // the administrator). Nobody reads anyone else's conversation.
    .filter(({ thread }) => canSee(actor, thread) && !thread.hiddenForFiarep)
    .map(({ id, thread }) => ({
      id,
      kind: thread.kind,
      who: thread.kind === "client" ? thread.clientCompany : thread.kind === "member" ? [thread.contactName, thread.clientCompany].filter(Boolean).join(" · ") : thread.contactName,
      coordinator: thread.coordinatorName,
      address: thread.address,
      apartment: thread.apartment,
      last: fiarepMessages(thread)[fiarepMessages(thread).length - 1]?.body ?? "",
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
  if (!(await messagingOpen())) { res.status(403).json({ error: "Messaging is switched off in Module Management." }); return; }
  if (!(await mayMessage(actor))) { res.status(403).json({ error: "Messaging is not switched on for you. The administrator turns it on." }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const issued = await issueCode(actor, body);
  await audit(actor, "fiarep-messages.code-issued", text(body["contactName"], 120), issued.threadId);
  res.status(201).json({ code: issued.code, threadId: issued.threadId });
});

/** Type a name: the people who signed up in the app under it. */
router.get("/v1/fiarep/messages/people", async (req, res) => {
  const actor = actorFrom(res);
  if (!(await mayMessage(actor))) { res.status(403).json({ error: "Messaging is not switched on for you. The administrator turns it on." }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(await searchPeople(String((req.query ?? {})["q"] ?? "")));
});

/** Tap a name: the conversation opens and lands on that person's phone. */
router.post("/v1/fiarep/messages/people/:id/start", async (req, res) => {
  const actor = actorFrom(res);
  if (!(await messagingOpen())) { res.status(403).json({ error: "Messaging is switched off in Module Management." }); return; }
  if (!(await mayMessage(actor))) { res.status(403).json({ error: "Messaging is not switched on for you. The administrator turns it on." }); return; }
  const started = await startWithPerson(actor, String(req.params["id"] || ""));
  if (!started) { res.status(404).json({ error: "That person is no longer signed up." }); return; }
  await audit(actor, "fiarep-messages.person-started", "", started.threadId);
  res.status(201).json(started);
});

router.post("/v1/fiarep/messages/:id/close", async (req, res) => {
  const actor = actorFrom(res);
  if (!(await mayMessage(actor))) { res.status(403).json({ error: "Messaging is not switched on for you. The administrator turns it on." }); return; }
  const id = String(req.params["id"] || "");
  if (!(await revokeCode(actor, id))) { res.status(404).json({ error: "That conversation is not yours." }); return; }
  await audit(actor, "fiarep-messages.code-closed", "", id);
  res.json({ ok: true });
});

/** Clear the messages (the conversation stays) or delete the conversation from your list. */
for (const action of ["clear", "delete"] as const) {
  router.post(`/v1/fiarep/messages/:id/${action}`, async (req, res) => {
    const actor = actorFrom(res);
    if (!(await mayMessage(actor))) { res.status(403).json({ error: "Messaging is not switched on for you." }); return; }
    const row = await loadThread(String(req.params["id"] || ""));
    if (!row) { res.status(404).json({ error: "No such conversation." }); return; }
    const thread = threadOf(row.state);
    if (!canSee(actor, thread)) { res.status(403).json({ error: "That conversation is not yours." }); return; }
    await clearFiarepSide(row.id, row.version ?? 1, thread, action === "delete");
    res.json({ ok: true });
  });
}

router.get("/v1/fiarep/messages/:id", async (req, res) => {
  const actor = actorFrom(res);
  if (!(await mayMessage(actor))) { res.status(403).json({ error: "Messaging is not switched on for you. The administrator turns it on." }); return; }
  const row = await loadThread(String(req.params["id"] || ""));
  if (!row) { res.status(404).json({ error: "No such conversation." }); return; }
  const thread = threadOf(row.state);
  // A code thread belongs to the coordinator who issued it and to nobody else
  // at FIAREP - supervisor included.
  if (!canSee(actor, thread)) {
    res.status(403).json({ error: "That conversation is not yours." });
    return;
  }
  await markRead(row.id, row.version ?? 1, thread, "fiarep");
  res.setHeader("Cache-Control", "no-store");
  res.json({
    id: row.id, kind: thread.kind, closed: Boolean(thread.closedAt),
    who: thread.kind === "client" ? thread.clientCompany : thread.contactName,
    address: thread.address, apartment: thread.apartment,
    messages: fiarepMessages(thread),
  });
});

router.post("/v1/fiarep/messages/:id", async (req, res) => {
  const actor = actorFrom(res);
  if (!(await mayMessage(actor))) { res.status(403).json({ error: "Messaging is not switched on for you. The administrator turns it on." }); return; }
  const row = await loadThread(String(req.params["id"] || ""));
  if (!row) { res.status(404).json({ error: "No such conversation." }); return; }
  const thread = threadOf(row.state);
  if (!canSee(actor, thread)) {
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
  if (!(await messagingOpen())) return null;
  if (!["administrator", "management"].includes(actor.role)) return null;
  if (!(await clientMessagingEnabled(actor.tenantId))) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations)
    .where(eq(organizations.id, actor.tenantId)).limit(1);
  return { actor, company: org?.name || actor.tenantId };
}

router.get("/v1/client/messages", async (_req, res) => {
  const gate = await clientGate(res);
  if (!gate) { res.status(403).json({ error: "Messaging FIAREP Services is not part of your plan." }); return; }
  const to = String((_req.query ?? {})["to"] ?? "") === "admin" ? "admin" as const : "services" as const;
  const { id, version, thread } = await clientThread(gate.actor.tenantId, gate.company, to);
  await markRead(id, version, thread, "contact");
  res.setHeader("Cache-Control", "no-store");
  res.json({ id, messages: thread.messages.map((m) => ({ ...m, mine: m.from === "contact" })) });
});

router.post("/v1/client/messages", async (_req, res) => {
  const req = _req;
  const gate = await clientGate(res);
  if (!gate) { res.status(403).json({ error: "Messaging FIAREP Services is not part of your plan." }); return; }
  const to = String((_req.query ?? {})["to"] ?? "") === "admin" ? "admin" as const : "services" as const;
  const { id, version, thread } = await clientThread(gate.actor.tenantId, gate.company, to);
  const result = await postMessage(id, version, thread, "contact", gate.actor, String((req.body ?? {})["body"] ?? ""));
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.message);
});

// ── How many unread messages are waiting for this person, anywhere ─────────
// The website plays a sound and shows a notice when this goes up.
router.get("/v1/messages/unread", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  res.setHeader("Cache-Control", "no-store");
  if (!(await messagingOpen())) { res.json({ unread: 0, latest: null }); return; }
  const answers = actor.tenantId === FIAREP_TENANT && (await mayMessage(actor));
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, THREAD_ENTITY), eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).orderBy(desc(entityRecords.updatedAt)).limit(500);
  let unread = 0;
  let latest: { who: string; body: string; at: string } | null = null;
  for (const row of rows) {
    const t = threadOf(row.state);
    let n = 0;
    if (t.kind === "code" && t.coordinatorId === actor.id) n = t.openForFiarep;
    else if (answers && t.kind !== "code" && canSee(actor, t)) n = t.openForFiarep;
    else if (t.kind === "member" && t.memberId === actor.id) n = t.openForContact;
    else if (t.kind === "client" && t.clientTenantId === actor.tenantId && ["administrator", "management"].includes(actor.role)) n = t.openForContact;
    if (!n) continue;
    unread += n;
    const last = t.messages[t.messages.length - 1];
    if (last && (!latest || last.at > latest.at)) latest = { who: last.authorName || t.contactName || t.clientCompany || "Someone", body: last.body.slice(0, 120), at: last.at };
  }
  res.json({ unread, latest });
});

// ── Every member's side: any staff member, any company, writes to FIAREP ──
router.use("/v1/member/messages", requireAuth);

async function memberGate(res: Parameters<typeof actorFrom>[0]) {
  const actor = actorFrom(res);
  if (!(await messagingOpen())) return null;
  if (["resident", "vendor"].includes(String(actor.role))) return null;
  // FIAREP Services and FIAREP's administrators answer on their own Messages screen.
  if (actor.tenantId === FIAREP_TENANT && answersForFiarep(actor)) return null;
  if (actor.tenantId !== FIAREP_TENANT && !(await clientMessagingEnabled(actor.tenantId))) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations)
    .where(eq(organizations.id, actor.tenantId)).limit(1);
  return { actor, company: actor.tenantId === FIAREP_TENANT ? "FIAREP" : org?.name || actor.tenantId };
}

router.get("/v1/member/messages", async (req, res) => {
  const gate = await memberGate(res);
  if (!gate) { res.status(403).json({ error: "Messaging FIAREP is switched off for you." }); return; }
  const to = String((req.query ?? {})["to"] ?? "") === "admin" ? "admin" as const : "services" as const;
  const { id, version, thread } = await memberThread(gate.actor, gate.company, to);
  await markRead(id, version, thread, "contact");
  res.setHeader("Cache-Control", "no-store");
  res.json({ id, messages: thread.messages.map((m) => ({ ...m, mine: m.from === "contact" })) });
});

router.post("/v1/member/messages", async (req, res) => {
  const gate = await memberGate(res);
  if (!gate) { res.status(403).json({ error: "Messaging FIAREP is switched off for you." }); return; }
  const to = String((req.query ?? {})["to"] ?? "") === "admin" ? "admin" as const : "services" as const;
  const { id, version, thread } = await memberThread(gate.actor, gate.company, to);
  const result = await postMessage(id, version, thread, "contact", gate.actor, String((req.body ?? {})["body"] ?? ""));
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.message);
});

// ── Any member hands out codes too: the person with the code writes to them ──
async function memberCodeGate(res: Parameters<typeof actorFrom>[0]) {
  const gate = await memberGate(res);
  if (gate) return gate;
  // A client's administrators and managers use the company page; they make codes as well.
  const actor = actorFrom(res);
  if (!(await messagingOpen()) || ["resident", "vendor"].includes(String(actor.role))) return null;
  if (actor.tenantId === FIAREP_TENANT || !(await clientMessagingEnabled(actor.tenantId))) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  return { actor, company: org?.name || actor.tenantId };
}

router.get("/v1/member/messages/codes", async (_req, res) => {
  const gate = await memberCodeGate(res);
  if (!gate) { res.status(403).json({ error: "Messaging is switched off for you." }); return; }
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, THREAD_ENTITY), eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).orderBy(desc(entityRecords.updatedAt)).limit(300);
  res.setHeader("Cache-Control", "no-store");
  res.json(rows.map((row) => ({ id: row.id, thread: threadOf(row.state) }))
    .filter(({ thread }) => thread.kind === "code" && thread.coordinatorId === gate.actor.id && !thread.hiddenForFiarep)
    .map(({ id, thread }) => ({
      id, kind: thread.kind, who: thread.contactName, coordinator: thread.coordinatorName, address: thread.address, apartment: thread.apartment,
      last: fiarepMessages(thread)[fiarepMessages(thread).length - 1]?.body ?? "", lastAt: thread.lastAt, unread: thread.openForFiarep, closed: Boolean(thread.closedAt),
    })));
});

router.post("/v1/member/messages/codes", async (req, res) => {
  const gate = await memberCodeGate(res);
  if (!gate) { res.status(403).json({ error: "Messaging is switched off for you." }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const issued = await issueCode(gate.actor, body, gate.company);
  await audit(gate.actor, "fiarep-messages.code-issued", text(body["contactName"], 120), issued.threadId);
  res.status(201).json({ code: issued.code, threadId: issued.threadId });
});

async function ownCodeThread(res: Parameters<typeof actorFrom>[0], id: string) {
  const gate = await memberCodeGate(res);
  if (!gate) return { error: 403 as const };
  const row = await loadThread(id);
  if (!row) return { error: 404 as const };
  const thread = threadOf(row.state);
  if (thread.kind !== "code" || thread.coordinatorId !== gate.actor.id) return { error: 403 as const };
  return { gate, row, thread };
}

router.get("/v1/member/messages/codes/:id", async (req, res) => {
  const r = await ownCodeThread(res, String(req.params["id"] || ""));
  if ("error" in r) { res.status(r.error ?? 403).json({ error: "That conversation is not yours." }); return; }
  await markRead(r.row.id, r.row.version ?? 1, r.thread, "fiarep");
  res.setHeader("Cache-Control", "no-store");
  res.json({ id: r.row.id, kind: r.thread.kind, closed: Boolean(r.thread.closedAt), who: r.thread.contactName, address: r.thread.address, apartment: r.thread.apartment, messages: fiarepMessages(r.thread) });
});

router.post("/v1/member/messages/codes/:id", async (req, res) => {
  const r = await ownCodeThread(res, String(req.params["id"] || ""));
  if ("error" in r) { res.status(r.error ?? 403).json({ error: "That conversation is not yours." }); return; }
  const result = await postMessage(r.row.id, r.row.version ?? 1, r.thread, "fiarep", r.gate.actor, String((req.body ?? {})["body"] ?? ""));
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(result.message);
});

router.post("/v1/member/messages/codes/:id/close", async (req, res) => {
  const r = await ownCodeThread(res, String(req.params["id"] || ""));
  if ("error" in r) { res.status(r.error ?? 403).json({ error: "That conversation is not yours." }); return; }
  await revokeCode(r.gate.actor, r.row.id);
  await audit(r.gate.actor, "fiarep-messages.code-closed", "", r.row.id);
  res.json({ ok: true });
});

for (const action of ["clear", "delete"] as const) {
  router.post(`/v1/member/messages/codes/:id/${action}`, async (req, res) => {
    const r = await ownCodeThread(res, String(req.params["id"] || ""));
    if ("error" in r) { res.status(r.error ?? 403).json({ error: "That conversation is not yours." }); return; }
    await clearFiarepSide(r.row.id, r.row.version ?? 1, r.thread, action === "delete");
    res.json({ ok: true });
  });
}

// ── The code door: no account, no plan, nothing but the conversation ──────
router.use("/v1/public/messages", rateLimit("public-messages", 60));

/** Is messaging FIAREP open at all? The app shows or hides its Message button by this. */
router.get("/v1/public/messages/status", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ open: await messagingOpen() });
});

router.use("/v1/public/messages", async (req, res, next) => {
  if (req.path === "/status") { next(); return; }
  if (!(await messagingOpen())) { res.status(403).json({ error: "Messaging FIAREP is switched off right now." }); return; }
  next();
});

/** Sign up with first and last name and apartment, so FIAREP Services can find you and message you. */
router.post("/v1/public/messages/signup", async (req, res) => {
  const r = await signUpPerson((req.body ?? {}) as Record<string, unknown>);
  if ("error" in r) { res.status(400).json({ error: r.error }); return; }
  res.status(201).json(r);
});

/** The signed-up person's conversations (the phone holds the id and secret). */
router.post("/v1/public/messages/me", async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const inbox = await personInbox(String(b["id"] ?? ""), String(b["secret"] ?? ""), b["pushToken"]);
  if (!inbox) { res.status(404).json({ error: "Not signed up on this phone." }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(inbox);
});

router.post("/v1/public/messages/open", async (req, res) => {
  const found = await threadForCode(String((req.body ?? {})["code"] ?? ""));
  if (!found) { res.status(404).json({ error: "That code does not open anything. It may have been blocked, or mistyped - check it with the person who gave it to you." }); return; }
  // The phone that opened it gets the replies as notifications.
  await rememberContactPhone(found.id, found.version, found.thread, (req.body ?? {})["pushToken"]);
  const fresh = (await threadForCode(String((req.body ?? {})["code"] ?? ""))) ?? found;
  await markRead(fresh.id, fresh.version, fresh.thread, "contact");
  res.setHeader("Cache-Control", "no-store");
  res.json(contactView(fresh.thread));
});

/** The person with the code clears their side: logged off on the website, or deleted in the app. */
router.post("/v1/public/messages/clear", async (req, res) => {
  const found = await threadForCode(String((req.body ?? {})["code"] ?? ""));
  if (!found) { res.status(404).json({ error: "That code does not open anything." }); return; }
  await clearContactSide(found.id, found.version, found.thread);
  res.json({ ok: true });
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
