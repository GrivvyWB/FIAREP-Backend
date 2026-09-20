import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, sql, count } from "drizzle-orm";
import {
  db,
  deviceTokens,
  entityRecords,
  notifications,
  refreshSessions,
  staffAccounts,
  organizations,
  organizationProperties,
} from "@workspace/db";
import { audit, auditInTransaction, notify } from "../lib/audit";
import {
  STAFF_POSITIONS,
  canIssueStaffAccountRole,
  canBrowseStaffDirectory,
  canDeleteStaffAccounts,
  canReadStaffDirectoryEmployee,
  isBoroughDirector,
  isElevated,
  serializeHrStaff,
  serializeStaffIssueResponse,
  withInitialWorkflowState,
} from "../lib/domain";
import { allocateStaffCode, allocateTruckStaffCode } from "../lib/staffCodes";
import { emailStaffAccessCode } from "../lib/staffEmail";
import { getConfiguredDevelopmentNames } from "../lib/organizationDevelopments";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const CODE_EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
router.use("/v1/staff", requireAuth);

function safe(
  staff: typeof staffAccounts.$inferSelect,
  actor?: ReturnType<typeof actorFrom>,
) {
  const data = serializeHrStaff(
    staff,
    actor?.role === "human_resources" || actor?.role === "administrator",
  );
  const permissions = actor
    ? {
        canManage: canManageStaff(actor, staff),
        canResetCode: actor.role === "human_resources" && canManageStaff(actor, staff),
        canRevoke: canManageStaff(actor, staff) && staff.status !== "revoked",
        canDelete: actor.id !== staff.id && canManageStaff(actor, staff),
        canApprove:
          actor.role === "human_resources" &&
          staff.status === "pending" &&
          canManageStaff(actor, staff),
      }
    : {};
  return { ...data, ...permissions };
}

function issueSafe(
  staff: typeof staffAccounts.$inferSelect,
  actor: ReturnType<typeof actorFrom>,
) {
  return {
    ...serializeStaffIssueResponse(
      staff,
      actor.role === "human_resources" || actor.role === "administrator",
    ),
    canManage: canManageStaff(actor, staff),
    canResetCode: actor.role === "human_resources" && canManageStaff(actor, staff),
    canRevoke: canManageStaff(actor, staff) && staff.status !== "revoked",
    canDelete: actor.id !== staff.id && canManageStaff(actor, staff),
    canApprove:
      actor.role === "human_resources" &&
      staff.status === "pending" &&
      canManageStaff(actor, staff),
  };
}

function developmentsWithinScope(
  actor: ReturnType<typeof actorFrom>,
  values: string[],
) {
  return (
    actor.role === "human_resources" ||
    actor.role === "administrator" ||
    isBoroughDirector(actor) ||
    (actor.developments.length > 0 &&
      values.length > 0 &&
      values.every((value) => actor.developments.includes(value)))
  );
}

function canManageStaff(
  actor: ReturnType<typeof actorFrom>,
  target: Pick<
    typeof staffAccounts.$inferSelect,
    "role" | "position" | "developments"
  >,
) {
  if (actor.role === "human_resources") {
    return target.position !== "Borough Director" &&
      !["administrator", "human_resources"].includes(target.role);
  }
  if (isBoroughDirector(actor)) return true;
  if (target.position === "Borough Director" || target.role === "administrator") {
    return false;
  }
  if (!developmentsWithinScope(actor, target.developments)) return false;
  if (actor.role === "administrator") return true;
  if (actor.role !== "management") return false;
  if (target.role === "management") {
    return actor.position === "Regional Director";
  }
  return ["worker", "inspector", "emergency"].includes(target.role);
}

function canHrAssignPositionRole(position: string, role: string): boolean {
  const managementPositions = new Set([
    "Regional Director",
    "Assistant Regional Director",
    "Property Manager",
    "Assistant Property Manager",
    "Superintendent",
    "Superintendent Ⓔ",
    "Assistant Superintendent",
    "Housing Assistant",
    "Director",
  ]);
  const managementPosition =
    managementPositions.has(position) ||
    position.toLowerCase().includes("supervisor");
  if (role === "management") return managementPosition;
  if (role === "inspector") return position === "Inspector" || position === "CPM";
  if (role === "emergency") return position === "Maintenance Worker";
  if (role === "worker") {
    return !managementPosition &&
      !["Human Resources", "Inspector", "CPM"].includes(position);
  }
  return false;
}

class StaffAssignmentIntegrityError extends Error {}

function canIssueStaff(
  actor: ReturnType<typeof actorFrom>,
  role: string,
  position: string,
  developments: string[],
) {
  if (!canIssueStaffAccountRole(role)) return false;
  if (position === "Borough Director" && !isBoroughDirector(actor)) return false;
  if (!developmentsWithinScope(actor, developments)) return false;
  if (actor.role === "human_resources") {
    return !["administrator", "human_resources"].includes(role);
  }
  if (isBoroughDirector(actor)) return true;
  if (actor.role === "administrator") {
    return role !== "administrator";
  }
  if (actor.role !== "management") return false;
  if (role === "management") return actor.position === "Regional Director";
  return ["worker", "inspector", "emergency"].includes(role);
}

export function scopedDevelopmentNames(
  values: Array<string | null | undefined>,
  actor: ReturnType<typeof actorFrom>,
) {
  const names = [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.trim().length > 0,
  ).map((value) => value.trim()))].sort((a, b) => a.localeCompare(b));
  if (
    isBoroughDirector(actor) ||
    actor.role === "administrator" ||
    actor.role === "human_resources"
  ) return names;
  const allowed = new Set(actor.developments);
  return names.filter((name) => allowed.has(name));
}

router.get("/v1/staff", async (req, res) => {
  const actor = actorFrom(res);
  if (!canBrowseStaffDirectory(actor)) {
    res.status(403).json({ error: "The staff directory is restricted to supervisors" });
    return;
  }
  const status =
    typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const rows = await db
    .select()
    .from(staffAccounts)
    .where(
      status
        ? and(
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.status, status),
          )
        : eq(staffAccounts.tenantId, actor.tenantId),
    )
    .orderBy(asc(staffAccounts.name));
  res.json(rows.filter((row) => canReadStaffDirectoryEmployee(actor, row))
    .map((row) => safe(row, actor)));
});

router.get("/v1/staff/developments", async (_req, res) => {
  const actor = actorFrom(res);
  if (!canBrowseStaffDirectory(actor)) {
    res.status(403).json({ error: "The staff directory is restricted to supervisors" });
    return;
  }
  const [propertyRows, staffRows, recordRows, organizationRows] = await Promise.all([
    db
      .select({ development: organizationProperties.development })
      .from(organizationProperties)
      .where(and(
        eq(organizationProperties.organizationId, actor.tenantId),
        eq(organizationProperties.active, true),
      )),
    db
      .select({ developments: staffAccounts.developments })
      .from(staffAccounts)
      .where(eq(staffAccounts.tenantId, actor.tenantId)),
    db
      .select({ development: entityRecords.development })
      .from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      )),
    db
      .select({ features: organizations.features })
      .from(organizations)
      .where(eq(organizations.id, actor.tenantId))
      .limit(1),
  ]);
  const configured = getConfiguredDevelopmentNames(organizationRows[0]?.features);
  if (configured !== null) {
    res.json(scopedDevelopmentNames(configured, actor));
    return;
  }
  res.json(scopedDevelopmentNames([
    ...propertyRows.map((row) => row.development),
    ...staffRows.flatMap((row) => row.developments),
    ...recordRows.map((row) => row.development),
  ], actor));
});

router.post("/v1/staff", async (req, res) => {
  const actor = actorFrom(res);
  if (actor.role) {
    res.status(403).json({ error: "Start employee intake in HR Workspace" });
    return;
  }
  const input = req.body as Record<string, unknown>;
  const name = typeof input["name"] === "string" ? input["name"].trim() : "";
  const role = typeof input["role"] === "string" ? input["role"] : "";
  const position =
    typeof input["position"] === "string" ? input["position"] : "";
  const developments = Array.isArray(input["developments"])
    ? [...new Set(input["developments"].filter(
        (item): item is string => typeof item === "string",
      ).map((item) => item.trim()).filter(Boolean))]
    : [];
  const clientRequestId =
    typeof input["clientRequestId"] === "string" ? input["clientRequestId"].trim() : "";
  const requestedStatus =
    input["status"] === "pending" ? "pending" :
    input["status"] === undefined || input["status"] === "approved" ? "approved" : "";
  const emergencyTruckDriver = input["emergencyTruckDriver"] === true;
  if (clientRequestId && !/^[a-zA-Z0-9_-]{8,100}$/.test(clientRequestId)) {
    res.status(400).json({ error: "Invalid staff issuance request id" });
    return;
  }
  if (
    !name ||
    !canIssueStaffAccountRole(role) ||
    !requestedStatus ||
    !STAFF_POSITIONS.includes(position as (typeof STAFF_POSITIONS)[number])
  ) {
    res.status(400).json({ error: "Valid name, role, and position are required" });
    return;
  }
  if (requestedStatus === "pending" && actor.role !== "human_resources") {
    res.status(403).json({ error: "Only Human Resources may create a pending employee" });
    return;
  }
  if (emergencyTruckDriver && (role !== "emergency" || position !== "Maintenance Worker")) {
    res.status(400).json({ error: "Truck designation is limited to emergency maintenance workers" });
    return;
  }
  const developmentRequiredPositions = new Set([
    "Regional Director",
    "Assistant Regional Director",
    "Property Manager",
    "Superintendent",
    "Superintendent Ⓔ",
    "Assistant Superintendent",
  ]);
  if (
    (developmentRequiredPositions.has(position) ||
      position.toLowerCase().includes("supervisor")) &&
    developments.length === 0
  ) {
    res.status(400).json({ error: "Select at least one assigned development" });
    return;
  }
  const canIssue = canIssueStaff(actor, role, position, developments);
  if (!canIssue) {
    res.status(403).json({ error: "Not allowed to issue this account" });
    return;
  }
  const [organization] = await db.select({
    staffLimit: organizations.staffLimit,
    features: organizations.features,
  }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  const configuredDevelopments = getConfiguredDevelopmentNames(organization?.features);
  if (configuredDevelopments !== null) {
    const allowedDevelopments = new Set(configuredDevelopments);
    if (developments.some((development) => !allowedDevelopments.has(development))) {
      res.status(400).json({ error: "Assigned developments must be configured by Platform Control" });
      return;
    }
  }
  if ("code" in input) {
    res.status(400).json({ error: "Staff codes are generated automatically" });
    return;
  }
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-limit:${actor.tenantId}`}))`);
    if (clientRequestId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-create:${actor.tenantId}:${clientRequestId}`}))`);
      const [existing] = await tx.select().from(staffAccounts).where(eq(staffAccounts.id, clientRequestId)).limit(1);
      if (existing) {
        throw Object.assign(new Error("Staff issuance request has already been completed"), { status: 409 });
      }
    }
    if (organization?.staffLimit !== null && organization?.staffLimit !== undefined) {
      const [{ value }] = await tx.select({ value: count() }).from(staffAccounts).where(eq(staffAccounts.tenantId, actor.tenantId));
      if (Number(value) >= organization.staffLimit) throw Object.assign(new Error("Organization staff license limit reached"), { status: 403 });
    }
    const now = new Date();
    let issuedName = name.replace(/^TRK-\d+\s+/i, "");
    if (emergencyTruckDriver) {
      const existingTruckDrivers = await tx
        .select({ name: staffAccounts.name })
        .from(staffAccounts)
        .where(and(
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.role, "emergency"),
          eq(staffAccounts.position, "Maintenance Worker"),
        ));
      const nextTruckNumber = existingTruckDrivers.reduce((highest, staff) => {
        const value = /^TRK-(\d+)\s+/i.exec(staff.name)?.[1];
        return value ? Math.max(highest, Number(value)) : highest;
      }, 0) + 1;
      issuedName = `TRK-${nextTruckNumber} ${issuedName}`;
    }
    const [row] = await tx
      .insert(staffAccounts)
      .values({
       id: clientRequestId || randomUUID(),
      tenantId: actor.tenantId,
      name: issuedName,
      firstName:
        typeof input["firstName"] === "string" ? input["firstName"] : null,
      lastName:
        typeof input["lastName"] === "string" ? input["lastName"] : null,
      role,
      position,
      code: await allocateStaffCode(tx, actor.tenantId, name),
       status: requestedStatus,
      developments,
      createdBy: actor.id,
      issuerName: actor.name,
      createdAt: now,
      updatedAt: now,
      })
      .returning();
    const hrRecordId = `hr-employee:${row.id}`;
    await tx.insert(entityRecords).values({
      id: hrRecordId,
      tenantId: actor.tenantId,
      entity: "hr-employee-records",
      development: developments.length === 1 ? developments[0] : null,
      state: withInitialWorkflowState("hr-employee-records", {
        employeeStaffId: row.id,
        firstName: row.firstName || undefined,
        lastName: row.lastName || undefined,
        position: row.position,
        employmentStatus: row.status,
        title: `${row.name} employee record`,
        assignedDevelopments: row.developments,
      }),
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    });
    return { row, hrRecordId };
  }).catch((error: any) => {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return null; }
    throw error;
  });
  if (!created) return;
  await audit(actor, "staff.created", `Issued account for ${name}`, created.row.id);
  await audit(
    actor,
    "hr-employee-records.created",
    `Started employee record for ${name}`,
    created.hrRecordId,
  );
  if (created.row.status === "pending") {
    await notify(
      actor,
      "human_resources",
      "Employee pending approval",
      `${name} is waiting for documents`,
      created.row.id,
    );
  }
  res.status(201).json(issueSafe(created.row, actor));
});

router.post("/v1/staff/:id/approve", async (req, res) => {
  const actor = actorFrom(res);
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.id, req.params["id"]!),
      eq(staffAccounts.tenantId, actor.tenantId),
    ))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  if (
    actor.role !== "human_resources" ||
    target.status !== "pending" ||
    !canManageStaff(actor, target)
  ) {
    res.status(403).json({ error: "Only Human Resources may approve a pending employee" });
    return;
  }
  const updatedResult = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-code:${actor.tenantId}:${target.id}`}))`);
    const [current] = await tx.select().from(staffAccounts).where(and(
      eq(staffAccounts.id, target.id),
      eq(staffAccounts.tenantId, actor.tenantId),
    )).limit(1);
    if (!current) throw Object.assign(new Error("Staff account not found"), { status: 404 });
    const code = await allocateStaffCode(tx, actor.tenantId, current.name);
    const approvedAt = new Date();
    const [updated] = await tx
      .update(staffAccounts)
      .set({
        code,
        status: "approved",
        sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
        updatedAt: approvedAt,
      })
      .where(and(
        eq(staffAccounts.id, target.id),
        eq(staffAccounts.tenantId, actor.tenantId),
        eq(staffAccounts.status, "pending"),
      ))
      .returning();
    if (updated) {
      const records = await tx.select().from(entityRecords).where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, "hr-employee-records"),
        eq(entityRecords.deleted, false),
        sql`${entityRecords.state}->>'employeeStaffId' = ${target.id}`,
      ));
      for (const record of records) {
        await tx.update(entityRecords).set({
          state: { ...record.state, employmentStatus: "approved" },
          version: sql`${entityRecords.version} + 1`,
          updatedAt: approvedAt,
        }).where(and(
          eq(entityRecords.id, record.id),
          eq(entityRecords.tenantId, actor.tenantId),
        ));
      }
    }
    return { updated, code };
  });
  if (!updatedResult.updated) {
    res.status(409).json({ error: "Employee is no longer pending" });
    return;
  }
  await db
    .update(notifications)
    .set({ read: true, updatedAt: new Date() })
    .where(and(
      eq(notifications.tenantId, actor.tenantId),
      eq(notifications.reportId, target.id),
      eq(notifications.message, "Employee pending approval"),
    ));
  await audit(actor, "staff.approved", `Approved account for ${target.name}`, target.id);
  res.json(issueSafe(updatedResult.updated, actor));
});

router.put("/v1/staff/:id/hr-notes", async (req, res) => {
  const actor = actorFrom(res);
  if (actor.role !== "human_resources") {
    res.status(403).json({ error: "Only Human Resources may update employee notes" });
    return;
  }
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.id, req.params["id"]!),
      eq(staffAccounts.tenantId, actor.tenantId),
    ))
    .limit(1);
  if (!target || !canManageStaff(actor, target)) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
  const [updated] = await db
    .update(staffAccounts)
    .set({ hrNotes: notes || null, updatedAt: new Date() })
    .where(and(
      eq(staffAccounts.id, req.params["id"]!),
      eq(staffAccounts.tenantId, actor.tenantId),
    ))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  await audit(actor, "staff.hr_notes_updated", `Updated HR notes for ${updated.name}`, updated.id);
  res.json(safe(updated, actor));
});

router.post("/v1/staff/:id/reset-code", async (req, res) => {
  const actor = actorFrom(res);
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.id, req.params["id"]!),
        eq(staffAccounts.tenantId, actor.tenantId),
      ),
    )
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  if (actor.role !== "human_resources" || !canManageStaff(actor, target)) {
    res.status(403).json({ error: "Only Human Resources may issue a replacement code" });
    return;
  }
  if (req.body && "code" in req.body) {
    res.status(400).json({ error: "Staff codes are generated automatically" });
    return;
  }
  const [employeeRecord] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.entity, "hr-employee-records"),
    eq(entityRecords.deleted, false),
    sql`${entityRecords.state}->>'employeeStaffId' = ${target.id}`,
  )).limit(1);
  const employeeEmail = String(employeeRecord?.state["email"] || "").trim();
  if (!employeeEmail.includes("@")) {
    res.status(400).json({ error: "Add the employee email address before issuing a replacement code" });
    return;
  }
  const updatedResult = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-code-email:${actor.tenantId}:${target.id}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`emergency-truck-sequence:${actor.tenantId}`}))`);
    const [current] = await tx.select().from(staffAccounts).where(and(
      eq(staffAccounts.id, target.id),
      eq(staffAccounts.tenantId, actor.tenantId),
    )).limit(1);
    const isTruckDriver = target.role === "emergency" &&
      target.position === "Maintenance Worker" &&
      employeeRecord?.state["emergencyTruckDriver"] === true;
    const needsTruckCodeUpgrade = isTruckDriver &&
      !/^TRK\d+-[A-Z0-9]{4}$/i.test(current?.code || "");
    const nextEmailAt = current?.codeEmailedAt
      ? new Date(current.codeEmailedAt.getTime() + CODE_EMAIL_COOLDOWN_MS)
      : null;
    if (nextEmailAt && nextEmailAt.getTime() > Date.now() && !needsTruckCodeUpgrade) {
      throw Object.assign(new Error("Next email in 24 hrs for code"), { status: 429, nextEmailAt });
    }
    let existingUnit: { id: string; state: Record<string, unknown> } | undefined;
    if (isTruckDriver) {
      [existingUnit] = await tx.select({
        id: entityRecords.id,
        state: entityRecords.state,
      })
        .from(entityRecords)
        .where(and(
          eq(entityRecords.tenantId, actor.tenantId),
          eq(entityRecords.entity, "emergency-units"),
          eq(entityRecords.deleted, false),
          sql`${entityRecords.state}->>'assignedStaffId' = ${target.id}`,
        ))
        .limit(1);
    }
    let truckNumber = target.role === "emergency"
      ? Number(
        existingUnit?.state["truckNumber"] ||
        /(?:TRK|Truck)[- ]?(\d+)/i.exec(String(existingUnit?.state["unitName"] || existingUnit?.state["name"] || ""))?.[1] ||
        /^TRK-(\d+)\s+/i.exec(target.name)?.[1] ||
        0
      )
      : 0;
    if (isTruckDriver && truckNumber === 0) {
      const [existingTruckDrivers, existingTruckUnits] = await Promise.all([
        tx.select({ name: staffAccounts.name })
          .from(staffAccounts)
          .where(and(
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.role, "emergency"),
            eq(staffAccounts.position, "Maintenance Worker"),
          )),
        tx.select({ state: entityRecords.state }).from(entityRecords).where(and(
          eq(entityRecords.tenantId, actor.tenantId),
          eq(entityRecords.entity, "emergency-units"),
          eq(entityRecords.deleted, false),
        )),
      ]);
      truckNumber = existingTruckDrivers.reduce((highest, member) => {
        const value = /^TRK-(\d+)\s+/i.exec(member.name)?.[1];
        return value ? Math.max(highest, Number(value)) : highest;
      }, existingTruckUnits.reduce((highest, unit) => {
        const value = Number(
          unit.state["truckNumber"] ||
          /(?:TRK|Truck)[- ]?(\d+)/i.exec(String(unit.state["unitName"] || unit.state["name"] || ""))?.[1] ||
          0
        );
        return Number.isInteger(value) ? Math.max(highest, value) : highest;
      }, 0)) + 1;
    }
    const code = truckNumber > 0
      ? await allocateTruckStaffCode(tx, actor.tenantId, truckNumber)
      : await allocateStaffCode(tx, actor.tenantId, target.name);
    const issuedName = target.name.replace(/^TRK-\d+\s+/i, "");
    let emergencyUnitId: string | null = null;
    if (isTruckDriver) {
      emergencyUnitId = existingUnit?.id || randomUUID();
      const now = new Date();
      const unitState = {
        ...(existingUnit?.state || {}),
        name: `Truck ${truckNumber}`,
        unitName: `TRK-${truckNumber}`,
        code,
        truckNumber,
        assignedStaffId: target.id,
        assignedTo: issuedName,
        createdAt: existingUnit?.state["createdAt"] || now.toISOString(),
      };
      if (existingUnit) {
        await tx.update(entityRecords).set({
          state: unitState,
          version: sql`${entityRecords.version} + 1`,
          updatedAt: now,
        }).where(and(
          eq(entityRecords.id, existingUnit.id),
          eq(entityRecords.tenantId, actor.tenantId),
        ));
      } else {
        await tx.insert(entityRecords).values({
          id: emergencyUnitId,
          tenantId: actor.tenantId,
          entity: "emergency-units",
          state: unitState,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    const [updated] = await tx
      .update(staffAccounts)
      .set({
        name: issuedName,
        code,
        codeIssuedAt: new Date(),
        sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(staffAccounts.id, req.params["id"]!),
          eq(staffAccounts.tenantId, actor.tenantId),
        ),
      )
      .returning();
    if (!updated) throw Object.assign(new Error("Staff account not found"), { status: 404 });
    if (emergencyUnitId && employeeRecord) {
      await tx.update(entityRecords).set({
        state: {
          ...employeeRecord.state,
          emergencyUnitId,
        },
        version: sql`${entityRecords.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(entityRecords.id, employeeRecord.id),
        eq(entityRecords.tenantId, actor.tenantId),
      ));
    }
    await emailStaffAccessCode({
      email: employeeEmail,
      employeeName: updated.name,
      code: updated.code,
    });
    const [emailed] = await tx.update(staffAccounts).set({
      codeEmailedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(staffAccounts.id, updated.id),
      eq(staffAccounts.tenantId, actor.tenantId),
    )).returning();
    if (!emailed) throw Object.assign(new Error("Staff account not found"), { status: 404 });
    return { updated: emailed };
  }).catch((error: any) => {
    if (error?.status) {
      res.status(error.status).json({
        error: error.message,
        ...(error.nextEmailAt ? { nextEmailAt: error.nextEmailAt } : {}),
      });
      return null;
    }
    res.status(502).json({ error: "The replacement code email could not be sent. The existing code still works." });
    return null;
  });
  if (!updatedResult) return;
  const { updated } = updatedResult;
  await audit(actor, "staff.code_reset", `Reset code for ${updated.name}`, updated.id);
  await audit(actor, "staff.code_emailed", `Emailed replacement access code to ${updated.name}`, updated.id);
  res.json(issueSafe(updated, actor));
});

router.delete("/v1/staff/:id", async (req, res) => {
  const actor = actorFrom(res);
  const [organization] = await db
    .select({ features: organizations.features })
    .from(organizations)
    .where(eq(organizations.id, actor.tenantId))
    .limit(1);
  if (organization?.features?.["deletionEnabled"] !== true) {
    res.status(403).json({ error: "Deletion is disabled for this organization" });
    return;
  }
  if (!canDeleteStaffAccounts(actor)) {
    res.status(403).json({ error: "Only Human Resources or higher management can delete staff accounts" });
    return;
  }
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.id, req.params["id"]!),
      eq(staffAccounts.tenantId, actor.tenantId),
    ))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  if (target.id === actor.id) {
    res.status(403).json({ error: "You cannot delete your own account" });
    return;
  }
  if (actor.role !== "administrator" && !canManageStaff(actor, target)) {
    res.status(403).json({ error: "Not allowed to delete this staff account" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(refreshSessions).where(eq(refreshSessions.staffId, target.id));
    await tx.delete(deviceTokens).where(and(
      eq(deviceTokens.tenantId, actor.tenantId),
      eq(deviceTokens.staffId, target.id),
    ));
    await tx.delete(entityRecords).where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "hr-employee-records"),
      sql`(${entityRecords.id} = ${`hr-employee:${target.id}`} OR ${entityRecords.state}->>'employeeStaffId' = ${target.id})`,
    ));
    await tx.delete(staffAccounts).where(and(
      eq(staffAccounts.id, target.id),
      eq(staffAccounts.tenantId, actor.tenantId),
    ));
  });
  await audit(actor, "staff.deleted", `Permanently deleted ${target.name}`, target.id);
  res.status(204).send();
});

router.put("/v1/staff/:id/developments", async (req, res) => {
  const actor = actorFrom(res);
  if (actor.role !== "human_resources") {
    res.status(403).json({ error: "Only Human Resources may move staff between developments" });
    return;
  }
  const input = req.body as { developments?: unknown };
  const developments: string[] | null = Array.isArray(input.developments)
    ? [...new Set(input.developments.filter(
        (item: unknown): item is string => typeof item === "string",
      ).map((item) => item.trim()).filter(Boolean))]
    : null;
  if (!developments) {
    res.status(400).json({ error: "developments is required" });
    return;
  }
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.id, req.params["id"]!),
      eq(staffAccounts.tenantId, actor.tenantId),
    ))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  if (!canManageStaff(actor, target)) {
    res.status(403).json({ error: "Not allowed to move this staff member" });
    return;
  }
  const developmentRequiredPositions = new Set([
    "Regional Director",
    "Assistant Regional Director",
    "Property Manager",
    "Superintendent",
    "Superintendent Ⓔ",
    "Assistant Superintendent",
  ]);
  if (
    (developmentRequiredPositions.has(target.position) ||
      target.position.toLowerCase().includes("supervisor")) &&
    developments.length === 0
  ) {
    res.status(400).json({ error: "Select at least one assigned development" });
    return;
  }
  const [organization] = await db
    .select({ features: organizations.features })
    .from(organizations)
    .where(eq(organizations.id, actor.tenantId))
    .limit(1);
  const configuredDevelopments = getConfiguredDevelopmentNames(organization?.features);
  if (configuredDevelopments !== null) {
    const allowedDevelopments = new Set(configuredDevelopments);
    if (developments.some((development) => !allowedDevelopments.has(development))) {
      res.status(400).json({ error: "Assigned developments must be configured by Platform Control" });
      return;
    }
  }
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-assignment:${actor.tenantId}:${target.id}`}))`);
    const [currentTarget] = await tx
      .select()
      .from(staffAccounts)
      .where(and(
        eq(staffAccounts.id, target.id),
        eq(staffAccounts.tenantId, actor.tenantId),
      ))
      .limit(1);
    if (
      !currentTarget ||
      currentTarget.position !== target.position ||
      currentTarget.role !== target.role ||
      currentTarget.annualSalaryCents !== target.annualSalaryCents ||
      currentTarget.hourlyRateCents !== target.hourlyRateCents ||
      JSON.stringify(currentTarget.developments) !== JSON.stringify(target.developments)
    ) {
      throw new StaffAssignmentIntegrityError();
    }
    let linkedHrRows = await tx
      .select()
      .from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, "hr-employee-records"),
        eq(entityRecords.deleted, false),
        sql`(${entityRecords.id} = ${`hr-employee:${target.id}`} OR ${entityRecords.state}->>'employeeStaffId' = ${target.id})`,
      ));
    if (linkedHrRows.length === 0) {
      await tx.insert(entityRecords).values({
        id: `hr-employee:${target.id}`,
        tenantId: actor.tenantId,
        entity: "hr-employee-records",
        development: target.developments.length === 1 ? target.developments[0]! : null,
        state: withInitialWorkflowState("hr-employee-records", {
          employeeStaffId: target.id,
          firstName: target.firstName || undefined,
          lastName: target.lastName || undefined,
          position: target.position,
          role: target.role,
          employmentStatus: target.status,
          title: `${target.name} employee record`,
          assignedDevelopments: target.developments,
        }),
        createdBy: actor.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoNothing();
      linkedHrRows = await tx
        .select()
        .from(entityRecords)
        .where(and(
          eq(entityRecords.tenantId, actor.tenantId),
          eq(entityRecords.entity, "hr-employee-records"),
          eq(entityRecords.deleted, false),
          sql`(${entityRecords.id} = ${`hr-employee:${target.id}`} OR ${entityRecords.state}->>'employeeStaffId' = ${target.id})`,
        ));
    }
    if (linkedHrRows.length !== 1) throw new StaffAssignmentIntegrityError();
    const [staff] = await tx
      .update(staffAccounts)
      .set({ developments, updatedAt: new Date() })
      .where(and(
        eq(staffAccounts.id, target.id),
        eq(staffAccounts.tenantId, actor.tenantId),
      ))
      .returning();
    if (!staff) throw new StaffAssignmentIntegrityError();
    const record = linkedHrRows[0]!;
    const [hrRecord] = await tx
      .update(entityRecords)
      .set({
        development: developments.length === 1 ? developments[0]! : null,
        state: { ...record.state, assignedDevelopments: developments },
        version: sql`${entityRecords.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(entityRecords.id, record.id),
        eq(entityRecords.tenantId, actor.tenantId),
      ))
      .returning({ id: entityRecords.id });
    if (!hrRecord) throw new StaffAssignmentIntegrityError();
    return staff;
  }).catch((error: unknown) => {
    if (error instanceof StaffAssignmentIntegrityError) return null;
    throw error;
  });
  if (!updated) {
    res.status(409).json({ error: "Staff assignment requires exactly one linked HR employee record" });
    return;
  }
  await audit(
    actor,
    "staff.developments_updated",
    `Moved ${target.name} to ${developments.length ? developments.join(", ") : "no assigned developments"}`,
    target.id,
  );
  res.json(safe(updated, actor));
});

router.put("/v1/staff/:id/assignment", async (req, res) => {
  const actor = actorFrom(res);
  if (actor.role !== "human_resources") {
    res.status(403).json({ error: "Only Human Resources may change staff assignments" });
    return;
  }
  const input = req.body && typeof req.body === "object"
    ? req.body as {
      position?: unknown;
      role?: unknown;
      developments?: unknown;
      annualSalary?: unknown;
      hourlyRate?: unknown;
    }
    : {};
  const position = typeof input.position === "string" ? input.position.trim() : "";
  const role = typeof input.role === "string" ? input.role.trim() : "";
  const developments = Array.isArray(input.developments)
    ? [...new Set(input.developments.filter(
      (item: unknown): item is string => typeof item === "string",
    ).map((item) => item.trim()).filter(Boolean))]
    : null;
  const hasAnnualSalary = Object.prototype.hasOwnProperty.call(input, "annualSalary");
  const hasHourlyRate = Object.prototype.hasOwnProperty.call(input, "hourlyRate");
  const parseCompensation = (value: unknown): number | null | undefined => {
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      value > 10_000_000) return undefined;
    const cents = Math.round(value * 100);
    return Number.isSafeInteger(cents) ? cents : undefined;
  };
  const annualSalaryCents = hasAnnualSalary
    ? parseCompensation(input.annualSalary) : undefined;
  const hourlyRateCents = hasHourlyRate
    ? parseCompensation(input.hourlyRate) : undefined;
  if ((hasAnnualSalary && annualSalaryCents === undefined) ||
    (hasHourlyRate && hourlyRateCents === undefined)) {
    res.status(400).json({ error: "Compensation must be a finite, nonnegative amount no greater than $10,000,000" });
    return;
  }
  if (
    !position ||
    !STAFF_POSITIONS.includes(position as (typeof STAFF_POSITIONS)[number]) ||
    !canHrAssignPositionRole(position, role) ||
    !developments
  ) {
    res.status(400).json({ error: "Valid position, role, and developments are required" });
    return;
  }
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.id, req.params["id"]!),
      eq(staffAccounts.tenantId, actor.tenantId),
    ))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  if (!canManageStaff(actor, target)) {
    res.status(403).json({ error: "Not allowed to change this staff member" });
    return;
  }
  const nextAnnualSalaryCents = hasAnnualSalary ? annualSalaryCents! : target.annualSalaryCents;
  const nextHourlyRateCents = hasHourlyRate ? hourlyRateCents! : target.hourlyRateCents;
  if ((nextAnnualSalaryCents ?? 0) > 0 && (nextHourlyRateCents ?? 0) > 0) {
    res.status(400).json({ error: "Set at most one positive compensation amount" });
    return;
  }
  const developmentRequiredPositions = new Set([
    "Regional Director",
    "Assistant Regional Director",
    "Property Manager",
    "Superintendent",
    "Superintendent Ⓔ",
    "Assistant Superintendent",
  ]);
  if (
    (developmentRequiredPositions.has(position) || position.toLowerCase().includes("supervisor")) &&
    developments.length === 0
  ) {
    res.status(400).json({ error: "Select at least one assigned development" });
    return;
  }
  const [organization] = await db
    .select({ features: organizations.features })
    .from(organizations)
    .where(eq(organizations.id, actor.tenantId))
    .limit(1);
  const configuredDevelopments = getConfiguredDevelopmentNames(organization?.features);
  if (
    configuredDevelopments !== null &&
    developments.some((development) => !new Set(configuredDevelopments).has(development))
  ) {
    res.status(400).json({ error: "Assigned developments must be configured by Platform Control" });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-assignment:${actor.tenantId}:${target.id}`}))`);
    const [currentTarget] = await tx
      .select()
      .from(staffAccounts)
      .where(and(
        eq(staffAccounts.id, target.id),
        eq(staffAccounts.tenantId, actor.tenantId),
      ))
      .limit(1);
    if (
      !currentTarget ||
      currentTarget.position !== target.position ||
      currentTarget.role !== target.role ||
      currentTarget.annualSalaryCents !== target.annualSalaryCents ||
      currentTarget.hourlyRateCents !== target.hourlyRateCents ||
      JSON.stringify(currentTarget.developments) !== JSON.stringify(target.developments)
    ) {
      throw new StaffAssignmentIntegrityError();
    }
    let linkedHrRows = await tx
      .select()
      .from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, "hr-employee-records"),
        eq(entityRecords.deleted, false),
        sql`(${entityRecords.id} = ${`hr-employee:${target.id}`} OR ${entityRecords.state}->>'employeeStaffId' = ${target.id})`,
      ));
    if (linkedHrRows.length === 0) {
      await tx.insert(entityRecords).values({
        id: `hr-employee:${target.id}`,
        tenantId: actor.tenantId,
        entity: "hr-employee-records",
        development: target.developments.length === 1 ? target.developments[0]! : null,
        state: withInitialWorkflowState("hr-employee-records", {
          employeeStaffId: target.id,
          firstName: target.firstName || undefined,
          lastName: target.lastName || undefined,
          position: target.position,
          role: target.role,
          employmentStatus: target.status,
          title: `${target.name} employee record`,
          assignedDevelopments: target.developments,
        }),
        createdBy: actor.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoNothing();
      linkedHrRows = await tx
        .select()
        .from(entityRecords)
        .where(and(
          eq(entityRecords.tenantId, actor.tenantId),
          eq(entityRecords.entity, "hr-employee-records"),
          eq(entityRecords.deleted, false),
          sql`(${entityRecords.id} = ${`hr-employee:${target.id}`} OR ${entityRecords.state}->>'employeeStaffId' = ${target.id})`,
        ));
    }
    if (linkedHrRows.length !== 1) throw new StaffAssignmentIntegrityError();
    const now = new Date();
    const [staff] = await tx
      .update(staffAccounts)
      .set({
        position,
        role,
        developments,
        ...(hasAnnualSalary ? { annualSalaryCents: nextAnnualSalaryCents } : {}),
        ...(hasHourlyRate ? { hourlyRateCents: nextHourlyRateCents } : {}),
        updatedAt: now,
      })
      .where(and(
        eq(staffAccounts.id, target.id),
        eq(staffAccounts.tenantId, actor.tenantId),
      ))
      .returning();
    if (!staff) throw new StaffAssignmentIntegrityError();
    const record = linkedHrRows[0]!;
    const [hrRecord] = await tx.update(entityRecords).set({
      development: developments.length === 1 ? developments[0]! : null,
      state: {
        ...record.state,
        position,
        role,
        assignedDevelopments: developments,
      },
      version: sql`${entityRecords.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(entityRecords.id, record.id),
      eq(entityRecords.tenantId, actor.tenantId),
    )).returning({ id: entityRecords.id });
    if (!hrRecord) throw new StaffAssignmentIntegrityError();
    await auditInTransaction(
      tx,
      actor,
      "staff.assignment_updated",
      `Changed ${target.name} position from ${currentTarget.position} to ${position} (${role}) in ${developments.length ? developments.join(", ") : "no assigned developments"}`,
      target.id,
    );
    return staff;
  }).catch((error: unknown) => {
    if (error instanceof StaffAssignmentIntegrityError) return null;
    throw error;
  });
  if (!updated) {
    res.status(409).json({ error: "Staff assignment requires exactly one linked HR employee record" });
    return;
  }
  res.json(safe(updated, actor));
});

router.post("/v1/staff/:id/revoke", async (req, res) => {
  const actor = actorFrom(res);
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.id, req.params["id"]!),
        eq(staffAccounts.tenantId, actor.tenantId),
      ),
    )
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  if (!canManageStaff(actor, target)) {
    res.status(403).json({ error: "Not allowed to manage this staff account" });
    return;
  }
  const [updated] = await db
    .update(staffAccounts)
    .set({
      status: "revoked",
      sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(staffAccounts.id, req.params["id"]!),
        eq(staffAccounts.tenantId, actor.tenantId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Staff account not found" });
    return;
  }
  await audit(actor, "staff.revoked", `Revoked ${updated.name}`, updated.id);
  res.json(safe(updated, actor));
});

export default router;