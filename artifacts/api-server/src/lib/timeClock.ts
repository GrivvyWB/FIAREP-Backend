import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  organizations,
  staffAccounts,
  timeClockPunches,
  type TimeClockPunch,
} from "@workspace/db";
import {
  canonicalizeProvider,
  classifyMobileIdempotency,
  expectedDirection,
  getTimeClockConfig,
  isMobileClockMutationAllowed,
  rejectUnimplementedExternalIntegration,
  serializeTimeClockPunch,
} from "./timeClockConfig";
import type { TimeClockConfig, TimeClockProvider } from "./timeClockConfig";

export type { TimeClockConfig, TimeClockProvider };
export { classifyMobileIdempotency, expectedDirection, getTimeClockConfig, isMobileClockMutationAllowed };
export { rejectUnimplementedExternalIntegration, serializeTimeClockPunch };
export { mergeTimeClockConfig } from "./timeClockConfig";

export type ExternalPunchInput = {
  tenantId: string;
  staffId: string;
  direction: "in" | "out";
  punchAt: Date;
  provider: string;
  externalId: string;
};

/**
 * Adapter-ready server-side import helper.  It is deliberately not mounted
 * as an HTTP route; only a trusted provider adapter can call it.
 */
export async function importExternalPunch(input: ExternalPunchInput): Promise<TimeClockPunch | null> {
  const provider = input.provider ? canonicalizeProvider(input.provider) : "";
  const externalId = input.externalId?.trim();
  if (!input.tenantId || !input.staffId || !provider || !externalId) {
    throw new Error("tenantId, staffId, provider, and externalId are required");
  }
  return db.transaction(async (tx) => {
    const [organization] = await tx.select({ features: organizations.features })
      .from(organizations)
      .where(eq(organizations.id, input.tenantId))
      .limit(1)
      .for("update");
    if (!organization) throw new Error("The external punch organization does not exist");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`time-clock:${input.tenantId}:${input.staffId}`}))`);
    const config = getTimeClockConfig(organization.features);
    if (!config.integrationEnabled || config.provider !== provider) {
      throw new Error("The external time-clock provider is not enabled for this organization");
    }
    const [staff] = await tx.select({ id: staffAccounts.id })
      .from(staffAccounts)
      .where(and(
        eq(staffAccounts.id, input.staffId),
        eq(staffAccounts.tenantId, input.tenantId),
        eq(staffAccounts.status, "approved"),
      ))
      .limit(1);
    if (!staff) throw new Error("The external punch does not match an approved staff member");
    const idempotencyKey = `${provider}:${externalId}`;
    const [existing] = await tx.select().from(timeClockPunches).where(and(
      eq(timeClockPunches.tenantId, input.tenantId),
      eq(timeClockPunches.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      if (
        existing.source !== "external" ||
        existing.staffId !== input.staffId ||
        existing.provider !== provider ||
        existing.externalId !== externalId ||
        existing.direction !== input.direction
      ) {
        throw new Error("The external punch idempotency key is already bound to a different punch");
      }
      return existing;
    }
    const [row] = await tx.insert(timeClockPunches).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      staffId: input.staffId,
      source: "external",
      direction: input.direction,
      punchAt: input.punchAt,
      provider,
      externalId,
      idempotencyKey,
    }).returning();
    return row ?? null;
  });
}

export async function getLatestPunch(tenantId: string, staffId: string): Promise<TimeClockPunch | null> {
  const [row] = await db.select().from(timeClockPunches).where(and(
    eq(timeClockPunches.tenantId, tenantId),
    eq(timeClockPunches.staffId, staffId),
  )).orderBy(desc(timeClockPunches.punchAt), desc(timeClockPunches.recordedAt)).limit(1);
  return row ?? null;
}

export { organizations, timeClockPunches };