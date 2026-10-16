// Read-only locks, each a switch in Platform Control -> Module Management
// ("Read-only locks"). A lock is OFF unless switched on for the organization:
// with it off, nobody is blocked by it. Stored as features.modules["lock.<key>"].
import { eq } from "drizzle-orm";
import { db, organizations } from "@workspace/db";

export type LockKey =
  | "appViewOnly"            // managers / supervisors / directors view-only in the phone app
  | "defaultRatesDirectorOnly" // only the Borough Director changes shared default rates
  | "adminProjectsViewOnly"  // administrators open projects view-only in the app
  | "approvedInspection"     // an approved inspection can no longer be edited
  | "procurementSubmitted"   // a CPM's submitted procurement scope can no longer be edited
  | "procurementClosed"      // a closed procurement record can no longer be changed
  | "approvalEvidence"       // approved company approval evidence can no longer be changed
  | "reportsOtherDevelopments" // management edits only reports in its own developments
  | "tradeSupWaitForSend";   // a trade supervisor acts only once management sends the complaint

// A switch flipped in Platform Control takes effect within 15 seconds.
const cache = new Map<string, { at: number; modules: Record<string, unknown> }>();
async function modulesFor(tenantId: string): Promise<Record<string, unknown>> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < 15_000) return hit.modules;
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = ((org?.features as Record<string, unknown> | undefined)?.["modules"] ?? {}) as Record<string, unknown>;
  cache.set(tenantId, { at: Date.now(), modules });
  return modules;
}

export async function lockOn(tenantId: string, key: LockKey): Promise<boolean> {
  try {
    return (await modulesFor(tenantId))[`lock.${key}`] === true;
  } catch {
    return false;
  }
}
