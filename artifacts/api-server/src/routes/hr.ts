import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { auditLog, db, entityRecords, organizations, staffAccounts } from "@workspace/db";
import {
  canReadHrEntityRecord,
  canIssueStaffAccountRole,
  isHrEntity,
  STAFF_POSITIONS,
  serializeHrStaff,
} from "../lib/domain";
import { allocateStaffCode } from "../lib/staffCodes";
import { emailStaffAccessCode } from "../lib/staffEmail";
import { audit } from "../lib/audit";
import { getConfiguredDevelopmentNames } from "../lib/organizationDevelopments";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/v1/hr", requireAuth);
const CODE_WINDOW_MS = 24 * 60 * 60 * 1000;

function requireHr(res: Parameters<typeof actorFrom>[0]) {
  const actor = actorFrom(res);
  if (actor.role !== "human_resources") {
    res.status(403).json({ error: "The HR workspace is restricted to Human Resources" });
    return null;
  }
  return actor;
}

function visibleCode(row: typeof staffAccounts.$inferSelect) {
  if (!row.codeIssuedAt) return {};
  const visibleUntil = new Date(row.codeIssuedAt.getTime() + CODE_WINDOW_MS);
  return {
    code: visibleUntil.getTime() > Date.now() ? row.code : undefined,
    codeVisibleUntil: visibleUntil,
  };
}

function outward(row: typeof entityRecords.$inferSelect) {
  return {
    id: row.id,
    entity: row.entity,
    projectId: row.projectId,
    development: row.development,
    state: row.state,
    deleted: row.deleted,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/v1/hr/workspace", async (_req, res): Promise<void> => {
  const actor = requireHr(res);
  if (!actor) return;
  await db.delete(entityRecords).where(and(
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.entity, "hr-employee-records"),
    sql`${entityRecords.state}->>'employeeStaffId' IS NOT NULL`,
    sql`NOT EXISTS (
      SELECT 1
      FROM ${staffAccounts}
      WHERE ${staffAccounts.id} = ${entityRecords.state}->>'employeeStaffId'
        AND ${staffAccounts.tenantId} = ${entityRecords.tenantId}
    )`,
  ));
  const [staffRows, recordRows, audits] = await Promise.all([
    db.select().from(staffAccounts)
      .where(eq(staffAccounts.tenantId, actor.tenantId))
      .orderBy(staffAccounts.name),
    db.select().from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ))
      .orderBy(desc(entityRecords.updatedAt)),
    db.select().from(auditLog)
      .where(eq(auditLog.tenantId, actor.tenantId))
      .orderBy(desc(auditLog.at))
      .limit(100),
  ]);
  const staffById = new Map(staffRows.map((row) => [row.id, row]));
  const records = recordRows
    .filter((row) => isHrEntity(row.entity))
    .filter((row) => {
      const employeeId = typeof row.state["employeeStaffId"] === "string"
        ? row.state["employeeStaffId"].trim()
        : "";
      return canReadHrEntityRecord(actor, row, staffById.get(employeeId));
    })
    .map(outward);
  const visibleRecordIds = new Set(records.map((row) => row.id));
  const visibleStaffIds = new Set(staffRows.map((row) => row.id));
  const visibleAudits = audits.filter((row) => {
    const reportId = row.reportId || "";
    const actionEntity = row.action.split(".", 1)[0] || "";
    const isHrLifecycleAudit = isHrEntity(actionEntity);
    const isStaffLifecycleAudit = row.action.startsWith("staff.");
    return (
      (isHrLifecycleAudit && visibleRecordIds.has(reportId)) ||
      (isStaffLifecycleAudit && visibleStaffIds.has(reportId))
    );
  });
  res.json({
    staff: staffRows.map((row) => ({
      ...serializeHrStaff(row, true),
      ...visibleCode(row),
    })),
    records,
    audit: visibleAudits.map((row) => ({
      id: row.id,
      actorRole: row.actorRole,
      actorName: row.actorName,
      action: row.action,
      detail: row.detail,
      reportId: row.reportId,
      at: row.at,
    })),
  });
});

router.post("/v1/hr/employee-records/:id/complete", async (req, res): Promise<void> => {
  const actor = requireHr(res);
  if (!actor) return;
  const employeeNumber = typeof req.body?.employeeNumber === "string"
    ? req.body.employeeNumber.trim()
    : "";
  if (!employeeNumber || employeeNumber.length > 50) {
    res.status(400).json({ error: "Employee number is required" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-limit:${actor.tenantId}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`hr-employee:${actor.tenantId}:${req.params["id"]}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`employee-number:${actor.tenantId}:${employeeNumber.toLowerCase()}`}))`);
    const [record] = await tx.select().from(entityRecords).where(and(
      eq(entityRecords.id, req.params["id"]!),
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "hr-employee-records"),
      eq(entityRecords.deleted, false),
    )).limit(1);
    if (!record) throw Object.assign(new Error("Employee record not found"), { status: 404 });
    if (record.state["employeeStaffId"] || String(record.state["status"] || "").toLowerCase() !== "draft") {
      throw Object.assign(new Error("Employee record has already been completed"), { status: 409 });
    }
    const [duplicate] = await tx.select({ id: entityRecords.id }).from(entityRecords).where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "hr-employee-records"),
      eq(entityRecords.deleted, false),
      sql`lower(${entityRecords.state}->>'employeeNumber') = ${employeeNumber.toLowerCase()}`,
    )).limit(1);
    if (duplicate && duplicate.id !== record.id) {
      throw Object.assign(new Error("Employee number is already in use"), { status: 409 });
    }
    const firstName = String(record.state["firstName"] || "").trim();
    const lastName = String(record.state["lastName"] || "").trim();
    const email = String(record.state["email"] || "").trim();
    const position = String(record.state["position"] || "").trim();
    let role = String(record.state["role"] || "").trim();
    const maintenanceAssignment = req.body?.maintenanceAssignment === "truck"
      ? "truck"
      : req.body?.maintenanceAssignment === "regular"
        ? "regular"
        : "";
    let emergencyTruckDriver = record.state["emergencyTruckDriver"] === true;
    if (position === "Maintenance Worker" && maintenanceAssignment) {
      emergencyTruckDriver = maintenanceAssignment === "truck";
      role = emergencyTruckDriver ? "emergency" : "worker";
    }
    const developments = Array.isArray(record.state["assignedDevelopments"])
      ? record.state["assignedDevelopments"].filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      : [];
    if (!firstName || !lastName || !email.includes("@") ||
        !["management", "worker", "inspector", "procurement", "emergency"].includes(role) ||
        position === "Borough Director" ||
        !STAFF_POSITIONS.includes(position as (typeof STAFF_POSITIONS)[number]) ||
        !canIssueStaffAccountRole(role)) {
      throw Object.assign(new Error("Complete the employee name, email, role, and position first"), { status: 400 });
    }
    if (
      emergencyTruckDriver && (role !== "emergency" || position !== "Maintenance Worker")
    ) {
      throw Object.assign(new Error("Truck designation is limited to emergency maintenance workers"), { status: 400 });
    }
    if (role === "emergency" && position === "Maintenance Worker" && !emergencyTruckDriver) {
      throw Object.assign(new Error("Choose Truck driver or Regular maintenance"), { status: 400 });
    }
    const [organization] = await tx.select({
      staffLimit: organizations.staffLimit,
      features: organizations.features,
    }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
    const configuredDevelopments = getConfiguredDevelopmentNames(organization?.features);
    if (
      configuredDevelopments !== null &&
      developments.some((development) => !configuredDevelopments.includes(development))
    ) {
      throw Object.assign(new Error("Assigned developments must be configured by Platform Control"), { status: 400 });
    }
    if (organization?.staffLimit !== null && organization?.staffLimit !== undefined) {
      const [{ value }] = await tx.select({ value: count() }).from(staffAccounts)
        .where(eq(staffAccounts.tenantId, actor.tenantId));
      if (Number(value) >= organization.staffLimit) {
        throw Object.assign(new Error("Organization staff license limit reached"), { status: 403 });
      }
    }
    const staffId = randomUUID();
    const now = new Date();
    const name = `${firstName} ${lastName}`.trim();
    let issuedName = name.replace(/^TRK-\d+\s+/i, "");
    if (emergencyTruckDriver) {
      const existingTruckDrivers = await tx.select({ name: staffAccounts.name }).from(staffAccounts).where(and(
        eq(staffAccounts.tenantId, actor.tenantId),
        eq(staffAccounts.role, "emergency"),
        eq(staffAccounts.position, "Maintenance Worker"),
      ));
      const nextTruckNumber = existingTruckDrivers.reduce((highest, member) => {
        const value = /^TRK-(\d+)\s+/i.exec(member.name)?.[1];
        return value ? Math.max(highest, Number(value)) : highest;
      }, 0) + 1;
      issuedName = `TRK-${nextTruckNumber} ${issuedName}`;
    }
    const code = await allocateStaffCode(tx, actor.tenantId, name);
    const [staff] = await tx.insert(staffAccounts).values({
      id: staffId,
      tenantId: actor.tenantId,
      name: issuedName,
      firstName,
      lastName,
      role,
      position,
      code,
      codeIssuedAt: now,
      status: "approved",
      developments,
      createdBy: actor.id,
      issuerName: actor.name,
      createdAt: now,
      updatedAt: now,
    }).returning();
    const [updatedRecord] = await tx.update(entityRecords).set({
      state: {
        ...record.state,
        employeeNumber,
        employeeStaffId: staffId,
        employmentStatus: "approved",
        role,
        emergencyTruckDriver,
        status: "in_progress",
        advanceAt: now.toISOString(),
      },
      version: sql`${entityRecords.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(entityRecords.id, record.id),
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.version, record.version),
    )).returning();
    if (!staff || !updatedRecord) throw Object.assign(new Error("Concurrent update detected"), { status: 409 });
    return { staff, record: updatedRecord };
  }).catch((error: any) => {
    if (error?.status) {
      res.status(error.status).json({ error: error.message });
      return null;
    }
    throw error;
  });
  if (!result) return;
  await audit(actor, "hr-employee-records.completed", `Completed employee intake for ${result.staff.name}`, result.record.id);
  res.json({
    staffId: result.staff.id,
    code: result.staff.code,
    codeVisibleUntil: new Date(result.staff.codeIssuedAt!.getTime() + CODE_WINDOW_MS),
  });
});

router.post("/v1/hr/staff/:id/send-code", async (req, res): Promise<void> => {
  const actor = requireHr(res);
  if (!actor) return;
  const [staff] = await db.select().from(staffAccounts).where(and(
    eq(staffAccounts.id, req.params["id"]!),
    eq(staffAccounts.tenantId, actor.tenantId),
  )).limit(1);
  if (!staff || !staff.codeIssuedAt ||
      staff.codeIssuedAt.getTime() + CODE_WINDOW_MS <= Date.now()) {
    res.status(409).json({ error: "The code is no longer visible. Issue a replacement code." });
    return;
  }
  const [record] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.entity, "hr-employee-records"),
    eq(entityRecords.deleted, false),
    sql`${entityRecords.state}->>'employeeStaffId' = ${staff.id}`,
  )).limit(1);
  const email = String(record?.state["email"] || "").trim();
  if (!email.includes("@")) {
    res.status(400).json({ error: "Add the employee email address before sending the code" });
    return;
  }
  await emailStaffAccessCode({ email, employeeName: staff.name, code: staff.code });
  await audit(actor, "staff.code_emailed", `Emailed access code to ${staff.name}`, staff.id);
  res.status(204).end();
});

export default router;