import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "./auth";
import {
  canReadEntity,
  entityDevelopmentAllowed,
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

test("administrators can synchronize unscoped projects", () => {
  assert.equal(
    entityDevelopmentAllowed(
      actor({ role: "administrator", developments: [] }),
      "projects",
      null,
    ),
    true,
  );
});

test("restricted management roles cannot synchronize procurement records", () => {
  assert.equal(canReadEntity(actor(), "procurement"), false);
  assert.equal(
    canReadEntity(actor({ position: "Regional Director" }), "procurement"),
    true,
  );
});