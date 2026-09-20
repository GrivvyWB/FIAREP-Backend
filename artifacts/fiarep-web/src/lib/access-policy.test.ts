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

test("trade supervisors can open resident complaints they receive", () => {
  assert.equal(hasModuleAccess(supervisor("Elevator Supervisor"), "reports"), true);
  assert.equal(hasModuleAccess(supervisor("Plumbing Supervisor"), "reports"), true);
});

test("specialized supervisors can open resident complaints they receive", () => {
  assert.equal(hasModuleAccess(supervisor("Supervisor Inspector"), "reports"), true);
  assert.equal(hasModuleAccess(supervisor("CPM Supervisor"), "reports"), true);
});

test("complaint access does not expose unrelated management modules", () => {
  assert.equal(hasModuleAccess(supervisor("Elevator Supervisor"), "projects"), false);
  assert.equal(hasModuleAccess(supervisor("Elevator Supervisor"), "procurement"), false);
});