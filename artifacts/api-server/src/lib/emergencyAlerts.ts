// Emergency job alerts (Platform Control → Emergency alerts, per client; on unless switched off):
//   emergencyAlerts.new       a new emergency job → the emergency supervisor(s) and the emergency crew
//   emergencyAlerts.assigned  a job assigned to someone → that person
import { and, eq } from "drizzle-orm";
import { db, organizations, staffAccounts } from "@workspace/db";
import type { Actor } from "./auth";
import { notify } from "./audit";
import { isSuperintendentE } from "./domain";

async function switchOn(tenantId: string, key: string): Promise<boolean> {
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = ((org?.features as Record<string, unknown> | undefined)?.["modules"] ?? {}) as Record<string, unknown>;
  return modules[key] !== false;
}

const where = (s: Record<string, unknown>) => [s["emId"], s["issue"] || s["title"], s["address"] || s["location"], s["development"]]
  .map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean).join(" · ");

/** A new emergency job: the emergency supervisor(s) and every emergency crew member hear right away. */
export async function alertNewEmergencyJob(actor: Actor, jobId: string, state: Record<string, unknown>): Promise<void> {
  if (!(await switchOn(actor.tenantId, "emergencyAlerts.new"))) return;
  const people = await db.select({ id: staffAccounts.id, role: staffAccounts.role, position: staffAccounts.position })
    .from(staffAccounts).where(and(eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.status, "approved")));
  const to = people.filter((p) => p.id !== actor.id && (p.role === "emergency" || isSuperintendentE({ position: p.position })));
  for (const p of to) await notify(actor, p.id, "New emergency job", where(state) || undefined, jobId);
}

/** An emergency job assigned (or reassigned) to someone: that person hears. */
export async function alertEmergencyAssigned(actor: Actor, jobId: string, before: Record<string, unknown>, after: Record<string, unknown>): Promise<void> {
  const to = typeof after["assignedStaffId"] === "string" ? after["assignedStaffId"] : "";
  if (!to || to === before["assignedStaffId"] || to === actor.id) return;
  if (!(await switchOn(actor.tenantId, "emergencyAlerts.assigned"))) return;
  await notify(actor, to, "Emergency job assigned to you", where(after) || undefined, jobId);
}
