import { and, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import type { Actor } from "./auth";

/** entity_records rows that record a temporary cross-development coverage unlock. */
export const COVERAGE_ENTITY = "coverage-grant";
/** How long a single unlock lasts. */
export const COVERAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

function normDev(d: string): string {
  return d.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Stable 2-digit code (00-99) for a development, derived from its name.
 * Deterministic and dependency-free, so a supervisor sees the same code for a
 * site every time. It is a "confirm you are really working here today" gesture,
 * not a secret, so collisions across the full NYCHA list are acceptable — the
 * supervisor is confirming a development they have already picked from a list.
 */
export function developmentCoverageCode(development: string): string {
  const norm = normDev(development);
  let h = 0;
  for (let i = 0; i < norm.length; i++) h = (h * 31 + norm.charCodeAt(i)) % 100;
  return String(((h % 100) + 100) % 100).padStart(2, "0");
}

/** The actor's home developments already cover this site (no unlock needed). */
export function isHomeDevelopment(actor: Actor, development: string): boolean {
  const target = normDev(development);
  return actor.developments.some((d) => normDev(d) === target);
}

async function activeGrantStates(actor: Actor): Promise<Record<string, unknown>[]> {
  const now = Date.now();
  const rows = await db.select({ state: entityRecords.state })
    .from(entityRecords)
    .where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, COVERAGE_ENTITY),
      eq(entityRecords.deleted, false),
      eq(entityRecords.createdBy, actor.id),
    ));
  return rows
    .map((r) => r.state as Record<string, unknown>)
    .filter((st) => {
      const raw = st["expiresAt"];
      const exp = raw ? new Date(String(raw)).getTime() : 0;
      return Number.isFinite(exp) && exp > now;
    });
}

/** True if the actor holds an unexpired coverage unlock for the development. */
export async function hasActiveCoverage(actor: Actor, development: string): Promise<boolean> {
  if (!development) return false;
  const target = normDev(development);
  const states = await activeGrantStates(actor);
  return states.some((st) => normDev(String(st["development"] ?? "")) === target);
}

/** True if the actor holds ANY unexpired coverage unlock. One unlock grants
 * cross-development access for the whole 24h window (a floating supervisor may
 * bounce between sites), so callers use this rather than a per-site check. */
export async function hasAnyActiveCoverage(actor: Actor): Promise<boolean> {
  const states = await activeGrantStates(actor);
  return states.length > 0;
}

/** Home development OR an active coverage unlock — i.e. may ACT on this site. */
export async function canActOnDevelopment(actor: Actor, development: string): Promise<boolean> {
  if (!development) return true;
  if (isHomeDevelopment(actor, development)) return true;
  return hasActiveCoverage(actor, development);
}

/** Distinct development names the actor currently has an active unlock for. */
export async function activeCoverageDevelopments(actor: Actor): Promise<string[]> {
  const states = await activeGrantStates(actor);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const st of states) {
    const dev = String(st["development"] ?? "").trim();
    if (dev && !seen.has(normDev(dev))) {
      seen.add(normDev(dev));
      out.push(dev);
    }
  }
  return out;
}

/** The actor's active coverage unlocks, for display. */
export async function listActiveCoverage(
  actor: Actor,
): Promise<{ development: string; expiresAt: string }[]> {
  const states = await activeGrantStates(actor);
  return states.map((st) => ({
    development: String(st["development"] ?? ""),
    expiresAt: String(st["expiresAt"] ?? ""),
  }));
}
