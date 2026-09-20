import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVELOPMENT_ROTATION_MS,
  getComplaintPulseLevel,
  getDevelopmentPageCount,
  getVisibleDevelopmentPage,
  updateDevelopmentPage,
} from "./complaint-dashboard-rotation.ts";

test("splits every active development into complete groups of 10", () => {
  const developments = Array.from({ length: 25 }, (_, index) => index + 1);

  assert.equal(getDevelopmentPageCount(developments.length), 3);
  assert.deepEqual(getVisibleDevelopmentPage(developments, 0), developments.slice(0, 10));
  assert.deepEqual(getVisibleDevelopmentPage(developments, 1), developments.slice(10, 20));
  assert.deepEqual(getVisibleDevelopmentPage(developments, 2), developments.slice(20, 25));
  assert.equal(new Set([
    ...getVisibleDevelopmentPage(developments, 0),
    ...getVisibleDevelopmentPage(developments, 1),
    ...getVisibleDevelopmentPage(developments, 2),
  ]).size, 25);
});

test("uses a 30 minute interval and advances before wrapping to the first group", () => {
  assert.equal(DEVELOPMENT_ROTATION_MS, 30 * 60 * 1000);
  assert.equal(updateDevelopmentPage(0, { type: "next", pageCount: 3 }), 1);
  assert.equal(updateDevelopmentPage(1, { type: "next", pageCount: 3 }), 2);
  assert.equal(updateDevelopmentPage(2, { type: "next", pageCount: 3 }), 0);
});

test("previous and next navigation update immediately and wrap", () => {
  assert.equal(updateDevelopmentPage(1, { type: "previous", pageCount: 3 }), 0);
  assert.equal(updateDevelopmentPage(0, { type: "previous", pageCount: 3 }), 2);
  assert.equal(updateDevelopmentPage(1, { type: "next", pageCount: 3 }), 2);
});

test("filter changes reset and complaint-count changes clamp the current group", () => {
  assert.equal(updateDevelopmentPage(2, { type: "filtersChanged" }), 0);
  assert.equal(updateDevelopmentPage(2, { type: "countChanged", pageCount: 2 }), 1);
  assert.equal(updateDevelopmentPage(1, { type: "countChanged", pageCount: 1 }), 0);
  assert.equal(updateDevelopmentPage(0, { type: "countChanged", pageCount: 4 }), 0);
});

test("pulse thresholds do not alter navigation", () => {
  assert.equal(getComplaintPulseLevel(9), "standard");
  assert.equal(getComplaintPulseLevel(10), "orange");
  assert.equal(getComplaintPulseLevel(19), "orange");
  assert.equal(getComplaintPulseLevel(20), "red");

  assert.equal(updateDevelopmentPage(1, { type: "next", pageCount: 3 }), 2);
});