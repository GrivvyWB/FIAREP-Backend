import assert from "node:assert/strict";
import test from "node:test";
import type { Organization } from "@workspace/db";
import { effectiveLicenseStatus, licenseAllows } from "./auth";

function organization(overrides: Partial<Organization> = {}): Organization {
  const now = new Date("2026-09-12T16:00:00.000Z");
  return {
    id: "ORG-TEST",
    name: "Test Organization",
    status: "active",
    startsAt: null,
    endsAt: null,
    staffLimit: null,
    propertyLimit: null,
    hrEmail: "fiarep@outlook.com",
    features: {},
    unrestricted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("a passed expiration date has an effective expired status", () => {
  const now = new Date("2026-09-12T16:00:00.000Z");
  const org = organization({ endsAt: new Date("2026-09-12T15:59:59.000Z") });

  assert.equal(effectiveLicenseStatus(org, now), "expired");
  assert.equal(licenseAllows(org, org.id, now), false);
});

test("unrestricted organizations do not bypass expiration dates", () => {
  const now = new Date("2026-09-12T16:00:00.000Z");
  const org = organization({
    unrestricted: true,
    endsAt: new Date("2026-09-12T16:00:00.000Z"),
  });

  assert.equal(effectiveLicenseStatus(org, now), "expired");
  assert.equal(licenseAllows(org, org.id, now), false);
});

test("future expiration dates remain active", () => {
  const now = new Date("2026-09-12T16:00:00.000Z");
  const org = organization({ endsAt: new Date("2026-09-12T16:00:01.000Z") });

  assert.equal(effectiveLicenseStatus(org, now), "active");
  assert.equal(licenseAllows(org, org.id, now), true);
});

test("a future license start date blocks access without reporting expiration", () => {
  const now = new Date("2026-09-12T16:00:00.000Z");
  const org = organization({ startsAt: new Date("2026-09-12T16:00:01.000Z") });

  assert.equal(effectiveLicenseStatus(org, now), "active");
  assert.equal(licenseAllows(org, org.id, now), false);
});