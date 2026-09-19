import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import type { Actor } from "./auth";
import {
  canReadEntity,
  canReadEntityRecord,
  canReadHrEntityRecord,
  isHrEntity,
  type EntityRecordAuthorizationState,
} from "./domain";

export async function canReadEntityRecordForActor(
  actor: Actor,
  row: EntityRecordAuthorizationState & { tenantId?: string },
): Promise<boolean> {
  if (row.tenantId && row.tenantId !== actor.tenantId) return false;
  if (!isHrEntity(row.entity)) {
    const routingOnlySupervisor =
      actor.role === "management" &&
      actor.position.toLowerCase().includes("supervisor");
    if (routingOnlySupervisor && row.entity === "manpower-requests") {
      return !row.deleted &&
        canReadEntity(actor, row.entity) &&
        row.state["receiverSupervisorId"] === actor.id;
    }
    if (
      routingOnlySupervisor &&
      (row.entity === "resident-reports" || row.entity === "building-violations")
    ) {
      if (row.deleted || !canReadEntity(actor, row.entity)) return false;
      if (
        actor.developments.length > 0 &&
        row.development &&
        !actor.developments.includes(row.development)
      ) {
        return false;
      }
      if (row.state["assignedStaffId"] === actor.id) return true;
      const [routedRequest] = await db.select({ id: entityRecords.id })
        .from(entityRecords)
        .where(and(
          eq(entityRecords.tenantId, actor.tenantId),
          eq(entityRecords.entity, "manpower-requests"),
          eq(entityRecords.deleted, false),
          sql`${entityRecords.state}->>'sourceEntity' = ${row.entity}`,
          sql`${entityRecords.state}->>'sourceRecordId' = ${String((row as { id?: string }).id || "")}`,
          sql`${entityRecords.state}->>'receiverSupervisorId' = ${actor.id}`,
        ))
        .limit(1);
      return Boolean(routedRequest);
    }
    return canReadEntityRecord(actor, row);
  }
  return canReadHrEntityRecord(actor, row);
}