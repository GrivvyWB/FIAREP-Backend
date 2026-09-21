import assert from "node:assert/strict";
import test from "node:test";
import { developmentNamesFromCsv } from "./development-csv";

test("development CSV parsing handles reordered, quoted, and duplicate names", () => {
  const names = developmentNamesFromCsv([
    "Borough,Development Name,Code",
    'Queens,"Quoted, Development",QD1',
    'Brooklyn,"Name with ""quotes""",NQ1',
    'Queens,"Quoted, Development",QD2',
  ].join("\n"));

  assert.deepEqual(names, [
    "Quoted, Development",
    'Name with "quotes"',
  ]);
});