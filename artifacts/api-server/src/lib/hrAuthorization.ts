import type { Actor } from "./auth";
import {
  canReadEntity,
  canReadEntityRecord,
  canReadHrEntityRecord,
  isHrEntity,
  type EntityRecordAuthorizationState,
} from "./domain";

const normalizeDevelopment = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

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
      // Resident Reports are visible to every management supervisor across all
      // developments (the Resident Reports page is org-wide for supervisors).
      // Building violations stay scoped to the supervisor's own developments.
      if (row.entity === "resident-reports") return true;
      if (
        actor.developments.length > 0 &&
        row.development &&
        !actor.developments.some(
          (development) =>
            normalizeDevelopment(development) === normalizeDevelopment(row.development),
        )
      ) {
        return false;
      }
      return true;
    }
    return canReadEntityRecord(actor, row);
  }
  return canReadHrEntityRecord(actor, row);
}