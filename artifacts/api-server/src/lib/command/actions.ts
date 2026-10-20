// The Command Center's fixed list of actions. The interpreter can only pick
// from this list and fill in parameters; nothing else can run. Each action is
// switched on/off (Platform Control for FIAREP and every client; each client's
// own Command Center page for that client), and "write" actions wait for a
// Face ID approval unless their confirm switch is turned off.
// Every action runs inside one organization: a client's Command Center sees
// only that client's buildings, alerts, work orders, complaints and computers.
// FIAREP's own ("default", Platform Control) sees every client. Actions marked
// platformOnly (the FIAREP server itself) exist only on FIAREP's.
import { randomUUID } from "node:crypto";
import os from "node:os";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { checkAllWatched } from "../../routes/alerts";
import { lookupNycPropertyData } from "../nycProperty";
import { commandAgents, commandWorkOrders, type AgentTask } from "./tables";
import { onlineAgents, ONLINE_WINDOW_MS } from "./agentBus";
import { recentAudit } from "./audit";
import { notify } from "../audit";
import type { Actor } from "../auth";

import { bookingView, bookingsOn, createBooking, findMember, findSlot, hm, nyDate, nyLabel, nyTime, staffBookings, type Slot } from "./scheduling";
import { staffAccounts } from "@workspace/db";
import { residentPhotoToWorkOrder } from "./photoWorkOrder";
import { notifyResident } from "../residentNotify";
import { attachmentFor, findContacts, mailStatus, readEmail, readInbox, resolveRecipients, saveContact, sendEmail } from "./mail";
import { createScope, listContractors, listReports, listScopes, saveReport, sendScope, findScope } from "./scopes";
import { createContract, quotePlans, type ContractRequest } from "./sales";
import { clientAlertsStatus, setClientAlerts } from "./clientAccess";
import { commandFillForm } from "./forms";

export type ActionContext = { runId: string; staffId: string; deviceId: string; actorName: string; tenantId: string };
/** FIAREP's own Command Center (Platform Control): sees every client. */
export const isPlatform = (tenantId: string) => tenantId === "default";
export type Risk = "read" | "write";

export type ActionDef = {
  name: string;
  label: string; // shown in Platform Control and on approval cards
  description: string; // given to the interpreter
  risk: Risk;
  confirmDefault: boolean;
  target: "server" | "agent";
  /** The FIAREP server itself: only on FIAREP's own Command Center, never a client's. */
  platformOnly?: boolean;
  schema: Record<string, unknown>;
  /** Server actions only. */
  run?: (params: Record<string, unknown>, ctx: ActionContext) => Promise<unknown>;
  /** One line for the approval card. */
  describe: (params: Record<string, unknown>) => string;
  /** Optional richer line, looked up when the action is proposed. */
  describeLive?: (params: Record<string, unknown>, ctx: ActionContext) => Promise<string | null>;
  /** Spoken line after it ran (writes, which don't go back through the interpreter). */
  spoken?: (result: unknown) => string;
};

const ALERT = "violation-alerts";
const WATCH = "watch-buildings";
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const strList = (v: unknown, max = 200) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, max) : []);

type AlertState = { watchId: string; kind: string; key: string; date: string; address: string; borough: string; company: string; bbl: string; title: string; detail: string; seen: boolean; foundAt: string };

/** Urgent = what the City itself treats as immediately hazardous: HPD Class C,
 *  HPD emergency complaints, DOB / ECB items marked hazardous, unsafe or immediate. */
export function alertUrgency(a: { kind: string; title: string; detail: string }): "urgent" | "routine" {
  const title = a.title.toUpperCase();
  const all = `${title} ${a.detail.toUpperCase()}`;
  if (a.kind === "HPD complaint" && all.includes("(EMERGENCY)")) return "urgent";
  if (a.kind === "HPD violation" && /^CLASS C\b/.test(title)) return "urgent";
  if ((a.kind === "DOB violation" || a.kind === "OATH / ECB summons") &&
    (/(^|[^-])\bHAZARDOUS\b/.test(all) || /CLASS - 1\b|UNSAFE|IMMEDIATE|IMEGNCY/.test(all))) return "urgent";
  return "routine";
}

/** A client's alerts are the ones on its watched buildings (Platform -> Alerts assigns them). */
const alertsOf = (tenantId: string) => isPlatform(tenantId) ? sql`true`
  : sql`${entityRecords.state}->>'watchId' in (select w.id from entity_records w where w.entity = ${WATCH} and w.deleted = false and w.state->>'organizationId' = ${tenantId})`;

async function alertRows(tenantId: string, scope: "unseen" | "all", limit: number, address?: string) {
  const rows = await db.select().from(entityRecords)
    .where(and(eq(entityRecords.entity, ALERT), eq(entityRecords.deleted, false), alertsOf(tenantId),
      scope === "unseen" ? sql`${entityRecords.state}->>'seen' is distinct from 'true'` : sql`true`,
      address ? sql`upper(${entityRecords.state}->>'address') like ${`%${address.toUpperCase()}%`}` : sql`true`))
    .orderBy(desc(entityRecords.createdAt)).limit(limit);
  return rows.map((r) => {
    const s = r.state as unknown as AlertState;
    return { id: r.id, kind: s.kind, date: s.date, address: s.address, borough: s.borough, company: s.company, bbl: s.bbl, title: s.title, detail: s.detail.slice(0, 240), seen: s.seen === true, urgency: alertUrgency(s), key: s.key, foundAt: s.foundAt };
  });
}

function summarizeAlerts(items: Awaited<ReturnType<typeof alertRows>>) {
  const urgent = items.filter((a) => a.urgency === "urgent");
  const byBuilding = new Map<string, { address: string; company: string; urgent: number; routine: number }>();
  for (const a of items) {
    const b = byBuilding.get(a.address) ?? { address: a.address, company: a.company, urgent: 0, routine: 0 };
    b[a.urgency] += 1; byBuilding.set(a.address, b);
  }
  return {
    total: items.length, urgent: urgent.length, routine: items.length - urgent.length,
    byBuilding: [...byBuilding.values()].sort((x, y) => y.urgent - x.urgent || (y.urgent + y.routine) - (x.urgent + x.routine)).slice(0, 25),
    top: [...urgent, ...items.filter((a) => a.urgency === "routine")].slice(0, 15)
      .map(({ id, kind, date, address, title, urgency }) => ({ id, kind, date, address, title, urgency })),
  };
}

async function draftWorkOrders(alertIds: string[], urgentOnly: boolean, ctx: ActionContext) {
  const items = alertIds.length
    ? (await alertRows(ctx.tenantId, "all", 2000)).filter((a) => alertIds.includes(a.id))
    : (await alertRows(ctx.tenantId, "unseen", 2000)).filter((a) => !urgentOnly || a.urgency === "urgent");
  const existing = items.length
    ? new Set((await db.select({ alertId: commandWorkOrders.alertId }).from(commandWorkOrders).where(inArray(commandWorkOrders.alertId, items.map((a) => a.id)))).map((r) => r.alertId))
    : new Set<string>();
  const fresh = items.filter((a) => !existing.has(a.id));
  for (const a of fresh) {
    await db.insert(commandWorkOrders).values({
      id: randomUUID(), tenantId: ctx.tenantId, alertId: a.id, alertKey: a.key, address: a.address, borough: a.borough, company: a.company, bbl: a.bbl,
      kind: a.kind, title: a.title, detail: a.detail, urgency: a.urgency, status: "draft", runId: ctx.runId,
    }).onConflictDoNothing();
  }
  return { drafted: fresh.length, alreadyDrafted: items.length - fresh.length, urgent: fresh.filter((a) => a.urgency === "urgent").length };
}

const workOrdersOf = (tenantId: string) => isPlatform(tenantId) ? sql`true` : eq(commandWorkOrders.tenantId, tenantId);

/** "2026-10-20T09:00" / "2026-10-20 9:00" / "2026-10-20" → New York time. */
function parseWhen(v: unknown): Date | undefined {
  const t = str(v, 40);
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(t);
  if (!m) return undefined;
  return nyTime(m[1]!, m[2] ? `${m[2].padStart(2, "0")}:${m[3]}` : "00:00");
}
/** Members who can be sent to jobs; with a trade, only those whose title matches it ("plumb" matches Plumber, Plumbing Supervisor). */
async function membersFor(tenantId: string, trade: string) {
  const all = await db.select({ id: staffAccounts.id, name: staffAccounts.name, position: staffAccounts.position, role: staffAccounts.role }).from(staffAccounts)
    .where(and(eq(staffAccounts.tenantId, tenantId), eq(staffAccounts.status, "approved")));
  const field = all.filter((s) => !["resident", "vendor", "procurement", "human_resources"].includes(String(s.role)));
  const t = trade.trim().toLowerCase().replace(/(ers?|ing|s)$/, "");
  return (t ? field.filter((s) => String(s.position ?? "").toLowerCase().includes(t)) : field).map((s) => ({ id: s.id, name: s.name, position: s.position ?? "" }));
}
/** Who notifications from the Command Center come from, inside the organization. */
const commandActor = (ctx: ActionContext): Actor => ({ id: ctx.staffId, tenantId: ctx.tenantId, name: ctx.actorName, role: "administrator", position: "", developments: [], sessionVersion: 0 });

const agentProp = { agent: { type: "string", description: "Agent name (the computer). Omit when only one agent is online." } };

export const ACTIONS: ActionDef[] = [
  // ── Buildings & violations ──────────────────────────────────────────────
  {
    name: "violation_sweep", label: "Check every watched building", risk: "read", confirmDefault: false, target: "server",
    description: "Check every watched client building against NYC Open Data right now (HPD complaints and violations, DOB violations, OATH/ECB summonses, 311), then summarize everything not yet marked seen: totals, urgent vs routine, by building, and the top items. Use for 'check every building', 'any new violations'.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_p, ctx) => {
      const mine = isPlatform(ctx.tenantId) ? undefined : ctx.tenantId;
      const check = await checkAllWatched(mine);
      const watched = await db.select({ n: sql<number>`count(*)::int` }).from(entityRecords).where(and(eq(entityRecords.entity, WATCH), eq(entityRecords.deleted, false), mine ? sql`${entityRecords.state}->>'organizationId' = ${mine}` : sql`true`));
      const n = watched[0]?.n ?? 0;
      return { checkedNow: check, watchedBuildings: n, note: n === 0 ? "No buildings are on the watch list for this organization yet (FIAREP assigns them)." : check.checked === 0 && check.errors === 0 ? "A sweep was already running; showing current results." : undefined, unseen: summarizeAlerts(await alertRows(ctx.tenantId, "unseen", 2000)) };
    },
    describe: () => "Check every watched building now",
  },
  {
    name: "list_alerts", label: "List violation alerts", risk: "read", confirmDefault: false, target: "server",
    description: "List violation alerts already found on watched buildings, optionally only unseen and/or one address. Each has an id usable with prepare_work_orders and mark_alerts_seen.",
    schema: { type: "object", properties: { scope: { type: "string", enum: ["unseen", "all"] }, address: { type: "string", description: "Part of the street address" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    run: async (p, ctx) => alertRows(ctx.tenantId, p["scope"] === "all" ? "all" : "unseen", num(p["limit"], 30, 1, 100), str(p["address"], 120) || undefined),
    describe: () => "List alerts",
  },
  {
    name: "property_lookup", label: "Look up an NYC address (HPD / DOB)", risk: "read", confirmDefault: false, target: "server",
    description: "Look up one New York City address live: HPD violations, DOB violations and HPD complaints, with open counts.",
    schema: { type: "object", properties: { address: { type: "string" } }, required: ["address"], additionalProperties: false },
    run: async (p) => {
      const r = await lookupNycPropertyData(str(p["address"], 200), 25);
      if (!r) return { error: "That address could not be matched to an NYC property." };
      return { property: r.property, summary: r.summary, warnings: r.warnings,
        openHpd: r.hpdViolations.filter((v) => !/close|resolved/i.test(v.status)).slice(0, 15).map((v) => ({ class: v.class, apt: v.apartment, description: v.description.slice(0, 160), date: v.inspectionDate })),
        openDob: r.dobViolations.filter((v) => v.status === "Open").slice(0, 10).map((v) => ({ type: v.type, description: v.description.slice(0, 160), date: v.issueDate })) };
    },
    describe: (p) => `Look up ${str(p["address"])}`,
  },
  {
    name: "complaint_feed", label: "Resident complaints", risk: "read", confirmDefault: false, target: "server",
    description: "Most recent resident complaints with their status (on FIAREP's own Command Center: at every client FIAREP serves; on a client's: that client's).",
    schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (p, ctx) => {
      const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false), isPlatform(ctx.tenantId) ? sql`${entityRecords.tenantId} <> 'default'` : eq(entityRecords.tenantId, ctx.tenantId)))
        .orderBy(desc(entityRecords.createdAt)).limit(num(p["limit"], 20, 1, 50));
      const orgs = new Map((await db.select({ id: organizations.id, name: organizations.name }).from(organizations)).map((o) => [o.id, o.name]));
      return rows.map((r) => {
        const s = r.state as Record<string, unknown>;
        return { id: r.id, client: orgs.get(r.tenantId) ?? r.tenantId, development: r.development, status: str(s["status"], 40), category: str(s["category"] ?? s["type"], 80), address: str(s["address"] ?? s["building"], 120), apartment: str(s["apartment"] ?? s["unit"], 20), createdAt: r.createdAt };
      });
    },
    describe: () => "Recent resident complaints",
  },
  {
    name: "list_work_orders", label: "List work orders", risk: "read", confirmDefault: false, target: "server",
    description: "List work orders prepared from violation alerts, by status (draft = waiting for approval).",
    schema: { type: "object", properties: { status: { type: "string", enum: ["draft", "approved", "rejected", "assigned", "any"] } }, additionalProperties: false },
    run: async (p, ctx) => {
      const status = str(p["status"], 20) || "draft";
      const rows = await db.select().from(commandWorkOrders).where(and(workOrdersOf(ctx.tenantId), status === "any" ? sql`true` : eq(commandWorkOrders.status, status))).orderBy(desc(commandWorkOrders.createdAt)).limit(100);
      return rows.map((w) => ({ id: w.id, status: w.status, urgency: w.urgency, address: w.address, kind: w.kind, title: w.title, trade: w.trade ?? undefined, assignedTo: w.assignedName ?? undefined, createdAt: w.createdAt }));
    },
    describe: () => "List work orders",
  },
  {
    name: "prepare_work_orders", label: "Prepare work orders from alerts", risk: "write", confirmDefault: false, target: "server",
    description: "Draft work orders (status draft, waiting for approval) from violation alerts: either the given alert ids, or every unseen alert (urgentOnly to limit to urgent). Drafting does not send anything to anyone.",
    schema: { type: "object", properties: { alertIds: { type: "array", items: { type: "string" } }, urgentOnly: { type: "boolean" } }, additionalProperties: false },
    run: async (p, ctx) => draftWorkOrders(strList(p["alertIds"]), p["urgentOnly"] === true, ctx),
    describe: (p) => strList(p["alertIds"]).length ? `Draft work orders for ${strList(p["alertIds"]).length} alert(s)` : `Draft work orders for every unseen${p["urgentOnly"] === true ? " urgent" : ""} alert`,
    spoken: (r) => { const x = r as { drafted: number; urgent: number }; return `${x.drafted} work order${x.drafted === 1 ? "" : "s"} prepared for approval, ${x.urgent} urgent.`; },
  },
  {
    name: "decide_work_order", label: "Approve / reject a work order", risk: "write", confirmDefault: true, target: "server",
    description: "Approve or reject one drafted work order by id.",
    schema: { type: "object", properties: { workOrderId: { type: "string" }, decision: { type: "string", enum: ["approve", "reject"] }, note: { type: "string" } }, required: ["workOrderId", "decision"], additionalProperties: false },
    run: async (p, ctx) => {
      const id = str(p["workOrderId"], 80);
      const status = p["decision"] === "approve" ? "approved" : "rejected";
      const [row] = await db.update(commandWorkOrders).set({ status, note: str(p["note"], 500) || null, decidedBy: ctx.actorName, decidedAt: new Date() })
        .where(and(eq(commandWorkOrders.id, id), workOrdersOf(ctx.tenantId), eq(commandWorkOrders.status, "draft"))).returning();
      if (!row) return { error: "No draft work order with that id." };
      return { id: row.id, status: row.status, address: row.address, title: row.title };
    },
    describe: (p) => `${p["decision"] === "approve" ? "Approve" : "Reject"} work order ${str(p["workOrderId"], 12)}…`,
    describeLive: async (p, ctx) => {
      const [w] = await db.select().from(commandWorkOrders).where(and(eq(commandWorkOrders.id, str(p["workOrderId"], 80)), workOrdersOf(ctx.tenantId))).limit(1);
      return w ? `${p["decision"] === "approve" ? "Approve" : "Reject"} work order — ${w.address} · ${w.title}` : null;
    },
    spoken: (r) => { const x = r as { status?: string; address?: string; error?: string }; return x.error ?? `Work order ${x.status} for ${x.address}.`; },
  },
  {
    name: "mark_alerts_seen", label: "Mark alerts seen", risk: "write", confirmDefault: true, target: "server",
    description: "Mark violation alerts as seen (they stop showing red). Give alert ids, or all=true for every unseen alert.",
    schema: { type: "object", properties: { alertIds: { type: "array", items: { type: "string" } }, all: { type: "boolean" } }, additionalProperties: false },
    run: async (p, ctx) => {
      const ids = strList(p["alertIds"], 2000);
      const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, ALERT), eq(entityRecords.deleted, false), alertsOf(ctx.tenantId),
        sql`${entityRecords.state}->>'seen' is distinct from 'true'`, p["all"] === true ? sql`true` : ids.length ? inArray(entityRecords.id, ids) : sql`false`));
      const now = new Date();
      for (const r of rows) await db.update(entityRecords).set({ state: { ...r.state, seen: true }, updatedAt: now }).where(eq(entityRecords.id, r.id));
      return { marked: rows.length };
    },
    describe: (p) => p["all"] === true ? "Mark every unseen alert seen" : `Mark ${strList(p["alertIds"]).length} alert(s) seen`,
    spoken: (r) => `${(r as { marked: number }).marked} alerts marked seen.`,
  },
  // ── FIAREP server ───────────────────────────────────────────────────────
  {
    name: "server_status", label: "FIAREP server status", risk: "read", confirmDefault: false, target: "server", platformOnly: true,
    description: "Health of the FIAREP API right now: uptime, memory, database round-trip, alert checker, desktop agents online.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const t0 = Date.now(); let dbOk = true; let dbError = "";
      try { await db.execute(sql`select 1`); } catch (e) { dbOk = false; dbError = e instanceof Error ? e.message : "failed"; }
      const dbMs = Date.now() - t0;
      const lastCheck = await db.select({ at: sql<string>`max(${entityRecords.state}->>'lastCheckedAt')`, errors: sql<number>`count(*) filter (where coalesce(${entityRecords.state}->>'lastError','') <> '')::int` })
        .from(entityRecords).where(and(eq(entityRecords.entity, WATCH), eq(entityRecords.deleted, false)));
      const agents = await db.select({ name: commandAgents.name, lastSeenAt: commandAgents.lastSeenAt }).from(commandAgents).where(and(eq(commandAgents.status, "active"), eq(commandAgents.tenantId, "default")));
      const mem = process.memoryUsage();
      return {
        api: { up: true, uptimeMinutes: Math.round(process.uptime() / 60), node: process.version, rssMb: Math.round(mem.rss / 1e6), heapUsedMb: Math.round(mem.heapUsed / 1e6), host: os.hostname(), load1m: os.loadavg()[0] },
        database: { ok: dbOk, roundTripMs: dbMs, error: dbError || undefined },
        alertChecker: { lastCheckedAt: lastCheck[0]?.at ?? null, buildingsWithErrors: lastCheck[0]?.errors ?? 0 },
        agents: agents.map((a) => ({ name: a.name, online: !!a.lastSeenAt && Date.now() - a.lastSeenAt.getTime() < ONLINE_WINDOW_MS, lastSeenAt: a.lastSeenAt })),
      };
    },
    describe: () => "Server status",
  },
  {
    name: "restart_api", label: "Restart the FIAREP API", risk: "write", confirmDefault: true, target: "server", platformOnly: true,
    description: "Restart the FIAREP API process: it exits a few seconds after answering and its supervisor (Replit deployment / PM2) starts it again. Only when asked to restart or fix a stuck API.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      setTimeout(() => process.exit(0), 2_000).unref();
      return { restarting: true, inSeconds: 2 };
    },
    describe: () => "Restart the FIAREP API",
    spoken: () => "Restarting the API. It should be back in under a minute.",
  },
  {
    name: "audit_recent", label: "Read the command audit trail", risk: "read", confirmDefault: false, target: "server",
    description: "The most recent Command Center audit entries (who ran what, approvals, results).",
    schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (p, ctx) => (await recentAudit(num(p["limit"], 15, 1, 50), ctx.tenantId)).map((r) => ({ at: r.at, actor: r.actor, event: r.event, detail: r.detail })),
    describe: () => "Read audit trail",
  },
  // ── Calendar: booking members for jobs ──────────────────────────────────
  {
    name: "staff_schedule", label: "A member's schedule", risk: "read", confirmDefault: false, target: "server",
    description: "What a member is booked for on a day (default today), New York time: each job's time, building, apartments, and drive time from the job before.",
    schema: { type: "object", properties: { member: { type: "string", description: "Member's name" }, date: { type: "string", description: "YYYY-MM-DD (New York). Omit for today." } }, required: ["member"], additionalProperties: false },
    run: async (p, ctx) => {
      const m = await findMember(ctx.tenantId, str(p["member"], 80));
      if ("error" in m) return m;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p["date"], 10)) ? str(p["date"], 10) : nyDate(new Date());
      return { member: m.name, date, jobs: (await bookingsOn(ctx.tenantId, m.id, date)).map(bookingView) };
    },
    describe: (p) => `Schedule for ${str(p["member"])}`,
  },
  {
    name: "find_time", label: "Find a free time for a member", risk: "read", confirmDefault: false, target: "server",
    description: "Find the earliest time a member can do a job at an address without clashing with their other bookings, counting drive time from the job before (Google Maps with traffic) and to the job after. Several apartments in one building can fill a whole building day. Does not book anything.",
    schema: { type: "object", properties: {
      member: { type: "string" }, address: { type: "string", description: "Building address (apartment separate)" },
      apartments: { type: "array", items: { type: "string" } }, minutes: { type: "integer", minimum: 15, maximum: 720, description: "How long the job takes; omit to use the default" },
      after: { type: "string", description: "Earliest start, ISO date-time or YYYY-MM-DD (New York)" }, wholeDay: { type: "boolean", description: "Keep the member in this building the whole day" },
    }, required: ["member", "address"], additionalProperties: false },
    run: async (p, ctx) => {
      const m = await findMember(ctx.tenantId, str(p["member"], 80));
      if ("error" in m) return m;
      const r = await findSlot(ctx.tenantId, m.id, { address: str(p["address"], 300), apartments: strList(p["apartments"], 50), minutes: p["minutes"] === undefined ? undefined : num(p["minutes"], 120, 15, 720), after: parseWhen(p["after"]), wholeDay: typeof p["wholeDay"] === "boolean" ? p["wholeDay"] : undefined });
      return r.slot ? { member: m.name, start: nyLabel(r.slot.startAt), end: nyLabel(r.slot.endAt), length: hm(r.minutes), wholeDay: r.wholeDay, driveFromPreviousJob: r.slot.travelDetail, daysSkipped: r.skipped.slice(0, 5) } : { member: m.name, error: "No free time in the next 3 weeks.", daysSkipped: r.skipped.slice(0, 8) };
    },
    describe: (p) => `Find a time for ${str(p["member"])} at ${str(p["address"])}`,
  },
  {
    name: "book_job", label: "Book a member for a job (calendar)", risk: "write", confirmDefault: true, target: "server",
    description: "Put a job on a member's calendar and notify them. With 'start' it books that exact time if it's free (including drive time); without it, the earliest free time. Never double-books: a member already at a job can't be booked for another at the same time, and on a building day can't be sent to another building.",
    schema: { type: "object", properties: {
      member: { type: "string" }, title: { type: "string", description: "What the job is" }, address: { type: "string" },
      apartments: { type: "array", items: { type: "string" } }, minutes: { type: "integer", minimum: 15, maximum: 720 },
      start: { type: "string", description: "Exact start, ISO date-time in New York time (e.g. 2026-10-20T09:00)" }, after: { type: "string" },
      wholeDay: { type: "boolean" }, note: { type: "string" }, workOrderId: { type: "string", description: "Command Center work order this is for, if any" },
    }, required: ["member", "title", "address"], additionalProperties: false },
    run: async (p, ctx) => {
      const m = await findMember(ctx.tenantId, str(p["member"], 80));
      if ("error" in m) return m;
      const address = str(p["address"], 300);
      const apartments = strList(p["apartments"], 50);
      const r = await findSlot(ctx.tenantId, m.id, { address, apartments, minutes: p["minutes"] === undefined ? undefined : num(p["minutes"], 120, 15, 720), at: parseWhen(p["start"]), after: parseWhen(p["after"]), wholeDay: typeof p["wholeDay"] === "boolean" ? p["wholeDay"] : undefined });
      if (!r.slot) return { error: p["start"] ? `${m.name} can't take that time: ${r.skipped[0]?.why ?? "it's taken"}.` : `${m.name} has no free time in the next 3 weeks.` };
      const b = await createBooking(ctx.tenantId, m, { title: str(p["title"], 200), address, apartments, slot: r.slot, wholeDay: r.wholeDay, sourceEntity: str(p["workOrderId"], 80) ? "command-work-order" : undefined, sourceId: str(p["workOrderId"], 80) || undefined, note: str(p["note"], 1000) || undefined, createdBy: ctx.actorName });
      if ("error" in b) return b;
      await notify(commandActor(ctx), m.id, `New job: ${b.title}`, `${nyLabel(b.startAt)} at ${b.address}${apartments.length ? ` (${apartments.join(", ")})` : ""}`, b.id).catch(() => undefined);
      return { booked: bookingView(b), driveFromPreviousJob: r.slot.travelDetail, notified: m.name };
    },
    describe: (p) => `Book ${str(p["member"])}: ${str(p["title"], 80)} at ${str(p["address"])}${str(p["start"]) ? ` (${str(p["start"])})` : " (first free time)"}`,
    spoken: (r) => { const x = r as { booked?: { member: string; when: string }; error?: string }; return x.error ?? `Booked ${x.booked!.member} for ${x.booked!.when}. They've been notified.`; },
  },
  {
    name: "cancel_booking", label: "Cancel a calendar booking", risk: "write", confirmDefault: true, target: "server",
    description: "Cancel one booking (by id from staff_schedule) and tell the member.",
    schema: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"], additionalProperties: false },
    run: async (p, ctx) => {
      const [b] = await db.update(staffBookings).set({ status: "cancelled" }).where(and(eq(staffBookings.id, str(p["bookingId"], 80)), eq(staffBookings.tenantId, ctx.tenantId), eq(staffBookings.status, "booked"))).returning();
      if (!b) return { error: "No booking with that id." };
      await notify(commandActor(ctx), b.staffId, `Job cancelled: ${b.title}`, `${nyLabel(b.startAt)} at ${b.address}`, b.id).catch(() => undefined);
      return { cancelled: bookingView(b) };
    },
    describe: (p) => `Cancel booking ${str(p["bookingId"], 12)}…`,
    spoken: (r) => { const x = r as { cancelled?: { member: string; when: string }; error?: string }; return x.error ?? `Cancelled ${x.cancelled!.member}'s job ${x.cancelled!.when}.`; },
  },
  {
    name: "complaint_to_work_order", label: "Work order from a resident's photo", risk: "write", confirmDefault: false, target: "server",
    description: "Smart Repair reads a resident complaint's photo (what's wrong, where, trade, tools, parts, steps, priority) and drafts a work order with those repair instructions, then notifies the supervisors the complaint goes to. Give the complaint number (e.g. RC-12345). Does nothing twice for the same complaint.",
    schema: { type: "object", properties: { complaintNo: { type: "string" } }, required: ["complaintNo"], additionalProperties: false },
    run: async (p, ctx) => {
      const no = str(p["complaintNo"], 20).toUpperCase();
      const [r] = await db.select({ id: entityRecords.id }).from(entityRecords).where(and(eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'complaintNo' = ${no}`, isPlatform(ctx.tenantId) ? sql`true` : eq(entityRecords.tenantId, ctx.tenantId))).limit(1);
      if (!r) return { error: `No complaint ${no}.` };
      const [row] = await db.select({ tenantId: entityRecords.tenantId }).from(entityRecords).where(eq(entityRecords.id, r.id)).limit(1);
      const out = await residentPhotoToWorkOrder(row!.tenantId, r.id, ctx.actorName);
      if ("error" in out) return out;
      const w = out.workOrder;
      return { workOrder: { id: w.id, title: w.title, trade: w.trade, urgency: w.urgency, status: w.status, instructions: w.detail.slice(0, 1200) }, alreadyExisted: !out.created };
    },
    describe: (p) => `Work order from complaint ${str(p["complaintNo"], 20)}'s photo`,
    spoken: (r) => { const x = r as { workOrder?: { title: string; trade?: string | null; urgency: string }; error?: string }; return x.error ?? `Work order drafted: ${x.workOrder!.title}${x.workOrder!.trade ? `, for a ${x.workOrder!.trade}` : ""}${x.workOrder!.urgency === "urgent" ? ", urgent" : ""}.`; },
  },
  {
    name: "find_members", label: "Members who can do a trade", risk: "read", confirmDefault: false, target: "server",
    description: "List members of this organization, optionally only those whose title matches a trade (e.g. Plumber, Electrician, Painter), with their next free time for a job at an address if one is given.",
    schema: { type: "object", properties: { trade: { type: "string" }, address: { type: "string" }, minutes: { type: "integer", minimum: 15, maximum: 720 } }, additionalProperties: false },
    run: async (p, ctx) => {
      const list = await membersFor(ctx.tenantId, str(p["trade"], 60));
      const address = str(p["address"], 300);
      const out = [];
      for (const m of list.slice(0, 15)) {
        const r = address ? await findSlot(ctx.tenantId, m.id, { address, minutes: p["minutes"] === undefined ? undefined : num(p["minutes"], 120, 15, 720) }) : null;
        out.push({ name: m.name, title: m.position, nextFree: r?.slot ? nyLabel(r.slot.startAt) : address ? "nothing in 3 weeks" : undefined });
      }
      return { trade: str(p["trade"], 60) || "any", members: out };
    },
    describe: (p) => `Members${str(p["trade"]) ? ` (${str(p["trade"])})` : ""}`,
  },
  {
    name: "assign_work_order", label: "Assign a work order to a member", risk: "write", confirmDefault: true, target: "server",
    description: "Assign an approved (or draft) work order: to the named member, or — with a trade (or the trade Smart Repair found) — to whichever member with that trade is free soonest. For a resident's complaint it also tells the resident the visit time. Books it on their calendar (no double booking, drive time counted) and notifies them. Approves a draft at the same time.",
    schema: { type: "object", properties: {
      workOrderId: { type: "string" }, member: { type: "string" }, trade: { type: "string" },
      minutes: { type: "integer", minimum: 15, maximum: 720 }, start: { type: "string" }, after: { type: "string" }, apartments: { type: "array", items: { type: "string" } },
    }, required: ["workOrderId"], additionalProperties: false },
    run: async (p, ctx) => {
      const [w] = await db.select().from(commandWorkOrders).where(and(eq(commandWorkOrders.id, str(p["workOrderId"], 80)), workOrdersOf(ctx.tenantId))).limit(1);
      if (!w) return { error: "No work order with that id." };
      if (w.status === "rejected") return { error: "That work order was rejected." };
      if (w.status === "assigned") return { error: `Already assigned to ${w.assignedName}.` };
      const address = [w.address, w.borough].filter(Boolean).join(", ");
      const apartments = strList(p["apartments"], 50).length ? strList(p["apartments"], 50) : (/Apt\s+([\w-]+)/i.exec(`${w.title} ${w.detail}`)?.[1] ? [/Apt\s+([\w-]+)/i.exec(`${w.title} ${w.detail}`)![1]!] : []);
      const opts = { address, apartments, minutes: p["minutes"] === undefined ? undefined : num(p["minutes"], 120, 15, 720), at: parseWhen(p["start"]), after: parseWhen(p["after"]) };
      let pick: { m: { id: string; name: string }; slot: Slot; wholeDay: boolean } | null = null;
      if (str(p["member"], 80)) {
        const m = await findMember(ctx.tenantId, str(p["member"], 80));
        if ("error" in m) return m;
        const r = await findSlot(ctx.tenantId, m.id, opts);
        if (!r.slot) return { error: `${m.name} has no free time${opts.at ? " then" : " in the next 3 weeks"}.` };
        pick = { m, slot: r.slot, wholeDay: r.wholeDay };
      } else {
        const trade = str(p["trade"], 60) || w.trade || "";
        if (!trade) return { error: "Say who should do it, or which trade." };
        const list = await membersFor(ctx.tenantId, trade);
        if (!list.length) return { error: `No member's title matches "${trade}".` };
        for (const m of list.slice(0, 25)) {
          const r = await findSlot(ctx.tenantId, m.id, opts);
          if (r.slot && (!pick || r.slot.startAt < pick.slot.startAt)) pick = { m, slot: r.slot, wholeDay: r.wholeDay };
        }
        if (!pick) return { error: `No ${trade} is free${opts.at ? " then" : " in the next 3 weeks"}.` };
      }
      const b = await createBooking(ctx.tenantId, pick.m, { title: `${w.kind}: ${w.title}`.slice(0, 200), address, apartments, slot: pick.slot, wholeDay: pick.wholeDay, sourceEntity: "command-work-order", sourceId: w.id, note: w.detail, createdBy: ctx.actorName });
      if ("error" in b) return b;
      await db.update(commandWorkOrders).set({ status: "assigned", assignedStaffId: pick.m.id, assignedName: pick.m.name, bookingId: b.id, decidedBy: w.decidedBy ?? ctx.actorName, decidedAt: w.decidedAt ?? new Date() }).where(eq(commandWorkOrders.id, w.id));
      // A resident's complaint: put the visit on the complaint and tell the resident when.
      if (w.alertId.startsWith("resident:")) {
        const reportId = w.alertId.slice("resident:".length);
        const appointment = { bookingId: b.id, startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), staffId: pick.m.id, staffName: pick.m.name, bookedAt: new Date().toISOString(), by: ctx.actorName };
        await db.update(entityRecords).set({ state: sql`${entityRecords.state} || ${JSON.stringify({ appointment, appointmentDate: appointment.startAt })}::jsonb`, updatedAt: new Date() }).where(eq(entityRecords.id, reportId));
        const [rep] = await db.select().from(entityRecords).where(eq(entityRecords.id, reportId)).limit(1);
        if (rep) await notifyResident(rep, "Visit scheduled", `Someone from maintenance is scheduled for ${nyLabel(b.startAt)}.`).catch(() => undefined);
      }
      await notify(commandActor(ctx), pick.m.id, `New job: ${w.urgency === "urgent" ? "URGENT — " : ""}${w.title}`, `${nyLabel(b.startAt)} at ${address}${apartments.length ? ` (${apartments.join(", ")})` : ""} · ${w.kind}`, b.id).catch(() => undefined);
      return { assigned: pick.m.name, booked: bookingView(b), driveFromPreviousJob: pick.slot.travelDetail, workOrder: { id: w.id, address, title: w.title } };
    },
    describe: (p) => `Assign work order ${str(p["workOrderId"], 12)}… to ${str(p["member"]) || `the first free ${str(p["trade"]) || "member"}`}`,
    describeLive: async (p, ctx) => {
      const [w] = await db.select().from(commandWorkOrders).where(and(eq(commandWorkOrders.id, str(p["workOrderId"], 80)), workOrdersOf(ctx.tenantId))).limit(1);
      return w ? `Assign ${w.address} · ${w.title} to ${str(p["member"]) || `the first free ${str(p["trade"]) || "member"}`}` : null;
    },
    spoken: (r) => { const x = r as { assigned?: string; booked?: { when: string }; error?: string }; return x.error ?? `Assigned to ${x.assigned}, ${x.booked!.when}. They've been notified.`; },
  },
  // ── Scopes of work, contractors, reports ───────────────────────────────
  {
    name: "list_contractors", label: "Contractors on the vendor list", risk: "read", confirmDefault: false, target: "server",
    description: "The contractors on this organization's vendor list (Procurement → Vendor Contacts): name, company, trade, email. Optionally only one trade.",
    schema: { type: "object", properties: { trade: { type: "string" } }, additionalProperties: false },
    run: async (p, ctx) => { const list = await listContractors(ctx.tenantId, str(p["trade"], 60)); return { count: list.length, contractors: list.slice(0, 50) }; },
    describe: (p) => `Contractors${str(p["trade"]) ? ` (${str(p["trade"])})` : ""}`,
  },
  {
    name: "list_scopes", label: "Scopes of work", risk: "read", confirmDefault: false, target: "server",
    description: "Scopes of work in Procurement, newest first: code, status (draft, submitted, approved = ready to send, bidding = out to contractors, awarded, closed), address, who wrote it, whether it was emailed. Optionally one status.",
    schema: { type: "object", properties: { status: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    run: async (p, ctx) => ({ scopes: await listScopes(ctx.tenantId, str(p["status"], 30), num(p["limit"], 15, 1, 50)) }),
    describe: () => "Scopes of work",
  },
  {
    name: "write_scope_of_work", label: "Write a scope of work", risk: "write", confirmDefault: false, target: "server",
    description: "Write a scope of work for contractors and save it in Procurement, ready to send (nothing is emailed yet). Base it on a work order (workOrderId, from list_work_orders), a resident complaint (complaintNo) or an address and what's wrong. You write: scope = a clear scope for contractors to bid on (the work, where, materials and standard, protection and clean-up, permits if any, what's excluded); lines = the items for contractors to price (title, location, description, no prices). Optional walk-through and bid-close times (YYYY-MM-DDTHH:MM, New York time).",
    schema: { type: "object", properties: {
      workOrderId: { type: "string" }, complaintNo: { type: "string" }, address: { type: "string" }, title: { type: "string" },
      scope: { type: "string" },
      lines: { type: "array", maxItems: 40, items: { type: "object", properties: { title: { type: "string" }, location: { type: "string" }, description: { type: "string" } }, required: ["title"], additionalProperties: false } },
      walkthroughAt: { type: "string" }, walkthroughNote: { type: "string" }, bidCloseAt: { type: "string" },
    }, required: ["scope"], additionalProperties: false },
    run: async (p, ctx) => {
      const lines = Array.isArray(p["lines"]) ? (p["lines"] as Array<Record<string, unknown>>).map((l) => ({ title: str(l["title"], 120), location: str(l["location"], 120), description: str(l["description"], 600) })) : [];
      const when = (v: unknown) => { const d = parseWhen(v); return d ? nyLabel(d) : str(v, 40); };
      return createScope({ tenantId: ctx.tenantId, byId: ctx.staffId, byName: ctx.actorName, runId: ctx.runId, workOrderId: str(p["workOrderId"], 60) || undefined, complaintNo: str(p["complaintNo"], 20) || undefined,
        address: str(p["address"], 300), title: str(p["title"], 200), scope: typeof p["scope"] === "string" ? p["scope"] : "", lines,
        walkthroughAt: p["walkthroughAt"] ? when(p["walkthroughAt"]) : undefined, walkthroughNote: str(p["walkthroughNote"], 300), bidCloseAt: p["bidCloseAt"] ? when(p["bidCloseAt"]) : undefined });
    },
    describe: (p) => `Write a scope of work${str(p["complaintNo"]) ? ` for ${str(p["complaintNo"])}` : str(p["address"]) ? ` for ${str(p["address"])}` : ""}`,
    spoken: (r) => { const x = r as { scope?: { code: string; address: string }; error?: string }; return x.error ?? `Scope ${x.scope!.code} for ${x.scope!.address} is saved in Procurement, ready to send to contractors.`; },
  },
  {
    name: "send_scope_to_contractors", label: "Send a scope to contractors", risk: "write", confirmDefault: true, target: "server",
    description: "Email a scope of work to contractors (FIAREP's Outlook), the same as Procurement's release: a scope ready to send gets its SR- vendor code and goes to every contractor on the vendor list, or only the ones named (name, company or email). A scope already out for bid goes again to the ones named, or to everyone on the list if none are named. Give the scope's code (sr-12345 / SR-12345) or its complaint number.",
    schema: { type: "object", properties: { scope: { type: "string" }, contractors: { type: "array", items: { type: "string" }, maxItems: 30 } }, required: ["scope"], additionalProperties: false },
    run: async (p, ctx) => sendScope(ctx.tenantId, str(p["scope"], 60), strList(p["contractors"], 30), { id: ctx.staffId, name: ctx.actorName, runId: ctx.runId }),
    describe: (p) => `Send scope ${str(p["scope"], 60)} to ${strList(p["contractors"]).length ? strList(p["contractors"]).join(", ") : "every contractor on the vendor list"}`,
    describeLive: async (p, ctx) => {
      const r = await findScope(ctx.tenantId, str(p["scope"], 60)); if (!r) return null;
      const names = strList(p["contractors"]);
      const all = names.length ? 0 : (await listContractors(r.tenantId)).length;
      return `Email scope ${str(r.state["trackingId"], 20)} (${str(r.state["address"], 120)}) to ${names.length ? names.join(", ") : `all ${all} contractors on the vendor list`}`;
    },
    spoken: (r) => { const x = r as { code?: string; emailed?: number; failed?: number; emailError?: string; error?: string }; return x.error ?? (x.emailError ? `Scope ${x.code} is out for bid, but email isn't working: ${x.emailError}.` : `Scope ${x.code} sent to ${x.emailed} contractor${x.emailed === 1 ? "" : "s"}${x.failed ? `; ${x.failed} didn't go through` : ""}.`); },
  },
  {
    name: "write_report", label: "Write a report", risk: "write", confirmDefault: false, target: "server",
    description: "Save a report you wrote (from what the other actions returned: alerts, complaints, work orders, schedules, scopes) so it can be opened and printed from the Command Center page. Plain text; use lines starting with '# ' for headings and '- ' for list items.",
    schema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"], additionalProperties: false },
    run: async (p, ctx) => saveReport(ctx.tenantId, str(p["title"], 200), typeof p["body"] === "string" ? p["body"].replace(/^\s*</, "‹") : "", ctx.actorName, ctx.runId), // only contracts are saved as pages
    describe: (p) => `Save the report "${str(p["title"], 120)}"`,
    spoken: (r) => { const x = r as { title?: string }; return `Report saved: ${x.title}. It's on the Command Center page.`; },
  },
  {
    name: "list_reports", label: "Saved reports", risk: "read", confirmDefault: false, target: "server",
    description: "Reports saved with write_report, newest first (title, id, who, when).",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_p, ctx) => ({ reports: await listReports(ctx.tenantId, 30) }),
    describe: () => "Saved reports",
  },
  // ── Company Forms ───────────────────────────────────────────────────────
  {
    name: "fill_form", label: "Fill in a company form", risk: "write", confirmDefault: false, target: "server",
    description: "Fill a Company Form for a building and save it on the Company Forms page: the address the way the form asks for it, borough, ZIP, county, HPD registration number and owner, from the City's records. For a DOB OATH summons, give summons and it fills the AEU2 (Certificate of Correction) from that summons. Forms: AEU2 certificate of correction, violation correction timeline, vermin treatment request, vermin complaint & compliance, vermin treatment log, vermin tenant acknowledgment, lead paint disclosure, lead remediation tracking, lead hazard work log, AF-6, AF-7, AF-8, CIV 194, mold assessment, mold remediation, tenant notice. If the building isn't given, ask which address.",
    schema: { type: "object", properties: { form: { type: "string" }, address: { type: "string" }, summons: { type: "string" }, apartment: { type: "string" } }, required: ["form"], additionalProperties: false },
    run: async (p, ctx) => commandFillForm(ctx.tenantId, { form: str(p["form"], 120), address: str(p["address"], 200) || undefined, summons: str(p["summons"], 40) || undefined, apartment: str(p["apartment"], 20) || undefined }, { id: ctx.staffId, name: ctx.actorName }),
    describe: (p) => `Fill ${str(p["form"], 60)}${str(p["summons"]) ? ` for summons ${str(p["summons"], 30)}` : str(p["address"]) ? ` for ${str(p["address"], 80)}` : ""}`,
    spoken: (r) => { const x = r as { form?: string; saved?: string; error?: string }; return x.error ?? `${x.form} filled for ${x.saved}. It's on Company Forms to check and sign.`; },
  },
  // ── Client access (FIAREP's own Command Center) ──────────────────────────
  {
    name: "client_alerts_status", label: "A client's violation alerts access", risk: "read", confirmDefault: false, target: "server", platformOnly: true,
    description: "Whether a client has the Violation Alerts page and/or the Complaint Command strip switched on, and how many of its buildings are on the watch list.",
    schema: { type: "object", properties: { client: { type: "string" } }, required: ["client"], additionalProperties: false },
    run: async (p) => clientAlertsStatus(str(p["client"], 120)),
    describe: (p) => `Alerts access for ${str(p["client"], 80)}`,
  },
  {
    name: "set_client_alerts", label: "Turn a client's violation alerts on or off", risk: "write", confirmDefault: true, target: "server", platformOnly: true,
    description: "Give a client permission to see its violation alerts, or take it away: page = the Violation Alerts page in their menu, command = the red strip on their Borough Director's Complaint Command. Same switches as Platform Control → Modules. Only when asked. If they have no watched buildings, say the buildings still need adding on Platform → Alerts.",
    schema: { type: "object", properties: { client: { type: "string" }, page: { type: "boolean" }, command: { type: "boolean" } }, required: ["client"], additionalProperties: false },
    run: async (p, ctx) => setClientAlerts(str(p["client"], 120), { page: typeof p["page"] === "boolean" ? p["page"] : undefined, command: typeof p["command"] === "boolean" ? p["command"] : undefined }, ctx.actorName),
    describe: (p) => {
      const part = (v: unknown, what: string) => (typeof v === "boolean" ? `${what} ${v ? "on" : "off"}` : "");
      return `${str(p["client"], 80)}: ${[part(p["page"], "Alerts page"), part(p["command"], "Complaint Command strip")].filter(Boolean).join(", ") || "no change"}`;
    },
    spoken: (r) => { const x = r as { client?: string; alertsPage?: boolean; complaintCommandStrip?: boolean; watchedBuildings?: number; error?: string }; return x.error ?? `${x.client}: Alerts page ${x.alertsPage ? "on" : "off"}, Complaint Command strip ${x.complaintCommandStrip ? "on" : "off"}${x.watchedBuildings ? "" : " — no buildings on their watch list yet"}.`; },
  },
  // ── Sales: plan prices and contracts (FIAREP's own Command Center) ─────
  {
    name: "quote_plans", label: "Price the platform and the FIAREP plan", risk: "read", confirmDefault: false, target: "server", platformOnly: true,
    description: "What a client with N units would pay each month: the platform only (plus setup) and the FIAREP plan (full service), from the owner's pricing ladder, plus the pilot prices. Use for \"XYZ has 475 units, how much for the platform / a plan?\". Say the monthly numbers (and setup), then ask: \"Would you like me to create a contract and send it over?\" If a rate isn't set, say so — never make up a price.",
    schema: { type: "object", properties: { units: { type: "number" }, company: { type: "string" } }, required: ["units"], additionalProperties: false },
    run: async (p) => quotePlans(Number(p["units"])),
    describe: (p) => `Price ${Number(p["units"]) || "?"} units${str(p["company"]) ? ` for ${str(p["company"], 80)}` : ""}`,
  },
  {
    name: "create_contract", label: "Create a contract", risk: "write", confirmDefault: false, target: "server", platformOnly: true,
    description: "Create the FIAREP service agreement (the same one Platform Control's contract builder makes) for the platform or the FIAREP plan, priced from the pricing ladder, and save it so it can be opened, printed and emailed. Ask for anything missing first: company, who signs (name and title), their email, plan (platform or fiarep), units, pilot yes/no. Then to send it: send_email with attach set to the contract's title.",
    schema: { type: "object", properties: {
      kind: { type: "string", enum: ["platform", "fiarep"] }, company: { type: "string" }, contact: { type: "string" }, title: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, address: { type: "string" },
      units: { type: "number" }, buildings: { type: "array", maxItems: 200, items: { type: "object", properties: { name: { type: "string" }, address: { type: "string" }, units: { type: "number" } }, additionalProperties: false } },
      startDate: { type: "string", description: "YYYY-MM-DD; today if not given" }, termMonths: { type: "number" }, pilot: { type: "boolean" }, notes: { type: "string" },
    }, required: ["kind", "company", "contact", "units"], additionalProperties: false },
    run: async (p, ctx) => createContract(ctx.tenantId, p as unknown as ContractRequest, ctx.actorName, ctx.runId),
    describe: (p) => `Create a ${str(p["kind"]) === "platform" ? "platform" : "FIAREP plan"} contract for ${str(p["company"], 80)} (${Number(p["units"]) || "?"} units)`,
    spoken: (r) => { const x = r as { title?: string; monthly?: number; error?: string }; return x.error ?? `Contract ready: ${x.title}, $${x.monthly?.toLocaleString("en-US")} a month.`; },
  },
  // ── Email ───────────────────────────────────────────────────────────────
  {
    name: "read_inbox", label: "Read the inbox", risk: "read", confirmDefault: false, target: "server",
    description: "List recent emails in this organization's inbox (FIAREP's Outlook for FIAREP; a client's own connected mailbox): who from, subject, date, a short preview, unread. Optionally only unread, only from someone, or containing words. Use read_email for the whole email.",
    schema: { type: "object", properties: { unreadOnly: { type: "boolean" }, from: { type: "string" }, search: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 25 } }, additionalProperties: false },
    run: async (p, ctx) => readInbox(ctx.tenantId, { unreadOnly: p["unreadOnly"] === true, from: str(p["from"], 200) || undefined, search: str(p["search"], 200) || undefined, limit: num(p["limit"], 10, 1, 25) }),
    describe: (p) => `Inbox${p["unreadOnly"] ? " (unread)" : ""}${str(p["from"]) ? ` from ${str(p["from"])}` : ""}`,
  },
  {
    name: "read_email", label: "Read an email", risk: "read", confirmDefault: false, target: "server",
    description: "The whole text of one email from read_inbox (give its id).",
    schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    run: async (p, ctx) => readEmail(ctx.tenantId, str(p["id"], 600)),
    describe: () => "Read an email",
  },
  {
    name: "find_contact", label: "Look up an email address", risk: "read", confirmDefault: false, target: "server",
    description: "Find people's email addresses by name: saved contacts, staff (HR records), contractors, the HR mailbox.",
    schema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
    run: async (p, ctx) => ({ contacts: await findContacts(ctx.tenantId, str(p["name"], 120)) }),
    describe: (p) => `Email address for ${str(p["name"], 80) || "everyone"}`,
  },
  {
    name: "save_contact", label: "Save an email contact", risk: "write", confirmDefault: false, target: "server",
    description: "Save a name and email address (for example a building owner) so emails can be sent to them by name. Optional note (owner of 1 Acme St, insurance agent…).",
    schema: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, note: { type: "string" } }, required: ["name", "email"], additionalProperties: false },
    run: async (p, ctx) => saveContact(ctx.tenantId, str(p["name"], 120), str(p["email"], 200), str(p["note"], 60), ctx.actorName),
    describe: (p) => `Save ${str(p["name"], 80)} <${str(p["email"], 120)}>`,
    spoken: (r) => { const x = r as { saved?: { name: string }; error?: string }; return x.error ?? `Saved ${x.saved!.name}.`; },
  },
  {
    name: "send_email", label: "Send an email", risk: "write", confirmDefault: true, target: "server",
    description: "Send an email from this organization's mailbox (its own if connected, otherwise FIAREP's Outlook). to / cc: names (looked up like find_contact; a name must match one person) or email addresses. You write the subject and body (plain text, blank line between paragraphs). attach: saved report titles or ids (list_reports / write_report) or scope codes, sent as files.",
    schema: { type: "object", properties: {
      to: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, cc: { type: "array", items: { type: "string" }, maxItems: 20 },
      subject: { type: "string" }, body: { type: "string" }, attach: { type: "array", items: { type: "string" }, maxItems: 5 },
    }, required: ["to", "subject", "body"], additionalProperties: false },
    run: async (p, ctx) => {
      const to = await resolveRecipients(ctx.tenantId, strList(p["to"], 20)); if ("error" in to) return to;
      const cc = await resolveRecipients(ctx.tenantId, strList(p["cc"], 20)); if ("error" in cc) return cc;
      const att = [];
      for (const a of strList(p["attach"], 5)) { const r = await attachmentFor(ctx.tenantId, a); if ("error" in r) return r; att.push(r); }
      try { return await sendEmail(ctx.tenantId, { to: to.to, cc: cc.to, subject: str(p["subject"], 200), body: typeof p["body"] === "string" ? p["body"].slice(0, 20000) : "", attachments: att }, ctx.actorName, ctx.runId); }
      catch (e) { return { error: `Email didn't send: ${e instanceof Error ? e.message : "failed"}` }; }
    },
    describe: (p) => `Email "${str(p["subject"], 80)}" to ${strList(p["to"]).join(", ")}${strList(p["attach"]).length ? ` (${strList(p["attach"]).length} attached)` : ""}`,
    describeLive: async (p, ctx) => {
      const to = await resolveRecipients(ctx.tenantId, strList(p["to"], 20));
      if ("error" in to) return null;
      const st = await mailStatus(ctx.tenantId);
      return `Email "${str(p["subject"], 80)}" to ${to.to.map((c) => c.email).join(", ")}${strList(p["cc"]).length ? `, cc ${strList(p["cc"]).join(", ")}` : ""} from ${st.sends ?? "no mailbox"}${strList(p["attach"]).length ? ` · ${strList(p["attach"]).length} attached` : ""}`;
    },
    spoken: (r) => { const x = r as { to?: string[]; from?: string; error?: string }; return x.error ?? `Sent to ${x.to!.join(", ")} from ${x.from}.`; },
  },
  // ── Desktop agent (Windows, Mac or Linux) ───────────────────────────────
  {
    name: "desktop_status", label: "Computer status", risk: "read", confirmDefault: false, target: "agent",
    description: "Status of a desktop agent's computer: uptime, load, memory, disk, battery, its tasks.",
    schema: { type: "object", properties: { ...agentProp }, additionalProperties: false },
    describe: (p) => `Status of ${str(p["agent"]) || "the computer"}`,
  },
  {
    name: "desktop_list_folder", label: "List a folder on the computer", risk: "read", confirmDefault: false, target: "agent",
    description: "List files in a folder on the computer. Only folders the agent's config allows (and their subfolders).",
    schema: { type: "object", properties: { ...agentProp, path: { type: "string" } }, required: ["path"], additionalProperties: false },
    describe: (p) => `List ${str(p["path"])}`,
  },
  {
    name: "desktop_read_file", label: "Read a file on the computer", risk: "read", confirmDefault: false, target: "agent",
    description: "Read a text file (first 20 KB) on the computer. Only inside folders the agent's config allows.",
    schema: { type: "object", properties: { ...agentProp, path: { type: "string" } }, required: ["path"], additionalProperties: false },
    describe: (p) => `Read ${str(p["path"])}`,
  },
  {
    name: "desktop_send_file", label: "Send a file from the computer to the phone", risk: "read", confirmDefault: false, target: "agent",
    description: "Send any file (PDF, picture, Word, Excel… up to 25 MB) from the computer to the person, e.g. \"send me the resident flyer\". Find it first with desktop_list_folder. The phone shows an Open file button for it (works 24 hours); just say it is ready.",
    schema: { type: "object", properties: { ...agentProp, path: { type: "string" } }, required: ["path"], additionalProperties: false },
    describe: (p) => `Send ${str(p["path"]).split(/[\\/]/).pop() || "a file"} to the phone`,
    spoken: (r) => { const x = r as { name?: string; url?: string }; return x?.url ? `Here's ${x.name} — tap Open file.` : "The file didn't come through — check the result."; },
  },
  {
    name: "desktop_open_app", label: "Open an app on the computer", risk: "write", confirmDefault: true, target: "agent",
    description: "Open an application on the computer. Only apps listed in the agent's config.",
    schema: { type: "object", properties: { ...agentProp, app: { type: "string" } }, required: ["app"], additionalProperties: false },
    describe: (p) => `Open ${str(p["app"])}`,
    spoken: (r) => ((r as { ok?: boolean })?.ok ? "Opened." : "It didn't open — check the result."),
  },
  {
    // Each task's own "confirm" setting in the Mac's config decides whether it waits for Face ID;
    // turning this action's confirm switch on in Platform Control makes every task wait.
    name: "desktop_run_task", label: "Run a task on the computer", risk: "write", confirmDefault: false, target: "agent",
    description: "Run one of the named tasks defined in the computer's agent config (see each agent's task list). Only those tasks exist; parameters must match the task's patterns. Read-style tasks (status, logs) can be run whenever they help answer; tasks that change something only when asked.",
    schema: { type: "object", properties: { ...agentProp, task: { type: "string" }, params: { type: "object", additionalProperties: { type: "string" } } }, required: ["task"], additionalProperties: false },
    describe: (p) => {
      const params = p["params"] && typeof p["params"] === "object" ? Object.entries(p["params"] as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).join(", ") : "";
      return `Run task “${str(p["task"])}”${params ? ` (${params})` : ""}${str(p["agent"]) ? ` on ${str(p["agent"])}` : ""}`;
    },
    spoken: (r) => { const x = r as { ok?: boolean; exitCode?: number }; return x?.ok ? "Task finished." : `Task failed${typeof x?.exitCode === "number" ? ` with exit code ${x.exitCode}` : ""}.`; },
  },
];

export const ACTION_MAP = new Map(ACTIONS.map((a) => [a.name, a]));
/** The actions one organization's Command Center has. */
export const actionsFor = (tenantId: string) => ACTIONS.filter((a) => isPlatform(tenantId) || !a.platformOnly);

/** Which online agent a desktop_* action goes to, and is the request allowed by that agent's config? */
export async function resolveAgent(action: ActionDef, params: Record<string, unknown>, tenantId: string): Promise<{ agentId: string; taskConfirm: boolean } | { error: string }> {
  const agents = await onlineAgents(tenantId);
  if (!agents.length) return { error: "No desktop agent is online. The computer may be asleep or the agent stopped." };
  const wanted = str(params["agent"], 80).toLowerCase();
  const agent = wanted ? agents.find((a) => a.name.toLowerCase() === wanted) : agents.length === 1 ? agents[0] : undefined;
  if (!agent) return { error: wanted ? `No online agent named "${wanted}". Online: ${agents.map((a) => a.name).join(", ")}.` : `Several agents are online; say which: ${agents.map((a) => a.name).join(", ")}.` };
  if (action.name === "desktop_run_task") {
    const task = (agent.tasks as AgentTask[]).find((t) => t.name === str(params["task"], 80));
    if (!task) return { error: `"${agent.name}" has no task "${str(params["task"], 80)}". Its tasks: ${(agent.tasks as AgentTask[]).map((t) => t.name).join(", ") || "none"}.` };
    const given = params["params"] && typeof params["params"] === "object" ? (params["params"] as Record<string, unknown>) : {};
    for (const key of Object.keys(given)) if (!task.params[key]) return { error: `Task "${task.name}" has no parameter "${key}".` };
    for (const [key, spec] of Object.entries(task.params)) {
      const value = String(given[key] ?? "");
      if (!new RegExp(`^(?:${spec.pattern})$`).test(value)) return { error: `Parameter "${key}" must match ${spec.pattern}.` };
    }
    return { agentId: agent.id, taskConfirm: task.confirm };
  }
  if (action.name === "desktop_open_app" && !(agent.apps as string[]).includes(str(params["app"], 120))) {
    return { error: `"${str(params["app"], 120)}" is not in ${agent.name}'s allowed apps: ${(agent.apps as string[]).join(", ") || "none"}.` };
  }
  return { agentId: agent.id, taskConfirm: false };
}

/** The part of the system prompt that tells the interpreter what each online agent offers. */
export async function agentCatalog(tenantId: string): Promise<string> {
  const agents = await onlineAgents(tenantId);
  if (!agents.length) return "No desktop agent is online right now.";
  return agents.map((a) => {
    const tasks = (a.tasks as AgentTask[]).map((t) => `  - ${t.name}: ${t.description}${Object.keys(t.params).length ? ` (params: ${Object.entries(t.params).map(([k, v]) => `${k} — ${v.description}`).join("; ")})` : ""}`).join("\n");
    return `Agent "${a.name}" (online). Folders: ${(a.folders as string[]).join(", ") || "none"}. Apps: ${(a.apps as string[]).join(", ") || "none"}.\n Tasks:\n${tasks || "  (none)"}`;
  }).join("\n");
}
