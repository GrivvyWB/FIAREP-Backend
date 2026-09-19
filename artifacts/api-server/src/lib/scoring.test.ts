import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBuildingScores,
  calculateDevelopmentScores,
  calculateResidentialScores,
  calculateVendorScores,
  type ScoringRecord,
} from "./scoring";

const NOW = new Date("2025-01-31T00:00:00.000Z");
const record = (
  entity: string,
  state: Record<string, unknown>,
  development = "Development A",
): ScoringRecord => ({ entity, development, state, createdAt: state["createdAt"] as string });

test("vendor score applies performance, on-time, and deduction rates", () => {
  const scores = calculateVendorScores([
    record("procurement", {
      status: "closed",
      vendor: "Acme",
      performance: "good",
      awardedAt: "2025-01-20T00:00:00.000Z",
      completedAt: "2025-01-25T00:00:00.000Z",
    }),
    record("procurement", {
      status: "closed",
      vendor: "Acme",
      performance: "fair",
      deduction: 10,
      awardedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-20T00:00:00.000Z",
    }),
    record("procurement", { status: "closed", vendor: "" }),
  ]);
  assert.deepEqual(scores, [{
    vendor: "Acme",
    completed: 2,
    onTimeRate: 0.5,
    deductions: 1,
    score: 53,
  }]);
});

test("vendor score ignores closed jobs that were not rated", () => {
  assert.deepEqual(calculateVendorScores([
    record("procurement", {
      status: "closed",
      vendor: "Unrated Vendor",
      awardedAt: "2025-01-20T00:00:00.000Z",
      closedAt: "2025-01-25T00:00:00.000Z",
    }),
  ]), []);
});

test("development score separates open and fourteen-day overdue work", () => {
  const scores = calculateDevelopmentScores([
    record("procurement", { status: "closed" }),
    record("violations", { status: "open", createdAt: "2025-01-30T00:00:00.000Z" }),
    record("resident-reports", { status: "submitted", createdAt: "2025-01-01T00:00:00.000Z" }),
  ], NOW);
  assert.deepEqual(scores, [{
    development: "Development A",
    points: -5,
    scorePercent: 45,
    completed: 1,
    open: 1,
    overdue: 1,
    sampleSize: 3,
  }]);
});

test("development score includes inspections", () => {
  assert.deepEqual(calculateDevelopmentScores([
    record("inspections", {
      status: "completed",
      development: "Development A",
      createdAt: "2025-01-20T00:00:00.000Z",
    }),
  ], NOW), [{
    development: "Development A",
    points: 10,
    scorePercent: 60,
    completed: 1,
    open: 0,
    overdue: 0,
    sampleSize: 1,
  }]);
});

test("development score prefers the assigned development over a street address", () => {
  const [score] = calculateDevelopmentScores([
    record("procurement", {
      status: "submitted",
      address: "237 2185 3rd Ave NY NY 10067",
    }, "Jefferson"),
  ], NOW);
  assert.equal(score?.development, "Jefferson");
});

test("building and residential scores use resolved statuses and grouping fallbacks", () => {
  const records = [
    record("building-violations", { status: "resolved", building: "100 Main", createdAt: "2025-01-01T00:00:00.000Z" }),
    record("violations", { status: "open", building: "100 Main", createdAt: "2025-01-30T00:00:00.000Z" }),
    record("resident-reports", { status: "submitted", address: "200 Main", createdAt: "2025-01-01T00:00:00.000Z" }),
  ];
  assert.equal(calculateBuildingScores(records, NOW)[0]?.building, "100 Main");
  assert.equal(calculateBuildingScores(records, NOW)[0]?.resolved, 1);
  assert.deepEqual(calculateResidentialScores(records, NOW), [{
    address: "200 Main",
    score: -15,
    total: 1,
    resolved: 0,
    open: 0,
    overdue: 1,
    resolutionRate: 0,
  }]);
});

test("building and residential scores remain negative for unresolved work", () => {
  const records = [
    record("resident-reports", {
      status: "submitted",
      address: "2201 1st Avenue NY NY 10029",
      createdAt: "2025-01-30T00:00:00.000Z",
    }),
  ];
  assert.equal(calculateBuildingScores(records, NOW)[0]?.score, -5);
  assert.equal(calculateResidentialScores(records, NOW)[0]?.score, -5);
});

test("done work counts as completed and resolved", () => {
  const records = [
    record("building-violations", {
      status: "done",
      building: "2201 1st Avenue New York",
      createdAt: "2025-01-30T00:00:00.000Z",
    }, "Jefferson"),
  ];
  assert.equal(calculateDevelopmentScores(records, NOW)[0]?.completed, 1);
  assert.equal(calculateDevelopmentScores(records, NOW)[0]?.open, 0);
  assert.equal(calculateBuildingScores(records, NOW)[0]?.resolved, 1);
});

test("approved resident work counts as completed and resolved", () => {
  const records = [
    record("resident-reports", {
      status: "work_approved",
      address: "2201 1st Avenue New York, NY 10029",
    }, "Jefferson"),
  ];
  assert.equal(calculateDevelopmentScores(records, NOW)[0]?.completed, 1);
  assert.equal(calculateResidentialScores(records, NOW)[0]?.resolved, 1);
});

test("score grouping ignores case and repeated whitespace while preserving a display label", () => {
  const records = [
    record("building-violations", {
      status: "done",
      building: "2201 1st Avenue New York",
    }, "Jefferson"),
    record("building-violations", {
      status: "open",
      building: "  2201  1ST avenue new york ",
    }, "  JEFFERSON  "),
  ];
  const developmentScores = calculateDevelopmentScores(records, NOW);
  const buildingScores = calculateBuildingScores(records, NOW);
  assert.equal(developmentScores.length, 1);
  assert.equal(developmentScores[0]?.development, "Jefferson");
  assert.equal(developmentScores[0]?.sampleSize, 2);
  assert.equal(buildingScores.length, 1);
  assert.equal(buildingScores[0]?.building, "2201 1st Avenue New York");
  assert.equal(buildingScores[0]?.total, 2);
});

test("NYC address grouping treats common city and state variants as the same address", () => {
  const records = [
    record("resident-reports", {
      status: "work_approved",
      address: "2201 1st Avenue new ny, ny 10029",
    }, "Jefferson"),
    record("resident-reports", {
      status: "work_approved",
      address: "2201 1st Avenue New York, NY 10029",
    }, "Jefferson"),
    record("resident-reports", {
      status: "assigned",
      address: "2201 1st Avenue NY NY 10029",
    }, "Jefferson"),
    record("resident-reports", {
      status: "work_approved",
      address: "2201 1st Avenue New York, ny 10029",
    }, "Jefferson"),
    record("resident-reports", {
      status: "in_progress",
      address: "2201 1st Avenue New York, NY 10029",
    }, "Jefferson"),
  ];
  const [development] = calculateDevelopmentScores(records, NOW);
  const [building] = calculateBuildingScores(records, NOW);
  const [residential] = calculateResidentialScores(records, NOW);
  assert.equal(calculateBuildingScores(records, NOW).length, 1);
  assert.equal(calculateResidentialScores(records, NOW).length, 1);
  assert.equal(development?.completed, 3);
  assert.equal(development?.open, 2);
  assert.equal(development?.points, 20);
  assert.equal(building?.building, "2201 1st Avenue new ny, ny 10029");
  assert.equal(building?.total, 5);
  assert.equal(building?.resolved, 3);
  assert.equal(residential?.address, "2201 1st Avenue new ny, ny 10029");
  assert.equal(residential?.total, 5);
  assert.equal(residential?.resolved, 3);
});