import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "./auth";
import {
  canReadEntity,
  canBrowseStaffDirectory,
  canCreateEntity,
  canMutateEntity,
  canDeleteEntity,
  canPerformEntityAction,
  canPerformAssignedWorkflowAction,
  canAssignStaff,
  isAssignmentAuthority,
  normalizeAssignment,
  entityDevelopmentAllowed,
  isValidEntityTransition,
  patchesWorkflowManagedFields,
  withInitialWorkflowState,
  procurementRecordAllowed,
  canReadEntityRecord,
  canUploadToEntityRecord,
  staffCode,
} from "./domain";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: "staff-1",
    tenantId: "tenant-1",
    name: "Test Staff",
    role: "management",
    position: "Property Manager",
    developments: ["Development A"],
    sessionVersion: 1,
    ...overrides,
  };
}

test("staff access codes are generated as four digits", () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.match(staffCode(), /^\d{4}$/);
  }
});

test("project visibility is limited to an actor's developments", () => {
  const staff = actor();
  assert.equal(
    entityDevelopmentAllowed(staff, "projects", "Development A"),
    true,
  );
  assert.equal(
    entityDevelopmentAllowed(staff, "projects", "Development B"),
    false,
  );
  assert.equal(entityDevelopmentAllowed(staff, "projects", null), false);
});

test("ordinary administrators are limited to assigned developments", () => {
  const administrator = actor({
    role: "administrator",
    position: "Administrator",
    developments: ["Development A"],
  });
  assert.equal(
    entityDevelopmentAllowed(administrator, "projects", "Development A"),
    true,
  );
  assert.equal(
    entityDevelopmentAllowed(administrator, "projects", "Development B"),
    false,
  );
  assert.equal(entityDevelopmentAllowed(administrator, "projects", null), false);
});

test("human resources can browse the staff directory", () => {
  assert.equal(
    canBrowseStaffDirectory(actor({
      role: "human_resources",
      position: "Human Resources",
      developments: [],
    })),
    true,
  );
});

test("management oversight is limited to assigned developments", () => {
  const manager = actor({
    role: "management",
    position: "Property Manager",
    developments: ["Development A"],
  });
  assert.equal(
    entityDevelopmentAllowed(manager, "resident-reports", "Development A"),
    true,
  );
  assert.equal(
    entityDevelopmentAllowed(manager, "resident-reports", "Development B"),
    false,
  );
  assert.equal(
    entityDevelopmentAllowed(manager, "resident-reports", null),
    false,
  );
  assert.equal(
    entityDevelopmentAllowed(
      actor({ role: "management", position: "Property Manager", developments: [] }),
      "resident-reports",
      "Development A",
    ),
    false,
  );
});

test("file record access follows development and role boundaries", () => {
  const record = (overrides: Partial<Parameters<typeof canReadEntityRecord>[1]> = {}) => ({
    entity: "rooms",
    development: "Development A",
    state: {},
    createdBy: "staff-1",
    deleted: false,
    ...overrides,
  });
  assert.equal(canReadEntityRecord(actor(), record()), true);
  assert.equal(
    canReadEntityRecord(actor(), record({ development: "Development B" })),
    false,
  );
  assert.equal(
    canReadEntityRecord(
      actor({ role: "administrator", position: "Administrator" }),
      record({ development: "Development B" }),
    ),
    false,
  );
  assert.equal(
    canReadEntityRecord(
      actor({ role: "administrator", position: "Borough Director", developments: [] }),
      record({ development: "Development B" }),
    ),
    true,
  );
});

test("ordinary staff can read only operational records assigned to their canonical staff id", () => {
  const worker = actor({
    id: "worker-1",
    role: "worker",
    position: "Maintenance Worker",
  });
  const report = (state: Record<string, unknown>) => ({
    entity: "resident-reports",
    development: "Development A",
    state,
    createdBy: "resident-1",
    deleted: false,
  });
  assert.equal(
    canReadEntityRecord(worker, report({ assignedStaffId: "worker-1", assignedTo: "Roy P" })),
    true,
  );
  assert.equal(
    canReadEntityRecord(worker, report({ assignedStaffId: "worker-2", assignedTo: "Roy P" })),
    false,
  );
  assert.equal(
    canReadEntityRecord(worker, report({ assignedTo: "Roy P" })),
    false,
    "a display-name match must not grant access",
  );
  assert.equal(
    canReadEntityRecord(actor(), report({})),
    true,
    "management retains operational oversight",
  );
});

test("ordinary staff can read only their own leave requests", () => {
  const worker = actor({
    id: "worker-1",
    role: "worker",
    position: "Maintenance Worker",
  });
  const leave = (createdBy: string) => ({
    entity: "leave-requests",
    development: "Development A",
    state: {},
    createdBy,
    deleted: false,
  });
  assert.equal(canReadEntityRecord(worker, leave("worker-1")), true);
  assert.equal(canReadEntityRecord(worker, leave("worker-2")), false);
});

test("procurement file access remains isolated from administrator and Borough Director roles", () => {
  const procurement = {
    entity: "procurement",
    development: "Development A",
    state: { status: "submitted" },
    createdBy: "cpm-1",
    deleted: false,
  };
  assert.equal(canReadEntityRecord(actor(), procurement), true);
  assert.equal(
    canReadEntityRecord(
      actor({ role: "administrator", position: "Administrator" }),
      procurement,
    ),
    false,
  );
  assert.equal(
    canReadEntityRecord(
      actor({ role: "administrator", position: "Borough Director", developments: [] }),
      procurement,
    ),
    false,
  );
  assert.equal(
    canUploadToEntityRecord(actor(), procurement),
    false,
    "ordinary management can read a submitted scope but cannot attach procurement files",
  );
});

test("Borough Director cannot access procurement records", () => {
  const director = actor({
    role: "administrator",
    position: "Borough Director",
    developments: [],
  });
  assert.equal(canReadEntity(director, "procurement"), false);
  assert.equal(
    entityDevelopmentAllowed(director, "projects", "Any Development"),
    true,
  );
  assert.equal(entityDevelopmentAllowed(director, "projects", null), true);
});

test("procurement entity boundary is role- and ownership-specific", () => {
  const director = actor({ role: "administrator", position: "Borough Director", developments: [] });
  const admin = actor({ role: "administrator" });
  const procurement = actor({ role: "procurement" });
  const cpm = actor({ role: "inspector", position: "CPM" });
  assert.equal(canCreateEntity(director, "procurement"), false);
  assert.equal(canCreateEntity(admin, "procurement"), false);
  assert.equal(canCreateEntity(procurement, "procurement"), false);
  assert.equal(canCreateEntity(procurement, "procurement-bids"), false);
  assert.equal(canCreateEntity(cpm, "procurement"), true);
  assert.equal(canMutateEntity(director, "procurement"), false);
  assert.equal(canMutateEntity(admin, "procurement"), false);
  assert.equal(canDeleteEntity(director, "procurement", {}), false);
  assert.equal(canDeleteEntity(procurement, "procurement", {}), false);
});

test("restricted management roles cannot synchronize procurement records", () => {
  assert.equal(canReadEntity(actor(), "procurement"), true);
  assert.equal(canReadEntity(actor({ position: "Regional Director" }), "procurement"), false);
});

test("elevator modules are limited to elevator field positions", () => {
  const worker = actor({ role: "worker", position: "Maintenance Worker" });
  const elevatorService = actor({ role: "worker", position: "Elevator Service" });
  const elevatorSupervisor = actor({ role: "worker", position: "Elevator Supervisor" });
  const cpm = actor({ role: "inspector", position: "CPM" });
  for (const entity of ["elevators", "elevator-jobs"]) {
    assert.equal(canReadEntity(worker, entity), false);
    assert.equal(canCreateEntity(worker, entity), false);
    assert.equal(canMutateEntity(worker, entity), false);
    assert.equal(canReadEntity(elevatorService, entity), true);
    assert.equal(canReadEntity(elevatorSupervisor, entity), true);
    assert.equal(canReadEntity(cpm, entity), true);
  }
});

test("violation modules are restricted to inspectors and supervisors", () => {
  const worker = actor({ role: "worker", position: "Maintenance Worker" });
  const inspector = actor({ role: "inspector", position: "Inspector" });
  for (const entity of [
    "violations",
    "building-violations",
    "priority-violations",
    "route-assignments",
  ]) {
    assert.equal(canReadEntity(worker, entity), false);
    assert.equal(canCreateEntity(worker, entity), false);
    assert.equal(canMutateEntity(worker, entity), false);
    assert.equal(canReadEntity(inspector, entity), true);
    assert.equal(canCreateEntity(inspector, entity), true);
    assert.equal(canMutateEntity(inspector, entity), true);
  }
  const record = {
    entity: "violations",
    development: "Development A",
    state: { assignedStaffId: inspector.id },
    createdBy: inspector.id,
    deleted: false,
  };
  assert.equal(canReadEntityRecord(inspector, record), true);
  assert.equal(
    canReadEntityRecord(inspector, { ...record, state: { assignedStaffId: "other" } }),
    false,
  );
});

test("staff directory visibility is reserved for supervisors", () => {
  assert.equal(canBrowseStaffDirectory(actor({ role: "worker" })), false);
  assert.equal(canBrowseStaffDirectory(actor({ role: "inspector" })), false);
  assert.equal(canBrowseStaffDirectory(actor({ role: "management" })), true);
  assert.equal(canBrowseStaffDirectory(actor({ role: "administrator" })), true);
  assert.equal(
    canBrowseStaffDirectory(actor({ role: "administrator", position: "Borough Director" })),
    true,
  );
});

test("workflow actions require their explicit management or specialist role", () => {
  const manager = actor();
  const worker = actor({ role: "worker", position: "Maintenance Worker" });
  const procurement = actor({ role: "procurement", position: "CPM" });
  const cpm = actor({ role: "inspector", position: "CPM" });

  assert.equal(
    canPerformEntityAction(manager, "building-violations", "approve", {}),
    true,
  );
  assert.equal(
    canPerformEntityAction(worker, "building-violations", "approve", {}),
    false,
  );
  assert.equal(
    canPerformEntityAction(worker, "building-violations", "complete", {
      assignedStaffId: worker.id,
    }),
    true,
  );
  assert.equal(
    canPerformEntityAction(procurement, "procurement", "award", {}),
    true,
  );
  assert.equal(
    canPerformEntityAction(manager, "procurement", "award", {}),
    false,
  );
  assert.equal(
    canPerformEntityAction(cpm, "procurement", "submit", {}),
    true,
  );
  assert.equal(
    canPerformEntityAction(procurement, "procurement", "submit", {}),
    false,
  );
});

test("approve-work completes assigned staff work only for supervisors", () => {
  const manager = actor({ role: "management" });
  const administrator = actor({ role: "administrator", position: "Administrator" });
  const director = actor({
    role: "administrator",
    position: "Borough Director",
    developments: [],
  });
  const worker = actor({ role: "worker", position: "Maintenance Worker" });
  const states: Record<string, Record<string, unknown>> = {
    "resident-reports": { status: "resolved" },
    "building-violations": { status: "done" },
    "elevator-jobs": { status: "done" },
    "emergency-jobs": { status: "done" },
  };
  for (const [entity, state] of Object.entries(states)) {
    assert.equal(canPerformEntityAction(manager, entity, "approve-work", state), true);
    assert.equal(canPerformEntityAction(administrator, entity, "approve-work", state), true);
    assert.equal(canPerformEntityAction(director, entity, "approve-work", state), true);
    assert.equal(canPerformEntityAction(worker, entity, "approve-work", state), false);
  }
  assert.equal(
    isValidEntityTransition("resident-reports", "approve-work", { status: "in_progress" }),
    false,
  );
  assert.equal(
    isValidEntityTransition("resident-reports", "approve-work", { status: "resolved" }),
    true,
  );
  assert.equal(
    isValidEntityTransition("resident-reports", "complete", { status: "in_progress" }),
    true,
  );
  assert.equal(
    canPerformEntityAction(worker, "resident-reports", "complete", {
      assignedStaffId: worker.id,
    }),
    true,
  );
  assert.equal(
    isValidEntityTransition("building-violations", "approve-work", { status: "done" }),
    true,
  );
  assert.equal(
    isValidEntityTransition("elevator-jobs", "approve-work", { status: "assigned" }),
    false,
  );
});

test("procurement visibility follows the lifecycle", () => {
  const manager = actor();
  const cpm = actor({ id: "cpm-1", role: "inspector", position: "CPM" });
  const procurement = actor({ role: "procurement" });
  const row = (status: string, createdBy = cpm.id) => ({ entity: "procurement", createdBy, state: { status } });
  assert.equal(procurementRecordAllowed(cpm, row("draft")), true);
  assert.equal(procurementRecordAllowed(cpm, row("approved")), false);
  assert.equal(procurementRecordAllowed(manager, row("submitted")), true);
  assert.equal(procurementRecordAllowed(manager, row("approved")), false);
  assert.equal(procurementRecordAllowed(procurement, row("approved")), true);
  assert.equal(procurementRecordAllowed(procurement, row("submitted")), false);
});

test("staff can cancel only their own leave request", () => {
  const worker = actor({
    id: "worker-1",
    name: "Taylor Smith",
    role: "worker",
  });
  assert.equal(
    canPerformEntityAction(worker, "leave-requests", "cancel", {
      requesterStaffId: "worker-1",
    }),
    true,
  );
  assert.equal(
    canPerformEntityAction(worker, "leave-requests", "cancel", {
      requesterStaffId: "worker-2",
    }),
    false,
  );
});

test("management and supervisors can decide leave while ordinary staff and HR cannot", () => {
  const canApprove = [
    actor({ role: "management", position: "Property Manager" }),
    actor({ role: "management", position: "Superintendent" }),
    actor({ role: "administrator", position: "Administrator" }),
    actor({ role: "worker", position: "Plumber Supervisor" }),
  ];
  for (const approver of canApprove) {
    assert.equal(
      canPerformEntityAction(approver, "leave-requests", "approve", {}),
      true,
    );
    assert.equal(
      canPerformEntityAction(approver, "leave-requests", "deny", {}),
      true,
    );
  }
  assert.equal(
    canPerformEntityAction(
      actor({ role: "worker", position: "Maintenance Worker" }),
      "leave-requests",
      "approve",
      {},
    ),
    false,
  );
  assert.equal(
    canPerformEntityAction(
      actor({ role: "human_resources", position: "Human Resources" }),
      "leave-requests",
      "approve",
      {},
    ),
    false,
  );
});

test("legacy name-only leave requests do not grant cancellation ownership", () => {
  const worker = actor({
    id: "worker-1",
    name: "Taylor Smith",
    role: "worker",
  });
  assert.equal(
    canPerformEntityAction(worker, "leave-requests", "cancel", {
      employee: "Taylor Smith",
      requestedBy: "Taylor Smith",
    }),
    false,
  );
});

test("operational actions require canonical assignment ownership", () => {
  const worker = actor({
    id: "worker-1",
    role: "worker",
    position: "Maintenance Worker",
  });
  const otherWorker = actor({
    id: "worker-2",
    role: "worker",
    position: "Maintenance Worker",
  });
  for (const entity of [
    "building-violations",
    "resident-reports",
    "elevator-jobs",
    "emergency-jobs",
  ]) {
    const action = entity === "building-violations" ? "complete" : "start";
    assert.equal(
      canPerformAssignedWorkflowAction(worker, entity, action, {
        assignedStaffId: worker.id,
      }),
      true,
    );
    assert.equal(
      canPerformAssignedWorkflowAction(otherWorker, entity, action, {
        assignedStaffId: worker.id,
      }),
      false,
    );
  }
});

test("assignment normalization prefers canonical ids over mutable labels", () => {
  assert.deepEqual(
    normalizeAssignment({
      assignedStaffId: "staff-1",
      assignedTo: "Someone Else",
    }),
    { assignedStaffId: "staff-1", hasLegacyAssignment: false },
  );
  assert.deepEqual(
    normalizeAssignment({ assignedTo: "Taylor Smith" }),
    { assignedStaffId: null, hasLegacyAssignment: true },
  );
});

test("legacy name-only operational assignments fail closed", () => {
  const worker = actor({
    id: "worker-1",
    name: "Taylor Smith",
    role: "worker",
    position: "Maintenance Worker",
  });
  assert.equal(
    canPerformEntityAction(worker, "building-violations", "complete", {
      assignedTo: "Taylor Smith",
    }),
    false,
  );
  assert.equal(
    canPerformEntityAction(worker, "elevator-jobs", "start", {
      assignedTo: "Taylor Smith",
    }),
    false,
  );
  assert.equal(
    canPerformEntityAction(
      actor({ role: "emergency", id: "emergency-1", name: "Taylor Smith" }),
      "emergency-jobs",
      "complete",
      { assignedTo: "Taylor Smith" },
    ),
    false,
  );
});

test("supervisors may override operational assignments, but procurement may not", () => {
  const manager = actor();
  const admin = actor({ role: "administrator", position: "Administrator" });
  const director = actor({
    role: "administrator",
    position: "Borough Director",
    developments: [],
  });
  const state = { assignedStaffId: "someone-else" };
  assert.equal(
    canPerformEntityAction(manager, "building-violations", "complete", state),
    true,
  );
  assert.equal(
    canPerformEntityAction(admin, "elevator-jobs", "complete", state),
    true,
  );
  assert.equal(
    canPerformEntityAction(director, "emergency-jobs", "complete", state),
    true,
  );
  assert.equal(
    canPerformEntityAction(
      actor({ role: "procurement", position: "Procurement" }),
      "elevator-jobs",
      "complete",
      state,
    ),
    false,
  );
});

test("only assignment authorities may introduce canonical assignees", () => {
  const worker = actor({ role: "worker", position: "Maintenance Worker" });
  const inspector = actor({ role: "inspector", position: "Inspector" });
  const emergency = actor({ role: "emergency", position: "Other" });
  const manager = actor();
  const target = {
    id: "worker-2",
    role: "worker",
    position: "Maintenance Worker",
    developments: ["Development A"],
  };
  assert.equal(isAssignmentAuthority(worker), false);
  assert.equal(isAssignmentAuthority(inspector), false);
  assert.equal(isAssignmentAuthority(emergency), false);
  assert.equal(isAssignmentAuthority(manager), true);
  assert.equal(canAssignStaff(worker, target, "Development A"), false);
  assert.equal(canAssignStaff(inspector, target, "Development A"), false);
  assert.equal(canAssignStaff(emergency, target, "Development A"), false);
  assert.equal(canAssignStaff(manager, target, "Development A"), true);
});

test("canonical emergency and elevator assignments authorize only their staff id", () => {
  const emergency = actor({
    id: "emergency-1",
    role: "emergency",
    position: "Other",
  });
  const inspector = actor({
    id: "inspector-1",
    role: "inspector",
    position: "Elevator Service",
  });
  const other = actor({ id: "other-worker", role: "worker", position: "Maintenance Worker" });
  for (const entity of ["emergency-jobs", "elevator-jobs"]) {
    assert.equal(
      canPerformEntityAction(emergency, entity, "complete", {
        assignedStaffId: emergency.id,
      }),
      entity === "emergency-jobs",
    );
    assert.equal(
      canPerformEntityAction(inspector, entity, "complete", {
        assignedStaffId: inspector.id,
      }),
      true,
    );
    assert.equal(
      canPerformEntityAction(other, entity, "complete", {
        assignedStaffId: emergency.id,
      }),
      false,
    );
  }
});

test("generic patches cannot bypass protected workflow actions", () => {
  assert.equal(
    patchesWorkflowManagedFields("building-violations", {
      status: "approved",
    }),
    true,
  );
  assert.equal(
    patchesWorkflowManagedFields("leave-requests", {
      clearedByMgmt: true,
    }),
    true,
  );
  assert.equal(
    patchesWorkflowManagedFields("procurement", {
      awardAt: new Date().toISOString(),
    }),
    true,
  );
  assert.equal(
    patchesWorkflowManagedFields("projects", { status: "approved" }),
    false,
  );
  assert.equal(
    patchesWorkflowManagedFields("building-violations", {
      notes: "Updated notes",
    }),
    false,
  );
});

test("assignment fields are distinct from ordinary editable record fields", () => {
  assert.equal(
    patchesWorkflowManagedFields("building-violations", {
      assignedStaffId: "worker-2",
    }),
    false,
    "the route applies the stricter supervisor-only assignment policy",
  );
});

test("workflow creation discards privileged client state", () => {
  assert.deepEqual(
    withInitialWorkflowState("building-violations", {
      status: "approved",
      clearedByMgmt: true,
      approvedAt: "forged",
      building: "100 Main Street",
    }),
    {
      status: "submitted",
      building: "100 Main Street",
    },
  );
  assert.equal(
    withInitialWorkflowState("leave-requests", {
      status: "Approved",
      employee: "Taylor Smith",
    }).status,
    "Pending",
  );
  assert.equal(
    withInitialWorkflowState("procurement", {
      status: "awarded",
    }).status,
    "draft",
  );
});

test("workflow actions cannot skip required stages", () => {
  assert.equal(
    isValidEntityTransition("procurement", "award", { status: "draft" }),
    false,
  );
  assert.equal(
    isValidEntityTransition("procurement", "award", { status: "bidding" }),
    true,
  );
  assert.equal(
    isValidEntityTransition("resident-reports", "resolve", {
      status: "submitted",
    }),
    false,
  );
  assert.equal(
    isValidEntityTransition("resident-reports", "resolve", {
      status: "in_progress",
    }),
    true,
  );
});

test("Borough Director cannot perform procurement workflow actions", () => {
  const director = actor({
    role: "administrator",
    position: "Borough Director",
    developments: [],
  });
  assert.equal(
    canPerformEntityAction(director, "procurement", "award", {}),
    false,
  );
  assert.equal(
    canPerformEntityAction(director, "leave-requests", "cancel", {}),
    true,
  );
  assert.equal(
    canPerformEntityAction(director, "emergency-jobs", "complete", {}),
    true,
  );
});