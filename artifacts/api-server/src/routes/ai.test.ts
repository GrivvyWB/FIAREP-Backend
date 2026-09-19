import assert from "node:assert/strict";
import test from "node:test";
import { hasSavedResidentPhotoScan } from "./ai";

test("resident complaint photo analysis locks after its first saved result", () => {
  const state = {
    aiPhotoScans: {
      "photo-1": {
        classification: "B",
        confidence: 92,
      },
    },
  };

  assert.equal(hasSavedResidentPhotoScan(state, "photo-1"), true);
  assert.equal(hasSavedResidentPhotoScan(state, "photo-2"), false);
});

test("resident complaint photo analysis remains available without a saved result", () => {
  assert.equal(hasSavedResidentPhotoScan({}, "photo-1"), false);
  assert.equal(hasSavedResidentPhotoScan({ aiPhotoScans: [] }, "photo-1"), false);
});