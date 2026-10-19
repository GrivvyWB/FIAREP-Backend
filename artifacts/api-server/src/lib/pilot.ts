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
export type PilotPrices = Record<"60" | "90" | "365", number | null>;
const PRICES_KEY = "pilot-prices";

/** The price of each pilot option, set by the platform owner (Platform -> Modules -> Pilot program). */
export async function getPilotPrices(): Promise<PilotPrices> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, "default"), eq(settings.key, PRICES_KEY))).limit(1);
  const v = obj(row?.value);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : null);
  return { "60": n(v["60"]), "90": n(v["90"]), "365": n(v["365"]) };
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
  const now = new Date();
  await db.insert(settings).values({ tenantId: "default", key: PRICES_KEY, value: next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: next, updatedAt: now } });
  await platformAudit(by, "pilot.prices_changed", "default", before, next);
  return next;
}

export type Pilot = { price?: number | null; days: number; startedAt: string; endsAt: string; status: "running" | "purchased" | "ended"; before?: Record<string, unknown>; endedAt?: string; endedBy?: string; added?: string[] };

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
  const price = (await getPilotPrices())[String(days) as "60" | "90" | "365"];
  const pilot: Pilot = { days, price, startedAt: now.toISOString(), endsAt: new Date(now.getTime() + days * 86_400_000).toISOString(), status: "running", before: modules, added };
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
  const pilot: Pilot = { days: p.days ?? 0, price: p.price ?? null, startedAt: p.startedAt ?? now.toISOString(), endsAt: p.endsAt ?? now.toISOString(), status: "purchased", endedAt: now.toISOString(), endedBy: by, added: p.added };
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
  const pilot: Pilot = { days: p.days ?? 0, price: p.price ?? null, startedAt: p.startedAt ?? "", endsAt: p.endsAt ?? "", status: "ended", endedAt: now.toISOString(), endedBy: by, added: p.added };
  const [after] = await db.update(organizations).set({ features: { ...features, modules, pilot }, updatedAt: now }).where(eq(organizations.id, id)).returning();
  await platformAudit(by, "organization.pilot_ended", id, org, after);
  return { pilot: publicPilot(pilot) };
}

export function publicPilot(p: Partial<Pilot> | null | undefined) {
  if (!p || !p.status) return null;
  const left = p.status === "running" && p.endsAt ? Math.max(0, Math.ceil((new Date(p.endsAt).getTime() - Date.now()) / 86_400_000)) : null;
  return { days: p.days, price: p.price ?? null, startedAt: p.startedAt, endsAt: p.endsAt, status: p.status, daysLeft: left, endedAt: p.endedAt ?? null, endedBy: p.endedBy ?? null, added: p.added?.length ?? 0 };
}

/** Pilots past their end date that weren't purchased go back to their features from before. */
export async function expirePilots(): Promise<number> {
  const rows = await db.select({ id: organizations.id }).from(organizations)
    .where(sql`${organizations.features}->'pilot'->>'status' = 'running' and (${organizations.features}->'pilot'->>'endsAt')::timestamptz <= now()`);
  for (const r of rows) {
    const out = await endPilot(r.id, "pilot ended (time up)").catch((err) => { logger.error({ err, org: r.id }, "Pilot expiry failed"); return null; });
    if (out && "pilot" in out) logger.info({ org: r.id }, "Pilot ended: features from before the pilot restored");
  }
  return rows.length;
}
