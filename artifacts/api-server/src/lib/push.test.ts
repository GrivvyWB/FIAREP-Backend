import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  db,
  deviceTokens,
  notifications,
  pool,
  pushDeliveries,
  staffAccounts,
} from "@workspace/db";
import { notify } from "./audit";
import type { Actor } from "./auth";
import { deliverPushNotification } from "./push";
import { residentReportRecipientIds } from "./notificationVisibility";

const realFetch = globalThis.fetch;
const PUSH_TEST_TENANT_PATTERN =
  "^push-test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

async function cleanupStalePushTestTenants(): Promise<void> {
  const isPushTestTenant = (tenantId: { name: string }) =>
    sql`${tenantId} ~ ${PUSH_TEST_TENANT_PATTERN}`;

  await db
    .delete(pushDeliveries)
    .where(isPushTestTenant(pushDeliveries.tenantId));
  await db.delete(notifications).where(isPushTestTenant(notifications.tenantId));
  await db.delete(deviceTokens).where(isPushTestTenant(deviceTokens.tenantId));
  await db.delete(staffAccounts).where(isPushTestTenant(staffAccounts.tenantId));
}

before(async () => {
  const expectedSchema = process.env.TEST_DATABASE_SCHEMA;
  assert.match(expectedSchema ?? "", /^integration_test_[a-z0-9_]+$/);
  const result = await pool.query<{ schema: string }>(
    "select current_schema() as schema",
  );
  assert.equal(
    result.rows[0]?.schema,
    expectedSchema,
    "Push integration tests refuse to run outside their disposable schema",
  );
  await cleanupStalePushTestTenants();
});

after(async () => {
  globalThis.fetch = realFetch;
  await pool.end();
});

function tenant(): string {
  return `push-test-${randomUUID()}`;
}

async function cleanup(tenantId: string): Promise<void> {
  await db.delete(pushDeliveries).where(eq(pushDeliveries.tenantId, tenantId));
  await db.delete(notifications).where(eq(notifications.tenantId, tenantId));
  await db.delete(deviceTokens).where(eq(deviceTokens.tenantId, tenantId));
  await db.delete(staffAccounts).where(eq(staffAccounts.tenantId, tenantId));
}

async function addStaff(
  tenantId: string,
  name: string,
  role: string,
  status = "approved",
): Promise<string> {
  const id = randomUUID();
  await db.insert(staffAccounts).values({
    id,
    tenantId,
    name,
    role,
    position: role,
    code: String(Math.floor(1000 + Math.random() * 9000)),
    status,
  });
  return id;
}

async function addToken(
  tenantId: string,
  staffId: string,
  label: string,
): Promise<{ id: string; token: string }> {
  const value = {
    id: randomUUID(),
    token: `ExpoPushToken[${label}-${randomUUID()}]`,
  };
  await db.insert(deviceTokens).values({
    ...value,
    tenantId,
    staffId,
    platform: "test",
  });
  return value;
}

async function addScopedStaff(
  tenantId: string,
  name: string,
  role: string,
  position: string,
  developments: string[],
): Promise<string> {
  const id = randomUUID();
  await db.insert(staffAccounts).values({
    id,
    tenantId,
    name,
    role,
    position,
    developments,
    code: String(Math.floor(1000 + Math.random() * 9000)),
    status: "approved",
  });
  return id;
}

function expoResponse(
  tickets: Array<Record<string, unknown>>,
): Response {
  return new Response(JSON.stringify({ data: tickets }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function deliveries(tenantId: string) {
  return db
    .select()
    .from(pushDeliveries)
    .where(eq(pushDeliveries.tenantId, tenantId));
}

async function waitFor(
  assertion: () => Promise<void>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

test("startup cleanup removes only abandoned push-test tenants", async () => {
  const staleTenantId = tenant();
  const normalTenantId = "push-test-customer";
  try {
    await addStaff(staleTenantId, "Stale Test Staff", "Inspector");
    const normalStaffId = await addStaff(
      normalTenantId,
      "Normal Staff",
      "Inspector",
    );

    await cleanupStalePushTestTenants();

    assert.equal(
      (
        await db
          .select()
          .from(staffAccounts)
          .where(eq(staffAccounts.tenantId, staleTenantId))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select()
          .from(staffAccounts)
          .where(eq(staffAccounts.id, normalStaffId))
      ).length,
      1,
    );
  } finally {
    await cleanup(staleTenantId);
    await cleanup(normalTenantId);
  }
});

test("routes name targets only within the tenant to approved staff", async () => {
  const tenantId = tenant();
  const otherTenant = tenant();
  try {
    const alice = await addStaff(tenantId, "Alice", "Inspector");
    const bob = await addStaff(tenantId, "Bob", "Inspector");
    const disabledAlice = await addStaff(
      tenantId,
      "Alice",
      "Inspector",
      "disabled",
    );
    const otherAlice = await addStaff(otherTenant, "Alice", "Inspector");
    const aliceToken = await addToken(tenantId, alice, "alice");
    await addToken(tenantId, bob, "bob");
    await addToken(tenantId, disabledAlice, "disabled");
    await addToken(otherTenant, otherAlice, "other-tenant");

    let sent: Array<{ to: string }> = [];
    globalThis.fetch = async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as Array<{ to: string }>;
      return expoResponse(sent.map(() => ({ status: "ok", id: randomUUID() })));
    };

    await deliverPushNotification({
      id: randomUUID(),
      tenantId,
      target: "Alice",
      message: "Assigned",
    });

    assert.deepEqual(sent.map((message) => message.to), [aliceToken.token]);
    assert.equal((await deliveries(tenantId)).length, 1);
  } finally {
    await cleanup(tenantId);
    await cleanup(otherTenant);
  }
});

test("role targets send once to every valid device and skip unrelated roles", async () => {
  const tenantId = tenant();
  try {
    const inspectorOne = await addStaff(tenantId, "One", "Inspector");
    const inspectorTwo = await addStaff(tenantId, "Two", "Inspector");
    const manager = await addStaff(tenantId, "Manager", "Administrator");
    const expected = [
      await addToken(tenantId, inspectorOne, "one-phone"),
      await addToken(tenantId, inspectorOne, "one-tablet"),
      await addToken(tenantId, inspectorTwo, "two-phone"),
    ];
    await addToken(tenantId, manager, "manager");

    let sent: Array<{ to: string }> = [];
    globalThis.fetch = async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as Array<{ to: string }>;
      return expoResponse(sent.map(() => ({ status: "ok", id: randomUUID() })));
    };

    await deliverPushNotification({
      id: randomUUID(),
      tenantId,
      target: "Inspector",
      message: "Role alert",
    });

    assert.deepEqual(
      sent.map((message) => message.to).sort(),
      expected.map(({ token }) => token).sort(),
    );
    assert.equal(new Set(sent.map((message) => message.to)).size, 3);
    assert.equal((await deliveries(tenantId)).length, 3);
  } finally {
    await cleanup(tenantId);
  }
});

test("records Expo rejection and removes DeviceNotRegistered tokens", async () => {
  const tenantId = tenant();
  try {
    const staffId = await addStaff(tenantId, "Team", "Worker");
    const accepted = await addToken(tenantId, staffId, "accepted");
    const rejected = await addToken(tenantId, staffId, "rejected");
    const invalid = await addToken(tenantId, staffId, "invalid");

    globalThis.fetch = async (_input, init) => {
      const messages = JSON.parse(String(init?.body)) as Array<{ to: string }>;
      return expoResponse(
        messages.map(({ to }) => {
          if (to === accepted.token) {
            return { status: "ok", id: randomUUID() };
          }
          if (to === invalid.token) {
            return {
              status: "error",
              message: "Device is not registered",
              details: { error: "DeviceNotRegistered" },
            };
          }
          assert.equal(to, rejected.token);
          return {
            status: "error",
            message: "Message is too large",
            details: { error: "MessageTooBig" },
          };
        }),
      );
    };

    await deliverPushNotification({
      id: randomUUID(),
      tenantId,
      target: "Worker",
      message: "Outcome test",
    });

    const rows = await deliveries(tenantId);
    assert.deepEqual(
      rows.map(({ status }) => status).sort(),
      ["accepted", "rejected", "rejected"],
    );
    assert.deepEqual(
      rows.map(({ errorCode }) => errorCode).filter(Boolean).sort(),
      ["DeviceNotRegistered", "MessageTooBig"],
    );
    assert.equal(
      (
        await db
          .select()
          .from(deviceTokens)
          .where(eq(deviceTokens.id, invalid.id))
      ).length,
      0,
    );
  } finally {
    await cleanup(tenantId);
  }
});

test("records request failures for each intended device", async () => {
  const tenantId = tenant();
  try {
    const staffId = await addStaff(tenantId, "Emergency Team", "Emergency");
    await addToken(tenantId, staffId, "phone");
    await addToken(tenantId, staffId, "tablet");
    globalThis.fetch = async () => {
      throw new Error("network unavailable");
    };

    await deliverPushNotification({
      id: randomUUID(),
      tenantId,
      target: "Emergency",
      message: "Network test",
    });

    const rows = await deliveries(tenantId);
    assert.equal(rows.length, 2);
    assert(rows.every(({ status }) => status === "request_failed"));
    assert(rows.every(({ errorCode }) => errorCode === "ExpoRequestFailed"));
  } finally {
    await cleanup(tenantId);
  }
});

test("notification creation triggers push delivery and logs no recipients", async () => {
  const tenantId = tenant();
  try {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      throw new Error("Expo should not be called without recipients");
    };
    const actor: Actor = {
      id: randomUUID(),
      tenantId,
      name: "Administrator",
      role: "Administrator",
      position: "Administrator",
      developments: [],
      sessionVersion: 1,
    };

    await notify(actor, "Missing Role", "No recipients");
    await waitFor(async () => {
      const rows = await deliveries(tenantId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, "no_recipients");
    });
    assert.equal(called, false);
  } finally {
    await cleanup(tenantId);
  }
});

test("notification creation persists an unambiguous staff target by id", async () => {
  const tenantId = tenant();
  try {
    const recipientId = await addStaff(tenantId, "Assigned Staff", "Worker");
    const actor: Actor = {
      id: randomUUID(),
      tenantId,
      name: "Administrator",
      role: "administrator",
      position: "Administrator",
      developments: [],
      sessionVersion: 1,
    };

    await notify(actor, "Assigned Staff", "Stable target");
    const rows = await db
      .select({ target: notifications.target })
      .from(notifications)
      .where(eq(notifications.tenantId, tenantId));
    assert.deepEqual(rows, [{ target: recipientId }]);
    await waitFor(async () => {
      const deliveryRows = await deliveries(tenantId);
      assert.equal(deliveryRows[0]?.status, "no_recipients");
    });
  } finally {
    await cleanup(tenantId);
  }
});

test("resident reports notify development supervision and Superintendent E", async () => {
  const tenantId = tenant();
  try {
    await addScopedStaff(
      tenantId, "Jefferson PM", "management", "Property Manager", ["Jefferson"],
    );
    const maintenanceSupervisor = await addScopedStaff(
      tenantId, "Jefferson Supervisor", "management", "Maintenance Supervisor", ["Jefferson"],
    );
    await addScopedStaff(
      tenantId, "Jefferson Regional", "management", "Regional Director", ["Jefferson"],
    );
    await addScopedStaff(
      tenantId, "Jefferson Admin", "administrator", "Director", ["Jefferson"],
    );
    await addScopedStaff(
      tenantId, "Borough Director", "administrator", "Borough Director", [],
    );
    const emergencySuperintendent = await addScopedStaff(
      tenantId,
      "Emergency Superintendent",
      "emergency",
      "Superintendent Ⓔ",
      ["Adams"],
    );
    await addScopedStaff(
      tenantId, "Adams PM", "management", "Property Manager", ["Adams"],
    );
    await addScopedStaff(
      tenantId, "Unscoped Director", "administrator", "Director", [],
    );

    const recipients = await residentReportRecipientIds(tenantId, "Jefferson");
    assert.deepEqual(new Set(recipients), new Set([
      maintenanceSupervisor,
      emergencySuperintendent,
    ]));
  } finally {
    await cleanup(tenantId);
  }
});