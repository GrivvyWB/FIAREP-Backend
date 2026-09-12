import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TIME_CLOCK_CONFIG,
  classifyMobileIdempotency,
  expectedDirection,
  getTimeClockConfig,
  isMobileClockMutationAllowed,
  rejectUnimplementedExternalIntegration,
  serializeTimeClockPunch,
  mergeTimeClockConfig,
} from "./timeClockConfig";

test("time-clock configuration defaults are safe and vendor-neutral", () => {
  assert.deepEqual(getTimeClockConfig({}), DEFAULT_TIME_CLOCK_CONFIG);
  assert.equal(getTimeClockConfig({ timeClock: { mobileClockEnabled: true } }).mobileClockEnabled, true);
  assert.equal(getTimeClockConfig({ timeClock: { externalAuthoritative: false } }).externalAuthoritative, true);
});

test("time-clock updates preserve unrelated feature values", () => {
  const features = mergeTimeClockConfig({ inspections: { enabled: true } }, { mobileClockEnabled: true });
  assert.deepEqual(features.inspections, { enabled: true });
  assert.deepEqual(features.timeClock, { ...DEFAULT_TIME_CLOCK_CONFIG, mobileClockEnabled: true });
  const attemptedOverride = mergeTimeClockConfig({}, { externalAuthoritative: false });
  assert.equal((attemptedOverride.timeClock as { externalAuthoritative: boolean }).externalAuthoritative, true);
});

test("mobile mutation and alternating direction are explicit", () => {
  assert.equal(isMobileClockMutationAllowed(DEFAULT_TIME_CLOCK_CONFIG), false);
  assert.equal(isMobileClockMutationAllowed({ ...DEFAULT_TIME_CLOCK_CONFIG, mobileClockEnabled: true }), true);
  assert.equal(expectedDirection(null), "in");
  assert.equal(expectedDirection({ direction: "in" }), "out");
  assert.equal(expectedDirection({ direction: "out" }), "in");
});

test("mobile idempotency retries only match the same actor, source, and direction", () => {
  assert.equal(classifyMobileIdempotency(null, "staff-1", "in"), "new");
  assert.equal(classifyMobileIdempotency({ staffId: "staff-1", source: "fiarep-mobile", direction: "in" }, "staff-1", "in"), "retry");
  assert.equal(classifyMobileIdempotency({ staffId: "staff-1", source: "fiarep-mobile", direction: "in" }, "staff-1", "out"), "conflict");
  assert.equal(classifyMobileIdempotency({ staffId: "staff-2", source: "fiarep-mobile", direction: "in" }, "staff-1", "in"), "conflict");
});

test("external authority is fixed and unimplemented integration cannot be enabled", () => {
  assert.equal(getTimeClockConfig({ timeClock: { externalAuthoritative: false } }).externalAuthoritative, true);
  assert.equal(rejectUnimplementedExternalIntegration({ integrationEnabled: true }), "External time-clock integration is not available until a provider adapter is configured");
  assert.equal(rejectUnimplementedExternalIntegration({ provider: "vendor" }), "The external time-clock provider is managed by the provider adapter");
  assert.equal(rejectUnimplementedExternalIntegration({ integrationEnabled: false }), null);
});

test("time-clock punch serialization returns the complete read-only contract", () => {
  const serialized = serializeTimeClockPunch({
    id: "punch-1",
    direction: "in",
    source: "external",
    punchAt: new Date("2025-01-01T10:00:00.000Z"),
    recordedAt: new Date("2025-01-01T10:01:00.000Z"),
    provider: "vendor",
    externalId: "external-1",
  });
  assert.deepEqual(serialized, {
    id: "punch-1",
    direction: "in",
    source: "external",
    punchAt: "2025-01-01T10:00:00.000Z",
    recordedAt: "2025-01-01T10:01:00.000Z",
    provider: "vendor",
    externalId: "external-1",
    readOnly: true,
  });
});