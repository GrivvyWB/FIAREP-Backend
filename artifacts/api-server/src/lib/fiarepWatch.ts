// FIAREP watching a client quietly (Platform Control → Module Management → "FIAREP sees everything
// (quiet)"): every complaint at that client shows on FIAREP's Complaint Dashboard and opens read-only
// for FIAREP's administrators and management. Nothing is written to the client's records and the
// client is never told — for pilots, to see how the business is really being run.
import { and, eq } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import type { Actor } from "./auth";

export const FIAREP_TENANT = "default";

export async function watchedClients(): Promise<Set<string>> {
  const orgs = await db.select({ id: organizations.id, features: organizations.features }).from(organizations);
  return new Set(orgs.filter((o) => ((((o.features ?? {}) as Record<string, unknown>)["modules"] ?? {}) as Record<string, unknown>)["fiarepWatch"] === true).map((o) => o.id));
}

export const isFiarepOffice = (actor: Pick<Actor, "tenantId" | "role">) => actor.tenantId === FIAREP_TENANT && ["administrator", "management"].includes(actor.role);

/** A client's complaint, read-only, for FIAREP's office — only at a client FIAREP watches. */
export async function watchedComplaint(actor: Actor, id: string) {
  if (!isFiarepOffice(actor)) return null;
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false))).limit(1);
  if (!row || row.tenantId === FIAREP_TENANT || !(await watchedClients()).has(row.tenantId)) return null;
  return row;
}
