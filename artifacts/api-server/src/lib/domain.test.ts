import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "./auth";
import {
  canReadEntity,
  canCreateEntity,
  canMutateEntity,
  canDeleteEntity,
  canPerformEntityAction,
  entityDevelopmentAllowed,
  isValidEntityTransition,
  patchesWorkflowManagedFields,
  withInitialWorkflowState,
  procurementRecordAllowed,
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
    canPerformEntityAction(worker, "building-violations", "complete", {}),
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