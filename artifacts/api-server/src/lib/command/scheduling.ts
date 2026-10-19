// Staff bookings: every job a member is sent to sits on the calendar with a
// start and an end, so nobody is booked twice for the same time.
//  - Same building: jobs can follow each other with no travel time.
//  - Another building: the next job starts after this one ends plus the drive
//    there (Google Maps Routes API with live traffic; a distance estimate only
//    when Google can't be reached or no key is set — marked as an estimate).
//  - A "building day" (several apartments in one building, or asked for) keeps
//    the member in that building all day: no other building can be booked that day.
// Times are New York time. Settings per organization (Command Center page → Scheduling).
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { db, settings, staffAccounts } from "@workspace/db";
import { apiKey } from "./keys";
import { distanceMeters, geocodeNycPoint } from "../nycProperty";

const ts = (name: string) => timestamp(name, { withTimezone: true });
export const staffBookings = pgTable("staff_bookings", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  staffId: text("staff_id").notNull(),
  staffName: text("staff_name").notNull(),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  title: text("title").notNull(),
  address: text("address").notNull(),
  buildingKey: text("building_key").notNull(),
  development: text("development"),
  apartments: jsonb("apartments").$type<string[]>().notNull().default([]),
  wholeDay: boolean("whole_day").notNull().default(false),
  travelMinutes: integer("travel_minutes").notNull().default(0),
  travelSource: text("travel_source").notNull().default("first"), // first | same-building | google | estimate
  sourceEntity: text("source_entity"),
  sourceId: text("source_id"),
  status: text("status").notNull().default("booked"), // booked | cancelled
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});
export type Booking = typeof staffBookings.$inferSelect;

export async function ensureBookingTable(): Promise<void> {
  await db.execute(sql`create table if not exists staff_bookings (
    id text primary key, tenant_id text not null, staff_id text not null, staff_name text not null,
    start_at timestamptz not null, end_at timestamptz not null, title text not null, address text not null,
    building_key text not null, development text, apartments jsonb not null default '[]', whole_day boolean not null default false,
    travel_minutes integer not null default 0, travel_source text not null default 'first',
    source_entity text, source_id text, status text not null default 'booked', note text,
    created_by text not null, created_at timestamptz not null default now())`);
  await db.execute(sql`create index if not exists staff_bookings_staff_idx on staff_bookings (tenant_id, staff_id, start_at)`);
}

// ── settings ────────────────────────────────────────────────────────────────
export type ScheduleSettings = {
  dayStart: string; // "08:00"
  dayEnd: string;   // "17:00"
  workDays: number[]; // 0 = Sunday … 6 = Saturday
  defaultJobMinutes: number;
  minutesPerApartment: number;
  buildingDayApartments: number; // this many apartments in one building = the whole day there
};
export const DEFAULT_SCHEDULE: ScheduleSettings = { dayStart: "08:00", dayEnd: "17:00", workDays: [1, 2, 3, 4, 5], defaultJobMinutes: 120, minutesPerApartment: 90, buildingDayApartments: 3 };
const SKEY = "command-schedule";
const hhmm = (v: unknown, d: string) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
const intIn = (v: unknown, d: number, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d; };

export function cleanSchedule(v: Record<string, unknown>, base: ScheduleSettings = DEFAULT_SCHEDULE): ScheduleSettings {
  const days = Array.isArray(v["workDays"]) ? [...new Set(v["workDays"].map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : base.workDays;
  const out = {
    dayStart: hhmm(v["dayStart"], base.dayStart), dayEnd: hhmm(v["dayEnd"], base.dayEnd), workDays: days.length ? days : base.workDays,
    // Whole quarter hours (shown as hours + minutes on the page).
    defaultJobMinutes: Math.round(intIn(v["defaultJobMinutes"], base.defaultJobMinutes, 15, 720) / 15) * 15,
    minutesPerApartment: Math.round(intIn(v["minutesPerApartment"], base.minutesPerApartment, 15, 720) / 15) * 15,
    buildingDayApartments: intIn(v["buildingDayApartments"], base.buildingDayApartments, 2, 50),
  };
  if (out.dayEnd <= out.dayStart) { out.dayStart = base.dayStart; out.dayEnd = base.dayEnd; }
  return out;
}
export async function getSchedule(tenantId: string): Promise<ScheduleSettings> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, SKEY))).limit(1);
  return cleanSchedule((row?.value && typeof row.value === "object" ? row.value : {}) as Record<string, unknown>);
}
export async function saveSchedule(tenantId: string, v: Record<string, unknown>): Promise<ScheduleSettings> {
  const next = cleanSchedule(v, await getSchedule(tenantId));
  const now = new Date();
  await db.insert(settings).values({ tenantId, key: SKEY, value: next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: next, updatedAt: now } });
  return next;
}

// ── New York time ───────────────────────────────────────────────────────────
const TZ = "America/New_York";
/** The UTC instant of a New York wall-clock time on a New York date ("2026-10-19", "09:00"). */
const nyParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** New York's offset from UTC at an instant, in ms (−4 h in summer, −5 h in winter). Independent of the server's own time zone. */
function nyOffset(at: Date): number {
  const p = Object.fromEntries(nyParts.formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p["year"]), Number(p["month"]) - 1, Number(p["day"]), Number(p["hour"]), Number(p["minute"]), Number(p["second"])) - Math.floor(at.getTime() / 1000) * 1000;
}
export function nyTime(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const first = new Date(guess.getTime() - nyOffset(guess));
  return new Date(guess.getTime() - nyOffset(first)); // second pass gets the right side of a DST change
}
export const nyDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const nyWeekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const nyLabel = (d: Date) => d.toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ceil15 = (d: Date) => new Date(Math.ceil(d.getTime() / 900_000) * 900_000);

/** "78 Warwick St, Apt 3F, Brooklyn" and "78 WARWICK STREET Brooklyn" → the same building. */
export function buildingKey(address: string): string {
  return address.toUpperCase()
    .replace(/[,#]/g, " ")
    .replace(/\b(APT|APARTMENT|UNIT|FL|FLOOR|STE|SUITE|RM|ROOM)\.?\s*[\w-]+/g, " ")
    .replace(/\bSTREET\b/g, "ST").replace(/\bAVENUE\b/g, "AVE").replace(/\bPLACE\b/g, "PL").replace(/\bBOULEVARD\b/g, "BLVD").replace(/\bROAD\b/g, "RD")
    .replace(/\bNEW YORK\b|\bNY\b|\b\d{5}\b/g, " ")
    .replace(/[^\w ]/g, " ").replace(/\s+/g, " ").trim();
}

/** 45 → "45 min", 60 → "1 hr", 90 → "1 hr 30 min", 120 → "2 hrs". */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return `${h} hr${h === 1 ? "" : "s"}${r ? ` ${r} min` : ""}`;
}

// ── drive time ──────────────────────────────────────────────────────────────
export type Travel = { minutes: number; source: "same-building" | "google" | "estimate"; detail: string };
const travelCache = new Map<string, { at: number; t: Travel }>();
const parseSeconds = (s: unknown) => { const m = /^(\d+(?:\.\d+)?)s$/.exec(String(s ?? "")); return m ? Number(m[1]) : NaN; };

/** Drive time from one building to another, leaving at `departAt`. */
export async function travelTime(from: string, to: string, departAt: Date): Promise<Travel> {
  if (buildingKey(from) === buildingKey(to)) return { minutes: 0, source: "same-building", detail: "same building" };
  const hour = Math.floor(departAt.getTime() / 3_600_000);
  const ck = `${buildingKey(from)}|${buildingKey(to)}|${hour}`;
  const hit = travelCache.get(ck);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.t;
  let t: Travel | null = null;
  const key = await apiKey("googleMaps");
  if (key) {
    try {
      const base = (process.env["GOOGLE_ROUTES_BASE_URL"] || "https://routes.googleapis.com").replace(/\/$/, "");
      const depart = departAt.getTime() > Date.now() + 60_000 ? departAt : new Date(Date.now() + 60_000);
      const r = await fetch(`${base}/directions/v2:computeRoutes`, {
        method: "POST",
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters", "content-type": "application/json" },
        body: JSON.stringify({ origin: { address: from }, destination: { address: to }, travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", departureTime: depart.toISOString() }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await r.json().catch(() => ({}))) as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
      const sec = parseSeconds(data.routes?.[0]?.duration);
      if (r.ok && Number.isFinite(sec)) t = { minutes: Math.ceil(sec / 60), source: "google", detail: `Google Maps with traffic: ${hm(Math.ceil(sec / 60))}, ${((data.routes?.[0]?.distanceMeters ?? 0) / 1609).toFixed(1)} mi` };
    } catch { /* falls back to the estimate */ }
  }
  if (!t) {
    // No key or Google unreachable: straight-line distance × 1.4 for streets, at 12 mph city average, + 10 min to park.
    const [a, b] = await Promise.all([geocodeNycPoint(from), geocodeNycPoint(to)]);
    if (a && b) {
      const m = distanceMeters(a, b) * 1.4;
      const minutes = Math.ceil(m / 5.36 / 60) + 10;
      t = { minutes, source: "estimate", detail: `estimate (${key ? "Google Maps didn't answer" : "no Google Maps key"}): ${(m / 1609).toFixed(1)} mi at 12 mph + 10 min parking = ${hm(minutes)}` };
    } else t = { minutes: 45, source: "estimate", detail: `estimate (${key ? "Google Maps didn't answer" : "no Google Maps key"} and the address couldn't be placed): 45 min` };
  }
  travelCache.set(ck, { at: Date.now(), t });
  return t;
}

// ── finding a time ──────────────────────────────────────────────────────────
export async function bookingsOn(tenantId: string, staffId: string, date: string): Promise<Booking[]> {
  const from = nyTime(date, "00:00"); const to = nyTime(addDays(date, 1), "00:00");
  return db.select().from(staffBookings).where(and(eq(staffBookings.tenantId, tenantId), eq(staffBookings.staffId, staffId), eq(staffBookings.status, "booked"), lt(staffBookings.startAt, to), gte(staffBookings.endAt, from))).orderBy(asc(staffBookings.startAt));
}

export type Slot = { startAt: Date; endAt: Date; travelMinutes: number; travelSource: Travel["source"] | "first"; travelDetail: string; date: string };
type Want = { address: string; minutes: number; wholeDay: boolean; earliest: Date; exactStart?: Date };

/** The first time on one day that fits, or why the day doesn't work. */
async function fitDay(tenantId: string, staffId: string, date: string, want: Want, cfg: ScheduleSettings): Promise<{ slot?: Slot; why?: string }> {
  if (!cfg.workDays.includes(nyWeekday(date)) && !want.exactStart) return { why: "not a work day" };
  const dayStart = nyTime(date, cfg.dayStart), dayEnd = nyTime(date, cfg.dayEnd);
  const booked = await bookingsOn(tenantId, staffId, date);
  const key = buildingKey(want.address);
  const otherBuilding = booked.find((b) => b.buildingKey !== key);
  const lockedTo = booked.find((b) => b.wholeDay);
  if (lockedTo && lockedTo.buildingKey !== key) return { why: `building day at ${lockedTo.address}` };
  if (want.wholeDay && otherBuilding) return { why: `already going to ${otherBuilding.address} that day` };
  const minMs = want.minutes * 60_000;
  // Gaps: [cursor, next.start) — before each booking, then after the last.
  let prev: Booking | null = null;
  const candidates = [...booked, null];
  for (const next of candidates) {
    let start = prev ? new Date(prev.endAt) : dayStart;
    let travel: Travel | { minutes: number; source: "first"; detail: string } = { minutes: 0, source: "first", detail: "first job of the day" };
    if (prev) { travel = await travelTime(prev.address, want.address, prev.endAt); start = new Date(start.getTime() + travel.minutes * 60_000); }
    if (start < want.earliest) start = want.earliest;
    start = want.exactStart ?? ceil15(start);
    const end = new Date(start.getTime() + minMs);
    let fits = start >= (prev ? new Date(prev.endAt.getTime() + travel.minutes * 60_000) : dayStart) && end <= dayEnd;
    if (fits && next) {
      const onward = await travelTime(want.address, next.address, end);
      fits = end.getTime() + onward.minutes * 60_000 <= next.startAt.getTime();
    }
    if (fits) return { slot: { startAt: start, endAt: end, travelMinutes: travel.minutes, travelSource: travel.source, travelDetail: travel.detail, date } };
    if (want.exactStart && next && next.startAt > want.exactStart) break;
    prev = next;
  }
  return { why: want.exactStart ? "that time overlaps another job or the drive between them" : "no room left that day" };
}

/** The earliest time, from `after`, that fits — looking up to 21 days ahead. With `at`, only that exact time. */
export async function findSlot(tenantId: string, staffId: string, opts: { address: string; minutes?: number; apartments?: string[]; wholeDay?: boolean; after?: Date; at?: Date }): Promise<{ slot: Slot | null; skipped: Array<{ date: string; why: string }>; minutes: number; wholeDay: boolean }> {
  const cfg = await getSchedule(tenantId);
  const apts = opts.apartments?.filter(Boolean) ?? [];
  const minutes = opts.minutes ?? (apts.length > 1 ? apts.length * cfg.minutesPerApartment : cfg.defaultJobMinutes);
  const wholeDay = opts.wholeDay ?? apts.length >= cfg.buildingDayApartments;
  const now = new Date(Date.now() + 15 * 60_000);
  const earliest = opts.after && opts.after > now ? opts.after : now;
  const skipped: Array<{ date: string; why: string }> = [];
  if (opts.at) {
    const r = await fitDay(tenantId, staffId, nyDate(opts.at), { address: opts.address, minutes, wholeDay, earliest: opts.at, exactStart: opts.at }, cfg);
    return { slot: r.slot ?? null, skipped: r.why ? [{ date: nyDate(opts.at), why: r.why }] : [], minutes, wholeDay };
  }
  let date = nyDate(earliest);
  for (let i = 0; i < 21; i += 1, date = addDays(date, 1)) {
    const r = await fitDay(tenantId, staffId, date, { address: opts.address, minutes, wholeDay, earliest }, cfg);
    if (r.slot) return { slot: r.slot, skipped, minutes, wholeDay };
    if (r.why && r.why !== "not a work day") skipped.push({ date, why: r.why });
  }
  return { slot: null, skipped, minutes, wholeDay };
}

/** Book it — re-checked under a per-member lock so two bookings can't take the same time. */
export async function createBooking(tenantId: string, staff: { id: string; name: string }, b: { title: string; address: string; development?: string | null; apartments?: string[]; slot: Slot; wholeDay: boolean; sourceEntity?: string; sourceId?: string; note?: string; createdBy: string }): Promise<Booking | { error: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-booking:${tenantId}:${staff.id}`}))`);
    const clash = await tx.select().from(staffBookings).where(and(eq(staffBookings.tenantId, tenantId), eq(staffBookings.staffId, staff.id), eq(staffBookings.status, "booked"), lt(staffBookings.startAt, b.slot.endAt), sql`${staffBookings.endAt} > ${b.slot.startAt}`)).limit(1);
    if (clash[0]) return { error: `${staff.name} is already booked ${nyLabel(clash[0].startAt)} – ${clash[0].endAt.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })} at ${clash[0].address}.` };
    const key = buildingKey(b.address);
    const dayFrom = nyTime(b.slot.date, "00:00"), dayTo = nyTime(addDays(b.slot.date, 1), "00:00");
    const sameDay = await tx.select().from(staffBookings).where(and(eq(staffBookings.tenantId, tenantId), eq(staffBookings.staffId, staff.id), eq(staffBookings.status, "booked"), lt(staffBookings.startAt, dayTo), gte(staffBookings.endAt, dayFrom), ne(staffBookings.buildingKey, key))).limit(1);
    if (sameDay[0] && (b.wholeDay || sameDay[0].wholeDay)) return { error: `${staff.name} has a building day ${sameDay[0].wholeDay ? `at ${sameDay[0].address}` : `conflict with ${sameDay[0].address}`} on ${b.slot.date}.` };
    const [row] = await tx.insert(staffBookings).values({
      id: randomUUID(), tenantId, staffId: staff.id, staffName: staff.name, startAt: b.slot.startAt, endAt: b.slot.endAt, title: b.title.slice(0, 200),
      address: b.address.slice(0, 300), buildingKey: key, development: b.development ?? null, apartments: (b.apartments ?? []).slice(0, 50), wholeDay: b.wholeDay,
      travelMinutes: b.slot.travelMinutes, travelSource: b.slot.travelSource, sourceEntity: b.sourceEntity ?? null, sourceId: b.sourceId ?? null, note: b.note?.slice(0, 1000) ?? null, createdBy: b.createdBy,
    }).returning();
    return row!;
  });
}

/** A member of this organization by name (or id), who can be sent to jobs. */
export async function findMember(tenantId: string, who: string): Promise<{ id: string; name: string; position: string; role: string } | { error: string }> {
  const q = who.trim().toLowerCase();
  if (!q) return { error: "Say who to book." };
  const all = await db.select({ id: staffAccounts.id, name: staffAccounts.name, position: staffAccounts.position, role: staffAccounts.role }).from(staffAccounts)
    .where(and(eq(staffAccounts.tenantId, tenantId), eq(staffAccounts.status, "approved")));
  const exact = all.filter((s) => s.id === who || s.name.toLowerCase() === q);
  const partial = exact.length ? exact : all.filter((s) => s.name.toLowerCase().includes(q));
  if (partial.length === 1) return { id: partial[0]!.id, name: partial[0]!.name, position: partial[0]!.position ?? "", role: partial[0]!.role };
  if (!partial.length) return { error: `No member named "${who}".` };
  return { error: `More than one member matches "${who}": ${partial.slice(0, 6).map((s) => s.name).join(", ")}. Say which.` };
}

export const bookingView = (b: Booking) => ({
  id: b.id, member: b.staffName, staffId: b.staffId, title: b.title, address: b.address, apartments: b.apartments, wholeDay: b.wholeDay,
  start: b.startAt.toISOString(), end: b.endAt.toISOString(), when: `${nyLabel(b.startAt)} – ${b.endAt.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}`,
  travelMinutes: b.travelMinutes, drive: b.travelMinutes ? hm(b.travelMinutes) : null, length: hm((b.endAt.getTime() - b.startAt.getTime()) / 60_000), travelSource: b.travelSource, status: b.status, development: b.development,
});
