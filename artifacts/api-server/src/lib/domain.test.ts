import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "./auth";
import {
  canReadEntity,
  isViolationAuthority,
  canBrowseStaffDirectory,
  canCreateEntity,
  canMutateEntity,
  canDeleteEntity,
  canDeleteOperationalRecords,
  canPerformEntityAction,
  canPerformAssignedWorkflowAction,
  canApproveLeaveForEmployee,
  canApproveLeaveDuration,
  validateLeaveRequestSchedule,
  canReadStaffDirectoryEmployee,
  canAssignStaff,
  canSuperintendentEAssignResidentReport,
  isAssignmentAuthority,
  normalizeAssignment,
  entityDevelopmentAllowed,
  isValidEntityTransition,
  patchesWorkflowManagedFields,
  withInitialWorkflowState,
  procurementRecordAllowed,
  canReadEntityRecord,
  canReadHrEntityRecord,
  canUploadToEntityRecord,
  canIssueStaffAccountRole,
  canUseGeneralStaffLogin,
  staffCode,
  leaveRequestDurationDays,
  validLeaveRequestDuration,
  isHrEntity,
  isHrProtectedField,
  serializeHrStaff,
  serializeStaffIssueResponse,
  isCpmSupervisor,
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

test("staff access codes are generated with both letters and digits", () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = staffCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/);
    assert.match(code, /[A-HJ-NP-Z]/);
    assert.match(code, /[2-9]/);
  }
});

test("HR lifecycle entities are tenant-administered without changing staff authority", () => {
  assert.equal(isHrEntity("hr-employee-records"), true);
  assert.equal(canReadEntity(actor({ role: "human_resources", developments: [] }), "hr-payroll-benefits"), true);
  assert.equal(canCreateEntity(actor({ role: "human_resources", developments: [] }), "hr-payroll-benefits"), true);
  assert.equal(canReadEntity(actor({ role: "worker" }), "hr-payroll-benefits"), false);
  assert.equal(canCreateEntity(actor({ role: "management" }), "hr-payroll-benefits"), false);
});

test("policy-sensitive HR actions require the HR workflow authority", () => {
  const hr = actor({ role: "human_resources", developments: [] });
  const administrator = actor({ role: "administrator", developments: [] });
  const supervisor = actor({ role: "management" });
  assert.equal(canPerformEntityAction(hr, "hr-payroll-benefits", "approve-pay-change", {}), true);
  for (const [entity, sensitiveAction] of [
    ["hr-payroll-benefits", "approve-pay-change"],
    ["hr-discipline", "approve-discipline"],
    ["hr-exits", "approve-termination"],
    ["hr-exits", "approve-layoff"],
  ] as const) {
    assert.equal(canPerformEntityAction(administrator, entity, sensitiveAction, {}), false);
  }
  assert.equal(canPerformEntityAction(supervisor, "hr-payroll-benefits", "approve-pay-change", {}), false);
  assert.equal(canPerformEntityAction(supervisor, "hr-approvals", "approve", {}), true);
  assert.equal(isValidEntityTransition("hr-payroll-benefits", "approve-pay-change", { status: "draft" }), true);
  assert.equal(isValidEntityTransition("hr-payroll-benefits", "approve-pay-change", { status: "Approved" }), false);
  assert.equal(isValidEntityTransition("hr-payroll-benefits", "close", { status: "in_progress" }), false);
  assert.equal(isValidEntityTransition("hr-payroll-benefits", "close", { status: "approved" }), true);
  assert.equal(isValidEntityTransition("hr-discipline", "close", { status: "in_progress" }), false);
  assert.equal(isValidEntityTransition("hr-discipline", "close", { status: "disciplined" }), true);
  assert.equal(isValidEntityTransition("hr-exits", "close", { status: "in_progress" }), false);
  assert.equal(isValidEntityTransition("hr-exits", "close", { status: "terminated" }), true);
});

test("supervisors cannot approve employee leave but retain scoped directory access", () => {
  const supervisor = actor({
    role: "management",
    position: "Property Manager",
    developments: ["Development A"],
  });
  const inScope = {
    id: "employee-a",
    role: "worker",
    position: "Maintenance Worker",
    developments: ["Development A"],
  };
  const outOfScope = {
    id: "employee-b",
    role: "worker",
    position: "Maintenance Worker",
    developments: ["Development B"],
  };
  const sharedScope = {
    id: "employee-c",
    role: "management",
    position: "Plumber Supervisor",
    developments: ["Development A", "Development B"],
  };
  assert.equal(canApproveLeaveForEmployee(supervisor, inScope), false);
  assert.equal(canApproveLeaveForEmployee(supervisor, outOfScope), false);
  assert.equal(canApproveLeaveForEmployee(supervisor, sharedScope), false);
  assert.equal(canReadStaffDirectoryEmployee(supervisor, inScope), true);
  assert.equal(canReadStaffDirectoryEmployee(supervisor, outOfScope), false);
  assert.equal(canReadStaffDirectoryEmployee(supervisor, sharedScope), true);
  assert.equal(canReadStaffDirectoryEmployee(supervisor, supervisor), false);
});

test("HR records are visible only to HR, administrators, and the linked employee", () => {
  const supervisor = actor({ role: "management", position: "Property Manager" });
  const linkedEmployee = actor({ id: "employee-a", role: "worker", position: "Maintenance Worker" });
  const employee = {
    id: "employee-a",
    role: "worker",
    position: "Maintenance Worker",
    developments: ["Development A"],
    status: "approved",
  };
  const linkedRecord = {
    entity: "hr-employee-records",
    development: "Development A",
    state: { status: "in_progress", employeeStaffId: "employee-a" },
    createdBy: supervisor.id,
    deleted: false,
  };
  assert.equal(canReadHrEntityRecord(supervisor, linkedRecord, employee), false);
  assert.equal(canReadHrEntityRecord(linkedEmployee, linkedRecord, employee), true);
  assert.equal(canReadHrEntityRecord(actor({ role: "human_resources" }), linkedRecord), true);
  assert.equal(canReadHrEntityRecord(actor({ role: "administrator" }), linkedRecord), true);
  assert.equal(canReadHrEntityRecord(supervisor, {
    entity: "hr-employee-records",
    development: "Development A",
    state: { status: "in_progress" },
    createdBy: supervisor.id,
    deleted: false,
  }), false);
  assert.equal(canReadHrEntityRecord(supervisor, {
    entity: "hr-approvals",
    development: "Development A",
    state: { status: "approved", employeeStaffId: "employee-a" },
    createdBy: supervisor.id,
    deleted: false,
  }, employee), false);
});

test("HR linkage and workflow fields cannot be patched directly", () => {
  assert.equal(isHrProtectedField("targetRecordId"), true);
  assert.equal(isHrProtectedField("employeeStaffId"), true);
  assert.equal(isHrProtectedField("approvalPurpose"), true);
  assert.equal(isHrProtectedField("status"), true);
  assert.equal(isHrProtectedField("details"), false);
  assert.deepEqual(withInitialWorkflowState("hr-approvals", {
    targetRecordId: "target-1",
    employeeStaffId: "employee-1",
    approvalPurpose: "pay-change",
    status: "approved",
  }), {
    targetRecordId: "target-1",
    employeeStaffId: "employee-1",
    approvalPurpose: "pay-change",
    status: "pending",
  });
  assert.equal(isValidEntityTransition("hr-approvals", "approve", { status: "PENDING" }), true);
  assert.equal(isValidEntityTransition("hr-approvals", "approve", { status: "consumed" }), false);
  const managementView = serializeHrStaff({
    id: "staff-1",
    code: "AB12",
    sessionVersion: 3,
    hrNotes: "restricted",
    name: "Employee",
    annualSalaryCents: null,
    hourlyRateCents: 2550,
  }, false);
  assert.equal("code" in managementView, false);
  assert.equal("sessionVersion" in managementView, false);
  assert.equal("hrNotes" in managementView, false);
  assert.equal("annualSalaryCents" in managementView, false);
  assert.equal("hourlyRateCents" in managementView, false);
  assert.equal("totalAnnualSalary" in managementView, false);
  const hrView = serializeHrStaff({
    id: "staff-1",
    code: "AB12",
    sessionVersion: 3,
    hrNotes: "restricted",
    name: "Employee",
    annualSalaryCents: null,
    hourlyRateCents: 2550,
  }, true);
  assert.equal("code" in hrView, false);
  assert.equal("sessionVersion" in hrView, false);
  assert.equal(hrView.hrNotes, "restricted");
  assert.equal(hrView.hourlyRate, 25.5);
  assert.equal(hrView.totalAnnualSalary, 53040);
  const administratorView = serializeHrStaff({
    id: "staff-1",
    code: "AB12",
    sessionVersion: 3,
    hrNotes: "restricted",
    name: "Employee",
  }, true);
  assert.equal(administratorView.hrNotes, "restricted");
  assert.equal(isHrProtectedField("position"), true);
  assert.equal(isHrProtectedField("assignedDevelopments"), true);
  assert.equal(isHrProtectedField("annualSalary"), true);
  assert.equal(isHrProtectedField("hourlyRate"), true);
  const issuedView = serializeStaffIssueResponse({
    id: "staff-1",
    code: "AB12",
    sessionVersion: 3,
    hrNotes: "restricted",
    name: "Employee",
  }, false);
  assert.equal(issuedView.code, "AB12");
  assert.equal("sessionVersion" in issuedView, false);
  assert.equal("hrNotes" in issuedView, false);
});

test("operational deletion is limited to higher management", () => {
  assert.equal(canDeleteOperationalRecords(actor({ role: "management", position: "Borough Director" })), true);
  assert.equal(canDeleteOperationalRecords(actor({ role: "management", position: "Regional Director" })), true);
  assert.equal(canDeleteOperationalRecords(actor({ role: "administrator", position: "Administrator" })), true);
  assert.equal(canDeleteOperationalRecords(actor({ role: "management", position: "Property Manager" })), false);
  assert.equal(canDeleteOperationalRecords(actor({ role: "inspector", position: "Supervisor" })), false);
});

test("Borough Director may delete resident reports but remains read-only elsewhere", () => {
  const boroughDirector = actor({ role: "management", position: "Borough Director" });
  for (const entity of ["resident-reports", "emergency-jobs", "elevators", "procurement", "hr-approvals"]) {
    assert.equal(canCreateEntity(boroughDirector, entity), false);
    assert.equal(canMutateEntity(boroughDirector, entity), false);
    assert.equal(
      canDeleteEntity(boroughDirector, entity, {}),
      entity === "resident-reports",
    );
  }
});

test("administrators can delete every entity while other roles retain deletion boundaries", () => {
  const administrator = actor({ role: "administrator", position: "Administrator" });
  for (const entity of [
    "procurement",
    "procurement-bids",
    "hr-employee-records",
    "hr-approvals",
    "hud-inspections",
    "resident-reports",
  ]) {
    assert.equal(canDeleteEntity(administrator, entity, {}), true);
  }
  assert.equal(canDeleteEntity(actor({ role: "management", position: "Regional Director" }), "procurement", {}), true);
  assert.equal(canDeleteEntity(actor({ role: "management", position: "Borough Director" }), "procurement", {}), false);
  assert.equal(canDeleteEntity(actor({ role: "inspector", position: "CPM" }), "procurement", {}), false);
  assert.equal(canDeleteEntity(actor({ role: "human_resources" }), "hr-exits", {}), false);
  assert.equal(canDeleteEntity(actor({ role: "management" }), "hr-approvals", {}), false);
});

test("staff account creation excludes Resident and Vendor public-access roles", () => {
  assert.equal(canIssueStaffAccountRole("resident"), false);
  assert.equal(canIssueStaffAccountRole("vendor"), false);
  assert.equal(canIssueStaffAccountRole("worker"), true);
  assert.equal(canIssueStaffAccountRole("procurement"), true);
});

test("general staff login rejects legacy Resident and Vendor staff roles", () => {
  for (const role of ["resident", "vendor"]) {
    assert.equal(canUseGeneralStaffLogin(role), false);
  }
  for (const role of ["administrator", "human_resources", "management", "worker", "inspector", "procurement", "emergency"]) {
    assert.equal(canUseGeneralStaffLogin(role), true);
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

test("administrators can see operational work across their organization", () => {
  const administrator = actor({
    role: "administrator",
    position: "Administrator",
    developments: [],
  });
  assert.equal(
    entityDevelopmentAllowed(administrator, "projects", "Development A"),
    true,
  );
  assert.equal(
    entityDevelopmentAllowed(administrator, "projects", "Development B"),
    true,
  );
  assert.equal(entityDevelopmentAllowed(administrator, "projects", null), true);
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
    entityDevelopmentAllowed(manager, "resident-reports", " development a "),
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
    true,
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

test("HUD inspections are created on mobile and reviewed only by the Supervisor Inspector", () => {
  const cpm = actor({ id: "cpm-1", role: "inspector", position: "CPM" });
  const inspector = actor({ id: "inspector-1", role: "inspector", position: "Inspector" });
  const inspectorSupervisor = actor({ role: "management", position: "Supervisor Inspector" });
  const cpmSupervisor = actor({ role: "management", position: "CPM Supervisor" });
  const tradeSupervisor = actor({ role: "management", position: "Plumber Supervisor" });

  assert.equal(canCreateEntity(cpm, "hud-inspections"), true);
  assert.equal(canCreateEntity(inspector, "hud-inspections"), true);
  assert.equal(canCreateEntity(inspectorSupervisor, "hud-inspections"), false);
  assert.equal(canReadEntity(inspectorSupervisor, "hud-inspections"), true);
  assert.equal(canReadEntity(cpmSupervisor, "hud-inspections"), false);
  assert.equal(canReadEntity(tradeSupervisor, "hud-inspections"), false);

  for (const action of ["approve", "deny", "correction"]) {
    assert.equal(
      canPerformEntityAction(inspectorSupervisor, "hud-inspections", action, { status: "Submitted" }),
      true,
    );
    assert.equal(
      canPerformEntityAction(cpmSupervisor, "hud-inspections", action, { status: "Submitted" }),
      false,
    );
  }
  assert.equal(
    canPerformEntityAction(tradeSupervisor, "hud-inspections", "approve", { status: "Submitted" }),
    false,
  );
  assert.equal(
    canPerformEntityAction(cpm, "hud-inspections", "resubmit", { status: "Correction" }),
    true,
  );
});

test("HUD inspection records remain scoped to their creator and development", () => {
  const record = {
    entity: "hud-inspections",
    development: "Development A",
    state: { status: "Submitted" },
    createdBy: "inspector-1",
    deleted: false,
  };
  assert.equal(
    canReadEntityRecord(
      actor({ id: "inspector-1", role: "inspector", position: "Inspector" }),
      record,
    ),
    true,
  );
  assert.equal(
    canReadEntityRecord(
      actor({ id: "inspector-2", role: "inspector", position: "Inspector" }),
      record,
    ),
    false,
  );
  assert.equal(
    canReadEntityRecord(
      actor({ role: "management", position: "Supervisor Inspector" }),
      record,
    ),
    true,
  );
  assert.equal(
    canReadEntityRecord(
      actor({
        role: "management",
        position: "Supervisor Inspector",
        developments: ["Development B"],
      }),
      record,
    ),
    false,
  );
});

test("HUD inspection workflow protects review status and valid transitions", () => {
  assert.deepEqual(
    withInitialWorkflowState("hud-inspections", { status: "completed", unitAddress: "1 Main St" }),
    { status: "Submitted", unitAddress: "1 Main St" },
  );
  assert.equal(
    patchesWorkflowManagedFields("hud-inspections", { status: "Approved" }),
    true,
  );
  assert.equal(
    isValidEntityTransition("hud-inspections", "approve", { status: "Submitted" }),
    true,
  );
  assert.equal(
    isValidEntityTransition("hud-inspections", "correction", { status: "Submitted" }),
    true,
  );
  assert.equal(
    isValidEntityTransition("hud-inspections", "resubmit", { status: "Correction" }),
    true,
  );
  assert.equal(
    isValidEntityTransition("hud-inspections", "approve", { status: "Approved" }),
    false,
  );
});

test("all supervisors can open and change work orders", () => {
  for (const position of ["Supervisor Inspector", "CPM Supervisor", "Plumber Supervisor"]) {
    const supervisor = actor({ role: "management", position });
    assert.equal(canReadEntity(supervisor, "change-orders"), true);
    assert.equal(canCreateEntity(supervisor, "change-orders"), true);
    assert.equal(canMutateEntity(supervisor, "change-orders"), true);
  }
});

test("ordinary staff can read only their own leave requests", () => {
  const worker = actor({
    id: "worker-1",
    role: "worker",
    position: "Maintenance Worker",
  });
  const leave = (createdBy: string, state: Record<string, unknown> = {}) => ({
    entity: "leave-requests",
    development: "Development A",
    state,
    createdBy,
    deleted: false,
  });
  assert.equal(canReadEntityRecord(worker, leave("worker-1")), true);
  assert.equal(canReadEntityRecord(worker, leave("worker-2")), false);
  assert.equal(
    canReadEntityRecord(
      worker,
      leave("manager-1", { employeeStaffId: "worker-1", requesterStaffId: "manager-1" }),
    ),
    true,
  );
  assert.equal(
    canReadEntityRecord(
      worker,
      leave("worker-1", { employeeStaffId: "worker-2", requesterStaffId: "worker-1" }),
    ),
    false,
  );
});

test("procurement scopes are isolated from ordinary management and administrators", () => {
  const procurement = {
    entity: "procurement",
    development: "Development A",
    state: { status: "submitted" },
    createdBy: "cpm-1",
    deleted: false,
  };
  assert.equal(canReadEntity(actor(), "procurement"), false);
  assert.equal(canReadEntityRecord(actor(), procurement), false);
  const cpm = actor({ id: "cpm-1", role: "inspector", position: "CPM" });
  assert.equal(canReadEntity(cpm, "procurement"), true);
  assert.equal(canReadEntityRecord(cpm, procurement), true);
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
    "ordinary management cannot read or attach procurement files",
  );
});

test("administrator authority overrides a Borough Director position for procurement access", () => {
  const director = actor({
    role: "administrator",
    position: "Borough Director",
    developments: [],
  });
  assert.equal(canReadEntity(director, "procurement"), true);
  assert.equal(
    entityDevelopmentAllowed(director, "projects", "Any Development"),
    true,
  );
  assert.equal(entityDevelopmentAllowed(director, "projects", null), true);
});

test("elevated management can sync resident reports across developments", () => {
  for (const position of [
    "  BOROUGH   director ",
    "Regional Director",
    "Superintendent",
  ]) {
    const elevated = actor({
      role: "management",
      position,
      developments: ["Development A"],
    });
    assert.equal(
      entityDevelopmentAllowed(
        elevated,
        "resident-reports",
        "Development B",
      ),
      true,
    );
  }
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
  assert.equal(canDeleteEntity(director, "procurement", {}), true);
  assert.equal(canDeleteEntity(procurement, "procurement", {}), false);
});

test("CPM Supervisors review submitted procurement scopes but cannot author or submit them", () => {
  const supervisor = actor({
    role: "management",
    position: "CPM Supervisor",
    developments: ["Development A"],
  });
  assert.equal(isCpmSupervisor(supervisor), true);
  assert.equal(canCreateEntity(supervisor, "procurement"), false);
  assert.equal(canReadEntity(supervisor, "procurement"), true);
  assert.equal(canMutateEntity(supervisor, "procurement"), false);
  assert.equal(canReadEntity(supervisor, "procurement-bids"), false);
  assert.equal(canReadEntity(supervisor, "vendor-quotes"), false);

  const ownDraft = {
    entity: "procurement",
    development: "Development A",
    state: { status: "draft" },
    createdBy: supervisor.id,
    deleted: false,
  };
  const otherDraft = { ...ownDraft, createdBy: "another-cpm" };
  const submitted = { ...ownDraft, state: { status: "submitted" } };
  const outOfCoverage = { ...submitted, development: "Development B" };
  assert.equal(canReadEntityRecord(supervisor, ownDraft), false);
  assert.equal(canReadEntityRecord(supervisor, otherDraft), false);
  assert.equal(canReadEntityRecord(supervisor, submitted), true);
  assert.equal(canReadEntityRecord(supervisor, outOfCoverage), false);
  assert.equal(canPerformEntityAction(supervisor, "procurement", "submit", ownDraft.state), false);
  assert.equal(canPerformEntityAction(supervisor, "procurement", "approve", submitted.state), true);
  assert.equal(canPerformEntityAction(supervisor, "procurement", "reject", submitted.state), true);
});

test("in-house manpower workflow permits only the assigned eligible trade subordinate", () => {
  const request = {
    assignmentMode: "in_house",
    requestedTrade: "Plumber",
    development: "Development A",
    assignedStaffId: "worker-1",
  };
  const plumber = actor({
    id: "worker-1",
    role: "worker",
    position: "Plumber",
    developments: ["Development A"],
  });
  const inspector = actor({
    id: "inspector-1",
    role: "inspector",
    position: "Inspector",
    developments: ["Development A"],
  });
  assert.equal(canPerformEntityAction(plumber, "manpower-requests", "start", request), true);
  assert.equal(canPerformEntityAction(plumber, "manpower-requests", "complete", {
    ...request,
    status: "in_progress",
  }), true);
  assert.equal(canPerformEntityAction(inspector, "manpower-requests", "start", request), false);
  assert.equal(canPerformEntityAction(actor({
    ...plumber,
    id: "worker-2",
  }), "manpower-requests", "start", request), false);
  assert.equal(canPerformEntityAction(actor({
    ...plumber,
    id: "worker-1",
    developments: ["Development B"],
  }), "manpower-requests", "start", request), false);
});

test("restricted management roles cannot synchronize procurement records", () => {
  assert.equal(canReadEntity(actor(), "procurement"), false);
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
  assert.equal(isViolationAuthority(actor({ role: "management", position: "Supervisor Inspector" })), true);
  for (const position of ["CPM Supervisor", "Plumbing Supervisor", "Carpenter Supervisor", "Elevator Supervisor"]) {
    const supervisor = actor({ role: "management", position });
    assert.equal(isViolationAuthority(supervisor), false);
    // Trade supervisors receive violations dispatched to their trade, so they
    // can read them; they still cannot author or edit violation records.
    assert.equal(canReadEntity(supervisor, "violations"), true);
    assert.equal(canCreateEntity(supervisor, "building-violations"), false);
    assert.equal(canMutateEntity(supervisor, "priority-violations"), false);
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
  const manager = actor({ position: "Supervisor Inspector" });
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
  const submitted = { status: "submitted" };
  const cpmSupervisor = actor({ role: "management", position: "CPM Supervisor" });
  const ordinaryManagement = actor({ role: "management", position: "Property Manager" });
  const administrator = actor({ role: "administrator", position: "Administrator" });
  assert.equal(canPerformEntityAction(cpmSupervisor, "procurement", "approve", submitted), true);
  assert.equal(canPerformEntityAction(cpmSupervisor, "procurement", "reject", submitted), true);
  for (const reviewer of [ordinaryManagement, manager, administrator, cpm, procurement]) {
    assert.equal(canPerformEntityAction(reviewer, "procurement", "approve", submitted), false);
  }
  assert.equal(canPerformEntityAction(cpmSupervisor, "procurement", "submit", { status: "draft" }), false);
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
  // The CPM follows their own scope after approval (pricing stays procurement-only).
  assert.equal(procurementRecordAllowed(cpm, row("approved")), true);
  assert.equal(procurementRecordAllowed(cpm, row("approved", "someone-else")), false);
  assert.equal(procurementRecordAllowed(manager, row("submitted")), false);
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

test("only HR can decide another employee's leave request", () => {
  const cannotApprove = [
    actor({ role: "management", position: "Property Manager" }),
    actor({ role: "management", position: "Superintendent" }),
    actor({ role: "worker", position: "Plumber Supervisor" }),
    actor({ role: "inspector", position: "Supervisor Inspector" }),
  ];
  for (const approver of cannotApprove) {
    assert.equal(
      canPerformEntityAction(approver, "leave-requests", "approve", {}),
      false,
    );
    assert.equal(
      canPerformEntityAction(approver, "leave-requests", "deny", {}),
      false,
    );
  }
  for (const upperManagement of [
    actor({ role: "administrator", position: "Administrator" }),
    actor({ role: "management", position: "Regional Director" }),
    actor({ role: "management", position: "Borough Director" }),
  ]) {
    assert.equal(
      canPerformEntityAction(upperManagement, "leave-requests", "approve", {}),
      false,
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
    true,
  );
});

test("HR controls leave while supervisors cannot access employee leave", () => {
  const employee = actor({
    id: "employee-1",
    role: "worker",
    position: "Plumber",
    developments: ["Development A"],
  });
  assert.equal(
    canApproveLeaveForEmployee(
      actor({ id: "hr-1", role: "human_resources", position: "Human Resources", developments: [] }),
      employee,
    ),
    true,
  );
  assert.equal(
    canApproveLeaveForEmployee(
      actor({ id: "plumber-supervisor", role: "management", position: "Plumber Supervisor", developments: ["Development A"] }),
      employee,
    ),
    false,
  );
  assert.equal(
    canApproveLeaveForEmployee(
      actor({ id: "painter-supervisor", role: "management", position: "Painter Supervisor", developments: ["Development A"] }),
      employee,
    ),
    false,
  );
  assert.equal(
    canApproveLeaveForEmployee(
      actor({ id: "other-development", role: "management", position: "Property Manager", developments: ["Development B"] }),
      employee,
    ),
    false,
  );
  assert.equal(
    canApproveLeaveForEmployee(
      actor({ id: "regional", role: "management", position: "Regional Director", developments: ["Development A"] }),
      employee,
    ),
    false,
  );
});

test("leave records are visible only to HR and the employee", () => {
  const leave = {
    entity: "leave-requests",
    development: "Development A",
    state: {
      employeeStaffId: "employee-1",
      supervisorStaffId: "supervisor-1",
      status: "Pending",
    },
    createdBy: "employee-1",
    deleted: false,
  };
  assert.equal(
    canReadEntityRecord(actor({ id: "employee-1", role: "worker", position: "Plumber" }), leave),
    true,
  );
  assert.equal(
    canReadEntityRecord(actor({ id: "supervisor-1", role: "management", position: "Plumber Supervisor" }), leave),
    false,
  );
  assert.equal(
    canReadEntityRecord(actor({ id: "hr-1", role: "human_resources", position: "Human Resources" }), leave),
    true,
  );
  assert.equal(
    canReadEntityRecord(actor({ id: "regional", role: "management", position: "Regional Director" }), leave),
    false,
  );
  assert.equal(
    canReadEntityRecord(actor({ id: "admin", role: "administrator", position: "Administrator" }), leave),
    false,
  );
});

test("leave duration routes short requests to supervisors and long requests to HR", () => {
  assert.equal(leaveRequestDurationDays({ startDate: "2026-09-01", endDate: "2026-09-14" }), 14);
  assert.equal(leaveRequestDurationDays({ startDate: "2026-09-01", endDate: "2026-09-30" }), 30);
  assert.equal(validLeaveRequestDuration(14), true);
  assert.equal(validLeaveRequestDuration(15), false);
  assert.equal(validLeaveRequestDuration(29), false);
  assert.equal(validLeaveRequestDuration(30), true);
  assert.equal(validLeaveRequestDuration(365), true);
  assert.equal(validLeaveRequestDuration(366), false);
  assert.equal(canApproveLeaveDuration(actor({ role: "management" }), 14), true);
  assert.equal(canApproveLeaveDuration(actor({ role: "management" }), 30), false);
  assert.equal(canApproveLeaveDuration(actor({ role: "administrator" }), 14), false);
  assert.equal(canApproveLeaveDuration(actor({ role: "worker" }), 14), false);
  assert.equal(canApproveLeaveDuration(actor({ role: "inspector" }), 14), false);
  assert.equal(canApproveLeaveDuration(actor({ role: "human_resources" }), 14), false);
  assert.equal(canApproveLeaveDuration(actor({ role: "human_resources" }), 30), true);
  assert.equal(validateLeaveRequestSchedule({
    startAt: "2026-09-01T09:00",
    endAt: "2026-09-01T17:00",
    returnAt: "2026-09-02T09:00",
  }), null);
  assert.equal(validateLeaveRequestSchedule({
    startAt: "2026-09-01T17:00",
    endAt: "2026-09-01T09:00",
    returnAt: "2026-09-02T09:00",
  }), "End must not be before start");
  assert.equal(validateLeaveRequestSchedule({
    startAt: "2026-09-01T09:00",
    endAt: "2026-09-01T17:00",
    returnAt: "2026-09-01T16:00",
  }), "Return must not be before end");
});

test("management cannot approve or deny any leave request", () => {
  const manager = actor({
    id: "manager-1",
    name: "Kye G",
    role: "management",
    position: "Property Manager",
  });
  assert.equal(
    canPerformEntityAction(manager, "leave-requests", "approve", {
      employeeStaffId: manager.id,
      employee: manager.name,
    }),
    false,
  );
  assert.equal(
    canPerformEntityAction(manager, "leave-requests", "deny", {
      employee: manager.name,
    }),
    false,
  );
  assert.equal(
    canPerformEntityAction(manager, "leave-requests", "approve", {
      employeeStaffId: "worker-1",
      employee: "Mark K",
    }),
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

test("management cannot perform work assigned to another staff member", () => {
  const manager = actor({
    id: "manager-1",
    role: "management",
    position: "Property Manager",
  });
  const assignedToWorker = { assignedStaffId: "worker-1" };
  assert.equal(
    canPerformEntityAction(manager, "resident-reports", "start", assignedToWorker),
    false,
  );
  assert.equal(
    canPerformEntityAction(manager, "resident-reports", "complete", assignedToWorker),
    false,
  );
  assert.equal(
    canPerformEntityAction(manager, "resident-reports", "resolve", assignedToWorker),
    false,
  );
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

test("supervisors and procurement cannot perform another staff member's assigned work", () => {
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
    false,
  );
  assert.equal(
    canPerformEntityAction(admin, "elevator-jobs", "complete", state),
    false,
  );
  assert.equal(
    canPerformEntityAction(director, "emergency-jobs", "complete", state),
    false,
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

test("trade supervisors can assign only their own non-supervisor crew", () => {
  const plumberSupervisor = actor({
    position: "Plumbing Supervisor",
    developments: ["Development A"],
  });
  const plumber = {
    id: "plumber-2",
    role: "worker",
    position: "Plumber",
    developments: ["Development A"],
  };
  const inspector = {
    id: "inspector-2",
    role: "inspector",
    position: "Inspector",
    developments: ["Development A"],
  };
  const otherSupervisor = {
    id: "supervisor-2",
    role: "management",
    position: "Plumber Supervisor",
    developments: ["Development A"],
  };
  assert.equal(canAssignStaff(plumberSupervisor, plumber, "Development A"), true);
  assert.equal(canAssignStaff(plumberSupervisor, inspector, "Development A"), false);
  assert.equal(canAssignStaff(plumberSupervisor, otherSupervisor, "Development A"), false);
});

test("any supervisor may send an emergency request to an emergency crew member", () => {
  const crew = { id: "em-1", role: "emergency", position: "Maintenance Worker", developments: [] as string[] };
  for (const position of ["CPM Supervisor", "Plumber Supervisor", "Superintendent", "Supervisor Inspector"]) {
    assert.equal(canAssignStaff(actor({ role: "management", position, developments: ["Development A"] }), crew, "CONEY ISLAND I (SITES 4 & 5)"), true, position);
  }
  assert.equal(canAssignStaff(actor({ role: "worker", position: "Plumber" }), crew, "Development A"), false);
  assert.equal(canCreateEntity(actor({ role: "management", position: "CPM Supervisor" }), "emergency-jobs"), true);
  assert.equal(canCreateEntity(actor({ role: "management", position: "CPM Supervisor" }), "emergency-units"), false);
});

test("procurement may return a scope that is pending release or out for bid", () => {
  const procurement = actor({ role: "procurement", position: "Procurement" });
  assert.equal(canPerformEntityAction(procurement, "procurement", "return", { status: "approved" }), true);
  assert.equal(canPerformEntityAction(procurement, "procurement", "return", { status: "bidding" }), true);
  assert.equal(canPerformEntityAction(procurement, "procurement", "return", { status: "awarded" }), false);
});

test("the CPM and the routed CPM Supervisor follow a scope through every stage", () => {
  const cpm = actor({ id: "cpm-1", role: "inspector", position: "CPM", developments: ["Other"] });
  const sup = actor({ id: "sup-1", role: "management", position: "CPM Supervisor", developments: [] });
  const otherSup = actor({ id: "sup-2", role: "management", position: "CPM Supervisor", developments: ["CONEY ISLAND"] });
  const scope = (status: string) => ({
    entity: "procurement", development: "CONEY ISLAND", createdBy: "cpm-1", deleted: false,
    state: { status, handoffTargetId: "sup-1", complaintNo: "RC-85441", sourceRef: "RC-85441" },
  });
  for (const status of ["submitted", "returned", "approved", "bidding", "awarded"]) {
    assert.equal(canReadEntityRecord(cpm, scope(status)), true, `cpm ${status}`);
    assert.equal(canReadEntityRecord(sup, scope(status)), true, `sup ${status}`);
    assert.equal(canReadEntityRecord(otherSup, scope(status)), false, `other ${status}`);
  }
  assert.equal(canReadEntityRecord(sup, scope("draft")), false);
});

test("complaint-handling supervisors may send a complaint as a violation inspection", () => {
  for (const position of ["Superintendent", "Plumber Supervisor", "CPM Supervisor", "Supervisor Inspector"]) {
    assert.equal(canCreateEntity(actor({ role: "management", position }), "route-assignments"), true, position);
  }
  assert.equal(canCreateEntity(actor({ role: "management", position: "Property Manager" }), "route-assignments"), false);
  assert.equal(canCreateEntity(actor({ role: "worker", position: "Plumber" }), "route-assignments"), false);
});

test("the assigned/completing CPM keeps a read copy of a complaint outside their developments", () => {
  const cpm = actor({ id: "cpm-7", role: "inspector", position: "CPM", developments: ["Development B"] });
  const row = (state: Record<string, unknown>) => ({
    entity: "resident-reports", development: "CONEY ISLAND I (SITES 4 & 5)", state, createdBy: "resident", deleted: false,
  });
  assert.equal(canReadEntityRecord(cpm, row({ status: "done", assignedStaffId: "cpm-7" })), true);
  assert.equal(canReadEntityRecord(cpm, row({ status: "work_approved", completedByStaffId: "cpm-7" })), true);
  assert.equal(canReadEntityRecord(cpm, row({ status: "submitted" })), false);
  assert.equal(canReadEntityRecord(cpm, row({ status: "done", assignedStaffId: "someone-else" })), false);
});

test("office-based CPM Supervisor assigns a CPM covering the site without holding that development", () => {
  const cpmSupervisor = actor({ position: "CPM Supervisor", developments: [] });
  const cpm = { id: "cpm-1", role: "inspector", position: "CPM", developments: ["CONEY ISLAND", "Development B"] };
  const plumber = { id: "plumber-9", role: "worker", position: "Plumber", developments: ["CONEY ISLAND"] };
  assert.equal(canAssignStaff(cpmSupervisor, cpm, "Coney Island"), true);
  assert.equal(canAssignStaff(cpmSupervisor, cpm, "Development C"), false);
  assert.equal(canAssignStaff(cpmSupervisor, plumber, "Coney Island"), false);  assert.equal(canPerformEntityAction(cpmSupervisor, "resident-reports", "assign", { status: "submitted" }), true);
  assert.equal(canPerformEntityAction(cpmSupervisor, "resident-reports", "clear", { status: "resolved" }), true);
  assert.equal(canPerformEntityAction(cpmSupervisor, "resident-reports", "approve-work", { status: "done" }), true);
  const assignedByHim = { status: "done", assignedByStaffId: cpmSupervisor.id };
  assert.equal(canPerformEntityAction(cpmSupervisor, "resident-reports", "approve-work", assignedByHim), true);
  assert.equal(canPerformEntityAction(cpmSupervisor, "resident-reports", "reject-work", assignedByHim), true);
});

test("Superintendent E can hand resident complaints to supervisors or operational staff", () => {
  const superintendentE = actor({
    id: "superintendent-e",
    role: "management",
    position: "Superintendent Ⓔ",
    developments: [],
  });
  assert.equal(
    canSuperintendentEAssignResidentReport(superintendentE, {
      id: "amsterdam-supervisor",
      role: "management",
      position: "Maintenance Supervisor",
    }),
    true,
  );
  assert.equal(
    canSuperintendentEAssignResidentReport(superintendentE, {
      id: "worker",
      role: "worker",
      position: "Maintenance Worker",
    }),
    true,
  );
  assert.equal(
    canSuperintendentEAssignResidentReport(superintendentE, {
      id: "borough-director",
      role: "administrator",
      position: "Borough Director",
    }),
    false,
  );
  assert.equal(
    entityDevelopmentAllowed(
      superintendentE,
      "resident-reports",
      "Amsterdam",
    ),
    true,
  );
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
    false,
  );
  assert.equal(
    canPerformEntityAction(director, "emergency-jobs", "complete", {}),
    false,
  );
});