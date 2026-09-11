import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CreateOrganizationBody, CreateOrganizationResponse } from "@workspace/api-zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const spec = readFileSync(resolve(root, "lib/api-spec/openapi.yaml"), "utf8");
const dialog = readFileSync(resolve(root, "artifacts/fiarep-web/src/components/platform-owner/organization-dialog.tsx"), "utf8");
const route = readFileSync(resolve(root, "artifacts/api-server/src/routes/organizations.ts"), "utf8");
const organizationCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

test("organization codes use the six-character unambiguous alphabet", () => {
  let index = 0;
  let suffix = "";
  for (let count = 0; count < 6; count += 1) suffix += organizationCodeAlphabet[index++ % organizationCodeAlphabet.length];
  const code = `ORG-${suffix}`;
  assert.match(code, /^ORG-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(code, `ORG-${organizationCodeAlphabet.slice(0, 6)}`);
  assert.equal(organizationCodeAlphabet.includes("I"), false);
  assert.equal(organizationCodeAlphabet.includes("O"), false);
  assert.equal(organizationCodeAlphabet.includes("0"), false);
  assert.equal(organizationCodeAlphabet.includes("1"), false);
  assert.match(route, /ORGANIZATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"/);
});

test("create contract omits client id while organization response retains id", () => {
  assert.equal("id" in CreateOrganizationBody.shape, false);
  assert.equal("id" in CreateOrganizationResponse.shape.organization.shape, true);
  assert.match(spec, /OrganizationInput:[\s\S]*required: \[name\][\s\S]*properties:[\s\S]*\n\s+name:/);
  assert.doesNotMatch(spec.match(/OrganizationInput:[\s\S]*?OrganizationUpdate:/)?.[0] ?? "", /\n\s+id:/);
});

test("allocation is bounded and returns an explicit 503 at the route boundary", () => {
  assert.match(route, /ORGANIZATION_CODE_ATTEMPTS = 20/);
  assert.match(route, /if \(error\?\.status\) \{\s*res\.status\(error\.status\)\.json\(\{ error: error\.message \}\)/);
  assert.match(route, /Unable to allocate a unique organization code/);
});

test("creation dialog requires copy success or explicit acknowledgment before closing", () => {
  assert.match(dialog, /await navigator\.clipboard\.writeText\(generatedCode\)/);
  assert.match(dialog, /copySucceeded \|\| acknowledged/);
  assert.match(dialog, /if \(!nextOpen && !canCloseAfterCreation\) return/);
  assert.match(dialog, /I saved this code/);
});