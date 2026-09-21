import assert from "node:assert/strict";
import test from "node:test";
import type { Staff } from "@workspace/api-client-react";
import { hasModuleAccess } from "./access-policy.ts";

function supervisor(position: string): Staff {
  return {
    id: "supervisor-1",
    name: "Supervisor",
    role: "management",
    position,
    status: "approved",
    developments: ["Amsterdam"],
  } as Staff;
}

function worker(position: string): Staff {
  return {
    id: "worker-1",
    name: "Worker",
    role: "worker",
    position,
    status: "approved",
    developments: ["Amsterdam"],
  } as Staff;
}

test("trade supervisors can open resident complaints they receive", () => {
  assert.equal(hasModuleAccess(supervisor("Elevator Supervisor"), "reports"), true);
  assert.equal(hasModuleAccess(supervisor("Plumbing Supervisor"), "reports"), true);
  assert.equal(hasModuleAccess(supervisor("Elevator Supervisor"), "violations"), true);
  assert.equal(hasModuleAccess(supervisor("Plumbing Supervisor"), "violations"), true);
  assert.equal(hasModuleAccess(supervisor("Superintendent Ⓔ"), "reports"), true);
  assert.equal(hasModuleAccess(supervisor("Superintendent Ⓔ"), "violations"), true);
});

test("specialized supervisors can open resident complaints they receive", () => {
  assert.equal(hasModuleAccess(supervisor("Supervisor Inspector"), "reports"), true);
  assert.equal(hasModuleAccess(supervisor("CPM Supervisor"), "reports"), true);
  assert.equal(hasModuleAccess(supervisor("Supervisor Inspector"), "violations"), true);
  assert.equal(hasModuleAccess(supervisor("CPM Supervisor"), "violations"), true);
});

test("complaint access does not expose unrelated management modules", () => {
  assert.equal(hasModuleAccess(supervisor("Elevator Supervisor"), "projects"), false);
  assert.equal(hasModuleAccess(supervisor("Elevator Supervisor"), "procurement"), false);
});

test("workers can open assigned complaint links without exposing management modules", () => {
  assert.equal(hasModuleAccess(worker("Elevator Service"), "reports"), true);
  assert.equal(hasModuleAccess(worker("Elevator Service"), "projects"), false);
  assert.equal(hasModuleAccess(worker("Elevator Service"), "procurement"), false);
});

test("organization module switches override role access", () => {
  assert.equal(
    hasModuleAccess(
      supervisor("Superintendent"),
      "reports",
      { reports: false },
    ),
    false,
  );
  assert.equal(
    hasModuleAccess(
      supervisor("Superintendent"),
      "reports",
      { reports: true },
    ),
    true,
  );
  assert.equal(
    hasModuleAccess(supervisor("Superintendent"), "reports", {}),
    true,
  );
});