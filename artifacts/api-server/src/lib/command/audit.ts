// Command Center audit trail: every login, command, proposal, approval,
// denial, execution and result. Append-only and hash-chained.
import { asc, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { commandAudit } from "./tables";
import { canonicalJson, sha256hex } from "./crypto";
import { logger } from "../logger";

const GENESIS = "0".repeat(64);
const LOCK_KEY = 0x46494152; // "FIAR": serializes appends so the chain has one order

type Entry = { actor: string; event: string; deviceId?: string | null; runId?: string | null; actionId?: string | null; detail?: Record<string, unknown> };

function rowHash(prevHash: string, at: string, e: Required<Omit<Entry, "detail">> & { detail: Record<string, unknown> }): string {
  return sha256hex(canonicalJson({ prevHash, at, actor: e.actor, event: e.event, deviceId: e.deviceId, runId: e.runId, actionId: e.actionId, detail: e.detail }));
}

export async function commandAuditLog(entry: Entry): Promise<void> {
  const e = { actor: entry.actor, event: entry.event, deviceId: entry.deviceId ?? null, runId: entry.runId ?? null, actionId: entry.actionId ?? null, detail: entry.detail ?? {} };
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      const [last] = await tx.select({ hash: commandAudit.hash }).from(commandAudit).orderBy(desc(commandAudit.seq)).limit(1);
      const prevHash = last?.hash ?? GENESIS;
      const at = new Date();
      const hash = rowHash(prevHash, at.toISOString(), e as never);
      await tx.insert(commandAudit).values({ ...e, at, prevHash, hash });
    });
  } catch (err) {
    // The audit write must never be silently skipped for an action that ran:
    // callers that execute something log before they execute.
    logger.error({ err, event: e.event }, "Command audit write failed");
    throw err;
  }
}

export async function recentAudit(limit = 100) {
  return db.select().from(commandAudit).orderBy(desc(commandAudit.seq)).limit(Math.min(Math.max(limit, 1), 1000));
}

/** Walk the whole chain. Returns the first broken row, if any. */
export async function verifyAuditChain(): Promise<{ ok: boolean; rows: number; brokenAt: number | null }> {
  const rows = await db.select().from(commandAudit).orderBy(asc(commandAudit.seq));
  let prev = GENESIS;
  for (const r of rows) {
    const expected = rowHash(prev, r.at.toISOString(), { actor: r.actor, event: r.event, deviceId: r.deviceId, runId: r.runId, actionId: r.actionId, detail: r.detail } as never);
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false, rows: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true, rows: rows.length, brokenAt: null };
}
