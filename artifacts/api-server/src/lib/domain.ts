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
  return isBoroughDirector(actor) ||
    actor.role === "administrator" ||
    (actor.role === "management" && actor.position === "Regional Director");
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

export function isBoroughDirector(actor: Actor): boolean {
  return actor.position === "Borough Director";
}

export function isElevated(actor: Actor): boolean {
  return (
    isBoroughDirector(actor) ||
    (actor.role === "management" && ELEVATED_POSITIONS.has(actor.position))
  );
}

/** The only management actors who may review procurement scopes.  Keep this
 * predicate deliberately strict: position is an authorization boundary, not
 * merely a display label. */
export function isOrdinaryManagement(actor: Actor): boolean {
  return actor.role === "management" &&
    !isBoroughDirector(actor) &&
    !ELEVATED_POSITIONS.has(actor.position);
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
    actor.position === "Superintendent";
}

export function isHudReviewSupervisor(actor: Actor): boolean {
  return actor.position === "Supervisor Inspector" ||
    actor.position === "CPM Supervisor";
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
      actor.role === "management" ||
      actor.role === "administrator" ||
      isBoroughDirector(actor)
    );
  }
  if (entity === "procurement" || entity === "procurement-bids") {
    return actor.role === "procurement" ||
      isOrdinaryManagement(actor) ||
      (entity === "procurement" && actor.role === "inspector" && actor.position === "CPM");
  }
  if (actor.role === "emergency") return entity === "emergency-jobs" || entity === "emergency-units";
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
  if (employeeStaffId) return employeeStaffId === actor.id ||
    row.state["supervisorStaffId"] === actor.id;
  const employeeName = typeof row.state["employee"] === "string"
    ? row.state["employee"].trim().toLowerCase()
    : "";
  if (employeeName && employeeName === actor.name.trim().toLowerCase()) return true;
  if (!employeeName && row.createdBy === actor.id) return true;
  const supervisorName = typeof row.state["supervisor"] === "string"
    ? row.state["supervisor"].trim().toLowerCase()
    : "";
  return !row.state["supervisorStaffId"] &&
    supervisorName === actor.name.trim().toLowerCase() &&
    isLeaveApprovalAuthority(actor);
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
  if (isOrdinaryManagement(actor)) {
    return row.entity === "procurement" && status === "submitted";
  }
  return actor.role === "inspector" && actor.position === "CPM" &&
    row.entity === "procurement" && row.createdBy === actor.id &&
    ["draft", "submitted", "returned"].includes(status);
}

export function developmentAllowed(
  actor: Actor,
  development: string | null,
): boolean {
  if (isBoroughDirector(actor)) return true;
  if (actor.role === "administrator") return true;
  if (actor.role === "human_resources") return true;
  if (actor.role === "management") {
    return Boolean(development && actor.developments.includes(development));
  }
  return (
    actor.developments.length === 0 ||
    !development ||
    actor.developments.includes(development)
  );
}

export function entityDevelopmentAllowed(
  actor: Actor,
  entity: string,
  development: string | null,
): boolean {
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
]);

function staffAssignmentRecordAllowed(
  actor: Actor,
  row: EntityRecordAuthorizationState,
): boolean {
  if (!["worker", "inspector"].includes(actor.role)) return true;
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
  if (!STAFF_ASSIGNMENT_SCOPED_ENTITIES.has(row.entity)) return true;
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
  if (isHrEntity(entity)) {
    return actor.role === "human_resources" ||
      actor.role === "administrator" ||
      (entity === "hr-approvals" && actor.role === "management");
  }
  if (actor.role === "emergency") return false;
  if (isBoroughDirector(actor) && entity !== "procurement" && entity !== "procurement-bids") return true;
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
      actor.role === "management" ||
      actor.role === "administrator"
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
  if (isHrEntity(entity)) {
    return actor.role === "human_resources" ||
      actor.role === "administrator" ||
      (entity === "hr-approvals" && actor.role === "management");
  }
  if (actor.role === "emergency") return entity === "emergency-jobs";
  if (isBoroughDirector(actor) && entity !== "procurement" && entity !== "procurement-bids") return true;
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
  // HR lifecycle records and company approval evidence are retained as
  // employment history. No role may soft-delete them through the generic
  // entity deletion route.
  if (isHrEntity(entity)) return false;
  if (entity === "hud-inspections") return false;
  if (ELEVATOR_ENTITIES.has(entity)) {
    return (
      (isElevatorFieldStaff(actor) && state["clearedByMgmt"] === true) ||
      actor.role === "management" ||
      actor.role === "administrator" ||
      isBoroughDirector(actor)
    );
  }
  if (VIOLATION_ENTITIES.has(entity) && actor.role === "inspector") {
    return state["clearedByMgmt"] === true;
  }
  if (entity === "procurement" || entity === "procurement-bids") {
    return entity === "procurement" &&
      !isBoroughDirector(actor) &&
      (actor.role === "administrator" ||
        (actor.role === "management" && actor.position === "Regional Director"));
  }
  if (isBoroughDirector(actor)) return true;
  if (actor.role === "worker" || actor.role === "inspector") {
    return state["clearedByMgmt"] === true;
  }
  return actor.role === "administrator" || actor.role === "management";
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
]);

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
  ["Supervisor Inspector", new Set(["Inspector", "CPM"])],
]);

export function canApproveLeaveForEmployee(
  actor: Actor,
  employee: Pick<Actor, "id" | "role" | "position" | "developments">,
): boolean {
  if (!isLeaveApprovalAuthority(actor) || actor.id === employee.id) return false;
  if (actor.role === "human_resources") {
    return true;
  }
  if (
    employee.developments.length > 0 &&
    !employee.developments.every((development) => actor.developments.includes(development))
  ) {
    return false;
  }
  const supervisedPositions = SUPERVISED_LEAVE_POSITIONS.get(actor.position ?? "");
  if (supervisedPositions) return supervisedPositions.has(employee.position ?? "");
  return actor.role === "management";
}

export function canReadStaffDirectoryEmployee(
  actor: Actor,
  employee: Pick<Actor, "id" | "role" | "position" | "developments">,
): boolean {
  if (actor.role === "human_resources" || actor.role === "administrator") return true;
  return employee.id !== actor.id && canApproveLeaveForEmployee(actor, employee);
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
    isBoroughDirector(actor);
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
  if (!ASSIGNABLE_STAFF_ROLES.has(target.role)) return false;
  if (development && !target.developments.includes(development)) return false;
  if (isBoroughDirector(actor)) return true;
  if (
    !target.developments.length ||
    !target.developments.every((value) => actor.developments.includes(value))
  ) {
    return false;
  }
  if (target.role === "management") {
    return actor.position === "Regional Director" ||
      TRADE_SUPERVISOR_POSITIONS.has(target.position ?? "");
  }
  return ["worker", "inspector", "emergency"].includes(target.role);
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
    return (
      state["receiverSupervisorId"] === actor.id &&
      (actor.role === "management" || actor.role === "administrator" || isSupervisorPosition(actor)) &&
      ["assign", "dispatch"].includes(action)
    );
  }
  if (
    isBoroughDirector(actor) &&
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
    actor.role === "worker" || actor.role === "inspector";
  if (
    action === "approve-work" &&
    ["resident-reports", "building-violations", "elevator-jobs", "emergency-jobs"]
      .includes(entity)
  ) {
    return isSupervisor;
  }
  if (actor.role === "emergency") {
    return entity === "emergency-jobs" &&
      ["on-my-way", "start", "complete"].includes(action) &&
      canPerformAssignedWorkflowAction(actor, entity, action, state);
  }

  if (entity === "procurement") {
    if (action === "submit") {
      return actor.role === "inspector" && actor.position === "CPM";
    }
     if (action === "approve" || action === "reject") return isOrdinaryManagement(actor);
     if (action === "return") {
       return (isOrdinaryManagement(actor) && state["status"] === "submitted") ||
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
    if (action === "assign") return isAssignmentAuthority(actor);
    if (action === "clear") return isManagement;
    if (action === "resolve") return false;
     return ["start", "complete"].includes(action) &&
       (isFieldStaff || isSupervisor) &&
       canPerformAssignedWorkflowAction(actor, entity, action, state);
  }

  if (entity === "building-violations") {
    if (["approve", "route", "clear"].includes(action)) return isManagement;
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
      return isLeaveApprovalAuthority(actor);
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
      reject: ["submitted"],
      return: ["submitted", "approved"],
      broadcast: ["approved"],
      award: ["bidding"],
      "rate-close": ["awarded"],
    },
    "resident-reports": {
      assign: ["submitted"],
      start: ["assigned"],
      resolve: ["in_progress"],
      clear: ["resolved"],
      complete: ["in_progress"],
      "approve-work": ["done", "resolved"],
    },
    "building-violations": {
      approve: ["submitted"],
      route: ["approved"],
      complete: ["routed"],
      clear: ["done"],
      "approve-work": ["done"],
    },
    "manpower-requests": {
      assign: ["pending"],
      dispatch: ["assigned"],
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
): Omit<T, "code" | "sessionVersion" | "hrNotes"> & Partial<Pick<T, "hrNotes">> {
  const {
    code: _code,
    sessionVersion: _sessionVersion,
    hrNotes,
    ...safe
  } = staff;
  return (includeHrNotes ? { ...safe, hrNotes } : safe) as Omit<T, "code" | "sessionVersion" | "hrNotes"> & Partial<Pick<T, "hrNotes">>;
}

const HR_PROTECTED_FIELDS = new Set([
  "targetRecordId",
  "employeeStaffId",
  "approvalPurpose",
  "status",
  "exitType",
]);

export function canReadHrEntityRecord(
  actor: Actor,
  row: EntityRecordAuthorizationState,
  employee?: HrLinkedStaff,
): boolean {
  if (!isHrEntity(row.entity) || row.deleted || !canReadEntity(actor, row.entity)) return false;
  if (actor.role === "human_resources" || actor.role === "administrator") return true;
  if (actor.role !== "management") return false;
  const status = typeof row.state["status"] === "string"
    ? row.state["status"].trim().toLowerCase()
    : "";
  if (row.entity === "hr-approvals" && status !== "pending") return false;
  const employeeStaffId = typeof row.state["employeeStaffId"] === "string"
    ? row.state["employeeStaffId"].trim()
    : "";
  return Boolean(
    employee &&
    employee.status === "approved" &&
    employee.id === employeeStaffId &&
    employee.id !== actor.id &&
    canApproveLeaveForEmployee(actor, employee),
  );
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
