// Text messaging with FIAREP Services. FIAREP's side only: no client company
// gets a messaging module of its own, and nothing here touches a client's own
// residents or team.
//
// Two ways in:
//
//   A code. A FIAREP Services coordinator standing at a building hands someone
//   a code. That person installs the app or opens the website, presses
//   Message, types the code, and can write to THAT coordinator and no one
//   else. They get nothing else - no complaints, no records, no other staff -
//   and the coordinator who issued the code is the only person at FIAREP who
//   reads the thread. The coordinator can kill the code whenever they like,
//   and the conversation closes with it.
//
//   A plan. A client company whose plan includes it writes to FIAREP Services
//   from inside its own account, with no code: their management open Messages
//   and the thread goes to the unit, because a company has no way of knowing
//   which coordinator is on. A company on the regular plan has no such thread
//   - it deals with its own residents and its own team.
//
// There is no email anywhere in this: the whole conversation lives in the app
// and on the website.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, entityRecords, notifications, organizations, staffAccounts } from "@workspace/db";
import type { Actor } from "./auth";
import { deliverPushNotification } from "./push";
import { isCommunityCoordinator } from "./domain";
import { isFiarepFieldAdmin } from "./fiarepAdminNames";
import { FIAREP_TENANT } from "./fiarepDispatch";

// Neither entity is in ENTITIES, so the generic record routes cannot read or
// write them: only the routes in messages.ts touch a conversation.
export const CODE_ENTITY = "fiarep-message-codes";
export const THREAD_ENTITY = "fiarep-message-threads";
const MAX_MESSAGES = 500;
const MAX_BODY = 2000;

export type Message = {
  id: string;
  from: "fiarep" | "contact";
  authorId: string;
  authorName: string;
  body: string;
  at: string;
};

export type Thread = {
  kind: "code" | "client";
  /** A client thread goes to FIAREP Services ("services") or to FIAREP's
   *  administrator ("admin"); each is its own conversation. */
  to?: "services" | "admin";
  coordinatorId: string;       // "" on a client thread: the unit answers
  coordinatorName: string;
  contactName: string;
  address: string;
  apartment: string;
  clientTenantId: string;
  clientCompany: string;
  messages: Message[];
  lastAt: string;
  openForFiarep: number;       // unread on FIAREP's side
  openForContact: number;
  closedAt: string;            // set when the code is killed
  /** The phone of the person holding the code, so a reply reaches it as a
   *  push notification. They have no account; this is all we keep. */
  contactPush?: string;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const validPushToken = (t: unknown): string => {
  const token = String(t ?? "").trim();
  return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token) ? token : "";
};

/** Push a reply to the code holder's phone. Never throws. */
async function pushToContact(token: string, title: string, body: string, threadId: string): Promise<void> {
  if (!token) return;
  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify([{ to: token, title, body: body.slice(0, 160), sound: "default", data: { fiarepMessage: threadId } }]),
    });
  } catch { /* a missed push never loses the message - it is in the conversation */ }
}

/** Keep the code holder's phone on the thread so replies reach it. */
export async function rememberContactPhone(threadId: string, version: number, thread: Thread, token: unknown): Promise<void> {
  const valid = validPushToken(token);
  if (!valid || valid === thread.contactPush) return;
  await saveThread(threadId, version, { ...thread, contactPush: valid });
}

const text = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);
const hashCode = (code: string): string => createHash("sha256").update(code.trim().toUpperCase()).digest("hex");

/** Codes people read off a phone screen and type in: no O/0 or I/1 to confuse. */
function newCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function isFiarepServices(actor: Pick<Actor, "tenantId" | "role">): boolean {
  return actor.tenantId === FIAREP_TENANT && isCommunityCoordinator(actor);
}

/** Who answers on FIAREP's side: FIAREP Services, and FIAREP's administrators
 *  (Timothy Winn, Emily Winn). Never a technician or worker. Nobody reads a
 *  conversation they are not part of — not the administrators, not a
 *  supervisor: what is said is between the two sides having it. */
export function answersForFiarep(actor: Pick<Actor, "tenantId" | "role" | "name">): boolean {
  return isFiarepServices(actor) || isFiarepFieldAdmin(actor);
}

/** FIAREP's switches, from its own organization record. */
async function fiarepModules(): Promise<Record<string, unknown>> {
  const [org] = await db.select({ features: organizations.features }).from(organizations)
    .where(eq(organizations.id, FIAREP_TENANT)).limit(1);
  const modules = org?.features?.["modules"];
  return modules && typeof modules === "object" && !Array.isArray(modules) ? modules as Record<string, unknown> : {};
}

/** The administrator decides who uses messaging: a switch per FIAREP
 *  Services member and per administrator (Platform -> Crew), on unless
 *  switched off. */
export async function memberMayMessage(staffId: string): Promise<boolean> {
  return (await fiarepModules())[`msg.${staffId}`] !== false;
}

export async function mayMessage(actor: Pick<Actor, "id" | "tenantId" | "role" | "name">): Promise<boolean> {
  if (!isFiarepFieldAdmin(actor) && !isFiarepServices(actor)) return false;
  return memberMayMessage(actor.id);
}

/** The master switch on FIAREP's own Module Management page. On unless it
 *  was switched off; off closes every door — codes, plan clients, all of it. */
export async function messagingOpen(): Promise<boolean> {
  const [org] = await db.select({ features: organizations.features }).from(organizations)
    .where(eq(organizations.id, FIAREP_TENANT)).limit(1);
  const modules = org?.features?.["modules"];
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) return true;
  return (modules as Record<string, unknown>)["fiarepMessagingOpen"] !== false;
}

async function fiarepAdministrators(): Promise<string[]> {
  const rows = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"), eq(staffAccounts.role, "administrator"),
  ));
  return rows.map((r) => r.id);
}

/** A client company that can message FIAREP Services: every client, unless switched off in Module Management. */
export async function clientMessagingEnabled(tenantId: string): Promise<boolean> {
  if (tenantId === FIAREP_TENANT) return false;
  const [org] = await db.select({ features: organizations.features }).from(organizations)
    .where(eq(organizations.id, tenantId)).limit(1);
  const modules = org?.features?.["modules"];
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) return true;
  return (modules as Record<string, unknown>)["fiarepMessaging"] !== false;
}

function emptyThread(partial: Partial<Thread>): Thread {
  return {
    kind: "code", coordinatorId: "", coordinatorName: "", contactName: "", address: "", apartment: "",
    clientTenantId: "", clientCompany: "", messages: [], lastAt: new Date().toISOString(),
    openForFiarep: 0, openForContact: 0, closedAt: "", ...partial,
  };
}

export function threadOf(state: Record<string, unknown>): Thread {
  return emptyThread(state as Partial<Thread>);
}

async function loadThread(id: string) {
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, THREAD_ENTITY), eq(entityRecords.id, id),
    eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(1);
  return row ?? null;
}

async function saveThread(id: string, version: number, thread: Thread): Promise<void> {
  await db.update(entityRecords)
    .set({ state: thread as unknown as Record<string, unknown>, version: version + 1, updatedAt: new Date() })
    .where(and(eq(entityRecords.id, id), eq(entityRecords.tenantId, FIAREP_TENANT)));
}

async function alertFiarep(targets: string[], message: string, detail: string, threadId: string): Promise<void> {
  const ids = [...new Set(targets.filter(Boolean))];
  if (!ids.length) return;
  const rows = await db.insert(notifications).values(
    ids.map((target) => ({ id: randomUUID(), tenantId: FIAREP_TENANT, target, message, detail, reportId: threadId })),
  ).returning();
  for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
}

async function alertClient(tenantId: string, message: string, detail: string, threadId: string): Promise<void> {
  const staff = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
    eq(staffAccounts.tenantId, tenantId), eq(staffAccounts.status, "approved"),
    inArray(staffAccounts.role, ["administrator", "management"]),
  ));
  if (!staff.length) return;
  const rows = await db.insert(notifications).values(
    staff.map((s) => ({ id: randomUUID(), tenantId, target: s.id, message, detail, reportId: threadId })),
  ).returning();
  for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
}

/** The coordinator hands out a code at the door. One code, one conversation. */
export async function issueCode(
  actor: Actor,
  input: { contactName?: unknown; address?: unknown; apartment?: unknown },
): Promise<{ code: string; threadId: string; codeId: string }> {
  const now = new Date();
  const threadId = randomUUID();
  const code = newCode();
  const codeId = hashCode(code);
  const thread = emptyThread({
    kind: "code",
    coordinatorId: actor.id,
    coordinatorName: actor.name,
    contactName: text(input.contactName, 120),
    address: text(input.address),
    apartment: text(input.apartment, 40),
    lastAt: now.toISOString(),
  });
  await db.transaction(async (tx) => {
    await tx.insert(entityRecords).values({
      id: threadId, tenantId: FIAREP_TENANT, entity: THREAD_ENTITY, version: 1,
      state: thread as unknown as Record<string, unknown>, createdBy: actor.id, createdAt: now, updatedAt: now,
    });
    // The code itself is never stored - the row is keyed by its hash, so a
    // leak of the table does not hand anyone a working code.
    await tx.insert(entityRecords).values({
      id: codeId, tenantId: FIAREP_TENANT, entity: CODE_ENTITY, version: 1,
      state: { threadId, coordinatorId: actor.id, active: true, issuedAt: now.toISOString() },
      createdBy: actor.id, createdAt: now, updatedAt: now,
    });
  });
  return { code, threadId, codeId };
}

/** Kill a code: the person who holds it can no longer write or read. */
export async function revokeCode(actor: Actor, threadId: string): Promise<boolean> {
  const row = await loadThread(threadId);
  if (!row) return false;
  const thread = threadOf(row.state);
  if (thread.coordinatorId !== actor.id) return false;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(entityRecords)
      .set({ state: { ...row.state, closedAt: now.toISOString() }, version: (row.version ?? 1) + 1, updatedAt: now })
      .where(and(eq(entityRecords.id, row.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
    await tx.update(entityRecords)
      .set({ state: sql`${entityRecords.state} || ${JSON.stringify({ active: false, revokedAt: now.toISOString() })}::jsonb`, updatedAt: now })
      .where(and(eq(entityRecords.entity, CODE_ENTITY), eq(entityRecords.tenantId, FIAREP_TENANT),
        sql`${entityRecords.state}->>'threadId' = ${threadId}`));
  });
  return true;
}

/** Find the conversation a typed-in code opens. */
export async function threadForCode(code: string): Promise<{ id: string; version: number; thread: Thread } | null> {
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, CODE_ENTITY), eq(entityRecords.id, hashCode(code)),
    eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!row || (row.state as Record<string, unknown>)["active"] !== true) return null;
  const threadId = String((row.state as Record<string, unknown>)["threadId"] || "");
  const thread = threadId ? await loadThread(threadId) : null;
  if (!thread) return null;
  const parsed = threadOf(thread.state);
  if (parsed.closedAt) return null;
  // The member who gave the code was switched off messaging: the door is shut.
  if (parsed.coordinatorId && !(await memberMayMessage(parsed.coordinatorId))) return null;
  return { id: thread.id, version: thread.version ?? 1, thread: parsed };
}

/** The thread a client company on the plan has with FIAREP Services, or —
 *  a separate conversation — with FIAREP's administrator. */
export async function clientThread(tenantId: string, company: string, to: "services" | "admin" = "services"): Promise<{ id: string; version: number; thread: Thread }> {
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, THREAD_ENTITY), eq(entityRecords.tenantId, FIAREP_TENANT),
    eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'clientTenantId' = ${tenantId}`,
  )).limit(10);
  // Threads from before there was a choice belong to FIAREP Services.
  const existing = rows.find((r) => (threadOf(r.state).to || "services") === to);
  if (existing) return { id: existing.id, version: existing.version ?? 1, thread: threadOf(existing.state) };
  const now = new Date();
  const id = randomUUID();
  const thread = emptyThread({ kind: "client", to, clientTenantId: tenantId, clientCompany: company, lastAt: now.toISOString() });
  await db.insert(entityRecords).values({
    id, tenantId: FIAREP_TENANT, entity: THREAD_ENTITY, version: 1,
    state: thread as unknown as Record<string, unknown>, createdBy: "", createdAt: now, updatedAt: now,
  });
  return { id, version: 1, thread };
}

/** Add a message and tell the other side. */
export async function postMessage(
  threadId: string,
  version: number,
  thread: Thread,
  from: "fiarep" | "contact",
  author: { id: string; name: string },
  body: string,
): Promise<{ ok: true; message: Message } | { ok: false; status: number; error: string }> {
  const trimmed = String(body ?? "").trim().slice(0, MAX_BODY);
  if (!trimmed) return { ok: false, status: 400, error: "Write something first." };
  if (thread.closedAt) return { ok: false, status: 409, error: "This conversation is closed." };
  const now = new Date();
  const message: Message = {
    id: randomUUID(), from, authorId: author.id, authorName: author.name || (from === "fiarep" ? "FIAREP Services" : "Contact"),
    body: trimmed, at: now.toISOString(),
  };
  const next: Thread = {
    ...thread,
    messages: [...thread.messages, message].slice(-MAX_MESSAGES),
    lastAt: message.at,
    openForFiarep: from === "contact" ? thread.openForFiarep + 1 : 0,
    openForContact: from === "fiarep" ? thread.openForContact + 1 : 0,
  };
  await saveThread(threadId, version, next);

  const who = next.contactName || next.clientCompany || "Someone";
  const where = [next.address, next.apartment ? `Apt ${next.apartment}` : ""].filter(Boolean).join(" · ");
  if (from === "contact") {
    if (next.kind === "code") {
      await alertFiarep([next.coordinatorId], `${who} sent you a message`, where, threadId);
    } else if (next.to === "admin") {
      const modules = await fiarepModules();
      await alertFiarep((await fiarepAdministrators()).filter((id) => modules[`msg.${id}`] !== false), `${next.clientCompany} sent the administrator a message`, "", threadId);
    } else {
      const unit = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
        eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"),
        eq(staffAccounts.role, "community_coordinator"),
      ));
      const modules = await fiarepModules();
      await alertFiarep(unit.map((u) => u.id).filter((id) => modules[`msg.${id}`] !== false), `${next.clientCompany} sent FIAREP Services a message`, "", threadId);
    }
  } else if (next.kind === "code" && next.contactPush) {
    await pushToContact(next.contactPush, `${author.name || next.coordinatorName || "FIAREP Services"} replied`, trimmed, threadId);
  } else if (next.kind === "client" && next.clientTenantId) {
    await alertClient(next.clientTenantId, next.to === "admin" ? "FIAREP's administrator replied" : "FIAREP Services replied", trimmed.slice(0, 120), threadId);
  }
  return { ok: true, message };
}

/** What a thread looks like to the person holding the code - never the
 *  coordinator's id, never anything about any other conversation. */
export function contactView(thread: Thread) {
  return {
    coordinator: thread.coordinatorName,
    unit: "FIAREP Services",
    closed: Boolean(thread.closedAt),
    messages: thread.messages.map((m) => ({
      id: m.id, mine: m.from === "contact", author: m.from === "fiarep" ? m.authorName : "You", body: m.body, at: m.at,
    })),
  };
}

export async function markRead(threadId: string, version: number, thread: Thread, side: "fiarep" | "contact"): Promise<void> {
  if (side === "fiarep" ? thread.openForFiarep === 0 : thread.openForContact === 0) return;
  await saveThread(threadId, version, { ...thread, ...(side === "fiarep" ? { openForFiarep: 0 } : { openForContact: 0 }) });
}

// ── People who signed up in the app ───────────────────────────────────────
// Anyone who downloads the app can sign up with their first and last name and
// apartment, just so they are on the server. A FIAREP Services member types
// their name, it comes up, they tap it - and the conversation lands on that
// person's phone. The phone keeps a secret; the server keeps only its hash.
export const PEOPLE_ENTITY = "fiarep-message-people";

type Person = {
  firstName: string; lastName: string; name: string; apartment: string; building: string;
  secretHash: string; pushToken: string; createdAt: string;
  /** The conversations FIAREP started with this person: the code is theirs, so the phone can open it. */
  threads: Array<{ threadId: string; code: string; coordinatorId: string }>;
};
const hashSecret = (v: string): string => createHash("sha256").update(`person:${v}`).digest("hex");
const personOf = (state: Record<string, unknown>): Person => ({
  firstName: "", lastName: "", name: "", apartment: "", building: "", secretHash: "", pushToken: "", createdAt: "", threads: [],
  ...(state as Partial<Person>),
});

export async function signUpPerson(input: { firstName?: unknown; lastName?: unknown; apartment?: unknown; building?: unknown; pushToken?: unknown }): Promise<{ id: string; secret: string } | { error: string }> {
  const firstName = text(input.firstName, 60); const lastName = text(input.lastName, 60);
  if (!firstName || !lastName) return { error: "Type your first and last name." };
  const id = randomUUID(); const secret = randomBytes(24).toString("hex"); const now = new Date();
  const person: Person = {
    firstName, lastName, name: `${firstName} ${lastName}`, apartment: text(input.apartment, 40), building: text(input.building, 160),
    secretHash: hashSecret(secret), pushToken: validPushToken(input.pushToken), createdAt: now.toISOString(), threads: [],
  };
  await db.insert(entityRecords).values({
    id, tenantId: FIAREP_TENANT, entity: PEOPLE_ENTITY, version: 1,
    state: person as unknown as Record<string, unknown>, createdBy: "", createdAt: now, updatedAt: now,
  });
  return { id, secret };
}

async function loadPerson(id: string) {
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, PEOPLE_ENTITY), eq(entityRecords.id, id),
    eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
  )).limit(1);
  return row ?? null;
}

/** The person's own view: who they are and the conversations FIAREP started with them. */
export async function personInbox(id: string, secret: string, pushToken: unknown) {
  const row = await loadPerson(id);
  if (!row) return null;
  const person = personOf(row.state);
  if (!secret || person.secretHash !== hashSecret(secret)) return null;
  const token = validPushToken(pushToken);
  if (token && token !== person.pushToken) {
    await db.update(entityRecords).set({ state: { ...row.state, pushToken: token }, updatedAt: new Date() })
      .where(and(eq(entityRecords.id, row.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
  }
  const conversations = [];
  for (const t of person.threads) {
    const th = await loadThread(t.threadId);
    if (!th) continue;
    const thread = threadOf(th.state);
    if (token && token !== thread.contactPush && !thread.closedAt) await saveThread(th.id, th.version ?? 1, { ...thread, contactPush: token });
    conversations.push({ code: t.code, coordinator: thread.coordinatorName, last: thread.messages[thread.messages.length - 1]?.body ?? "", lastAt: thread.lastAt, unread: thread.openForContact, closed: Boolean(thread.closedAt) });
  }
  conversations.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { name: person.name, apartment: person.apartment, building: person.building, conversations };
}

/** FIAREP Services types a name: everyone signed up under it. */
export async function searchPeople(q: string) {
  const term = text(q, 80).toLowerCase();
  if (term.length < 2) return [];
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.entity, PEOPLE_ENTITY), eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false),
    sql`lower(${entityRecords.state}->>'name') like ${`%${term}%`}`,
  )).limit(30);
  return rows.map((r) => { const p = personOf(r.state); return { id: r.id, name: p.name, apartment: p.apartment, building: p.building, since: p.createdAt }; });
}

/** Tap the name: open a conversation with that person (or reopen the one already going) and tell their phone. */
export async function startWithPerson(actor: Actor, personId: string): Promise<{ threadId: string } | null> {
  const row = await loadPerson(personId);
  if (!row) return null;
  const person = personOf(row.state);
  for (const t of person.threads) {
    if (t.coordinatorId !== actor.id) continue;
    const th = await loadThread(t.threadId);
    if (th && !threadOf(th.state).closedAt) return { threadId: th.id };
  }
  const issued = await issueCode(actor, { contactName: person.name, address: person.building, apartment: person.apartment });
  if (person.pushToken) {
    const th = await loadThread(issued.threadId);
    if (th) await saveThread(th.id, th.version ?? 1, { ...threadOf(th.state), contactPush: person.pushToken });
  }
  const next: Person = { ...person, threads: [...person.threads, { threadId: issued.threadId, code: issued.code, coordinatorId: actor.id }] };
  await db.update(entityRecords).set({ state: next as unknown as Record<string, unknown>, version: (row.version ?? 1) + 1, updatedAt: new Date() })
    .where(and(eq(entityRecords.id, row.id), eq(entityRecords.tenantId, FIAREP_TENANT)));
  await pushToContact(person.pushToken, `${actor.name || "FIAREP Services"} wants to message you`, "Open the FIAREP app and press Message FIAREP.", issued.threadId);
  return { threadId: issued.threadId };
}

export { loadThread, MAX_BODY };
