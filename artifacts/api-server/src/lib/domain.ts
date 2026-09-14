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

export const STAFF_POSITIONS = [
  "Borough Director",
  "Regional Director",
  "Assistant Regional Director",
  "Property Manager",
  "Superintendent",
  "Assistant Superintendent",
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
  "elevators",
  "roofplans",
  "project-notes",
  "project-reviews",
  "resident-reports",
  "violations",
  "building-violations",
  "priority-violations",
  "route-assignments",
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

export function canBrowseStaffDirectory(actor: Actor): boolean {
  return (
    actor.role === "human_resources" ||
    actor.role === "management" ||
    actor.role === "administrator" ||
    isBoroughDirector(actor)
  );
}

export function canReadEntity(actor: Actor, entity: string): boolean {
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
  if (actor.role === "administrator" || actor.role === "management") {
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

type EntityRecordAuthorizationState = {
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
 * The complete record-level read boundary. File authorization uses this
 * predicate rather than only checking the tenant or entity name, so objects
 * cannot become a cross-development side channel.
 */
export function canReadEntityRecord(
  actor: Actor,
  row: EntityRecordAuthorizationState,
): boolean {
  return !row.deleted &&
    canReadEntity(actor, row.entity) &&
    entityDevelopmentAllowed(actor, row.entity, row.development) &&
    privateRecordAllowed(actor, row) &&
    procurementRecordAllowed(actor, row) &&
    emergencyRecordAllowed(actor, row) &&
    staffAssignmentRecordAllowed(actor, row);
}

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
  if (actor.role === "emergency") return false;
  if (isBoroughDirector(actor) && entity !== "procurement" && entity !== "procurement-bids") return true;
  if (entity === "global-settings") return false;
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
  if (actor.role === "emergency") return entity === "emergency-jobs";
  if (isBoroughDirector(actor) && entity !== "procurement" && entity !== "procurement-bids") return true;
  if (entity === "global-settings") return false;
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
      actor.role === "inspector" && actor.position === "CPM";
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
  "Regional Director",
  ...TRADE_SUPERVISOR_POSITIONS,
]);

export function isLeaveApprovalAuthority(
  actor: Pick<Actor, "role" | "position">,
): boolean {
  return actor.role === "management" ||
    actor.role === "administrator" ||
    LEAVE_APPROVER_POSITIONS.has(actor.position ?? "");
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
  if (
    isBoroughDirector(actor) &&
    entity !== "procurement" &&
    entity !== "procurement-bids" &&
    !ASSIGNMENT_REQUIRED_ACTIONS.has(action)
  ) return true;

  const isManagement = isOrdinaryManagement(actor);
  const isSupervisor =
    actor.role === "management" || actor.role === "administrator";
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
]);

export function patchesWorkflowManagedFields(
  entity: string,
  patch: Record<string, unknown>,
): boolean {
  return (
    WORKFLOW_ENTITIES.has(entity) &&
    Object.keys(patch).some((key) => WORKFLOW_MANAGED_FIELDS.has(key))
  );
}

const INITIAL_WORKFLOW_STATUS: Record<string, string> = {
  procurement: "draft",
  "resident-reports": "submitted",
  "building-violations": "submitted",
  "leave-requests": "Pending",
  "elevator-jobs": "assigned",
  "emergency-jobs": "assigned",
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
        ([key]) => !WORKFLOW_MANAGED_FIELDS.has(key),
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
  const status = state["status"];
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
    "leave-requests": {
      approve: ["Pending"],
      deny: ["Pending"],
      cancel: ["Pending"],
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
  };
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
  return randomInt(1000, 10000).toString();
}