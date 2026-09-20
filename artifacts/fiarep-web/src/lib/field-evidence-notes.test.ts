import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldEvidenceNotes } from "./field-evidence-notes.ts";

test("returns a staff completion note with its author and timestamp", () => {
  assert.deepEqual(extractFieldEvidenceNotes({
    completionNote: "Elevator reset and operating normally.",
    completedByStaffName: "Mark D",
    completedAt: "2026-09-20T18:51:29.000Z",
  }), [{
    text: "Elevator reset and operating normally.",
    by: "Mark D",
    at: "2026-09-20T18:51:29.000Z",
  }]);
});

test("returns release updates sent back to a supervisor", () => {
  assert.deepEqual(extractFieldEvidenceNotes({
    updates: [{
      action: "release",
      staffName: "Mark D",
      update: "Needs an elevator contractor.",
      at: "2026-09-20T18:51:29.000Z",
    }],
  }), [{
    text: "Needs an elevator contractor.",
    by: "Mark D",
    at: "2026-09-20T18:51:29.000Z",
  }]);
});

test("does not duplicate a synced completion note or show the automatic start entry", () => {
  assert.deepEqual(extractFieldEvidenceNotes({
    completionNote: "Completed repair.",
    completedByStaffName: "Mark D",
    updates: [
      { note: "Started job", by: "Mark D" },
      { note: "Completed repair.", by: "Mark D" },
    ],
  }), [{
    text: "Completed repair.",
    by: "Mark D",
  }]);
});