import { and, eq } from "drizzle-orm";
import { db, staffAccounts } from "@workspace/db";
import type { Actor } from "./auth";
import {
  canReadEntity,
  canReadEntityRecord,
  canReadHrEntityRecord,
  isHrEntity,
  type HrLinkedStaff,
  type EntityRecordAuthorizationState,
} from "./domain";

export async function canReadEntityRecordForActor(
  actor: Actor,
  row: EntityRecordAuthorizationState & { tenantId?: string },
): Promise<boolean> {
  if (row.tenantId && row.tenantId !== actor.tenantId) return false;
  if (!isHrEntity(row.entity)) return canReadEntityRecord(actor, row);
  if (actor.role === "human_resources" || actor.role === "administrator") {
    return !row.deleted && canReadEntity(actor, row.entity);
  }
  const employeeStaffId = typeof row.state["employeeStaffId"] === "string"
    ? row.state["employeeStaffId"].trim()
    : "";
  if (!employeeStaffId) return false;
  const [employee] = await db
    .select({
      id: staffAccounts.id,
      role: staffAccounts.role,
      position: staffAccounts.position,
      developments: staffAccounts.developments,
      status: staffAccounts.status,
    })
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.id, employeeStaffId),
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
    ))
    .limit(1);
  return canReadHrEntityRecord(actor, row, employee as HrLinkedStaff);
}