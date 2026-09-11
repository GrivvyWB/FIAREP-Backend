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

test("Borough Director has full module and development authority", () => {
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

test("restricted management roles cannot synchronize procurement records", () => {
  assert.equal(canReadEntity(actor(), "procurement"), false);
  assert.equal(
    canReadEntity(actor({ position: "Regional Director" }), "procurement"),
    true,
  );
});