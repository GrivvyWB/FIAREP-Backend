import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

test("HR exit approval route consumes approval and revokes linked staff atomically", {
  skip: !process.env["DATABASE_URL"],
}, async () => {
  process.env["SESSION_SECRET"] ||= "route-test-session-secret";
  const [{ default: app }, { db, auditLog, entityRecords, organizations, staffAccounts }, { signAccessToken }] =
    await Promise.all([
      import("../app"),
      import("@workspace/db"),
      import("../lib/auth"),
    ]);

  const tenantId = `route-test-${randomUUID()}`;
  const actorId = randomUUID();
  const employeeId = randomUUID();
  const targetId = randomUUID();
  const approvalId = randomUUID();
  const pendingApprovalId = randomUUID();
  const guessEmployeeId = randomUUID();
  const guessTargetId = randomUUID();
  const guessApprovalId = randomUUID();
  const unrelatedAuditId = randomUUID();
  const payTargetId = randomUUID();
  const disciplineTargetId = randomUUID();
  const administratorId = randomUUID();
  const leaveAdminId = randomUUID();
  const leaveWorkerId = randomUUID();
  const leaveManagementId = randomUUID();
  const leaveHrShortId = randomUUID();
  const leaveHrLongId = randomUUID();
  const createdLeaveIds: string[] = [];
  const supervisorId = randomUUID();
  const inScopeEmployeeId = randomUUID();
  const outOfScopeEmployeeId = randomUUID();
  const inScopeRecordId = randomUUID();
  const outOfScopeRecordId = randomUUID();
  const outsideRecordId = randomUUID();
  const outsideTenantId = `route-test-outside-${randomUUID()}`;
  const actorToken = signAccessToken({
    id: actorId,
    tenantId,
    name: "HR Reviewer",
    role: "human_resources",
    position: "HR Manager",
    developments: [],
    sessionVersion: 1,
  });
  const employeeToken = signAccessToken({
    id: employeeId,
    tenantId,
    name: "Departing Employee",
    role: "worker",
    position: "Worker",
    developments: ["Development A"],
    sessionVersion: 7,
  });

  await db.insert(organizations).values([
    { id: tenantId, name: "Route Test Tenant", status: "active", unrestricted: true, features: {} },
    { id: outsideTenantId, name: "Outside Tenant", status: "active", unrestricted: true, features: {} },
  ]);
  await db.insert(staffAccounts).values([
    {
      id: actorId,
      tenantId,
      name: "HR Reviewer",
      position: "HR Manager",
      role: "human_resources",
      code: "HR12",
      status: "approved",
      developments: [],
      sessionVersion: 1,
    },
    {
      id: employeeId,
      tenantId,
      name: "Departing Employee",
      position: "Worker",
      role: "worker",
      code: "EM12",
      status: "approved",
      developments: ["Development A"],
      sessionVersion: 7,
    },
    {
      id: guessEmployeeId,
      tenantId,
      name: "Guess Target Employee",
      position: "Worker",
      role: "worker",
      code: "GU12",
      status: "approved",
      developments: ["Development A"],
      sessionVersion: 3,
    },
    {
      id: supervisorId,
      tenantId,
      name: "Development Supervisor",
      position: "Property Manager",
      role: "management",
      code: "MG12",
      status: "approved",
      developments: ["Development A"],
      sessionVersion: 1,
    },
    {
      id: administratorId,
      tenantId,
      name: "Administrator",
      position: "Administrator",
      role: "administrator",
      code: "AD12",
      status: "approved",
      developments: [],
      sessionVersion: 1,
    },
    {
      id: inScopeEmployeeId,
      tenantId,
      name: "In Scope Employee",
      position: "Worker",
      role: "worker",
      code: "IN12",
      status: "approved",
      developments: ["Development A"],
      sessionVersion: 1,
    },
    {
      id: outOfScopeEmployeeId,
      tenantId,
      name: "Out of Scope Employee",
      position: "Worker",
      role: "worker",
      code: "OU12",
      status: "approved",
      developments: ["Development B"],
      sessionVersion: 1,
    },
  ]);
  await db.insert(entityRecords).values([
    {
      id: targetId,
      tenantId,
      entity: "hr-exits",
      createdBy: actorId,
      state: {
        status: "in_progress",
        employeeStaffId: employeeId,
        exitType: "termination",
        title: "Departure",
      },
      version: 1,
    },
    {
      id: approvalId,
      tenantId,
      entity: "hr-approvals",
      createdBy: randomUUID(),
      state: {
        status: "Approved",
        targetRecordId: targetId,
        employeeStaffId: employeeId,
        approvalPurpose: "termination",
      },
      version: 1,
    },
    {
      id: pendingApprovalId,
      tenantId,
      entity: "hr-approvals",
      createdBy: supervisorId,
      state: {
        status: "pending",
        targetRecordId: inScopeRecordId,
        employeeStaffId: inScopeEmployeeId,
        approvalPurpose: "termination",
      },
      version: 1,
    },
    {
      id: guessTargetId,
      tenantId,
      entity: "hr-exits",
      createdBy: actorId,
      state: {
        status: "in_progress",
        employeeStaffId: guessEmployeeId,
        exitType: "termination",
        title: "Guess target",
      },
      version: 1,
    },
    {
      id: guessApprovalId,
      tenantId,
      entity: "hr-approvals",
      createdBy: randomUUID(),
      state: {
        status: "Approved",
        targetRecordId: guessTargetId,
        employeeStaffId: guessEmployeeId,
        approvalPurpose: "termination",
      },
      version: 1,
    },
    {
      id: payTargetId,
      tenantId,
      entity: "hr-payroll-benefits",
      createdBy: actorId,
      state: { status: "in_progress", employeeStaffId: employeeId, title: "Pay target" },
      version: 1,
    },
    {
      id: disciplineTargetId,
      tenantId,
      entity: "hr-discipline",
      createdBy: actorId,
      state: { status: "in_progress", employeeStaffId: employeeId, title: "Discipline target" },
      version: 1,
    },
    {
      id: outsideRecordId,
      tenantId: outsideTenantId,
      entity: "hr-exits",
      createdBy: randomUUID(),
      state: { status: "in_progress", employeeStaffId: employeeId, exitType: "termination" },
      version: 1,
    },
    {
      id: inScopeRecordId,
      tenantId,
      entity: "hr-employee-records",
      createdBy: supervisorId,
      development: "Development A",
      state: { status: "in_progress", employeeStaffId: inScopeEmployeeId, title: "In scope" },
      version: 1,
    },
    {
      id: outOfScopeRecordId,
      tenantId,
      entity: "hr-employee-records",
      createdBy: supervisorId,
      development: "Development B",
      state: { status: "in_progress", employeeStaffId: outOfScopeEmployeeId, title: "Out of scope" },
      version: 1,
    },
    ...[
      [leaveAdminId, employeeId, "2026-09-01", "2026-09-14"],
      [leaveWorkerId, employeeId, "2026-09-01", "2026-09-14"],
      [leaveManagementId, employeeId, "2026-09-01", "2026-09-14"],
      [leaveHrShortId, employeeId, "2026-09-01", "2026-09-14"],
      [leaveHrLongId, employeeId, "2026-09-01", "2026-09-30"],
    ].map(([id, linkedEmployeeId, startDate, endDate]) => ({
      id: id as string,
      tenantId,
      entity: "leave-requests",
      development: "Development A",
      createdBy: linkedEmployeeId as string,
      state: {
        status: "pending",
        employeeStaffId: linkedEmployeeId,
        employee: "Departing Employee",
        startDate,
        endDate,
      },
      version: 1,
    })),
  ]);
  await db.insert(auditLog).values({
    id: unrelatedAuditId,
    tenantId,
    actorRole: "management",
    actorName: "Property Manager",
    action: "procurement.updated",
    detail: "Sensitive procurement pricing must not leak into HR",
    reportId: targetId,
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const request = (body?: Record<string, unknown>) => fetch(
      `${base}/api/v1/hr-exits/${targetId}/actions/approve-termination`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${actorToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body || {}),
      },
    );
    const supervisorToken = signAccessToken({
      id: supervisorId,
      tenantId,
      name: "Development Supervisor",
      role: "management",
      position: "Property Manager",
      developments: ["Development A"],
      sessionVersion: 1,
    });
    const administratorToken = signAccessToken({
      id: administratorId,
      tenantId,
      name: "Administrator",
      role: "administrator",
      position: "Administrator",
      developments: [],
      sessionVersion: 1,
    });
    const workerToken = signAccessToken({
      id: employeeId,
      tenantId,
      name: "Departing Employee",
      role: "worker",
      position: "Worker",
      developments: ["Development A"],
      sessionVersion: 7,
    });
    const createLeave = (token: string, state: Record<string, unknown>) =>
      fetch(`${base}/api/v1/leave-requests`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ state }),
      });
    const impersonation = await createLeave(workerToken, {
      employeeStaffId: guessEmployeeId,
      employee: "Guess Target Employee",
      development: "Development A",
      startAt: "2026-10-01T09:00",
      endAt: "2026-10-02T17:00",
      returnAt: "2026-10-03T09:00",
    });
    assert.equal(impersonation.status, 201);
    const impersonationBody = await impersonation.json() as {
      id: string;
      state: { employeeStaffId: string; employee: string };
    };
    createdLeaveIds.push(impersonationBody.id);
    assert.equal(impersonationBody.state.employeeStaffId, employeeId);
    assert.equal(impersonationBody.state.employee, "Departing Employee");
    const invalidOrdering = await createLeave(workerToken, {
      startAt: "2026-10-04T17:00",
      development: "Development A",
      endAt: "2026-10-04T16:00",
      returnAt: "2026-10-04T17:00",
    });
    assert.equal(invalidOrdering.status, 400);
    const invalidReturn = await createLeave(workerToken, {
      startAt: "2026-10-05T09:00",
      development: "Development A",
      endAt: "2026-10-05T17:00",
      returnAt: "2026-10-05T16:00",
    });
    assert.equal(invalidReturn.status, 400);
    const ambiguousTarget = await createLeave(actorToken, {
      employee: "Not An Approved Employee",
      development: "Development A",
      startAt: "2026-10-06T09:00",
      endAt: "2026-10-06T17:00",
      returnAt: "2026-10-07T09:00",
    });
    assert.equal(ambiguousTarget.status, 400);
    const leaveAction = (token: string, id: string, body?: Record<string, unknown>) =>
      fetch(`${base}/api/v1/leave-requests/${id}/actions/approve`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body || {}),
      });
    const sensitiveActions = [
      ["hr-payroll-benefits", payTargetId, "approve-pay-change"],
      ["hr-discipline", disciplineTargetId, "approve-discipline"],
      ["hr-exits", targetId, "approve-termination"],
      ["hr-exits", targetId, "approve-layoff"],
    ];
    const workspace = await fetch(`${base}/api/v1/hr/workspace`, {
      headers: { authorization: `Bearer ${supervisorToken}` },
    });
    assert.equal(workspace.status, 200);
    const workspaceBody = await workspace.json() as {
      records: Array<{ id: string }>;
      staff: Array<{ id: string }>;
    };
    assert.equal(workspaceBody.records.some((row) => row.id === inScopeRecordId), true);
    assert.equal(workspaceBody.records.some((row) => row.id === outOfScopeRecordId), false);
    assert.equal(workspaceBody.staff.some((row) => row.id === supervisorId), false);
    assert.equal(workspaceBody.staff.some((row) => row.id === inScopeEmployeeId), true);
    assert.equal(workspaceBody.staff.some((row) => row.id === outOfScopeEmployeeId), false);
    const hrWorkspace = await fetch(`${base}/api/v1/hr/workspace`, {
      headers: { authorization: `Bearer ${actorToken}` },
    });
    assert.equal(hrWorkspace.status, 200);
    const hrWorkspaceBody = await hrWorkspace.json() as { records: Array<{ id: string }> };
    assert.equal(hrWorkspaceBody.records.some((row) => row.id === outsideRecordId), false);
    const sync = await fetch(
      `${base}/api/v1/sync?since=1970-01-01T00:00:00.000Z&entities=hr-employee-records,hr-approvals`,
      { headers: { authorization: `Bearer ${supervisorToken}` } },
    );
    assert.equal(sync.status, 200);
    const syncBody = await sync.json() as { records: Array<{ id: string }> };
    assert.equal(syncBody.records.some((row) => row.id === inScopeRecordId), true);
    assert.equal(syncBody.records.some((row) => row.id === pendingApprovalId), true);
    assert.equal(syncBody.records.some((row) => row.id === outOfScopeRecordId), false);
    assert.equal(syncBody.records.some((row) => row.id === approvalId), false);
    const deleteAttempt = await fetch(`${base}/api/v1/hr-employee-records/${inScopeRecordId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: 1 }),
    });
    assert.equal(deleteAttempt.status, 403);
    const [retained] = await db.select().from(entityRecords).where(eq(entityRecords.id, inScopeRecordId));
    assert.equal(retained?.deleted, false);
    for (const [sensitiveEntity, sensitiveTarget, sensitiveAction] of sensitiveActions) {
      const denied = await fetch(
        `${base}/api/v1/${sensitiveEntity}/${sensitiveTarget}/actions/${sensitiveAction}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${administratorToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ authorizationCode: "HR12" }),
        },
      );
      assert.equal(denied.status, 403);
    }
    const [adminDeniedTarget] = await db.select().from(entityRecords).where(eq(entityRecords.id, targetId));
    const [adminDeniedEmployee] = await db.select().from(staffAccounts).where(eq(staffAccounts.id, employeeId));
    const [adminDeniedApproval] = await db.select().from(entityRecords).where(eq(entityRecords.id, approvalId));
    assert.equal(adminDeniedTarget?.state.status, "in_progress");
    assert.equal(adminDeniedEmployee?.status, "approved");
    assert.equal(adminDeniedApproval?.state.status, "Approved");
    assert.equal((await leaveAction(administratorToken, leaveAdminId)).status, 403);
    assert.equal((await leaveAction(actorToken, leaveHrShortId, { authorizationCode: "HR12" })).status, 403);
    assert.equal((await leaveAction(actorToken, leaveHrLongId, { authorizationCode: "HR12" })).status, 200);
    assert.equal((await leaveAction(actorToken, leaveWorkerId)).status, 403);
    assert.equal((await leaveAction(supervisorToken, leaveManagementId)).status, 200);
    const approvedLeave = await db.select().from(entityRecords)
      .where(eq(entityRecords.id, leaveManagementId)).limit(1);
    const approvedLeavePatch = await fetch(`${base}/api/v1/leave-requests/${leaveManagementId}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: approvedLeave[0]!.version,
        state: { endDate: "2026-10-20" },
      }),
    });
    assert.equal(approvedLeavePatch.status, 409);
    const [unchangedApprovedLeave] = await db.select().from(entityRecords)
      .where(eq(entityRecords.id, leaveManagementId));
    assert.equal(unchangedApprovedLeave?.state.status, "Approved");
    assert.equal(unchangedApprovedLeave?.state.endDate, "2026-09-14");

    const missingCode = await request();
    assert.equal(missingCode.status, 401);
    const approved = await request({ authorizationCode: "HR12" });
    assert.equal(approved.status, 200);

    const [employee] = await db.select().from(staffAccounts).where(eq(staffAccounts.id, employeeId));
    assert.equal(employee?.status, "revoked");
    assert.equal(employee?.sessionVersion, 8);
    assert.equal(employee?.code, "EM12");
    const invalidatedSession = await fetch(`${base}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    assert.equal(invalidatedSession.status, 401);

    const [exit] = await db.select().from(entityRecords).where(eq(entityRecords.id, targetId));
    const [approval] = await db.select().from(entityRecords).where(eq(entityRecords.id, approvalId));
    assert.equal(exit?.state.status, "Terminated");
    assert.equal(approval?.state.status, "consumed");

    const audits = await db.select().from(auditLog).where(and(
      eq(auditLog.tenantId, tenantId),
      inArray(auditLog.reportId, [targetId, employeeId]),
    ));
    assert.equal(audits.some((row) => row.action === "hr-exits.approve-termination" && row.reportId === targetId), true);
    assert.equal(audits.some((row) => row.action === "staff.revoked" && row.reportId === employeeId), true);

    const consumedAgain = await request({ authorizationCode: "HR12" });
    assert.equal(consumedAgain.status, 403);
    const badGuessStatuses = await Promise.all(
      Array.from({ length: 9 }, () => fetch(
        `${base}/api/v1/hr-exits/${guessTargetId}/actions/approve-termination`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${actorToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ authorizationCode: "BAD1" }),
        },
      ).then((response) => response.status)),
    );
    assert.equal(badGuessStatuses.includes(429), true);
    const [guessTarget] = await db.select().from(entityRecords).where(eq(entityRecords.id, guessTargetId));
    const [guessEmployee] = await db.select().from(staffAccounts).where(eq(staffAccounts.id, guessEmployeeId));
    const [guessApproval] = await db.select().from(entityRecords).where(eq(entityRecords.id, guessApprovalId));
    assert.equal(guessTarget?.state.status, "in_progress");
    assert.equal(guessEmployee?.status, "approved");
    assert.equal(guessEmployee?.sessionVersion, 3);
    assert.equal(guessApproval?.state.status, "Approved");
    const postExitWorkspace = await fetch(`${base}/api/v1/hr/workspace`, {
      headers: { authorization: `Bearer ${actorToken}` },
    });
    assert.equal(postExitWorkspace.status, 200);
    const postExitWorkspaceBody = await postExitWorkspace.json() as {
      audit: Array<{ action: string; detail: string }>;
    };
    assert.equal(postExitWorkspaceBody.audit.some((row) => row.action === "procurement.updated"), false);
    assert.equal(postExitWorkspaceBody.audit.some((row) => row.action === "hr-exits.approve-termination"), true);
    assert.equal(postExitWorkspaceBody.audit.some((row) => row.action === "staff.revoked"), true);
    const postTransitionSync = await fetch(
      `${base}/api/v1/sync?since=1970-01-01T00:00:00.000Z&entities=hr-approvals`,
      { headers: { authorization: `Bearer ${supervisorToken}` } },
    );
    assert.equal(postTransitionSync.status, 200);
    const postTransitionBody = await postTransitionSync.json() as { records: Array<{ id: string }> };
    assert.equal(postTransitionBody.records.some((row) => row.id === approvalId), false);
    assert.equal(postTransitionBody.records.some((row) => row.id === pendingApprovalId), true);
  } finally {
    server.close();
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId));
    await db.delete(entityRecords).where(inArray(entityRecords.id, [
      targetId,
      approvalId,
      pendingApprovalId,
      guessTargetId,
      guessApprovalId,
      unrelatedAuditId,
      payTargetId,
      disciplineTargetId,
      inScopeRecordId,
      outOfScopeRecordId,
      outsideRecordId,
      leaveAdminId,
      leaveWorkerId,
      leaveManagementId,
      leaveHrShortId,
      leaveHrLongId,
      ...createdLeaveIds,
    ]));
    await db.delete(staffAccounts).where(inArray(staffAccounts.id, [
      actorId,
      employeeId,
      guessEmployeeId,
      supervisorId,
      inScopeEmployeeId,
      outOfScopeEmployeeId,
      administratorId,
    ]));
    await db.delete(organizations).where(inArray(organizations.id, [tenantId, outsideTenantId]));
  }
});