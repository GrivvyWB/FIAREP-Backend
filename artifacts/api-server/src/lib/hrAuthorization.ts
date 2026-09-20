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
      return true;
    }
    return canReadEntityRecord(actor, row);
  }
  return canReadHrEntityRecord(actor, row);
}