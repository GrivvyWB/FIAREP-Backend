import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

test("HR-first employee intake enforces handoff boundaries", {
  skip: !process.env["DATABASE_URL"],
}, async () => {
  process.env["SESSION_SECRET"] ||= "hr-intake-route-test-secret";
  const [
    { default: app },
    { db, auditLog, entityRecords, organizations, staffAccounts },
    { signAccessToken },
    { ReplitConnectors },
  ] = await Promise.all([
    import("../app"),
    import("@workspace/db"),
    import("../lib/auth"),
    import("@replit/connectors-sdk"),
  ]);

  const tenantId = `hr-intake-${randomUUID()}`;
  const outsideTenantId = `hr-intake-outside-${randomUUID()}`;
  const hrId = randomUUID();
  const workerId = randomUUID();
  const outsideHrId = randomUUID();
  const recordIds = {
    normal: randomUUID(),
    outside: randomUUID(),
    invalidDevelopment: randomUUID(),
    duplicateExisting: randomUUID(),
    duplicateAttempt: randomUUID(),
    concurrent: randomUUID(),
    limited: randomUUID(),
  };
  const createdStaffIds: string[] = [];
  const oldCodeStaffId = randomUUID();
  const oldIssuedAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1);
  const replacementStaffId = randomUUID();
  const replacementIssuedAt = new Date(Date.now() - 60_000);

  const employeeState = (
    firstName: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    status: "draft",
    firstName,
    lastName: "Employee",
    email: `${firstName.toLowerCase()}@example.test`,
    role: "worker",
    position: "Maintenance Worker",
    assignedDevelopments: ["Development A"],
    ...overrides,
  });

  await db.insert(organizations).values([
    {
      id: tenantId,
      name: "HR Intake Tenant",
      status: "active",
      unrestricted: true,
      staffLimit: 50,
      features: { configuredDevelopments: ["Development A"] },
    },
    {
      id: outsideTenantId,
      name: "Outside HR Intake Tenant",
      status: "active",
      unrestricted: true,
      staffLimit: 50,
      features: { configuredDevelopments: ["Development A"] },
    },
  ]);
  await db.insert(staffAccounts).values([
    {
      id: hrId,
      tenantId,
      name: "HR Intake Reviewer",
      position: "HR Manager",
      role: "human_resources",
      code: "HR60",
      status: "approved",
      developments: [],
      sessionVersion: 1,
    },
    {
      id: workerId,
      tenantId,
      name: "Existing Worker",
      position: "Maintenance Worker",
      role: "worker",
      code: "WK60",
      status: "approved",
      developments: ["Development A"],
      sessionVersion: 1,
    },
    {
      id: outsideHrId,
      tenantId: outsideTenantId,
      name: "Outside HR",
      position: "HR Manager",
      role: "human_resources",
      code: "OH60",
      status: "approved",
      developments: [],
      sessionVersion: 1,
    },
    {
      id: oldCodeStaffId,
      tenantId,
      name: "Expired Code Employee",
      firstName: "Expired",
      lastName: "Employee",
      position: "Maintenance Worker",
      role: "worker",
      code: "OLD1",
      codeIssuedAt: oldIssuedAt,
      status: "approved",
      developments: ["Development A"],
      sessionVersion: 1,
    },
    {
      id: replacementStaffId,
      tenantId,
      name: "Replacement Employee",
      firstName: "Replacement",
      lastName: "Employee",
      position: "Maintenance Worker",
      role: "worker",
      code: "KEEP",
      codeIssuedAt: replacementIssuedAt,
      status: "approved",
      developments: ["Development A"],
      sessionVersion: 7,
    },
  ]);
  await db.insert(entityRecords).values([
    {
      id: recordIds.normal,
      tenantId,
      entity: "hr-employee-records",
      state: employeeState("Normal"),
      createdBy: hrId,
    },
    {
      id: recordIds.outside,
      tenantId: outsideTenantId,
      entity: "hr-employee-records",
      state: employeeState("Outside"),
      createdBy: outsideHrId,
    },
    {
      id: recordIds.invalidDevelopment,
      tenantId,
      entity: "hr-employee-records",
      state: employeeState("Invalid", { assignedDevelopments: ["Unconfigured"] }),
      createdBy: hrId,
    },
    {
      id: recordIds.duplicateExisting,
      tenantId,
      entity: "hr-employee-records",
      state: employeeState("Existing", { employeeNumber: "EMP-60", status: "in_progress" }),
      createdBy: hrId,
    },
    {
      id: recordIds.duplicateAttempt,
      tenantId,
      entity: "hr-employee-records",
      state: employeeState("Duplicate"),
      createdBy: hrId,
    },
    {
      id: recordIds.concurrent,
      tenantId,
      entity: "hr-employee-records",
      state: employeeState("Concurrent"),
      createdBy: hrId,
    },
    {
      id: recordIds.limited,
      tenantId,
      entity: "hr-employee-records",
      state: employeeState("Limited"),
      createdBy: hrId,
    },
    {
      id: `expired-record-${randomUUID()}`,
      tenantId,
      entity: "hr-employee-records",
      state: employeeState("Expired", {
        status: "in_progress",
        employeeNumber: "EMP-OLD",
        employeeStaffId: oldCodeStaffId,
      }),
      createdBy: hrId,
    },
    {
      id: `replacement-record-${randomUUID()}`,
      tenantId,
      entity: "hr-employee-records",
      state: employeeState("Replacement", {
        status: "in_progress",
        employeeNumber: "EMP-KEEP",
        employeeStaffId: replacementStaffId,
      }),
      createdBy: hrId,
    },
  ]);

  const token = (input: {
    id: string;
    tenantId?: string;
    name: string;
    role: string;
    position: string;
    developments?: string[];
    sessionVersion?: number;
  }) => signAccessToken({
    tenantId,
    developments: [],
    sessionVersion: 1,
    ...input,
  });
  const hrToken = token({
    id: hrId,
    name: "HR Intake Reviewer",
    role: "human_resources",
    position: "HR Manager",
  });
  const workerToken = token({
    id: workerId,
    name: "Existing Worker",
    role: "worker",
    position: "Maintenance Worker",
    developments: ["Development A"],
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (
    path: string,
    bearer: string,
    body: Record<string, unknown> = {},
  ) => fetch(`${base}/api${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const complete = (id: string, employeeNumber: string, bearer = hrToken) =>
    post(`/v1/hr/employee-records/${id}/complete`, bearer, { employeeNumber });

  const originalProxy = ReplitConnectors.prototype.proxy;
  try {
    const forbidden = await complete(recordIds.normal, "EMP-NORMAL", workerToken);
    assert.equal(forbidden.status, 403);

    const crossTenant = await complete(recordIds.outside, "EMP-OUTSIDE");
    assert.equal(crossTenant.status, 404);

    const directTeamCreate = await post("/v1/staff", hrToken, {
      name: "Bypass Employee",
      role: "worker",
      position: "Maintenance Worker",
      developments: ["Development A"],
    });
    assert.equal(directTeamCreate.status, 403);

    const preCompletionStaff = await db.select({ id: staffAccounts.id })
      .from(staffAccounts)
      .where(and(
        eq(staffAccounts.tenantId, tenantId),
        eq(staffAccounts.name, "Normal Employee"),
      ));
    assert.equal(preCompletionStaff.length, 0);

    const invalidDevelopment = await complete(recordIds.invalidDevelopment, "EMP-INVALID");
    assert.equal(invalidDevelopment.status, 400);

    const duplicate = await complete(recordIds.duplicateAttempt, "emp-60");
    assert.equal(duplicate.status, 409);

    const [concurrentA, concurrentB] = await Promise.all([
      complete(recordIds.concurrent, "EMP-CONCURRENT"),
      complete(recordIds.concurrent, "EMP-CONCURRENT"),
    ]);
    assert.deepEqual(
      [concurrentA.status, concurrentB.status].sort((a, b) => a - b),
      [200, 409],
    );
    const concurrentStaff = await db.select().from(staffAccounts).where(and(
      eq(staffAccounts.tenantId, tenantId),
      eq(staffAccounts.name, "Concurrent Employee"),
    ));
    assert.equal(concurrentStaff.length, 1);
    createdStaffIds.push(concurrentStaff[0]!.id);

    const tenantStaff = await db.select({ id: staffAccounts.id })
      .from(staffAccounts)
      .where(eq(staffAccounts.tenantId, tenantId));
    await db.update(organizations).set({ staffLimit: tenantStaff.length })
      .where(eq(organizations.id, tenantId));
    const limited = await complete(recordIds.limited, "EMP-LIMITED");
    assert.equal(limited.status, 403);
    await db.update(organizations).set({ staffLimit: 50 })
      .where(eq(organizations.id, tenantId));

    const completed = await complete(recordIds.normal, "EMP-NORMAL");
    assert.equal(completed.status, 200);
    const completedBody = await completed.json() as { staffId: string; code: string };
    assert.ok(completedBody.staffId);
    assert.ok(completedBody.code);
    createdStaffIds.push(completedBody.staffId);

    const [normalRecord] = await db.select().from(entityRecords)
      .where(eq(entityRecords.id, recordIds.normal));
    assert.equal(normalRecord?.state["employeeStaffId"], completedBody.staffId);
    assert.equal(normalRecord?.state["employeeNumber"], "EMP-NORMAL");

    const workspace = await fetch(`${base}/api/v1/hr/workspace`, {
      headers: { authorization: `Bearer ${hrToken}` },
    });
    assert.equal(workspace.status, 200);
    const workspaceBody = await workspace.json() as {
      staff: Array<{ id: string; code?: string; codeVisibleUntil?: string }>;
    };
    const fresh = workspaceBody.staff.find((row) => row.id === completedBody.staffId);
    const expired = workspaceBody.staff.find((row) => row.id === oldCodeStaffId);
    assert.equal(fresh?.code, completedBody.code);
    assert.ok(fresh?.codeVisibleUntil);
    assert.equal(expired?.code, undefined);
    assert.ok(expired?.codeVisibleUntil);
    assert.ok(new Date(expired!.codeVisibleUntil!).getTime() <= Date.now());

    ReplitConnectors.prototype.proxy = async () =>
      new Response(null, { status: 503 });
    const replacement = await post(
      `/v1/staff/${replacementStaffId}/reset-code`,
      hrToken,
    );
    assert.equal(replacement.status, 502);
    const [restored] = await db.select().from(staffAccounts)
      .where(eq(staffAccounts.id, replacementStaffId));
    assert.equal(restored?.code, "KEEP");
    assert.equal(restored?.sessionVersion, 7);
    assert.equal(restored?.codeIssuedAt?.getTime(), replacementIssuedAt.getTime());
  } finally {
    ReplitConnectors.prototype.proxy = originalProxy;
    server.close();
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId));
    await db.delete(entityRecords).where(inArray(
      entityRecords.tenantId,
      [tenantId, outsideTenantId],
    ));
    await db.delete(staffAccounts).where(inArray(staffAccounts.id, [
      hrId,
      workerId,
      outsideHrId,
      oldCodeStaffId,
      replacementStaffId,
      ...createdStaffIds,
    ]));
    await db.delete(organizations).where(inArray(
      organizations.id,
      [tenantId, outsideTenantId],
    ));
  }
});