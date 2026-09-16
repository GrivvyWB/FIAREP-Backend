import assert from "node:assert/strict";
import test from "node:test";
import {
  addOrganizationNameForDevelopmentType,
  getConfiguredDevelopmentNames,
} from "./organizationDevelopments";

test("adds the client name when its organization type is Development", () => {
  const features = addOrganizationNameForDevelopmentType(
    { organizationType: " Development ", configuredDevelopments: ["Existing"] },
    "Jefferson",
  );

  assert.deepEqual(getConfiguredDevelopmentNames(features), ["Existing", "Jefferson"]);
});

test("does not add the client name for other organization types", () => {
  const features = addOrganizationNameForDevelopmentType(
    { organizationType: "Property Management", configuredDevelopments: ["Existing"] },
    "Jefferson",
  );

  assert.deepEqual(getConfiguredDevelopmentNames(features), ["Existing"]);
});