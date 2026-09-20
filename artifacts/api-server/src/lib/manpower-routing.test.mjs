import assert from "node:assert/strict";
import test from "node:test";
import { supervisorTargetForReleasedWork } from "./manpower-routing.ts";

test("returns released work to the supervisor who dispatched it", () => {
  assert.equal(supervisorTargetForReleasedWork({
    dispatchingSupervisorId: "supervisor-1",
    receiverSupervisorId: "supervisor-2",
  }), "supervisor-1");
});

test("uses the receiving supervisor recorded on the manpower request", () => {
  assert.equal(supervisorTargetForReleasedWork({
    receiverSupervisorId: "supervisor-2",
  }), "supervisor-2");
});