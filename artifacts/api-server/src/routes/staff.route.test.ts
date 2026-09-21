import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";

test("development configuration and assignment remain tenant-scoped", {
  skip: !process.env["DATABASE_URL"],
}, async () => {
  process.env["SESSION_SECRET"] ||= "staff-route-test-secret";
  const [
    { default: app },
    { auditLog, db, entityRecords, organizations, staffAccounts },
    { signAccessToken },
  ] = await Promise.all([
    import("../app"),
    import("@workspace/db"),
    import("../lib/auth"),
  ]);

  const tenantId = `staff-route-${randomUUID()}`;
  const outsideTenantId = `staff-route-outside-${randomUUID()}`;
  const hrId = randomUUID();
  const workerId = randomUUID();
  const employeeId = randomUUID();
  const outsideEmployeeId = randomUUID();
  const employeeRecordId = randomUUID();

  await db.insert(organizations).values([
    {
      id: tenantId,
      name: "Staff Route Tenant",
      status: "active",
      unrestricted: true,
      features: { configuredDevelopments: ["Existing Development"] },
    },
    {
      id: outsideTenantId,
      name: "Outside Staff Route Tenant",
      status: "active",
      unrestricted: true,
      features: { configuredDevelopments: ["Outside Development"] },
    },
  ]);
  await db.insert(staffAccounts).values([
    {
      id: hrId,
      tenantId,
      name: "HR Reviewer",
      position: "HR Manager",
      role: "human_resources",
      code: "HR80",
      status: "approved",
      developments: [],
      sessionVersion: 1,
    },
    {
      id: workerId,
      tenantId,
      name: "Route Worker",
      position: "Maintenance Worker",
      role: "worker",
      code: "WK80",
      status: "approved",
      developments: ["Existing Development"],
      sessionVersion: 1,
    },
    {
      id: employeeId,
      tenantId,
      name: "Assigned Employee",
      position: "Maintenance Worker",
      role: "worker",
      code: "AE80",
      status: "approved",
      developments: ["Existing Development"],
      sessionVersion: 1,
    },
    {
      id: outsideEmployeeId,
      tenantId: outsideTenantId,
      name: "Outside Employee",
      position: "Maintenance Worker",
      role: "worker",
      code: "OE80",
      status: "approved",
      developments: ["Outside Development"],
      sessionVersion: 1,
    },
  ]);
  await db.insert(entityRecords).values({
    id: employeeRecordId,
    tenantId,
    entity: "hr-employee-records",
    development: "Existing Development",
    state: {
      status: "in_progress",
      employeeStaffId: employeeId,
      assignedDevelopments: ["Existing Development"],
    },
    createdBy: hrId,
  });

  const token = (input: {
    id: string;
    name: string;
    role: string;
    position: string;
    developments?: string[];
  }) => signAccessToken({
    tenantId,
    developments: [],
    sessionVersion: 1,
    ...input,
  });
  const hrToken = token({
    id: hrId,
    name: "HR Reviewer",
    role: "human_resources",
    position: "HR Manager",
  });
  const workerToken = token({
    id: workerId,
    name: "Route Worker",
    role: "worker",
    position: "Maintenance Worker",
    developments: ["Existing Development"],
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (
    method: "GET" | "POST" | "PUT",
    path: string,
    bearer: string,
    body?: Record<string, unknown>,
  ) => fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  try {
    const forbidden = await request("POST", "/v1/staff/developments", workerToken, {
      developments: ["Worker Development"],
    });
    assert.equal(forbidden.status, 403);

    const configured = await request("POST", "/v1/staff/developments", hrToken, {
      developments: [
        " Existing Development ",
        "Quoted, Development",
        "Quoted, Development",
      ],
    });
    assert.equal(configured.status, 200);
    assert.deepEqual(await configured.json(), [
      "Existing Development",
      "Quoted, Development",
    ]);

    const [tenant, outsideTenant] = await Promise.all([
      db.select({ features: organizations.features }).from(organizations)
        .where(eq(organizations.id, tenantId)).limit(1),
      db.select({ features: organizations.features }).from(organizations)
        .where(eq(organizations.id, outsideTenantId)).limit(1),
    ]);
    assert.deepEqual(tenant[0]?.features, {
      configuredDevelopments: ["Existing Development", "Quoted, Development"],
    });
    assert.deepEqual(outsideTenant[0]?.features, {
      configuredDevelopments: ["Outside Development"],
    });

    const available = await request("GET", "/v1/staff/developments", hrToken);
    assert.equal(available.status, 200);
    assert.deepEqual(await available.json(), [
      "Existing Development",
      "Quoted, Development",
    ]);

    const assigned = await request(
      "PUT",
      `/v1/staff/${employeeId}/developments`,
      hrToken,
      { developments: ["Quoted, Development"] },
    );
    assert.equal(assigned.status, 200);

    const [updatedStaff] = await db.select().from(staffAccounts)
      .where(eq(staffAccounts.id, employeeId));
    const [updatedRecord] = await db.select().from(entityRecords)
      .where(eq(entityRecords.id, employeeRecordId));
    assert.deepEqual(updatedStaff?.developments, ["Quoted, Development"]);
    assert.equal(updatedRecord?.development, "Quoted, Development");
    assert.deepEqual(updatedRecord?.state["assignedDevelopments"], ["Quoted, Development"]);

    const crossTenantAssignment = await request(
      "PUT",
      `/v1/staff/${outsideEmployeeId}/developments`,
      hrToken,
      { developments: ["Quoted, Development"] },
    );
    assert.equal(crossTenantAssignment.status, 404);
  } finally {
    server.close();
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId));
    await db.delete(entityRecords).where(inArray(
      entityRecords.tenantId,
      [tenantId, outsideTenantId],
    ));
    await db.delete(staffAccounts).where(inArray(
      staffAccounts.id,
      [hrId, workerId, employeeId, outsideEmployeeId],
    ));
    await db.delete(organizations).where(inArray(
      organizations.id,
      [tenantId, outsideTenantId],
    ));
  }
});