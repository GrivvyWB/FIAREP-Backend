// FIAREP's own crew — the technicians FIAREP sends out under the plan. They are
// staff accounts on FIAREP's own organization ("default") issued by FIAREP,
// role "inspector" with the CPM title so they get the full CPM / Inspector
// tool set in the app (projects, HUD inspections, violations, measurement,
// scopes, change orders), with an hourly rate; they log in with their name and
// code and clock in / out on the Attendance screen. Platform Control turns the
// clock on, adds people, sets rates and reads the hours.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, entityRecords, notifications, organizationProperties, organizations, staffAccounts, timeClockLocations, timeClockPunches } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { platformAudit } from "../lib/audit";
import { allocateStaffCode } from "../lib/staffCodes";
import { getTimeClockConfig, mergeTimeClockConfig } from "../lib/timeClockConfig";
import { deliverPushNotification } from "../lib/push";
import { FIAREP_TENANT, crewPhotoPaths, mirrorFiarepProgress, sendComplaintToFiarep } from "../lib/fiarepDispatch";
import { fileStorage, isSafeTenantObjectPath } from "../lib/fileStorage";
import type { Actor } from "../lib/auth";

const router: IRouter = Router();
router.use("/v1/platform/crew", requirePlatformOwner);

const TENANT = "default";
// FIAREP's own crew. A member is one of these kinds; the role and position are
// what the app keys their screens and tools on. Everyone used to be forced to
// inspector / CPM, which is why a technician could only be told apart by being
// in FIAREP's own organization.
const CREW_KINDS = {
  technician: { role: "inspector", position: "CPM", label: "Technician" },
  "community-coordinator": { role: "community_coordinator", position: "FIAREP Services", label: "FIAREP Services" },
} as const;
type CrewKind = keyof typeof CREW_KINDS;
const CREW_ROLES = [...new Set(Object.values(CREW_KINDS).map((k) => k.role))];
const crewKind = (v: unknown): CrewKind => (typeof v === "string" && v in CREW_KINDS ? v as CrewKind : "technician");

const CREW_ROLE = CREW_KINDS.technician.role;
const CREW_POSITION = CREW_KINDS.technician.position; // the title the app keys every CPM / Inspector tool on
const ISSUER = "FIAREP";
const text = (v: unknown): string => (v == null ? "" : String(v).trim());
const cents = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

async function crewOrg() {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, TENANT)).limit(1);
  return org ?? null;
}

type Punch = { staffId: string; direction: "in" | "out"; punchAt: Date };
/** Hours worked per person inside [from, to): each "in" pairs with the next "out"; an open shift counts up to `now` (or `to`). */
function hoursByStaff(punches: Punch[], from: Date, to: Date, now = new Date()): Map<string, { hours: number; open: Date | null; shifts: number }> {
  const byStaff = new Map<string, Punch[]>();
  for (const p of punches) { const list = byStaff.get(p.staffId) || []; list.push(p); byStaff.set(p.staffId, list); }
  const out = new Map<string, { hours: number; open: Date | null; shifts: number }>();
  const end = to < now ? to : now;
  for (const [staffId, list] of byStaff) {
    list.sort((a, b) => a.punchAt.getTime() - b.punchAt.getTime());
    let openAt: Date | null = null; let ms = 0; let shifts = 0;
    for (const p of list) {
      if (p.direction === "in") { openAt = p.punchAt; }
      else if (openAt) { const s = Math.max(openAt.getTime(), from.getTime()); const e = Math.min(p.punchAt.getTime(), to.getTime()); if (e > s) { ms += e - s; shifts += 1; } openAt = null; }
    }
    if (openAt) { const s = Math.max(openAt.getTime(), from.getTime()); if (end.getTime() > s) { ms += end.getTime() - s; shifts += 1; } }
    out.set(staffId, { hours: Math.round((ms / 36e5) * 100) / 100, open: openAt, shifts });
  }
  return out;
}

function weekRange(now = new Date()): { from: Date; to: Date } {
  // Monday 00:00 local-ish (server time) through next Monday.
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  const to = new Date(d); to.setDate(to.getDate() + 7);
  return { from: d, to };
}

function parseRange(q: Record<string, unknown>): { from: Date; to: Date } {
  const f = text(q["from"]), t = text(q["to"]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const from = new Date(`${f}T00:00:00`); const to = new Date(`${t}T00:00:00`); to.setDate(to.getDate() + 1);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to > from) return { from, to };
  }
  return weekRange();
}

const view = (s: typeof staffAccounts.$inferSelect, h?: { hours: number; open: Date | null; shifts: number }, last?: { direction: string; punchAt: Date } | null) => ({
  id: s.id, name: s.name, position: s.position, role: s.role, code: s.code, status: s.status,
  hourlyRate: s.hourlyRateCents == null ? null : s.hourlyRateCents / 100,
  hours: h?.hours ?? 0, shifts: h?.shifts ?? 0,
  pay: s.hourlyRateCents == null ? null : Math.round((h?.hours ?? 0) * s.hourlyRateCents) / 100,
  clockedInSince: h?.open ? h.open.toISOString() : null,
  lastPunch: last ? { direction: last.direction, at: last.punchAt.toISOString() } : null,
  createdAt: s.createdAt?.toISOString?.() ?? null,
});

router.get("/v1/platform/crew", async (req, res) => {
  const org = await crewOrg();
  const { from, to } = parseRange(req.query as Record<string, unknown>);
  // Crew added before the switch to CPM / Inspector come along: same person, full tools.
  await db.update(staffAccounts).set({ role: CREW_ROLE, position: CREW_POSITION, updatedAt: new Date() }).where(and(eq(staffAccounts.tenantId, TENANT), eq(staffAccounts.issuerName, ISSUER), eq(staffAccounts.role, "worker")));
  const members = await db.select().from(staffAccounts).where(and(eq(staffAccounts.tenantId, TENANT), eq(staffAccounts.issuerName, ISSUER), inArray(staffAccounts.role, CREW_ROLES), inArray(staffAccounts.status, ["approved", "revoked"]))).orderBy(asc(staffAccounts.name));
  const ids = members.map((m) => m.id);
  const punches = ids.length ? await db.select({ staffId: timeClockPunches.staffId, direction: timeClockPunches.direction, punchAt: timeClockPunches.punchAt }).from(timeClockPunches)
    .where(and(eq(timeClockPunches.tenantId, TENANT), inArray(timeClockPunches.staffId, ids), gte(timeClockPunches.punchAt, new Date(from.getTime() - 24 * 36e5)), lte(timeClockPunches.punchAt, to))) : [];
  const hours = hoursByStaff(punches as Punch[], from, to);
  const last = new Map<string, { direction: string; punchAt: Date }>();
  for (const p of [...punches].sort((a, b) => b.punchAt.getTime() - a.punchAt.getTime())) if (!last.has(p.staffId)) last.set(p.staffId, p);
  const active = members.filter((m) => m.status === "approved");
  const totalHours = Math.round(active.reduce((n, m) => n + (hours.get(m.id)?.hours ?? 0), 0) * 100) / 100;
  const totalPay = Math.round(active.reduce((n, m) => n + (m.hourlyRateCents ?? 0) * (hours.get(m.id)?.hours ?? 0), 0)) / 100;
  res.json({
    clockEnabled: getTimeClockConfig(org?.features).mobileClockEnabled,
    from: from.toISOString().slice(0, 10), to: new Date(to.getTime() - 1).toISOString().slice(0, 10),
    members: members.map((m) => ({ ...view(m, hours.get(m.id), last.get(m.id) ?? null), messaging: (((org?.features as Record<string, unknown> | null)?.["modules"] ?? {}) as Record<string, unknown>)[`msg.${m.id}`] !== false })),
    totalHours, totalPay,
  });
});

router.put("/v1/platform/crew/clock", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const enabled = (req.body as Record<string, unknown>)?.["enabled"] === true;
  const org = await crewOrg();
  if (!org) { res.status(404).json({ error: "FIAREP organization not found" }); return; }
  const features = mergeTimeClockConfig(org.features, { mobileClockEnabled: enabled });
  await db.update(organizations).set({ features, updatedAt: new Date() }).where(eq(organizations.id, TENANT));
  await platformAudit(owner.name, "crew.clock", TENANT, { enabled: getTimeClockConfig(org.features).mobileClockEnabled }, { enabled });
  res.json({ clockEnabled: enabled });
});

/** Who uses messaging: a switch per FIAREP Services member, kept on FIAREP's
 *  own organization as modules["msg.<staffId>"]. On unless switched off. */
router.put("/v1/platform/crew/:id/messaging", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const id = String(req.params["id"] || "");
  const enabled = (req.body as Record<string, unknown>)?.["enabled"] === true;
  const org = await crewOrg();
  if (!org) { res.status(404).json({ error: "FIAREP organization not found" }); return; }
  const [member] = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(eq(staffAccounts.id, id), eq(staffAccounts.tenantId, TENANT))).limit(1);
  if (!member) { res.status(404).json({ error: "No such crew member." }); return; }
  const features = (org.features && typeof org.features === "object" ? org.features : {}) as Record<string, unknown>;
  const modules = (features["modules"] && typeof features["modules"] === "object" && !Array.isArray(features["modules"]) ? features["modules"] : {}) as Record<string, unknown>;
  const before = modules[`msg.${id}`] !== false;
  await db.update(organizations).set({ features: { ...features, modules: { ...modules, [`msg.${id}`]: enabled } }, updatedAt: new Date() }).where(eq(organizations.id, TENANT));
  await platformAudit(owner.name, "crew.messaging", TENANT, { id, enabled: before }, { id, enabled });
  res.json({ id, messaging: enabled });
});

router.post("/v1/platform/crew", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  const name = text(b["name"]).slice(0, 80);
  const kind = CREW_KINDS[crewKind(b["kind"])];
  const rate = cents(b["hourlyRate"]);
  if (name.length < 2) { res.status(400).json({ error: "A name is required." }); return; }
  if (rate == null || rate <= 0) { res.status(400).json({ error: "An hourly rate is required." }); return; }
  const created = await db.transaction(async (tx) => {
    const code = await allocateStaffCode(tx, TENANT, name);
    const now = new Date();
    const [row] = await tx.insert(staffAccounts).values({
      id: randomUUID(), tenantId: TENANT, name, position: kind.position, role: kind.role, code, status: "approved", developments: [],
      createdBy: owner.name, issuerName: ISSUER, hourlyRateCents: rate, createdAt: now, updatedAt: now,
    } as typeof staffAccounts.$inferInsert).returning();
    return row!;
  });
  await platformAudit(owner.name, "crew.added", TENANT, null, { id: created.id, name, position: kind.position, role: kind.role, hourlyRate: rate / 100 });
  res.status(201).json(view(created));
});

router.patch("/v1/platform/crew/:id", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  const [before] = await db.select().from(staffAccounts).where(and(eq(staffAccounts.id, req.params.id!), eq(staffAccounts.tenantId, TENANT), eq(staffAccounts.issuerName, ISSUER))).limit(1);
  if (!before) { res.status(404).json({ error: "Crew member not found" }); return; }
  const updates: Partial<typeof staffAccounts.$inferInsert> = { updatedAt: new Date() };
  if ("hourlyRate" in b) { const r = cents(b["hourlyRate"]); if (r == null || r <= 0) { res.status(400).json({ error: "Invalid hourly rate" }); return; } updates.hourlyRateCents = r; }
  if ("name" in b) { const n = text(b["name"]).slice(0, 80); if (n.length >= 2) updates.name = n; }
  if (b["status"] === "approved" || b["status"] === "revoked") { updates.status = b["status"]; if (b["status"] === "revoked") updates.sessionVersion = sql`${staffAccounts.sessionVersion} + 1` as never; }
  const [after] = await db.update(staffAccounts).set(updates).where(eq(staffAccounts.id, before.id)).returning();
  await platformAudit(owner.name, "crew.updated", TENANT, { hourlyRate: before.hourlyRateCents, position: before.position, status: before.status }, { hourlyRate: after!.hourlyRateCents, position: after!.position, status: after!.status });
  res.json(view(after!));
});

router.post("/v1/platform/crew/:id/reset-code", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const [before] = await db.select().from(staffAccounts).where(and(eq(staffAccounts.id, req.params.id!), eq(staffAccounts.tenantId, TENANT), eq(staffAccounts.issuerName, ISSUER))).limit(1);
  if (!before) { res.status(404).json({ error: "Crew member not found" }); return; }
  const after = await db.transaction(async (tx) => {
    const code = await allocateStaffCode(tx, TENANT, before.name);
    const [row] = await tx.update(staffAccounts).set({ code, sessionVersion: sql`${staffAccounts.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(staffAccounts.id, before.id)).returning();
    return row!;
  });
  await platformAudit(owner.name, "crew.code-reset", TENANT, null, { id: before.id });
  res.json(view(after));
});

/**
 * Whose building was the crew standing at? The phone reports a street address;
 * the registry holds one row per address across every client company, so an
 * address resolves to one company. Matching is on the address only - the
 * registry keeps no coordinates - so a stop on a building nobody registered
 * comes back with no company, which is the honest answer.
 */
const canon = (v: unknown): string =>
  String(v ?? "").toLowerCase().split(",")[0]!.replace(/[.#]/g, "").replace(/\s+/g, " ").trim();

async function buildingIndex(): Promise<Map<string, { company: string; development: string; address: string }>> {
  const [props, orgs] = await Promise.all([
    db.select({
      norm: organizationProperties.normalizedAddress,
      display: organizationProperties.displayAddress,
      org: organizationProperties.organizationId,
      development: organizationProperties.development,
    }).from(organizationProperties),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
  ]);
  const named = new Map(orgs.map((o) => [o.id, o.name]));
  const index = new Map<string, { company: string; development: string; address: string }>();
  for (const row of props) {
    const key = canon(row.norm);
    if (key) index.set(key, { company: named.get(row.org) || row.org, development: row.development || "", address: row.display });
  }
  return index;
}

/** The registry address can be shorter than what the phone reported
 *  ("1555 Grand Concourse" against "1555 Grand Concourse, Bronx"). */
function buildingAt(index: Map<string, { company: string; development: string; address: string }>, address: unknown) {
  const key = canon(address);
  if (!key) return null;
  const exact = index.get(key);
  if (exact) return exact;
  for (const [candidate, value] of index) if (key.startsWith(candidate)) return value;
  return null;
}

/** One person's punches for the period — the timesheet behind the hours. */
router.get("/v1/platform/crew/:id/punches", async (req, res) => {
  const { from, to } = parseRange(req.query as Record<string, unknown>);
  const rows = await db.select().from(timeClockPunches)
    .where(and(eq(timeClockPunches.tenantId, TENANT), eq(timeClockPunches.staffId, req.params.id!), gte(timeClockPunches.punchAt, from), lte(timeClockPunches.punchAt, to)))
    .orderBy(desc(timeClockPunches.punchAt));
  const index = await buildingIndex();
  res.json(rows.map((r) => {
    const at = buildingAt(index, r.address);
    return { id: r.id, direction: r.direction, at: r.punchAt.toISOString(), source: r.source, address: r.address, latitude: r.latitude, longitude: r.longitude, company: at?.company ?? "", development: at?.development ?? "" };
  }));
});

/** Where one person was while on the clock — the stops the phone reported (moved, then stayed 30+ minutes). */
router.get("/v1/platform/crew/:id/locations", async (req, res) => {
  const { from, to } = parseRange(req.query as Record<string, unknown>);
  const rows = await db.select().from(timeClockLocations)
    .where(and(eq(timeClockLocations.tenantId, TENANT), eq(timeClockLocations.staffId, req.params.id!), gte(timeClockLocations.arrivedAt, from), lte(timeClockLocations.arrivedAt, to)))
    .orderBy(desc(timeClockLocations.arrivedAt));
  const index = await buildingIndex();
  res.json(rows.map((r) => {
    const at = buildingAt(index, r.address);
    return { id: r.id, address: r.address, latitude: r.latitude, longitude: r.longitude, arrivedAt: r.arrivedAt.toISOString(), leftAt: r.leftAt ? r.leftAt.toISOString() : null, minutes: Math.round(((r.leftAt ?? new Date()).getTime() - r.arrivedAt.getTime()) / 6e4), company: at?.company ?? "", development: at?.development ?? "" };
  }));
});

// ---- Jobs: every client company's open complaint, and sending one to a technician ----
const OPEN = ["submitted", "assigned", "in_progress", "done"];
const jobView = (r: typeof entityRecords.$inferSelect, company: string, copy?: typeof entityRecords.$inferSelect | null) => {
  const st = r.state;
  const cs = copy?.state ?? null;
  return {
    id: r.id, tenantId: r.tenantId, company,
    complaintNo: String(st["complaintNo"] || ""), development: r.development || String(st["development"] || ""),
    address: String(st["address"] || ""), unit: String(st["unit"] || st["apartment"] || ""), category: String(st["category"] || st["issueType"] || st["location"] || ""),
    description: String(st["description"] || st["issue"] || ""), status: String(st["status"] || ""), createdAt: r.createdAt?.toISOString?.() ?? null,
    sentAt: typeof st["fiarepSentAt"] === "string" ? st["fiarepSentAt"] : null,
    clientStatus: String(st["status"] || ""),
    fiarep: cs ? {
      recordId: copy!.id, status: String(cs["status"] || ""), assignedStaffId: String(cs["assignedStaffId"] || ""), assignedTo: String(cs["assignedTo"] || ""),
      startedAt: cs["startedAt"] ?? null, completedAt: cs["completedAt"] ?? null, completionNote: String(cs["completionNote"] || ""),
      photos: crewPhotoPaths(cs),
      approvedAt: cs["approvedAt"] ?? null, approvedBy: String(cs["approvedBy"] || ""),
      sentBackNote: String(cs["reworkNote"] || ""), sentBackAt: cs["reworkAt"] ?? null,
      clientApprovedAt: cs["clientApprovedAt"] ?? null, clientApprovedBy: String(cs["clientApprovedBy"] || ""),
      updates: Array.isArray(cs["updates"]) ? (cs["updates"] as unknown[]).slice(-12) : [],
    } : null,
  };
};

router.get("/v1/platform/crew/jobs", async (_req, res) => {
  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  // Every open complaint on the platform, plus everything ever sent to FIAREP (so finished work stays on record).
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false), sql`${entityRecords.tenantId} <> ${FIAREP_TENANT}`,
    sql`(coalesce(${entityRecords.state}->>'status','') = any(${sql.raw("ARRAY['" + OPEN.join("','") + "']")}) or ${entityRecords.state} ? 'fiarepRecordId')`)).orderBy(desc(entityRecords.updatedAt));
  const copyIds = rows.map((r) => r.state["fiarepRecordId"]).filter((v): v is string => typeof v === "string" && v.length > 0);
  const copies = copyIds.length ? await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, FIAREP_TENANT), inArray(entityRecords.id, copyIds))) : [];
  const byId = new Map(copies.map((c) => [c.id, c]));
  res.json(rows.map((r) => jobView(r, names.get(r.tenantId) || r.tenantId, byId.get(String(r.state["fiarepRecordId"] || "")))));
});

/** Send a client's complaint to one FIAREP technician: copy it to FIAREP (if not already) and assign. */
router.post("/v1/platform/crew/jobs/:tenantId/:id/send", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const staffId = text((req.body as Record<string, unknown>)?.["staffId"]);
  const [tech] = await db.select().from(staffAccounts).where(and(eq(staffAccounts.id, staffId), eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"))).limit(1);
  if (!tech) { res.status(400).json({ error: "Pick a technician." }); return; }
  const [source] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, req.params.id!), eq(entityRecords.tenantId, req.params.tenantId!), eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false))).limit(1);
  if (!source) { res.status(404).json({ error: "Complaint not found" }); return; }
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, source.tenantId)).limit(1);
  const asClient: Actor = { id: "platform-owner", tenantId: source.tenantId, name: `FIAREP (${owner.name})`, role: "administrator", position: "Platform Owner", developments: [], sessionVersion: 0 };
  let copyId = typeof source.state["fiarepRecordId"] === "string" ? source.state["fiarepRecordId"] : "";
  if (!copyId) {
    const sent = await sendComplaintToFiarep(asClient, source);
    if (!sent.ok) { res.status(sent.status).json({ error: sent.error }); return; }
    copyId = String(sent.record.state["fiarepRecordId"] || "");
  }
  const [copy] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, copyId), eq(entityRecords.tenantId, FIAREP_TENANT))).limit(1);
  if (!copy) { res.status(500).json({ error: "FIAREP's copy of the complaint is missing" }); return; }
  const now = new Date();
  const [assigned] = await db.update(entityRecords).set({
    state: { ...copy.state, status: "assigned", assignedStaffId: tech.id, assignedTo: tech.name, assignedAt: now.toISOString(), assignedByStaffId: "platform-owner", assignedByName: `FIAREP (${owner.name})` },
    version: (copy.version ?? 1) + 1, updatedAt: now,
  }).where(eq(entityRecords.id, copy.id)).returning();
  const asFiarep: Actor = { ...asClient, tenantId: FIAREP_TENANT };
  await mirrorFiarepProgress(asFiarep, assigned!);
  const ref = [String(source.state["complaintNo"] || ""), String(source.state["address"] || ""), source.state["unit"] ? `Apt ${String(source.state["unit"])}` : ""].filter(Boolean).join(" \u00b7 ");
  const [alert] = await db.insert(notifications).values({ id: randomUUID(), tenantId: FIAREP_TENANT, target: tech.id, message: `Job from ${org?.name || source.tenantId}`, detail: ref, reportId: copy.id }).returning();
  if (alert) void deliverPushNotification(alert).catch(() => undefined);
  await platformAudit(owner.name, "crew.job-sent", source.tenantId, null, { complaint: source.id, copy: copy.id, technician: tech.name });
  res.json(jobView(source, org?.name || source.tenantId, assigned));
});

/** FIAREP signs off on its technician's finished work (its own record; the client still approves theirs). */
router.post("/v1/platform/crew/jobs/:tenantId/:id/approve", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const [source] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, req.params.id!), eq(entityRecords.tenantId, req.params.tenantId!), eq(entityRecords.deleted, false))).limit(1);
  const copyId = typeof source?.state["fiarepRecordId"] === "string" ? String(source.state["fiarepRecordId"]) : "";
  const [copy] = copyId ? await db.select().from(entityRecords).where(and(eq(entityRecords.id, copyId), eq(entityRecords.tenantId, FIAREP_TENANT))).limit(1) : [];
  if (!source || !copy) { res.status(404).json({ error: "Job not found" }); return; }
  if (copy.state["status"] !== "done") { res.status(409).json({ error: "The technician has not marked this done yet." }); return; }
  const now = new Date();
  const [after] = await db.update(entityRecords).set({ state: { ...copy.state, status: "approved", approvedAt: now.toISOString(), approvedBy: `FIAREP (${owner.name})` }, version: (copy.version ?? 1) + 1, updatedAt: now }).where(eq(entityRecords.id, copy.id)).returning();
  const asFiarep: Actor = { id: "platform-owner", tenantId: FIAREP_TENANT, name: `FIAREP (${owner.name})`, role: "administrator", position: "Platform Owner", developments: [], sessionVersion: 0 };
  await mirrorFiarepProgress(asFiarep, after!);
  const tech = String(copy.state["assignedStaffId"] || "");
  if (tech) { const [alert] = await db.insert(notifications).values({ id: randomUUID(), tenantId: FIAREP_TENANT, target: tech, message: "Work approved", detail: String(copy.state["complaintNo"] || ""), reportId: copy.id }).returning(); if (alert) void deliverPushNotification(alert).catch(() => undefined); }
  await platformAudit(owner.name, "crew.job-approved", source.tenantId, null, { complaint: source.id, copy: copy.id });
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, source.tenantId)).limit(1);
  const [src2] = await db.select().from(entityRecords).where(eq(entityRecords.id, source.id)).limit(1);
  res.json(jobView(src2 ?? source, org?.name || source.tenantId, after));
});

/** Send the technician back to fix it. */
router.post("/v1/platform/crew/jobs/:tenantId/:id/send-back", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const note = text((req.body as Record<string, unknown>)?.["note"]).slice(0, 1000);
  if (note.length < 3) { res.status(400).json({ error: "Say what needs fixing." }); return; }
  const [source] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, req.params.id!), eq(entityRecords.tenantId, req.params.tenantId!), eq(entityRecords.deleted, false))).limit(1);
  const copyId = typeof source?.state["fiarepRecordId"] === "string" ? String(source.state["fiarepRecordId"]) : "";
  const [copy] = copyId ? await db.select().from(entityRecords).where(and(eq(entityRecords.id, copyId), eq(entityRecords.tenantId, FIAREP_TENANT))).limit(1) : [];
  if (!source || !copy) { res.status(404).json({ error: "Job not found" }); return; }
  const now = new Date();
  const updates = Array.isArray(copy.state["updates"]) ? (copy.state["updates"] as unknown[]) : [];
  const [after] = await db.update(entityRecords).set({
    state: { ...copy.state, status: "in_progress", reworkNote: note, reworkByStaffName: `FIAREP (${owner.name})`, reworkAt: now.toISOString(), updates: [...updates, { status: "in_progress", note: `Sent back: ${note}`, by: `FIAREP (${owner.name})`, at: now.toISOString(), action: "reject-work" }] },
    version: (copy.version ?? 1) + 1, updatedAt: now,
  }).where(eq(entityRecords.id, copy.id)).returning();
  const asFiarep: Actor = { id: "platform-owner", tenantId: FIAREP_TENANT, name: `FIAREP (${owner.name})`, role: "administrator", position: "Platform Owner", developments: [], sessionVersion: 0 };
  await mirrorFiarepProgress(asFiarep, after!);
  const tech = String(copy.state["assignedStaffId"] || "");
  if (tech) { const [alert] = await db.insert(notifications).values({ id: randomUUID(), tenantId: FIAREP_TENANT, target: tech, message: `Sent back: ${note}`.slice(0, 200), detail: String(copy.state["complaintNo"] || ""), reportId: copy.id }).returning(); if (alert) void deliverPushNotification(alert).catch(() => undefined); }
  await platformAudit(owner.name, "crew.job-sent-back", source.tenantId, null, { complaint: source.id, copy: copy.id, note });
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, source.tenantId)).limit(1);
  const [src2] = await db.select().from(entityRecords).where(eq(entityRecords.id, source.id)).limit(1);
  res.json(jobView(src2 ?? source, org?.name || source.tenantId, after));
});

/** A signed link to one of the crew's job photos. */
router.post("/v1/platform/crew/photo-url", async (req, res) => {
  const objectPath = text((req.body as Record<string, unknown>)?.["objectPath"]);
  if (!objectPath || objectPath.includes("..") || !isSafeTenantObjectPath(FIAREP_TENANT, objectPath)) { res.status(404).json({ error: "File not found" }); return; }
  try { res.json(await fileStorage.createDownload(FIAREP_TENANT, objectPath)); } catch { res.status(404).json({ error: "File not found" }); }
});

export default router;
