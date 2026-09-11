import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateStaffBody,
  CreateStaffResponse,
  GetCurrentStaffResponse,
  ListStaffResponse,
  ResetStaffCodeResponse,
  RevokeStaffResponse,
} from "@workspace/api-zod";

const base = {
  id: "staff-1",
  tenantId: "tenant-1",
  name: "Taylor Smith",
  role: "worker" as const,
  position: "Staff Worker" as const,
  status: "approved",
  developments: [],
};

test("staff create and reset contracts require a one-time code", () => {
  const created = CreateStaffResponse.parse({ ...base, code: "AB23" });
  const reset = ResetStaffCodeResponse.parse({ ...base, code: "CD45" });
  assert.equal(created.code, "AB23");
  assert.equal(reset.code, "CD45");
  assert.throws(() => CreateStaffResponse.parse(base));
});

test("staff directory and revoke contracts never expose codes", () => {
  const directory = ListStaffResponse.parse([{ ...base, code: "AB23" }])[0];
  const revoked = RevokeStaffResponse.parse({ ...base, status: "revoked", code: "CD45" });
  assert.equal("code" in directory, false);
  assert.equal("code" in revoked, false);
});

test("auth staff contract includes tenant identity", () => {
  const staff = GetCurrentStaffResponse.parse(base);
  assert.equal(staff.tenantId, "tenant-1");
});

test("resident remains a response role but is not an issuance role", () => {
  const resident = GetCurrentStaffResponse.parse({ ...base, role: "resident" });
  assert.equal(resident.role, "resident");
  assert.throws(() => CreateStaffBody.parse({
    name: "Resident Account",
    role: "resident",
    position: "Staff Worker",
  }));
});

test("staff contract accepts supervisor positions", () => {
  const supervisor = CreateStaffResponse.parse({
    ...base,
    position: "Elevator Supervisor",
    code: "EF67",
  });
  assert.equal(supervisor.position, "Elevator Supervisor");
});