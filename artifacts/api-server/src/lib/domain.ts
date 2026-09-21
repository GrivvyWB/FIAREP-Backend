import { randomInt, randomUUID } from "node:crypto";
import type { Actor } from "./auth";

export const STAFF_ROLES = new Set([
  "administrator",
  "human_resources",
  "management",
  "worker",
  "inspector",
  "procurement",
  "vendor",
  "resident",
  "emergency",
]);

const PUBLIC_ACCESS_ROLES = new Set(["resident", "vendor"]);

export function isStaffAccountRole(role: string): boolean {
  return STAFF_ROLES.has(role) && !PUBLIC_ACCESS_ROLES.has(role);
}

export function canIssueStaffAccountRole(role: string): boolean {
  return isStaffAccountRole(role);
}

export function canUseGeneralStaffLogin(role: string): boolean {
  return isStaffAccountRole(role);
}

export function canDeleteOperationalRecords(actor: Actor): boolean {
  return actor.role === "administrator" ||
    (actor.role === "management" &&
      ["Borough Director", "Regional Director"].includes(actor.position));
}

export function canDeleteStaffAccounts(actor: Actor): boolean {
  return actor.role === "human_resources" || canDeleteOperationalRecords(actor);
}

export const STAFF_POSITIONS = [
  "Borough Director",
  "Regional Director",
  "Assistant Regional Director",
  "Property Manager",
  "Superintendent",
  "Assistant Superintendent",
  "Supervisor Inspector",
  "Plumbing Supervisor",
  "Electrical Supervisor",
  "Maintenance Supervisor",
  "CPM Supervisor",
  "Grounds Supervisor",
  "Inspector",
  "Plumber",
  "Electrician",
  "Maintenance Worker",
  "Caretaker",
  "Porter",
  "Laborer",
  "Groundskeeper",
  "Administrative Staff",
  "Other Support Staff",
  "Human Resources",
  "Assistant Property Manager",
  "Housing Assistant",
  "Janitorial Staff",
  "CPM",
  "Elevator Service",
  "Painter",
  "Plumber Supervisor",
  "Electric Supervisor",
  "Elevator Supervisor",
  "Painter Supervisor",
  "Carpenter Supervisor",
  "Carpenter",
  "Roofer",
  "General Construction",
  "CCTV Installation",
  "Heating Service",
  "Staff Worker",
  "Director",
  "Superintendent Ⓔ",
  "Other",
] as const;

export const ENTITIES = new Set([
  "projects",
  "rooms",
  "checklists",
  "cost-estimates",
  "project-scopes",
  "intakes",
  "inspections",
  "hud-inspections",
  "elevators",
  "roofplans",
  "project-notes",
  "project-reviews",
  "resident-reports",
  "violations",
  "building-violations",
  "priority-violations",
  "route-assignments",
  "manpower-requests",
  "procurement",
  "procurement-bids",
  "vendor-contacts",
  "vendor-quotes",
  "change-orders",
  "elevator-jobs",
  "emergency-units",
  "emergency-jobs",
  "leave-requests",
  "global-settings",
  "hr-employee-records",
  "hr-recruiting",
  "hr-onboarding",
  "hr-payroll-benefits",
  "hr-attendance",
  "hr-relations",
  "hr-performance",
  "hr-discipline",
  "hr-investigations",
  "hr-training-compliance",
  "hr-exits",
  "hr-approvals",
]);

export const HR_ENTITIES = new Set([
  "hr-employee-records",
  "hr-recruiting",
  "hr-onboarding",
  "hr-payroll-benefits",
  "hr-attendance",
  "hr-relations",
  "hr-performance",
  "hr-discipline",
  "hr-investigations",
  "hr-training-compliance",
  "hr-exits",
  "hr-approvals",
]);
const PRICING_KEYS = new Set([
  "amount",
  "amountCharged",
  "cost",
  "costs",
  "deduction",
  "finalAmount",
  "grandTotal",
  "origPrice",
  "price",
  "priceBy",
  "rates",
  "total",
  "totals",
  "unitCost",
  "unitPrice",
]);

const HIGH_RISK_ENTITIES = new Set([
  "procurement",
  "procurement-bids",
  "vendor-quotes",
  "change-orders",
]);

const ELEVATOR_ENTITIES = new Set(["elevators", "elevator-jobs"]);
const VIOLATION_ENTITIES = new Set([
  "violations",
  "building-violations",
  "priority-violations",
  "route-assignments",
]);

const ELEVATED_POSITIONS = new Set([
  "Borough Director",
  "Regional Director",
  "Superintendent",
]);
const SPECIALIZED_MANAGEMENT_POSITIONS = new Set([
  ...ELEVATED_POSITIONS,
  "Superintendent Ⓔ",
]);

function normalizedPosition(position: string): string {
  return position.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isBoroughDirector(actor: Actor): boolean {
  return normalizedPosition(actor.position) === "borough director";
}

export function isElevated(actor: Actor): boolean {
  const position = normalizedPosition(actor.position);
  return (
    isBoroughDirector(actor) ||
    (actor.role === "management" &&
      ["regional director", "superintendent"].includes(position))
  );
}

/** Audit history is restricted to the two organization-wide directors. */
export function canReadAuditLog(actor: Actor): boolean {
  return isBoroughDirector(actor) ||
    (actor.role === "management" && actor.position === "Regional Director");
}

export function canReadSharedDefaultRates(actor: Actor): boolean {
  return actor.position !== "Maintenance Worker";
}

/** The only management actors who may review procurement scopes.  Keep this
 * predicate deliberately strict: position is an authorization boundary, not
 * merely a display label. */
export function isOrdinaryManagement(actor: Actor): boolean {
  return actor.role === "management" &&
    !isBoroughDirector(actor) &&
    !SPECIALIZED_MANAGEMENT_POSITIONS.has(actor.position) &&
    actor.position !== "CPM Supervisor";
}

/** CPM Supervisors may author their own scope drafts, but are not procurement reviewers. */
export function isCpmSupervisor(actor: Pick<Actor, "role" | "position">): boolean {
  return actor.role === "management" && actor.position === "CPM Supervisor";
}

/**
 * Elevator records are operationally sensitive.  Field staff may only see
 * them when their approved position is part of the elevator operation (or
 * when an inspector is serving as the CPM for that scope).  Supervisors and
 * administrators retain their normal development-scoped oversight.
 */
export function isElevatorFieldStaff(actor: Actor): boolean {
  return (
    ["worker", "inspector"].includes(actor.role) &&
    (actor.position === "Elevator Service" ||
      actor.position === "Elevator Supervisor" ||
      (actor.role === "inspector" && actor.position === "CPM"))
  );
}

export function isSupervisorPosition(actor: Actor): boolean {
  return actor.position.toLowerCase().includes("supervisor") ||
    actor.position === "Superintendent" ||
    actor.position === "Superintendent Ⓔ";
}

export function isComplaintHandlingSupervisor(
  actor: Pick<Actor, "role" | "position">,
): boolean {
  if (actor.position === "Superintendent Ⓔ") return true;
  return actor.role === "management" &&
    actor.position !== "CPM Supervisor" &&
    (
      actor.position.toLowerCase().includes("supervisor") ||
      ["Superintendent", "Assistant Superintendent"].includes(actor.position)
    );
}

export function isHudReviewSupervisor(actor: Actor): boolean {
  return actor.position === "Supervisor Inspector";
}

/** Violation and inspection review authority for management positions. */
export function isViolationAuthority(actor: Actor): boolean {
  return actor.role === "management" &&
    actor.position === "Supervisor Inspector";
}

export function canBrowseStaffDirectory(actor: Actor): boolean {
  return (
    actor.role === "human_resources" ||
    actor.role === "management" ||
    actor.role === "administrator" ||
    isBoroughDirector(actor)
  );
}

export function canReadEntity(actor: Actor, entity: string): boolean {
  if (actor.role === "administrator") return true;
  const isEmergencyMaintenance =
    actor.role === "emergency" && actor.position === "Maintenance Worker";
  if (isHrEntity(entity)) {
    return actor.role === "human_resources" ||
      actor.role === "administrator" ||
      actor.role === "management";
  }
  if (entity === "hud-inspections") {
    return isHudReviewSupervisor(actor) ||
      (actor.role === "inspector" && ["CPM", "Inspector"].includes(actor.position));
  }
  if (entity === "change-orders" && isSupervisorPosition(actor)) return true;
  if (ELEVATOR_ENTITIES.has(entity)) {
    if (["management", "administrator"].includes(actor.role) ||
        isBoroughDirector(actor)) {
      return true;
    }
    return isElevatorFieldStaff(actor);
  }
  if (VIOLATION_ENTITIES.has(entity)) {
    return (
      actor.role === "inspector" ||
      isViolationAuthority(actor) ||
      (actor.role === "management" && isSupervisorPosition(actor)) ||
      (entity === "building-violations" && isCpmSupervisor(actor))
    );
  }
  if (entity === "procurement" || entity === "procurement-bids") {
    if (isCpmSupervisor(actor) && entity === "procurement-bids") return false;
    return actor.role === "procurement" ||
      (entity === "procurement" && isCpmSupervisor(actor)) ||
      (entity === "procurement" && actor.role === "inspector" && actor.position === "CPM");
  }
  if (isCpmSupervisor(actor) && entity === "vendor-quotes") return false;
  if (actor.role === "emergency" && !isEmergencyMaintenance) {
    return entity === "emergency-jobs" || entity === "emergency-units";
  }
  if (isEmergencyMaintenance && (entity === "emergency-jobs" || entity === "emergency-units")) {
    return true;
  }
  if (entity === "emergency-jobs" || entity === "emergency-units") {
    return actor.role === "administrator" || actor.role === "management" || isBoroughDirector(actor);
  }
  if (isBoroughDirector(actor)) return true;
  if (HIGH_RISK_ENTITIES.has(entity) && actor.role === "management") {
    return isElevated(actor);
  }
  return true;
}

function leaveRecordAllowed(
  actor: Actor,
  row: EntityRecordAuthorizationState,
): boolean {
  if (row.entity !== "leave-requests") return true;
  if (actor.role === "human_resources") return true;
  const employeeStaffId = typeof row.state["employeeStaffId"] === "string"
    ? row.state["employeeStaffId"]
    : "";
  if (employeeStaffId) return employeeStaffId === actor.id;
  const employeeName = typeof row.state["employee"] === "string"
    ? row.state["employee"].trim().toLowerCase()
    : "";
  if (employeeName && employeeName === actor.name.trim().toLowerCase()) return true;
  if (!employeeName && row.createdBy === actor.id) return true;
  return false;
}

export function procurementRecordAllowed(
  actor: Actor,
  row: { entity: string; createdBy: string | null; state: Record<string, unknown> },
): boolean {
  if (row.entity !== "procurement" && row.entity !== "procurement-bids") return true;
  const status = String(row.state["status"] ?? "");
  if (actor.role === "procurement") {
    return row.entity === "procurement-bids" ||
      ["approved", "bidding", "awarded", "closed"].includes(status);
  }
  if (isCpmSupervisor(actor)) {
    // CPM Supervisors are reviewers, not scope authors. They may inspect only
    // submitted scopes in their covered developments.
    const handoffTarget = typeof row.state["handoffTargetId"] === "string"
      ? row.state["handoffTargetId"]
      : "";
    if (handoffTarget && handoffTarget !== actor.id) return false;
    return row.entity === "procurement" &&
      (status === "submitted" || status === "in_house" || status === "in_house_completed");
  }
  return actor.role === "inspector" && actor.position === "CPM" &&
    row.entity === "procurement" && row.createdBy === actor.id &&
    ["draft", "submitted", "returned"].includes(status);
}

export function developmentAllowed(
  actor: Actor,
  development: string | null,
): boolean {
  if (isElevated(actor)) return true;
  if (actor.role === "administrator") return true;
  if (actor.role === "human_resources") return true;
  const normalizedDevelopment = development?.trim().toLowerCase() || "";
  const normalizedAssignments = actor.developments.map((item) =>
    item.trim().toLowerCase()
  );
  if (actor.role === "management") {
    return Boolean(
      normalizedDevelopment &&
      normalizedAssignments.includes(normalizedDevelopment)
    );
  }
  return (
    actor.developments.length === 0 ||
    !development ||
    normalizedAssignments.includes(normalizedDevelopment)
  );
}

export function entityDevelopmentAllowed(
  actor: Actor,
  entity: string,
  development: string | null,
): boolean {
  if (
    entity === "resident-reports" &&
    actor.role === "management" &&
    actor.position === "Superintendent Ⓔ"
  ) {
    return true;
  }
  if (
    entity === "projects" &&
    !development &&
    actor.developments.length > 0
  ) {
    return false;
  }
  return developmentAllowed(actor, development);
}

export type EntityRecordAuthorizationState = {
  entity: string;
  development: string | null;
  state: Record<string, unknown>;
  createdBy: string | null;
  deleted: boolean;
};

function privateRecordAllowed(
  actor: Actor,
  row: EntityRecordAuthorizationState,
): boolean {
  if (actor.role === "resident") {
    return row.entity === "resident-reports" && row.createdBy === actor.id;
  }
  if (
    actor.role === "vendor" &&
    (row.entity === "procurement-bids" || row.entity === "vendor-quotes")
  ) {
    return row.createdBy === actor.id;
  }
  return true;
}

function emergencyRecordAllowed(
  actor: Actor,
  row: EntityRecordAuthorizationState,
): boolean {
  if (actor.role !== "emergency") return true;
  const isEmergencyEntity =
    row.entity === "emergency-jobs" || row.entity === "emergency-units";
  if (actor.position === "Maintenance Worker" && !isEmergencyEntity) return true;
  const normalizedActor = actor.name.trim().toLowerCase().replace(/\s+/g, " ");
  return (row.entity === "emergency-jobs" || row.entity === "emergency-units") &&
    [
      row.state["assignedTo"],
      row.state["assignedStaffId"],
      row.state["assignedUnitId"],
      row.state["unitId"],
      row.state["name"],
      row.state["unitName"],
    ].some(
      (value) =>
        typeof value === "string" &&
        (value === actor.id ||
          value.trim().toLowerCase().replace(/\s+/g, " ") === normalizedActor),
    );
}

const STAFF_ASSIGNMENT_SCOPED_ENTITIES = new Set([
  "projects",
  "project-scopes",
  "inspections",
  "resident-reports",
  "violations",
  "building-violations",
  "priority-violations",
  "route-assignments",
  "change-orders",
  "elevator-jobs",
  "emergency-jobs",
  "manpower-requests",
]);

function staffAssignmentRecordAllowed(
  actor: Actor,
  row: EntityRecordAuthorizationState,
): boolean {
  const isEmergencyMaintenance =
    actor.role === "emergency" && actor.position === "Maintenance Worker";
  if (!["worker", "inspector"].includes(actor.role) && !isEmergencyMaintenance) return true;
  if (row.entity === "hud-inspections") return row.createdBy === actor.id;
  if (
    actor.role === "inspector" &&
    actor.position === "CPM" &&
    row.entity === "procurement"
  ) {
    return true;
  }
  if (row.entity === "leave-requests") {
    const employeeStaffId = typeof row.state["employeeStaffId"] === "string"
      ? row.state["employeeStaffId"]
      : "";
    if (employeeStaffId) return employeeStaffId === actor.id;
    const requesterStaffId = typeof row.state["requesterStaffId"] === "string"
      ? row.state["requesterStaffId"]
      : "";
    return requesterStaffId ? requesterStaffId === actor.id : row.createdBy === actor.id;
  }
  if (row.entity === "manpower-requests") {
    return row.state["receiverSupervisorId"] === actor.id ||
      normalizeAssignment(row.state).assignedStaffId === actor.id;
  }
  if (!STAFF_ASSIGNMENT_SCOPED_ENTITIES.has(row.entity)) return true;
  if (
    row.entity === "building-violations" &&
    actor.role === "inspector" &&
    actor.position === "CPM" &&
    row.state["assignedCpmStaffId"] === actor.id
  ) return true;
  if (
    row.entity === "building-violations" &&
    actor.role === "inspector" &&
    row.createdBy === actor.id
  ) return true;
  return normalizeAssignment(row.state).assignedStaffId === actor.id;
}

/**
 * The complete synchronous boundary for non-HR records. HR records are
 * intentionally denied here because their canonical employee linkage requires
 * the async predicate in hrAuthorization.ts.
 */
export function canReadEntityRecord(
  actor: Actor,
  row: EntityRecordAuthorizationState,
): boolean {
  // HR records require the async linked-employee lookup.  Returning false
  // here prevents synchronous consumers from accidentally bypassing the
  // supervisory scope boundary.
  if (isHrEntity(row.entity)) return false;
  if (
    row.entity === "building-violations" &&
    isCpmSupervisor(actor) &&
    row.state["cpmSupervisorId"] !== actor.id
  ) return false;
  if (
    row.entity === "building-violations" &&
    actor.role === "inspector" &&
    actor.position === "CPM" &&
    row.state["assignedCpmStaffId"] !== actor.id &&
    row.createdBy !== actor.id
  ) return false;
  return !row.deleted &&
    canReadEntity(actor, row.entity) &&
    entityDevelopmentAllowed(actor, row.entity, row.development) &&
    privateRecordAllowed(actor, row) &&
    procurementRecordAllowed(actor, row) &&
    emergencyRecordAllowed(actor, row) &&
    leaveRecordAllowed(actor, row) &&
    staffAssignmentRecordAllowed(actor, row);
}

export type HrLinkedStaff = {
  id: string;
  role: string;
  position: string;
  developments: string[];
  status: string;
};
/**
 * Uploads are attached to an existing record before an object URL is signed.
 * Mutability is intentional here: a read-only role must not be able to attach
 * arbitrary new objects to a record it can merely see.
 */
export function canUploadToEntityRecord(
  actor: Actor,
  row: EntityRecordAuthorizationState,
): boolean {
  return canReadEntityRecord(actor, row) && canMutateEntity(actor, row.entity);
}

export function canCreateEntity(actor: Actor, entity: string): boolean {
  const isEmergencyMaintenance =
    actor.role === "emergency" && actor.position === "Maintenance Worker";
  if (isBoroughDirector(actor)) return false;
  if (isHrEntity(entity)) {
    return actor.role === "human_resources" ||
      actor.role === "administrator" ||
      (entity === "hr-approvals" && actor.role === "management");
  }
  if (actor.role === "emergency" && !isEmergencyMaintenance) return false;
  if (entity === "global-settings") return false;
  if (entity === "hud-inspections") {
    return actor.role === "inspector" && ["CPM", "Inspector"].includes(actor.position);
  }
  if (entity === "change-orders" && isSupervisorPosition(actor)) return true;
  if (ELEVATOR_ENTITIES.has(entity)) {
    return (
      isElevatorFieldStaff(actor) ||
      actor.role === "management" ||
      actor.role === "administrator"
    );
  }
  if (VIOLATION_ENTITIES.has(entity)) {
    return (
      actor.role === "inspector" ||
      isViolationAuthority(actor)
    );
  }
  if (entity === "emergency-units" || entity === "emergency-jobs") {
    return (
      actor.role === "administrator" ||
      (actor.role === "management" &&
        ["Borough Director", "Regional Director"].includes(actor.position))
    );
  }
  if (entity === "procurement-bids" || entity === "vendor-quotes") {
    // Bids are public-vendor submissions; authenticated Procurement staff may
    // read/process them but must never manufacture one.
    return entity === "vendor-quotes" && actor.role === "vendor";
  }
  if (entity === "resident-reports" && actor.role === "resident") return true;
  if (entity === "procurement") {
    return actor.role === "inspector" && actor.position === "CPM";
  }
  if (entity === "building-violations" || entity === "route-assignments") {
    return ["administrator", "management", "inspector"].includes(actor.role);
  }
  return !["resident", "vendor"].includes(actor.role);
}

export function canMutateEntity(actor: Actor, entity: string): boolean {
  const isEmergencyMaintenance =
    actor.role === "emergency" && actor.position === "Maintenance Worker";
  if (isBoroughDirector(actor)) return false;
  if (isHrEntity(entity)) {
    return actor.role === "human_resources" ||
      actor.role === "administrator" ||
      (entity === "hr-approvals" && actor.role === "management");
  }
  if (actor.role === "emergency") {
    if (entity === "emergency-jobs") return true;
    if (!isEmergencyMaintenance) return false;
  }
  if (entity === "global-settings") return false;
  if (entity === "hud-inspections") {
    return actor.role === "inspector" && ["CPM", "Inspector"].includes(actor.position);
  }
  if (entity === "change-orders" && isSupervisorPosition(actor)) return true;
  if (ELEVATOR_ENTITIES.has(entity) || VIOLATION_ENTITIES.has(entity)) {
    return canCreateEntity(actor, entity);
  }
  if (entity === "procurement" || entity === "procurement-bids") {
    return entity === "procurement" &&
      actor.role === "inspector" && actor.position === "CPM";
  }
  return canCreateEntity(actor, entity);
}

export function canDeleteEntity(
  actor: Actor,
  entity: string,
  state: Record<string, unknown>,
): boolean {
  if (entity === "resident-reports") return false;
  if (actor.role === "administrator") return true;
  // HR lifecycle records and company approval evidence are retained as
  // employment history. No role may soft-delete them through the generic
  // entity deletion route.
  if (isHrEntity(entity)) return false;
  if (entity === "hud-inspections") return false;
  if (ELEVATOR_ENTITIES.has(entity)) {
    return (
      (isElevatorFieldStaff(actor) && state["clearedByMgmt"] === true) ||
      actor.role === "management" ||
      false
    );
  }
  if (VIOLATION_ENTITIES.has(entity) && actor.role === "inspector") {
    return state["clearedByMgmt"] === true;
  }
  if (entity === "procurement" || entity === "procurement-bids") {
    return entity === "procurement" &&
      !isBoroughDirector(actor) &&
      actor.role === "management" && actor.position === "Regional Director";
  }
  if (
    actor.role === "worker" ||
    actor.role === "inspector" ||
    (actor.role === "emergency" && actor.position === "Maintenance Worker")
  ) {
    return state["clearedByMgmt"] === true;
  }
  return actor.role === "management";
}

const ASSIGNABLE_STAFF_ROLES = new Set([
  "management",
  "worker",
  "inspector",
  "emergency",
]);

const TRADE_SUPERVISOR_POSITIONS = new Set([
  "Plumber Supervisor",
  "Electric Supervisor",
  "Elevator Supervisor",
  "Painter Supervisor",
  "Carpenter Supervisor",
  "Boiler Supervisor",
  "Bricklayer Supervisor",
]);

const TRADE_ASSIGNMENT_BY_SUPERVISOR = new Map<string, string>([
  ["Plumbing Supervisor", "Plumber"],
  ["Plumber Supervisor", "Plumber"],
  ["Supervisor Plumber", "Plumber"],
  ["Supervisor Inspector", "Inspector"],
  ["Inspector Supervisor", "Inspector"],
  ["Inspection Supervisor", "Inspector"],
  ["CPM Supervisor", "CPM"],
  ["Supervisor CPM", "CPM"],
  ["Carpenter Supervisor", "Carpenter"],
  ["Supervisor Carpenter", "Carpenter"],
  ["Elevator Supervisor", "Elevator Service"],
  ["Elevator Service Supervisor", "Elevator Service"],
  ["Supervisor Elevator", "Elevator Service"],
  ["Electrical Supervisor", "Electrician"],
  ["Electric Supervisor", "Electrician"],
  ["Electrician Supervisor", "Electrician"],
  ["Supervisor Electrician", "Electrician"],
  ["Painter Supervisor", "Painter"],
  ["Supervisor Painter", "Painter"],
  ["Boiler Supervisor", "Boiler Mechanic"],
  ["Supervisor Boiler", "Boiler Mechanic"],
  ["Heat Plant Supervisor", "Boiler Mechanic"],
  ["Bricklayer Supervisor", "Bricklayer"],
  ["Supervisor Bricklayer", "Bricklayer"],
  ["Mason Supervisor", "Bricklayer"],
  ["Maintenance Supervisor", "Maintenance Worker"],
  ["Grounds Supervisor", "Groundskeeper"],
]);

export function supervisedTradeForPosition(position: string | null | undefined): string | null {
  return TRADE_ASSIGNMENT_BY_SUPERVISOR.get(position || "") || null;
}

function isOperationalAssignee(target: { role: string; position: string | null }) {
  return ["worker", "inspector", "emergency"].includes(target.role) &&
    !String(target.position || "").toLowerCase().includes("supervisor");
}

const LEAVE_APPROVER_POSITIONS = new Set([
  "Property Manager",
  "Assistant Property Manager",
  "Superintendent",
  "Assistant Superintendent",
  "Supervisor Inspector",
  "CPM Supervisor",
  ...TRADE_SUPERVISOR_POSITIONS,
]);

export function isLeaveApprovalAuthority(
  actor: Pick<Actor, "role" | "position">,
): boolean {
  return actor.role === "human_resources" ||
    LEAVE_APPROVER_POSITIONS.has(actor.position ?? "");
}

const SUPERVISED_LEAVE_POSITIONS = new Map<string, Set<string>>([
  ["Plumber Supervisor", new Set(["Plumber"])],
  ["Electric Supervisor", new Set(["Electrician"])],
  ["Elevator Supervisor", new Set(["Elevator Service"])],
  ["Painter Supervisor", new Set(["Painter"])],
  ["Carpenter Supervisor", new Set(["Carpenter"])],
  ["Boiler Supervisor", new Set(["Boiler Mechanic"])],
  ["Bricklayer Supervisor", new Set(["Bricklayer"])],
  ["Supervisor Inspector", new Set(["Inspector", "CPM"])],
]);

export function canApproveLeaveForEmployee(
  actor: Actor,
  employee: Pick<Actor, "id" | "role" | "position" | "developments">,
): boolean {
  return actor.role === "human_resources" && actor.id !== employee.id;
}

export function canReadStaffDirectoryEmployee(
  actor: Actor,
  employee: Pick<Actor, "id" | "role" | "position" | "developments">,
): boolean {
  if (actor.role === "human_resources" || actor.role === "administrator") return true;
  if (employee.id === actor.id) return false;
  if (actor.role === "management") {
    if (isBoroughDirector(actor)) return true;
    return employee.developments.length === 0 ||
      actor.developments.some((development) => employee.developments.includes(development));
  }
  return canApproveLeaveForEmployee(actor, employee);
}
export function leaveRequestDurationDays(state: Record<string, unknown>): number | null {
  const startValue = typeof state["startAt"] === "string"
    ? state["startAt"]
    : typeof state["startDate"] === "string"
      ? state["startDate"]
      : "";
  const endValue = typeof state["endAt"] === "string"
    ? state["endAt"]
    : typeof state["endDate"] === "string"
      ? state["endDate"]
      : startValue;
  const startDate = startValue.slice(0, 10);
  const endDate = endValue.slice(0, 10);
  const start = parseLeaveDateTime(startValue);
  const end = parseLeaveDateTime(endValue);
  if (!start || !end) return null;
  const difference = end.getTime() - start.getTime();
  if (!startDate || !endDate || !Number.isFinite(difference) || difference < 0) return null;
  const calendarDifference =
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return Math.floor(calendarDifference / 86_400_000) + 1;
}

function parseLeaveDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  if (
    month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 ||
    second > 59
  ) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
    ? date
    : null;
}
export function validLeaveRequestDuration(days: number): boolean {
  return (days >= 1 && days <= 14) || (days >= 30 && days <= 365);
}

export function canApproveLeaveDuration(
  actor: Pick<Actor, "role">,
  days: number,
): boolean {
  if (days >= 30 && days <= 365) return actor.role === "human_resources";
  if (days >= 1 && days <= 14) return actor.role === "management";
  return false;
}

/**
 * Assignment authority is intentionally narrower than generic mutation
 * authority.  Field staff can edit their own non-workflow data, but cannot
 * introduce an arbitrary assignee while creating or editing a job.
 */
export function isAssignmentAuthority(actor: Actor): boolean {
  return actor.role === "management" ||
    actor.role === "administrator" ||
    isBoroughDirector(actor) ||
    actor.position === "Superintendent Ⓔ";
}

export function canAssignStaff(
  actor: Actor,
  target: {
    id: string;
    role: string;
    position: string | null;
    developments: string[];
  },
  development: string | null,
): boolean {
  if (!isAssignmentAuthority(actor)) return false;
  if (target.id === actor.id || target.position === "Borough Director") return false;
  if (!ASSIGNABLE_STAFF_ROLES.has(target.role) || !isOperationalAssignee(target)) return false;
  if (development && !target.developments.includes(development)) return false;
  if (isBoroughDirector(actor) || actor.role === "administrator") return true;
  if (
    !target.developments.length ||
    !target.developments.every((value) => actor.developments.includes(value))
  ) {
    return false;
  }
  const actorTrade = supervisedTradeForPosition(actor.position);
  if (isSupervisorPosition(actor) && !actorTrade) return false;
  if (actorTrade && target.position !== actorTrade) return false;
  return true;
}

export function canSuperintendentEAssignResidentReport(
  actor: Actor,
  target: {
    id: string;
    role: string;
    position: string | null;
  },
): boolean {
  return actor.position === "Superintendent Ⓔ" &&
    target.id !== actor.id &&
    target.position !== "Borough Director" &&
    ASSIGNABLE_STAFF_ROLES.has(target.role);
}

/**
 * Assignment identity is deliberately separate from the display name.  Older
 * records may only have assignedTo (or another mutable label); those records
 * fail closed for ordinary staff because they cannot establish ownership.
 */
export type NormalizedAssignment = {
  assignedStaffId: string | null;
  hasLegacyAssignment: boolean;
};

export function normalizeAssignment(
  state: Record<string, unknown>,
): NormalizedAssignment {
  const assignedStaffId =
    typeof state["assignedStaffId"] === "string" &&
    state["assignedStaffId"].trim()
      ? state["assignedStaffId"].trim()
      : null;
  const hasLegacyAssignment =
    assignedStaffId === null &&
    ["assignedTo", "assignedStaffName", "assignedToName"].some(
      (key) => typeof state[key] === "string" && state[key].trim().length > 0,
    );
  return { assignedStaffId, hasLegacyAssignment };
}

const ASSIGNMENT_REQUIRED_ACTIONS = new Set([
  "start",
  "on-my-way",
  "progress",
  "complete",
  "release",
]);

/**
 * Operational actions are ownership-bound.  Supervisors can override a
 * canonical assignment, but procurement is intentionally never a supervisor
 * for operational work.  Name-only legacy records fail closed for workers,
 * inspectors, and emergency staff because a display name is not an identity.
 */
export function canPerformAssignedWorkflowAction(
  actor: Actor,
  entity: string,
  action: string,
  state: Record<string, unknown>,
): boolean {
  if (!ASSIGNMENT_REQUIRED_ACTIONS.has(action)) return true;
  if (
    ![
      "resident-reports",
      "building-violations",
      "manpower-requests",
      "elevator-jobs",
      "emergency-jobs",
    ].includes(entity)
  ) {
    return true;
  }
  if (!["management", "administrator", "worker", "inspector", "emergency"].includes(actor.role)) {
    return false;
  }
  const assignment = normalizeAssignment(state);
  return assignment.assignedStaffId === actor.id;
}

export function canPerformEntityAction(
  actor: Actor,
  entity: string,
  action: string,
  state: Record<string, unknown>,
): boolean {
  if (isHrEntity(entity)) {
    if (entity === "hr-approvals") {
      return action === "approve" &&
        (actor.role === "management" || actor.role === "administrator");
    }
    if (actor.role === "human_resources") {
      return [
        "advance",
        "approve-pay-change",
        "approve-discipline",
        "approve-termination",
        "approve-layoff",
        "close",
      ].includes(action);
    }
    if (actor.role === "administrator") {
      return ["advance", "close"].includes(action);
    }
    return actor.role === "management" &&
      ["advance", "close"].includes(action);
  }
  if (entity === "manpower-requests") {
    if (["start", "complete"].includes(action)) {
      const requestedTrade = typeof state["requestedTrade"] === "string"
        ? state["requestedTrade"].trim() : "";
      const actorTrade = supervisedTradeForPosition(actor.position) ||
        (actor.position === "Maintenance Worker" ? "Maintenance Worker" : actor.position);
      const development = typeof state["development"] === "string"
        ? state["development"].trim().toLowerCase() : "";
      return ["worker", "inspector", "emergency"].includes(actor.role) &&
        actorTrade === requestedTrade &&
        (!development || actor.developments.some((item) =>
          item.trim().toLowerCase() === development)) &&
        canPerformAssignedWorkflowAction(actor, entity, action, state);
    }
    if (action === "release") return canPerformAssignedWorkflowAction(actor, entity, action, state);
    return (
      state["receiverSupervisorId"] === actor.id &&
      (actor.role === "management" || actor.role === "administrator" || isSupervisorPosition(actor)) &&
      ["assign", "dispatch"].includes(action)
    );
  }
  if (
    isBoroughDirector(actor) &&
    entity !== "resident-reports" &&
    entity !== "procurement" &&
    entity !== "procurement-bids" &&
    entity !== "leave-requests" &&
    !ASSIGNMENT_REQUIRED_ACTIONS.has(action)
  ) return true;

  const isManagement = isOrdinaryManagement(actor);
  const isSupervisor =
    actor.role === "management" || actor.role === "administrator" ||
    isSupervisorPosition(actor);
  const isFieldStaff =
    actor.role === "worker" || actor.role === "inspector" ||
    (actor.role === "emergency" && actor.position === "Maintenance Worker");
  if (
    action === "approve-work" &&
    ["resident-reports", "building-violations", "elevator-jobs", "emergency-jobs"]
      .includes(entity)
  ) {
    if (entity === "resident-reports") return isComplaintHandlingSupervisor(actor);
    return isSupervisor;
  }
  if (actor.role === "emergency" && entity === "emergency-jobs") {
    return entity === "emergency-jobs" &&
      ["on-my-way", "start", "complete"].includes(action) &&
      canPerformAssignedWorkflowAction(actor, entity, action, state);
  }

  if (entity === "procurement") {
    if (action === "submit") {
      // Only the exact CPM field position may submit a scope it owns.
      return actor.role === "inspector" &&
        actor.position === "CPM";
    }
      if (action === "approve" || action === "reject" || action === "handoff-inhouse") return isCpmSupervisor(actor);
     if (action === "return") {
        return (isCpmSupervisor(actor) && state["status"] === "submitted") ||
         (actor.role === "procurement" && state["status"] === "approved");
     }
    return (
      actor.role === "procurement" &&
      ["broadcast", "award", "rate-close", "return"].includes(action)
    );
  }

  if (entity === "hud-inspections") {
    if (["approve", "deny", "correction"].includes(action)) {
      return isHudReviewSupervisor(actor);
    }
    return action === "resubmit" &&
      actor.role === "inspector" &&
      ["CPM", "Inspector"].includes(actor.position);
  }

  if (entity === "resident-reports") {
    if (action === "assign") return isComplaintHandlingSupervisor(actor);
    if (action === "release") return canPerformAssignedWorkflowAction(actor, entity, action, state);
    if (action === "clear") return isComplaintHandlingSupervisor(actor);
    if (action === "resolve") return false;
     return ["start", "complete"].includes(action) &&
       (isFieldStaff || isSupervisor) &&
       canPerformAssignedWorkflowAction(actor, entity, action, state);
  }

  if (entity === "building-violations") {
    if (action === "handoff-cpm-supervisor") return isViolationAuthority(actor);
    if (action === "assign-cpm") {
      return isCpmSupervisor(actor) &&
        state["cpmSupervisorId"] === actor.id;
    }
    if (["approve", "route", "clear"].includes(action)) return isViolationAuthority(actor);
    if (action === "release") return canPerformAssignedWorkflowAction(actor, entity, action, state);
    return action === "complete" &&
      (isFieldStaff || isSupervisor) &&
      canPerformAssignedWorkflowAction(actor, entity, action, state);
  }

  if (entity === "leave-requests") {
    if (action === "approve" || action === "deny") {
      const employeeStaffId = typeof state["employeeStaffId"] === "string"
        ? state["employeeStaffId"]
        : "";
      const employeeName = typeof state["employee"] === "string"
        ? state["employee"].trim().toLowerCase()
        : "";
      if (
        employeeStaffId === actor.id ||
        (!employeeStaffId && employeeName === actor.name.trim().toLowerCase())
      ) {
        return false;
      }
      return actor.role === "human_resources";
    }
    if (action !== "cancel") return false;
    return state["requesterStaffId"] === actor.id;
  }

  if (entity === "elevator-jobs" || entity === "emergency-jobs") {
    return (
      ["on-my-way", "start", "complete"].includes(action) &&
      (isSupervisor ||
        (entity === "elevator-jobs"
          ? isElevatorFieldStaff(actor)
          : isFieldStaff)) &&
      canPerformAssignedWorkflowAction(actor, entity, action, state)
    );
  }

  return false;
}

const WORKFLOW_ENTITIES = new Set([
  "procurement",
  "manpower-requests",
  "resident-reports",
  "building-violations",
  "leave-requests",
  "elevator-jobs",
  "emergency-jobs",
  "hud-inspections",
  ...HR_ENTITIES,
]);

const WORKFLOW_MANAGED_FIELDS = new Set([
  "status",
  "clearedByMgmt",
  "submitAt",
  "approveAt",
  "rejectAt",
  "returnAt",
  "broadcastAt",
  "awardAt",
  "rate_closeAt",
  "assignAt",
  "startAt",
  "resolveAt",
  "clearAt",
  "completeAt",
  "approve_workAt",
  "denyAt",
  "cancelAt",
  "on_my_wayAt",
  "approvedAt",
  "returnedAt",
  "assignedAt",
  "startedAt",
  "resolvedAt",
  "completedAt",
  "cancelledAt",
  "completed",
  "completionStatus",
  "completionDate",
  "advanceAt",
  "approve_pay_changeAt",
  "approve_disciplineAt",
  "approve_terminationAt",
  "approve_layoffAt",
  "closeAt",
]);

export function patchesWorkflowManagedFields(
  entity: string,
  patch: Record<string, unknown>,
): boolean {
  return (
    WORKFLOW_ENTITIES.has(entity) &&
    Object.keys(patch).some((key) =>
      WORKFLOW_MANAGED_FIELDS.has(key) &&
      !(entity === "leave-requests" && ["startAt", "returnAt"].includes(key)),
    )
  );
}

const INITIAL_WORKFLOW_STATUS: Record<string, string> = {
  procurement: "draft",
  "resident-reports": "submitted",
  "building-violations": "submitted",
  "leave-requests": "Pending",
  "elevator-jobs": "assigned",
  "emergency-jobs": "assigned",
  "hud-inspections": "Submitted",
  "hr-employee-records": "draft",
  "hr-recruiting": "draft",
  "hr-onboarding": "draft",
  "hr-payroll-benefits": "draft",
  "hr-attendance": "draft",
  "hr-relations": "draft",
  "hr-performance": "draft",
  "hr-discipline": "draft",
  "hr-investigations": "draft",
  "hr-training-compliance": "draft",
  "hr-exits": "draft",
  "hr-approvals": "pending",
  "manpower-requests": "pending",
};

export function withInitialWorkflowState(
  entity: string,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const initialStatus = INITIAL_WORKFLOW_STATUS[entity];
  if (!initialStatus) return state;
  return {
    ...Object.fromEntries(
      Object.entries(state).filter(
        ([key]) =>
          !WORKFLOW_MANAGED_FIELDS.has(key) ||
          (entity === "leave-requests" && ["startAt", "returnAt"].includes(key)),
      ),
    ),
    status: initialStatus,
  };
}

export function isValidEntityTransition(
  entity: string,
  action: string,
  state: Record<string, unknown>,
): boolean {
  const status = String(state["status"] ?? "").trim().toLowerCase();
  const allowed: Record<string, Record<string, readonly unknown[]>> = {
    procurement: {
      submit: ["draft", "returned"],
      approve: ["submitted"],
      "handoff-inhouse": ["submitted"],
      reject: ["submitted"],
      return: ["submitted", "approved"],
      broadcast: ["approved"],
      award: ["bidding"],
      "rate-close": ["awarded"],
    },
    "resident-reports": {
      assign: ["submitted"],
      release: ["assigned", "in_progress"],
      start: ["assigned"],
      resolve: ["in_progress"],
      clear: ["resolved"],
      complete: ["in_progress"],
      "approve-work": ["done", "resolved"],
    },
    "building-violations": {
      approve: ["submitted"],
      "handoff-cpm-supervisor": ["approved"],
      "assign-cpm": ["cpm_review"],
      route: ["approved"],
      complete: ["routed"],
      clear: ["done"],
      "approve-work": ["done"],
      release: ["routed"],
    },
    "manpower-requests": {
      assign: ["pending"],
      dispatch: ["assigned"],
      start: ["dispatched"],
      complete: ["in_progress"],
      release: ["assigned", "dispatched"],
    },
    "leave-requests": {
      approve: ["pending"],
      deny: ["pending"],
      cancel: ["pending"],
    },
    "elevator-jobs": {
      "on-my-way": ["assigned"],
      start: ["assigned"],
      complete: ["assigned", "in_progress"],
      "approve-work": ["done"],
    },
    "emergency-jobs": {
      "on-my-way": ["assigned"],
      start: ["assigned"],
      complete: ["assigned", "in_progress"],
      "approve-work": ["done"],
    },
    "hud-inspections": {
      approve: ["submitted"],
      deny: ["submitted"],
      correction: ["submitted"],
      resubmit: ["correction"],
    },
    "hr-approvals": {
      approve: ["pending"],
    },
  };
  if (isHrEntity(entity) && entity !== "hr-approvals") {
    if (action === "advance") return ["draft", "in_progress"].includes(status);
    if (action === "close") {
      if (entity === "hr-payroll-benefits") return status === "approved";
      if (entity === "hr-discipline") return status === "disciplined";
      if (entity === "hr-exits") return ["terminated", "laid off"].includes(status);
      return ["in_progress", "approved", "disciplined", "terminated", "laid off"].includes(status);
    }
    if (action === "approve-pay-change") return ["draft", "in_progress"].includes(status);
    if (action === "approve-discipline") return ["draft", "in_progress"].includes(status);
    if (action === "approve-termination") return ["draft", "in_progress"].includes(status);
    if (action === "approve-layoff") return ["draft", "in_progress"].includes(status);
  }
  return allowed[entity]?.[action]?.includes(status) === true;
}

export function stripPricing(
  actor: Actor,
  value: unknown,
): unknown {
  if (
    !(
      actor.role === "worker" ||
      actor.role === "inspector" ||
      actor.role === "vendor"
    )
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => stripPricing(actor, item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRICING_KEYS.has(key))
      .map(([key, item]) => [key, stripPricing(actor, item)]),
  );
}

export function generatedCode(entity: string): string | undefined {
  const five = () => randomInt(0, 100000).toString().padStart(5, "0");
  if (entity === "resident-reports") return `RC-${five()}`;
  if (entity === "procurement") return `sr-${five()}`;
  if (entity === "elevator-jobs") return `EL-${five()}`;
  if (entity === "emergency-jobs") return `EM-${five()}`;
  if (entity === "emergency-units") {
    return `TRK-${randomInt(0, 10000).toString().padStart(4, "0")}`;
  }
  return undefined;
}

export function recordId(input: unknown): string {
  return typeof input === "string" && input.trim() ? input : randomUUID();
}

export function staffCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const alphabet = `${letters}${digits}`;
  const characters = [
    letters[randomInt(letters.length)]!,
    digits[randomInt(digits.length)]!,
    alphabet[randomInt(alphabet.length)]!,
    alphabet[randomInt(alphabet.length)]!,
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex]!, characters[index]!];
  }
  return characters.join("");
}

export function serializeStaffIssueResponse<T extends Record<string, unknown>>(
  staff: T,
  includeHrNotes: boolean,
): Omit<T, "sessionVersion" | "hrNotes"> {
  const safe = serializeHrStaff(staff, includeHrNotes);
  return { ...safe, code: staff.code } as Omit<T, "sessionVersion" | "hrNotes">;
}

export function isHrEntity(entity: string): boolean {
  return HR_ENTITIES.has(entity);
}

export function isHrProtectedField(field: string): boolean {
  return HR_PROTECTED_FIELDS.has(field);
}

export function serializeHrStaff<T extends Record<string, unknown>>(
  staff: T,
  includeHrNotes: boolean,
): Omit<T, "code" | "sessionVersion" | "hrNotes"> &
  Partial<Pick<T, "hrNotes">> & {
    annualSalary?: number | null;
    hourlyRate?: number | null;
    totalAnnualSalary?: number | null;
  } {
  const {
    code: _code,
    sessionVersion: _sessionVersion,
    hrNotes,
    annualSalaryCents,
    hourlyRateCents,
    ...safe
  } = staff;
  if (!includeHrNotes) {
    return safe as Omit<T, "code" | "sessionVersion" | "hrNotes"> &
      Partial<Pick<T, "hrNotes">>;
  }
  const annualSalary = typeof annualSalaryCents === "number"
    ? annualSalaryCents / 100
    : null;
  const hourlyRate = typeof hourlyRateCents === "number"
    ? hourlyRateCents / 100
    : null;
  const totalAnnualSalary = annualSalary !== null && annualSalary > 0
    ? annualSalary
    : hourlyRate !== null && hourlyRate > 0
      ? Math.round(hourlyRate * 2080 * 100) / 100
      : annualSalary ?? hourlyRate;
  return {
    ...safe,
    hrNotes,
    annualSalary,
    hourlyRate,
    totalAnnualSalary,
  } as Omit<T, "code" | "sessionVersion" | "hrNotes"> &
    Partial<Pick<T, "hrNotes">> & {
      annualSalary?: number | null;
      hourlyRate?: number | null;
      totalAnnualSalary?: number | null;
    };
}

const HR_PROTECTED_FIELDS = new Set([
  "targetRecordId",
  "employeeStaffId",
  "employeeNumber",
  "approvalPurpose",
  "status",
  "exitType",
  "position",
  "role",
  "assignedDevelopments",
  "annualSalary",
  "hourlyRate",
  "totalAnnualSalary",
]);

export function canReadHrEntityRecord(
  actor: Actor,
  row: EntityRecordAuthorizationState,
  employee?: HrLinkedStaff,
): boolean {
  if (!isHrEntity(row.entity) || row.deleted) return false;
  if (actor.role === "human_resources" || actor.role === "administrator") return true;
  const employeeStaffId = typeof row.state["employeeStaffId"] === "string"
    ? row.state["employeeStaffId"].trim()
    : "";
  return Boolean(employeeStaffId && employeeStaffId === actor.id);
}

export function validateLeaveRequestSchedule(
  state: Record<string, unknown>,
): string | null {
  const startValue = typeof state["startAt"] === "string"
    ? state["startAt"]
    : typeof state["startDate"] === "string" ? state["startDate"] : "";
  const endValue = typeof state["endAt"] === "string"
    ? state["endAt"]
    : typeof state["endDate"] === "string" ? state["endDate"] : "";
  const returnValue = typeof state["returnAt"] === "string" ? state["returnAt"] : "";
  const start = parseLeaveDateTime(startValue);
  const end = parseLeaveDateTime(endValue);
  const returnAt = parseLeaveDateTime(returnValue);
  if (!start || !end) return "Start and end must be valid dates and times";
  if (end.getTime() < start.getTime()) return "End must not be before start";
  if (!returnAt) return "A valid return date and time is required";
  if (returnAt.getTime() < end.getTime()) return "Return must not be before end";
  return null;
}
