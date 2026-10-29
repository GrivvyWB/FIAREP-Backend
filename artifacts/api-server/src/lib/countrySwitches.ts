// Countries (Platform Control → Countries): FIAREP works in a country only once it is
// switched on there. The United States is on until switched off; every other country
// starts off. Off means: no address suggestions or lookups there, and no new buildings.
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";
import { COUNTRIES } from "./countries";

const KEY = "countries";
const PLATFORM = "default";
let cache: { at: number; value: Record<string, boolean> } | null = null;

/** Saved switches by two-letter code; the United States is on unless saved off. */
export async function countrySwitches(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, PLATFORM), eq(settings.key, KEY))).limit(1);
  const saved = (row?.value || {}) as Record<string, unknown>;
  const value: Record<string, boolean> = { US: saved["US"] !== false };
  for (const [k, v] of Object.entries(saved)) if (k !== "US" && v === true && COUNTRIES[k]) value[k] = true;
  cache = { at: Date.now(), value };
  return value;
}

export async function setCountry(code: string, on: boolean): Promise<Record<string, boolean>> {
  const c = code.toUpperCase();
  if (!COUNTRIES[c]) throw Object.assign(new Error("Unknown country"), { status: 404 });
  const cur = await countrySwitches();
  const value = { ...cur, [c]: on };
  if (!on && c !== "US") delete value[c];
  const now = new Date();
  await db.insert(settings).values({ tenantId: PLATFORM, key: KEY, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedAt: now } });
  cache = null;
  return countrySwitches();
}

/** The two-letter code for a country as typed ("Canada", "UAE", "ca"); "" when unknown. */
export function countryCode(typed: unknown): string {
  const t = String(typed ?? "").trim();
  if (!t) return "US";
  const up = t.toUpperCase().replace(/\./g, "");
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "AMERICA"].includes(up)) return "US";
  if (["UAE"].includes(up)) return "AE";
  if (["UK", "ENGLAND", "SCOTLAND", "WALES", "GREAT BRITAIN", "BRITAIN"].includes(up)) return "GB";
  if (up.length === 2 && COUNTRIES[up]) return up;
  const hit = Object.entries(COUNTRIES).find(([, n]) => n.toUpperCase() === up || n.toUpperCase().replace(/&/g, "AND") === up);
  return hit ? hit[0] : "";
}

/** True when FIAREP works in this country now. */
export async function countryOn(code: string): Promise<boolean> {
  const c = (code || "US").toUpperCase();
  return (await countrySwitches())[c] === true;
}
