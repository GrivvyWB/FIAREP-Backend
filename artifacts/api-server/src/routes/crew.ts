// FIAREP's own crew — the technicians FIAREP sends out under the plan. They are
// staff accounts on FIAREP's own organization ("default"), role "worker", with
// an hourly rate; they log in to the FIAREP mobile app with their name and
// code like any worker and clock in / out on the Attendance screen. Platform
// Control turns the clock on, adds people, sets rates and reads the hours.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, organizations, staffAccounts, timeClockPunches } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { platformAudit } from "../lib/audit";
import { allocateStaffCode } from "../lib/staffCodes";
import { getTimeClockConfig, mergeTimeClockConfig } from "../lib/timeClockConfig";

const router: IRouter = Router();
router.use("/v1/platform/crew", requirePlatformOwner);

const TENANT = "default";
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
  id: s.id, name: s.name, position: s.position, code: s.code, status: s.status,
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
  const members = await db.select().from(staffAccounts).where(and(eq(staffAccounts.tenantId, TENANT), eq(staffAccounts.role, "worker"), inArray(staffAccounts.status, ["approved", "revoked"]))).orderBy(asc(staffAccounts.name));
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
    members: members.map((m) => view(m, hours.get(m.id), last.get(m.id) ?? null)),
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

router.post("/v1/platform/crew", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  const name = text(b["name"]).slice(0, 80);
  const position = text(b["position"]).slice(0, 60) || "Technician";
  const rate = cents(b["hourlyRate"]);
  if (name.length < 2) { res.status(400).json({ error: "A name is required." }); return; }
  if (rate == null || rate <= 0) { res.status(400).json({ error: "An hourly rate is required." }); return; }
  const created = await db.transaction(async (tx) => {
    const code = await allocateStaffCode(tx, TENANT, name);
    const now = new Date();
    const [row] = await tx.insert(staffAccounts).values({
      id: randomUUID(), tenantId: TENANT, name, position, role: "worker", code, status: "approved", developments: [],
      createdBy: owner.name, issuerName: "FIAREP", hourlyRateCents: rate, createdAt: now, updatedAt: now,
    } as typeof staffAccounts.$inferInsert).returning();
    return row!;
  });
  await platformAudit(owner.name, "crew.added", TENANT, null, { id: created.id, name, position, hourlyRate: rate / 100 });
  res.status(201).json(view(created));
});

router.patch("/v1/platform/crew/:id", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  const [before] = await db.select().from(staffAccounts).where(and(eq(staffAccounts.id, req.params.id!), eq(staffAccounts.tenantId, TENANT), eq(staffAccounts.role, "worker"))).limit(1);
  if (!before) { res.status(404).json({ error: "Crew member not found" }); return; }
  const updates: Partial<typeof staffAccounts.$inferInsert> = { updatedAt: new Date() };
  if ("hourlyRate" in b) { const r = cents(b["hourlyRate"]); if (r == null || r <= 0) { res.status(400).json({ error: "Invalid hourly rate" }); return; } updates.hourlyRateCents = r; }
  if ("position" in b) updates.position = text(b["position"]).slice(0, 60) || before.position;
  if ("name" in b) { const n = text(b["name"]).slice(0, 80); if (n.length >= 2) updates.name = n; }
  if (b["status"] === "approved" || b["status"] === "revoked") { updates.status = b["status"]; if (b["status"] === "revoked") updates.sessionVersion = sql`${staffAccounts.sessionVersion} + 1` as never; }
  const [after] = await db.update(staffAccounts).set(updates).where(eq(staffAccounts.id, before.id)).returning();
  await platformAudit(owner.name, "crew.updated", TENANT, { hourlyRate: before.hourlyRateCents, position: before.position, status: before.status }, { hourlyRate: after!.hourlyRateCents, position: after!.position, status: after!.status });
  res.json(view(after!));
});

router.post("/v1/platform/crew/:id/reset-code", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const [before] = await db.select().from(staffAccounts).where(and(eq(staffAccounts.id, req.params.id!), eq(staffAccounts.tenantId, TENANT), eq(staffAccounts.role, "worker"))).limit(1);
  if (!before) { res.status(404).json({ error: "Crew member not found" }); return; }
  const after = await db.transaction(async (tx) => {
    const code = await allocateStaffCode(tx, TENANT, before.name);
    const [row] = await tx.update(staffAccounts).set({ code, sessionVersion: sql`${staffAccounts.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(staffAccounts.id, before.id)).returning();
    return row!;
  });
  await platformAudit(owner.name, "crew.code-reset", TENANT, null, { id: before.id });
  res.json(view(after));
});

/** One person's punches for the period — the timesheet behind the hours. */
router.get("/v1/platform/crew/:id/punches", async (req, res) => {
  const { from, to } = parseRange(req.query as Record<string, unknown>);
  const rows = await db.select().from(timeClockPunches)
    .where(and(eq(timeClockPunches.tenantId, TENANT), eq(timeClockPunches.staffId, req.params.id!), gte(timeClockPunches.punchAt, from), lte(timeClockPunches.punchAt, to)))
    .orderBy(desc(timeClockPunches.punchAt));
  res.json(rows.map((r) => ({ id: r.id, direction: r.direction, at: r.punchAt.toISOString(), source: r.source })));
});

export default router;
