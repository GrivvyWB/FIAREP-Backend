import { and, eq, inArray } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import type { Actor } from "./auth";
import { activeCoverageDevelopments } from "./coverage";
import {
  canReadEntity,
  canReadEntityRecord,
  isBoroughDirector,
  isSuperintendentE,
  isViolationAuthority,
  canReadHrEntityRecord,
  isHrEntity,
  type EntityRecordAuthorizationState,
} from "./domain";

const normalizeDevelopment = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export async function canReadEntityRecordForActor(
  actor: Actor,
  row: EntityRecordAuthorizationState & { tenantId?: string; id?: string },
): Promise<boolean> {
  if (row.tenantId && row.tenantId !== actor.tenantId) return false;
  if (row.entity === "resident-reports" || row.entity === "building-violations") {
    const decision = await complaintVisibility(actor, row);
    if (decision !== null) return decision;
  }
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

// ── Who sees a resident complaint / building violation ─────────────────────
// No inbox clutter: a complaint shows only for
//   • the development's own building management (Superintendent, Assistant
//     Superintendent, Maintenance Supervisor, Property Manager, APM, Housing
//     Assistant) — people whose home developments include the site,
//   • the emergency supervisor (Superintendent Ⓔ) and upper management,
//   • anyone it was SENT to (assigned, dispatched, handed off …),
//   • a supervisor/manager who entered that development's 2-digit code
//     ("Cover a site") — for the 24 hours the code lasts.
// Everyone else (other developments' supervisors, trade / inspection / CPM
// supervisors, CPMs, workers) does not see it until it is sent to them.
const BUILDING_MANAGEMENT_TITLES = new Set([
  "superintendent", "assistant superintendent", "maintenance supervisor",
  "property manager", "assistant property manager", "housing assistant",
]);
const UPPER_MANAGEMENT_TITLES = new Set(["borough director", "regional director", "assistant regional director"]);
const SENT_TO_FIELDS = [
  "assignedStaffId", "assignedByStaffId", "completedByStaffId", "receiverSupervisorId",
  "cpmSupervisorId", "assignedCpmStaffId", "dispatchingSupervisorId", "handoffTargetId",
  "directedToStaffId",
];

const coverageCache = new Map<string, { at: number; developments: string[] }>();
async function coveredDevelopments(actor: Actor): Promise<string[]> {
  const key = `${actor.tenantId}:${actor.id}`;
  const hit = coverageCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.developments;
  const developments = await activeCoverageDevelopments(actor).catch(() => [] as string[]);
  coverageCache.set(key, { at: Date.now(), developments });
  return developments;
}

// Complaints the actor handled indirectly: the inspection, scope, trade
// request or change order that came out of the complaint was created by them
// or sent to them (the Supervisor Inspector reviews every inspection). The
// complaint itself then reads for them too — a read-only trail of their work.
const handledCache = new Map<string, { at: number; ids: Set<string>; nos: Set<string> }>();
// Complaint numbers (RC-12345) written anywhere on a record: the inspector's
// note ("Complaint #: RC-86147"), the scope's source reference, etc.
function complaintNumbersIn(state: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const scan = (value: unknown, depth: number) => {
    if (depth > 2 || value == null) return;
    if (typeof value === "string") {
      for (const m of value.toUpperCase().matchAll(/\bRC-\d{3,}\b/g)) found.add(m[0]);
    } else if (Array.isArray(value)) {
      value.forEach((v) => scan(v, depth + 1));
    } else if (typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach((v) => scan(v, depth + 1));
    }
  };
  scan(state, 0);
  return [...found];
}
async function handledComplaints(actor: Actor): Promise<{ ids: Set<string>; nos: Set<string> }> {
  const key = `${actor.tenantId}:${actor.id}`;
  const hit = handledCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit;
  const ids = new Set<string>();
  const nos = new Set<string>();
  try {
    const rows = await db
      .select({ entity: entityRecords.entity, state: entityRecords.state, createdBy: entityRecords.createdBy, deleted: entityRecords.deleted })
      .from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        inArray(entityRecords.entity, ["building-violations", "procurement", "manpower-requests", "change-orders"]),
      ));
    for (const r of rows) {
      if (r.deleted) continue;
      const state = (r.state || {}) as Record<string, unknown>;
      const mine =
        r.createdBy === actor.id ||
        SENT_TO_FIELDS.some((field) => state[field] === actor.id) ||
        (r.entity === "building-violations" && isViolationAuthority(actor));
      if (!mine) continue;
      const source = String(state["sourceReportId"] || (state["sourceEntity"] === "resident-reports" ? state["sourceRecordId"] || "" : "") || "").trim();
      if (source) ids.add(source);
      complaintNumbersIn(state).forEach((no) => nos.add(no));
    }
  } catch { /* best effort */ }
  const result = { at: Date.now(), ids, nos };
  handledCache.set(key, result);
  return result;
}

async function complaintVisibility(
  actor: Actor,
  row: EntityRecordAuthorizationState & { id?: string },
): Promise<boolean | null> {
  // Residents, administrators and field staff viewing violations keep the
  // existing rules.
  if (actor.role === "administrator" || actor.role === "resident") return null;
  if (row.entity === "building-violations" && actor.role !== "management") return null;
  // The Supervisor Inspector reviews and routes violations (existing rules).
  if (row.entity === "building-violations" && isViolationAuthority(actor)) return null;
  if (row.deleted || !canReadEntity(actor, row.entity)) return false;
  const title = normalizeDevelopment(actor.position);
  if (isSuperintendentE(actor) || isBoroughDirector(actor) || UPPER_MANAGEMENT_TITLES.has(title)) return null;
  if (row.createdBy === actor.id) return true;
  if (SENT_TO_FIELDS.some((field) => row.state[field] === actor.id)) return true;
  // A measurement / picture from the job was sent to this person.
  if (Array.isArray(row.state["measurementSharedWith"]) && (row.state["measurementSharedWith"] as unknown[]).includes(actor.id)) return true;
  if (row.entity === "resident-reports") {
    const handled = await handledComplaints(actor);
    if (row.id && handled.ids.has(row.id)) return true;
    const no = String(row.state["complaintNo"] || "").trim().toUpperCase();
    if (no && handled.nos.has(no)) return true;
  }
  const development = normalizeDevelopment(row.development || String(row.state["development"] || ""));
  if (!development) return false;
  const home = actor.developments.some((d) => normalizeDevelopment(d) === development);
  if (home && BUILDING_MANAGEMENT_TITLES.has(title)) return true;
  // Supervisors / managers who entered this development's 2-digit code.
  if (actor.role === "management" || /supervisor|superintendent|manager/i.test(actor.position)) {
    const covered = await coveredDevelopments(actor);
    if (covered.some((d) => normalizeDevelopment(d) === development)) return true;
  }
  return false;
}
