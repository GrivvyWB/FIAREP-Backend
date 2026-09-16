import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "./auth";
import {
  canReadOwnedFile,
  isSafeTenantObjectPath,
  legacyFileOwnerCandidates,
} from "./fileStorage";

const actor: Actor = {
  id: "staff-1",
  tenantId: "tenant-1",
  name: "Property Manager",
  role: "management",
  position: "Property Manager",
  developments: ["Development A"],
  sessionVersion: 1,
};
const ownership = (overrides: Partial<{
  tenantId: string;
  objectPath: string;
  entity: string;
  recordId: string;
}> = {}) => ({
  tenantId: "tenant-1",
  objectPath: "/objects/tenants/tenant-1/rooms/file-1",
  entity: "rooms",
  recordId: "room-1",
  ...overrides,
});
const record = (overrides: Partial<{
  tenantId: string;
  id: string;
  entity: string;
  deleted: boolean;
  development: string | null;
  state: Record<string, unknown>;
}> = {}) => ({
  tenantId: "tenant-1",
  id: "room-1",
  entity: "rooms",
  development: "Development A",
  state: {},
  createdBy: "staff-1",
  deleted: false,
  ...overrides,
});

test("legacy ownership can be claimed only from one exact same-tenant reference", async () => {
  const path = ownership().objectPath;
  const legacy = record({
    state: { remoteFiles: [{ objectPath: path }] },
  });
  assert.equal(legacyFileOwnerCandidates([legacy], path).length, 1);
  assert.equal(legacyFileOwnerCandidates([record()], path).length, 0);
  assert.equal(
    legacyFileOwnerCandidates(
      [legacy, { ...legacy, id: "room-2" }],
      path,
    ).length,
    2,
  );
  const crossDevelopmentLegacy = record({
    development: "Development B",
    state: { remoteFiles: [{ objectPath: path }] },
  });
  assert.equal(legacyFileOwnerCandidates([crossDevelopmentLegacy], path).length, 1);
  assert.equal(
    await canReadOwnedFile(actor, path, ownership(), crossDevelopmentLegacy),
    false,
  );
  assert.equal(isSafeTenantObjectPath("tenant-1", path), true);
  assert.equal(isSafeTenantObjectPath("tenant-1", "/objects/tenants/tenant-2/file"), false);
  assert.equal(isSafeTenantObjectPath("tenant-1", `${path}/../other`), false);
});

test("immutable file ownership authorization enforces exact owner and development scope", async () => {
  const path = ownership().objectPath;
  assert.equal(await canReadOwnedFile(actor, path, ownership(), record()), true);
  assert.equal(
    await canReadOwnedFile(actor, path, ownership(), record({ development: "Development B" })),
    false,
  );
  assert.equal(
    await canReadOwnedFile(actor, path, ownership({ tenantId: "tenant-2" }), record()),
    false,
  );
  assert.equal(
    await canReadOwnedFile(actor, path, ownership({ recordId: "room-2" }), record()),
    false,
  );
  assert.equal(
    await canReadOwnedFile(actor, path, ownership(), record({ deleted: true })),
    false,
  );
  assert.equal(
    await canReadOwnedFile(
      actor,
      `${path}-unknown`,
      ownership(),
      record(),
    ),
    false,
  );
  assert.equal(
    await canReadOwnedFile(
      actor,
      path,
      ownership(),
      record({ state: { remoteFiles: [{ objectPath: "/objects/tenants/tenant-2/secret" }] } }),
    ),
    true,
    "mutable JSON references cannot change the immutable owner",
  );
});