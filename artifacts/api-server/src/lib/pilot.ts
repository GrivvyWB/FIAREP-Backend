// Pilot program (Platform -> Modules, per client): 60 days, 90 days or 1 year
// with every feature on. When it ends:
//  - purchased  -> everything stays on (the platform owner marks it purchased);
//  - not bought -> the client goes back to exactly the features it had before
//                  the pilot started (anything the pilot added is shut off).
// Stored on the organization: features.pilot = { days, startedAt, endsAt,
// status: running | purchased | ended, before: <features.modules before> }.
// Checked every hour, and when the platform owner opens the page.
import { and, eq, sql } from "drizzle-orm";
import { db, organizations, settings } from "@workspace/db";
import { platformAudit } from "./audit";
import { logger } from "./logger";

export const PILOT_DAYS = [60, 90, 365] as const;
export type PilotPrices = Record<"60" | "90" | "365", number | null> & { refundPercent: number };
/** What a client gets back when it doesn't buy after the pilot: 20% of what it paid, unless changed. */
export const DEFAULT_REFUND_PERCENT = 20;
const money = (n: number) => Math.round(n * 100) / 100;
const PRICES_KEY = "pilot-prices";

/** The price of each pilot option, set by the platform owner (Platform -> Modules -> Pilot program). */
export async function getPilotPrices(): Promise<PilotPrices> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, "default"), eq(settings.key, PRICES_KEY))).limit(1);
  const v = obj(row?.value);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : null);
  const pct = typeof v["refundPercent"] === "number" && v["refundPercent"] >= 0 && v["refundPercent"] <= 100 ? v["refundPercent"] : DEFAULT_REFUND_PERCENT;
  return { "60": n(v["60"]), "90": n(v["90"]), "365": n(v["365"]), refundPercent: pct };
}

export async function savePilotPrices(input: Record<string, unknown>, by: string): Promise<PilotPrices | { error: string }> {
  const before = await getPilotPrices();
  const next = { ...before };
  for (const k of ["60", "90", "365"] as const) {
    if (!(k in input)) continue;
    const raw = input[k];
    if (raw === null || raw === "") { next[k] = null; continue; }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 10_000_000) return { error: "Each price is a dollar amount." };
    next[k] = Math.round(v * 100) / 100;
  }
  if ("refundPercent" in input) {
    const r = Number(input["refundPercent"]);
    if (!Number.isFinite(r) || r < 0 || r > 100) return { error: "The refund is a percent from 0 to 100." };
    next.refundPercent = Math.round(r * 100) / 100;
  }
  const now = new Date();
  await db.insert(settings).values({ tenantId: "default", key: PRICES_KEY, value: next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: next, updatedAt: now } });
  await platformAudit(by, "pilot.prices_changed", "default", before, next);
  return next;
}

export type Pilot = {
  /** The price of the option picked, when the pilot started. */
  price?: number | null;
  /** What the client has paid toward the pilot (starts at the price; changeable). It is a credit toward the contract. */
  paid?: number;
  /** Percent of what was paid that goes back to a client that doesn't buy (20% unless changed), as it was when the pilot started. */
  refundPercent?: number;
  /** Bought: what was paid, taken off the contract. */
  credit?: number | null;
  /** Didn't buy: what goes back to them, and when it was sent. */
  refundDue?: number | null; refundedAt?: string | null; refundedBy?: string | null;
  days: number; startedAt: string; endsAt: string; status: "running" | "purchased" | "ended"; before?: Record<string, unknown>; endedAt?: string; endedBy?: string; added?: string[] };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

async function load(id: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  return org ?? null;
}

/** Start a pilot: everything in `allOn` switched on until the end date; what they had before is kept to go back to. */
export async function startPilot(id: string, days: number, allOn: Record<string, boolean>, by: string) {
  if (id === "default") return { error: "FIAREP's own organization doesn't need a pilot." };
  if (!(PILOT_DAYS as readonly number[]).includes(days)) return { error: "Pick 60 days, 90 days or 1 year." };
  const org = await load(id);
  if (!org) return { error: "Organization not found" };
  const features = obj(org.features);
  const current = obj(features["pilot"]) as Partial<Pilot>;
  if (current.status === "running") return { error: "A pilot is already running for this client. End it or mark it purchased first." };
  const modules = obj(features["modules"]);
  const on = Object.fromEntries(Object.entries(allOn).filter(([k, v]) => v === true && typeof k === "string" && k.length <= 120 && !k.startsWith("lock."))) as Record<string, boolean>;
  const added = Object.keys(on).filter((k) => modules[k] !== true);
  const now = new Date();
  // The price of the option they picked, as it was when the pilot started.
  const prices = await getPilotPrices();
  const price = prices[String(days) as "60" | "90" | "365"];
  const pilot: Pilot = { days, price, paid: price ?? 0, refundPercent: prices.refundPercent, credit: null, refundDue: null, refundedAt: null, refundedBy: null, startedAt: now.toISOString(), endsAt: new Date(now.getTime() + days * 86_400_000).toISOString(), status: "running", before: modules, added };
  const [after] = await db.update(organizations).set({ features: { ...features, modules: { ...modules, ...on }, pilot }, updatedAt: now }).where(eq(organizations.id, id)).returning();
  await platformAudit(by, "organization.pilot_started", id, org, after);
  return { pilot: publicPilot(pilot) };
}

/** They bought it: every feature stays on. */
export async function purchasePilot(id: string, by: string) {
  const org = await load(id);
  if (!org) return { error: "Organization not found" };
  const features = obj(org.features);
  const p = obj(features["pilot"]) as Partial<Pilot>;
  if (p.status !== "running" && p.status !== "ended") return { error: "No pilot to mark purchased." };
  const now = new Date();
  // Purchased after it already ended: switch the pilot's features back on.
  const modules = p.status === "ended" ? { ...obj(features["modules"]), ...Object.fromEntries((p.added ?? []).map((k) => [k, true])) } : obj(features["modules"]);
  // What they paid toward the pilot comes off the contract (less anything already sent back to them).
  const paid = p.paid ?? p.price ?? 0;
  const sentBack = p.refundedAt ? (p.refundDue ?? 0) : 0;
  const { before: _before, ...rest } = p;
  const pilot: Pilot = { ...rest, days: p.days ?? 0, startedAt: p.startedAt ?? now.toISOString(), endsAt: p.endsAt ?? now.toISOString(), status: "purchased", credit: money(Math.max(0, paid - sentBack)), refundDue: p.refundedAt ? p.refundDue ?? null : null, endedAt: now.toISOString(), endedBy: by };
  const [after] = await db.update(organizations).set({ features: { ...features, modules, pilot }, updatedAt: now }).where(eq(organizations.id, id)).returning();
  await platformAudit(by, "organization.pilot_purchased", id, org, after);
  return { pilot: publicPilot(pilot) };
}

/** Not bought: back to exactly what they had before the pilot. */
export async function endPilot(id: string, by: string) {
  const org = await load(id);
  if (!org) return { error: "Organization not found" };
  const features = obj(org.features);
  const p = obj(features["pilot"]) as Partial<Pilot>;
  if (p.status !== "running") return { error: "No pilot running." };
  const now = new Date();
  const before = obj(p.before);
  // Settings changed during the pilot that aren't features it added (locks, routing…) are kept.
  const modules = { ...obj(features["modules"]) };
  for (const k of p.added ?? []) { if (k in before) modules[k] = before[k]; else delete modules[k]; }
  // They don't buy: a share of what they paid goes back to them (20% unless changed).
  const paid = p.paid ?? p.price ?? 0;
  const pct = p.refundPercent ?? DEFAULT_REFUND_PERCENT;
  const { before: _before, ...rest } = p;
  const pilot: Pilot = { ...rest, days: p.days ?? 0, startedAt: p.startedAt ?? "", endsAt: p.endsAt ?? "", status: "ended", credit: null, refundDue: money(paid * pct / 100), refundedAt: null, refundedBy: null, endedAt: now.toISOString(), endedBy: by };
  const [after] = await db.update(organizations).set({ features: { ...features, modules, pilot }, updatedAt: now }).where(eq(organizations.id, id)).returning();
  await platformAudit(by, "organization.pilot_ended", id, org, after);
  return { pilot: publicPilot(pilot) };
}

/** Record what the client has actually paid toward the pilot (running, or ended and not bought yet). */
export async function setPilotPaid(id: string, amount: unknown, by: string) {
  const org = await load(id);
  if (!org) return { error: "Organization not found" };
  const features = obj(org.features);
  const p = obj(features["pilot"]) as Partial<Pilot>;
  if (p.status !== "running" && p.status !== "ended") return { error: "No pilot to record a payment on." };
  if (p.refundedAt) return { error: "The refund was already sent." };
  const v = Number(amount);
  if (!Number.isFinite(v) || v < 0 || v > 10_000_000) return { error: "Paid is a dollar amount." };
  const pilot: Partial<Pilot> = { ...p, paid: money(v), ...(p.status === "ended" ? { refundDue: money(v * (p.refundPercent ?? DEFAULT_REFUND_PERCENT) / 100) } : {}) };
  const [after] = await db.update(organizations).set({ features: { ...features, pilot }, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
  await platformAudit(by, "organization.pilot_paid", id, org, after);
  return { pilot: publicPilot(pilot) };
}

/** The 20% (or whatever was set) went back to the client. */
export async function markPilotRefunded(id: string, by: string) {
  const org = await load(id);
  if (!org) return { error: "Organization not found" };
  const features = obj(org.features);
  const p = obj(features["pilot"]) as Partial<Pilot>;
  if (p.status !== "ended" || p.refundDue === null || p.refundDue === undefined) return { error: "No refund due." };
  if (p.refundedAt) return { error: "Already marked sent." };
  const pilot: Partial<Pilot> = { ...p, refundedAt: new Date().toISOString(), refundedBy: by };
  const [after] = await db.update(organizations).set({ features: { ...features, pilot }, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
  await platformAudit(by, "organization.pilot_refunded", id, org, after);
  return { pilot: publicPilot(pilot) };
}

export function publicPilot(p: Partial<Pilot> | null | undefined) {
  if (!p || !p.status) return null;
  const left = p.status === "running" && p.endsAt ? Math.max(0, Math.ceil((new Date(p.endsAt).getTime() - Date.now()) / 86_400_000)) : null;
  return { days: p.days, price: p.price ?? null, paid: p.paid ?? p.price ?? 0, refundPercent: p.refundPercent ?? DEFAULT_REFUND_PERCENT, credit: p.credit ?? null, refundDue: p.refundDue ?? null, refundedAt: p.refundedAt ?? null, startedAt: p.startedAt, endsAt: p.endsAt, status: p.status, daysLeft: left, endedAt: p.endedAt ?? null, endedBy: p.endedBy ?? null, added: p.added?.length ?? 0 };
}

/** Pilots past their end date that weren't purchased go back to their features from before. */
export async function expirePilots(): Promise<number> {
  const rows = await db.select({ id: organizations.id }).from(organizations)
    .where(sql`${organizations.features}->'pilot'->>'status' = 'running' and (${organizations.features}->'pilot'->>'endsAt')::timestamptz <= now()`);
  for (const r of rows) {
    const out = await endPilot(r.id, "time up").catch((err) => { logger.error({ err, org: r.id }, "Pilot expiry failed"); return null; });
    if (out && "pilot" in out) logger.info({ org: r.id }, "Pilot ended: features from before the pilot restored");
  }
  return rows.length;
}
