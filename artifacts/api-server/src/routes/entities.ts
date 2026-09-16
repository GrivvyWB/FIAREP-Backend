import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { db, entityRecords, notifications, organizations, publicAccessCodes, staffAccounts } from "@workspace/db";
import { audit, notify } from "../lib/audit";
import {
  ENTITIES,
  canAssignStaff,
  canApproveLeaveForEmployee,
  canApproveLeaveDuration,
  canDeleteOperationalRecords,
  canCreateEntity,
  canPerformAssignedWorkflowAction,
  canDeleteEntity,
  canMutateEntity,
  canPerformEntityAction,
  canReadEntity,
  canReadEntityRecord,
  entityDevelopmentAllowed,
  generatedCode,
  isBoroughDirector,
  isAssignmentAuthority,
  isLeaveApprovalAuthority,
  leaveRequestDurationDays,
  isValidEntityTransition,
  patchesWorkflowManagedFields,
  recordId,
  stripPricing,
  validLeaveRequestDuration,
  withInitialWorkflowState,
  procurementRecordAllowed,
} from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";
import type { Actor } from "../lib/auth";
import { emailReleasedScope } from "../lib/vendorEmail";
import { logger } from "../lib/logger";
import { repairLegacyResidentDevelopment } from "../lib/legacyResidentDevelopment";
import { rateLimit } from "../lib/rateLimit";

const router: IRouter = Router();
router.use("/v1", requireAuth);
const hrLeaveDecisionRateLimit = rateLimit("hr-leave-decision", 12);

router.get("/v1/deletion-policy", async (_req, res) => {
  const actor = actorFrom(res);
  const [organization] = await db
    .select({ features: organizations.features })
    .from(organizations)
    .where(eq(organizations.id, actor.tenantId))
    .limit(1);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    enabled: organization?.features?.["deletionEnabled"] === true,
    canDelete: canDeleteOperationalRecords(actor),
  });
});

function validEntity(value: string | undefined): value is string {
  return typeof value === "string" && ENTITIES.has(value);
}

function stateOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const ASSIGNMENT_FIELDS = new Set([
  "assignedStaffId",
  "assignedUnitId",
  "assignedTo",
  "assignedStaffName",
  "assignedToName",
]);
const ASSIGNMENT_SCOPED_ENTITIES = [
  "resident-reports",
  "violations",
  "building-violations",
  "priority-violations",
  "route-assignments",
  "elevator-jobs",
  "emergency-jobs",
];

function containsAssignmentFields(state: Record<string, unknown>): boolean {
  return Object.entries(state).some(([key, value]) =>
    ASSIGNMENT_FIELDS.has(key) &&
    value !== undefined &&
    (typeof value !== "string" || value.trim().length > 0),
  );
}

function hasAssignmentFields(state: Record<string, unknown>): boolean {
  return Object.keys(state).some((key) => ASSIGNMENT_FIELDS.has(key));
}

async function canonicalizeAssignment(
  actor: ReturnType<typeof actorFrom>,
  entity: string,
  state: Record<string, unknown>,
  development: string | null,
): Promise<{ state: Record<string, unknown> | null; error?: string }> {
  if (!ASSIGNMENT_SCOPED_ENTITIES.includes(entity) &&
    containsAssignmentFields(state) &&
    !isAssignmentAuthority(actor)) {
    return {
      state: null,
      error: "Only authorized supervisors may assign staff",
    };
  }
  if (
    !ASSIGNMENT_SCOPED_ENTITIES.includes(entity) ||
    !containsAssignmentFields(state)
  ) {
    return { state };
  }
  const rawId = state["assignedStaffId"];
  if (typeof rawId !== "string" || !rawId.trim()) {
    return {
      state: null,
      error: "Assignments must use an approved canonical staff id",
    };
  }
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.id, rawId.trim()),
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
    ))
    .limit(1);
  const inspectorSelfAssignment =
    actor.role === "inspector" &&
    ["violations", "building-violations", "priority-violations", "route-assignments"]
      .includes(entity) &&
    target?.id === actor.id;
  if (!target || (!canAssignStaff(actor, target, development) && !inspectorSelfAssignment)) {
    return {
      state: null,
      error: "Select an operational staff member from your authorized group",
    };
  }
  if (entity === "emergency-jobs") {
    const rawUnitId = state["assignedUnitId"];
    if (
      rawUnitId !== undefined &&
      (typeof rawUnitId !== "string" || !rawUnitId.trim())
    ) {
      return {
        state: null,
        error: "Emergency assignments must use an approved canonical unit id",
      };
    }
    if (typeof rawUnitId === "string" && rawUnitId.trim()) {
      const [unit] = await db
        .select({ id: entityRecords.id })
        .from(entityRecords)
        .where(and(
          eq(entityRecords.id, rawUnitId.trim()),
          eq(entityRecords.entity, "emergency-units"),
          eq(entityRecords.tenantId, actor.tenantId),
          eq(entityRecords.deleted, false),
        ))
        .limit(1);
      if (!unit) {
        return {
          state: null,
          error: "Select an existing emergency unit",
        };
      }
    }
  }
  return {
    state: {
      ...state,
      assignedStaffId: target.id,
      assignedTo: target.name,
    },
  };
}

function outward(
  actor: ReturnType<typeof actorFrom>,
  row: typeof entityRecords.$inferSelect,
) {
  return {
    id: row.id,
    entity: row.entity,
    projectId: row.projectId,
    development: row.development,
    state: stripPricing(actor, row.state),
    deleted: row.deleted,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function withGeneratedFields(
  entity: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const state = { ...input };
  const code = generatedCode(entity);
  if (entity === "resident-reports" && !state["complaintNo"]) {
    state["complaintNo"] = code;
    state["status"] ??= "submitted";
  }
  if (entity === "procurement" && !state["trackingId"]) {
    state["trackingId"] = code;
    state["status"] ??= "draft";
  }
  if (entity === "elevator-jobs" && !state["elId"]) state["elId"] = code;
  if (entity === "emergency-jobs" && !state["emId"]) state["emId"] = code;
  if (entity === "emergency-units" && !state["code"]) state["code"] = code;
  state["createdAt"] ??= new Date().toISOString();
  return state;
}

router.get("/v1/:entity", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!canReadEntity(actor, entity)) {
    res.status(403).json({ error: "This module is restricted for your role" });
    return;
  }
  const storedRows = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, entity),
        eq(entityRecords.deleted, false),
      ),
    )
    .orderBy(desc(entityRecords.updatedAt));
  const rows = entity === "resident-reports"
    ? await Promise.all(storedRows.map(repairLegacyResidentDevelopment))
    : storedRows;
  const projectId =
    typeof req.query["projectId"] === "string" ? req.query["projectId"] : null;
  const development =
    typeof req.query["development"] === "string"
      ? req.query["development"]
      : null;
  const status =
    typeof req.query["status"] === "string" ? req.query["status"] : null;
  res.json(
    rows
      .filter((row) => canReadEntityRecord(actor, row))
      .filter((row) => !projectId || row.projectId === projectId)
      .filter(
        (row) =>
          !development ||
          row.development?.toLowerCase() === development.toLowerCase(),
      )
      .filter((row) => !status || row.state["status"] === status)
      .map((row) => outward(actor, row)),
  );
});

router.post("/v1/:entity", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!canCreateEntity(actor, entity)) {
    res.status(403).json({ error: "Not allowed to create this record" });
    return;
  }
  const body = stateOf(req.body);
  const rawState = stateOf(body?.["state"]);
  if (!body || !rawState) {
    res.status(400).json({ error: "A JSON state object is required" });
    return;
  }
  const id = recordId(body["id"]);
  const [existing] = await db
    .select()
    .from(entityRecords)
    .where(eq(entityRecords.id, id))
    .limit(1);
  if (existing) {
    if (
      existing.entity === "procurement" &&
      (!canReadEntity(actor, entity) || !procurementRecordAllowed(actor, existing))
    ) {
      // Do not reveal whether an id belongs to a downstream scope.
      res.status(404).json({ error: "Record not found" });
      return;
    }
    if (
      existing.tenantId === actor.tenantId &&
      existing.entity === entity &&
      existing.createdBy === actor.id &&
      !existing.deleted
    ) {
      res.json(outward(actor, existing));
      return;
    }
    res.status(409).json({ error: "A different record already uses this id" });
    return;
  }
  const projectId =
    typeof body["projectId"] === "string"
      ? body["projectId"]
      : typeof rawState["projectId"] === "string"
        ? rawState["projectId"]
        : null;
  let development =
    typeof body["development"] === "string"
      ? body["development"]
      : typeof rawState["development"] === "string"
        ? rawState["development"]
        : null;
  if (!development && projectId) {
    const [project] = await db.select({ development: entityRecords.development })
      .from(entityRecords)
      .where(and(eq(entityRecords.id, projectId), eq(entityRecords.entity, "projects"), eq(entityRecords.tenantId, actor.tenantId)))
      .limit(1);
    development = project?.development || null;
  }
  if (
    entity === "projects" &&
    !development &&
    actor.developments.length === 1
  ) {
    development = actor.developments[0]!;
  }
  if (!development && !isBoroughDirector(actor)) {
    res.status(403).json({ error: "A development is required for scoped records" });
    return;
  }
  if (!entityDevelopmentAllowed(actor, entity, development)) {
    res.status(403).json({ error: "Development access denied" });
    return;
  }
  const now = new Date();
  let createdState = withInitialWorkflowState(
    entity,
    entity === "leave-requests"
      ? { ...rawState, requesterStaffId: actor.id }
      : rawState,
  );
  if (entity === "leave-requests") {
    delete createdState["employeeStaffId"];
    delete createdState["supervisorStaffId"];
    const employeeName = typeof createdState["employee"] === "string"
      ? createdState["employee"].trim()
      : "";
    let employee: typeof staffAccounts.$inferSelect | undefined;
    if (employeeName) {
      const employeeMatches = await db.select()
        .from(staffAccounts)
        .where(and(
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.status, "approved"),
          sql`lower(${staffAccounts.name}) = lower(${employeeName})`,
        ))
        .limit(2);
      if (employeeMatches.length === 1) {
        employee = employeeMatches[0]!;
        createdState["employeeStaffId"] = employee.id;
      }
    }
    if (employee) {
      const supervisorName = typeof createdState["supervisor"] === "string"
        ? createdState["supervisor"].trim()
        : "";
      const supervisorMatches = await db.select().from(staffAccounts).where(and(
        eq(staffAccounts.tenantId, actor.tenantId),
        eq(staffAccounts.status, "approved"),
        ...(supervisorName
          ? [sql`lower(${staffAccounts.name}) = lower(${supervisorName})`]
          : []),
      ));
      const eligibleSupervisors = supervisorMatches.filter((candidate) =>
        candidate.role !== "human_resources" &&
        canApproveLeaveForEmployee(
          {
            id: candidate.id,
            tenantId: candidate.tenantId,
            name: candidate.name,
            role: candidate.role as Actor["role"],
            position: candidate.position,
            developments: candidate.developments,
            sessionVersion: candidate.sessionVersion,
          },
          {
            id: employee.id,
            role: employee.role as Actor["role"],
            position: employee.position,
            developments: employee.developments,
          },
        )
      );
      if (eligibleSupervisors.length === 1) {
        createdState["supervisorStaffId"] = eligibleSupervisors[0]!.id;
        createdState["supervisor"] = eligibleSupervisors[0]!.name;
      }
    }
    const leaveDays = leaveRequestDurationDays(createdState);
    if (leaveDays === null || !validLeaveRequestDuration(leaveDays)) {
      res.status(400).json({ error: "Time off must be 1 to 14 days or 30 to 365 days" });
      return;
    }
    if (
      leaveDays >= 30 &&
      (typeof createdState["reasonableAccommodation"] !== "string" ||
        !createdState["reasonableAccommodation"].trim())
    ) {
      res.status(400).json({ error: "A reasonable accommodation is required for 30 to 365 days off" });
      return;
    }
  }
  if (
    actor.role === "inspector" &&
    ["violations", "building-violations", "priority-violations", "route-assignments"]
      .includes(entity) &&
    !containsAssignmentFields(createdState)
  ) {
    createdState = {
      ...createdState,
      assignedStaffId: actor.id,
      assignedTo: actor.name,
    };
  }
  const canonicalCreated = await canonicalizeAssignment(
    actor,
    entity,
    createdState,
    development,
  );
  if (!canonicalCreated.state) {
    res.status(403).json({ error: canonicalCreated.error });
    return;
  }
  const persistedCreatedState = canonicalCreated.state;
  if (entity === "procurement") {
    // Preserve a server-derived notification target; clients must not be able
    // to impersonate another CPM in workflow routing.
    persistedCreatedState["cpmName"] = actor.name;
    persistedCreatedState["cpmId"] = actor.id;
  }
  const [created] = await db
    .insert(entityRecords)
    .values({
      id,
      tenantId: actor.tenantId,
      entity,
      projectId,
      development,
      state: withGeneratedFields(entity, persistedCreatedState),
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await audit(actor, `${entity}.created`, `Created ${entity} record`, id);
  if (entity === "building-violations") {
    await notify(
      actor,
      "management",
      "Inspection logged and awaiting review",
      typeof rawState["building"] === "string" ? rawState["building"] : undefined,
      id,
    );
  } else if (entity === "leave-requests") {
    const reviewers = await db.select({
      id: staffAccounts.id,
      role: staffAccounts.role,
    }).from(staffAccounts).where(and(
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
    ));
    for (const reviewer of reviewers) {
      if (reviewer.role === "human_resources" ||
          reviewer.id === persistedCreatedState["supervisorStaffId"]) {
        await notify(
          actor,
          reviewer.id,
          "Leave request",
          typeof persistedCreatedState["employee"] === "string"
            ? persistedCreatedState["employee"]
            : undefined,
          id,
        );
      }
    }
  }
  res.status(201).json(outward(actor, created!));
});

router.get("/v1/:entity/:id", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!canReadEntity(actor, entity)) {
    res.status(403).json({ error: "This module is restricted for your role" });
    return;
  }
  const [storedRow] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.id, req.params["id"]!),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ),
    )
    .limit(1);
  const row = storedRow && entity === "resident-reports"
    ? await repairLegacyResidentDevelopment(storedRow)
    : storedRow;
  if (
    !row ||
    !canReadEntityRecord(actor, row)
  ) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  res.json(outward(actor, row));
});

router.patch("/v1/:entity/:id", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!canMutateEntity(actor, entity)) {
    res.status(403).json({ error: "Not allowed to update this record" });
    return;
  }
  const input = stateOf(req.body);
  const expectedVersion = input?.["version"];
  if (typeof expectedVersion !== "number") {
    res.status(400).json({ error: "version is required" });
    return;
  }
  const patch = stateOf(input?.["state"]) ?? input;
  if (!patch) {
    res.status(400).json({ error: "A JSON update is required" });
    return;
  }
  if (patchesWorkflowManagedFields(entity, patch)) {
    res.status(403).json({
      error: "Workflow-managed fields must be changed through an authorized action",
    });
    return;
  }
  if (
    hasAssignmentFields(patch) &&
    actor.role !== "management" &&
    actor.role !== "administrator"
  ) {
    res.status(403).json({
      error: "Only authorized supervisors may change an assignment",
    });
    return;
  }
  const [current] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.id, req.params["id"]!),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ),
    )
    .limit(1);
  if (
    !current ||
    !canReadEntityRecord(actor, current)
  ) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (entity === "procurement" &&
      actor.role === "inspector" && actor.position === "CPM" &&
      !["draft", "returned"].includes(String(current.state["status"] ?? ""))) {
    res.status(403).json({ error: "Submitted procurement scopes are read-only" });
    return;
  }
  if (
    entity === "procurement" &&
     current.state["status"] === "closed"
  ) {
    res.status(409).json({ error: "Closed procurement records are immutable" });
    return;
  }
  if (expectedVersion !== current.version) {
    res.status(409).json({
      error: "Concurrent update detected",
      current: outward(actor, current),
    });
    return;
  }
  const canonicalPatch = await canonicalizeAssignment(
    actor,
    entity,
    patch,
    current.development,
  );
  if (!canonicalPatch.state) {
    res.status(403).json({ error: canonicalPatch.error });
    return;
  }
  const updatedState = { ...current.state, ...canonicalPatch.state };
  if (entity === "leave-requests") {
    const leaveDays = leaveRequestDurationDays(updatedState);
    if (leaveDays === null || !validLeaveRequestDuration(leaveDays)) {
      res.status(400).json({ error: "Time off must be 1 to 14 days or 30 to 365 days" });
      return;
    }
    if (
      leaveDays >= 30 &&
      (typeof updatedState["reasonableAccommodation"] !== "string" ||
        !updatedState["reasonableAccommodation"].trim())
    ) {
      res.status(400).json({ error: "A reasonable accommodation is required for 30 to 365 days off" });
      return;
    }
  }
  const updatedDevelopment =
    typeof updatedState["development"] === "string"
      ? updatedState["development"]
      : current.development;
  if (!entityDevelopmentAllowed(actor, entity, updatedDevelopment)) {
    res.status(403).json({ error: "Development access denied" });
    return;
  }
  const now = new Date();
  const [updated] = await db
    .update(entityRecords)
    .set({
      state: updatedState,
      projectId:
        typeof updatedState["projectId"] === "string"
          ? updatedState["projectId"]
          : current.projectId,
      development: updatedDevelopment,
      version: sql`${entityRecords.version} + 1`,
      updatedAt: now,
    })
    .where(and(
      eq(entityRecords.id, current.id),
      eq(entityRecords.entity, entity),
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.deleted, false),
      eq(entityRecords.version, expectedVersion),
    ))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Concurrent update detected" });
    return;
  }
  await audit(actor, `${entity}.updated`, `Updated ${entity} record`, current.id);
  res.json(outward(actor, updated!));
});

router.post(
  "/v1/:entity/:id/actions/:action",
  (req, res, next) => {
    const actor = actorFrom(res);
    if (
      actor.role === "human_resources" &&
      req.params["entity"] === "leave-requests" &&
      (req.params["action"] === "approve" || req.params["action"] === "deny")
    ) {
      hrLeaveDecisionRateLimit(req, res, next);
      return;
    }
    next();
  },
  async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  const action = req.params["action"]!;
  const [current] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.id, req.params["id"]!),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ),
    )
    .limit(1);
  if (!current || !canReadEntityRecord(actor, current)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (
    entity === "procurement" &&
     current.state["status"] === "closed"
  ) {
    res.status(409).json({ error: "Closed procurement records are immutable" });
    return;
  }
  const transitions: Record<string, Record<string, string>> = {
    procurement: {
      submit: "submitted",
      approve: "approved",
      reject: "returned",
      return: "returned",
      broadcast: "bidding",
      award: "awarded",
      "rate-close": "closed",
    },
    "resident-reports": {
      assign: "assigned",
      start: "in_progress",
      resolve: "resolved",
      clear: "resolved",
      complete: "done",
      "approve-work": "work_approved",
    },
    "building-violations": {
      approve: "approved",
      route: "routed",
      complete: "done",
      clear: "done",
      "approve-work": "work_approved",
    },
    "leave-requests": {
      approve: "Approved",
      deny: "Denied",
      cancel: "Cancelled",
    },
    "hud-inspections": {
      approve: "Approved",
      deny: "Denied",
      correction: "Correction",
      resubmit: "Submitted",
    },
    "elevator-jobs": {
      "on-my-way": "assigned",
      start: "in_progress",
      complete: "done",
      "approve-work": "work_approved",
    },
    "emergency-jobs": {
      "on-my-way": "assigned",
      start: "in_progress",
      complete: "done",
      "approve-work": "work_approved",
    },
  };
  const nextStatus = transitions[entity]?.[action];
  if (!nextStatus) {
    res.status(400).json({ error: "Unsupported workflow action" });
    return;
  }
  const body = stateOf(req.body) ?? {};
  if (
    hasAssignmentFields(body) &&
    !(
      entity === "resident-reports" &&
      action === "assign" &&
      Object.keys(body)
        .filter((key) => ASSIGNMENT_FIELDS.has(key))
        .every((key) => key === "assignedStaffId" || key === "assignedTo")
    )
  ) {
    res.status(403).json({
      error: "Assignments must be changed through the dedicated assignment action",
    });
    return;
  }
  if (!canPerformAssignedWorkflowAction(actor, entity, action, current.state)) {
    res.status(403).json({ error: "This workflow action is restricted to the assigned staff member" });
    return;
  }
  if (!canPerformEntityAction(actor, entity, action, current.state)) {
    res.status(403).json({ error: "Not allowed to perform this workflow action" });
    return;
  }
  if (entity === "leave-requests" && (action === "approve" || action === "deny")) {
    const leaveDays = leaveRequestDurationDays(current.state);
    if (leaveDays === null || !canApproveLeaveDuration(actor, leaveDays)) {
      res.status(403).json({
        error: actor.role === "human_resources"
          ? "HR may decide time off from 30 to 365 days"
          : "Management and supervisors may decide up to 14 days",
      });
      return;
    }
    const employeeStaffId = typeof current.state["employeeStaffId"] === "string"
      ? current.state["employeeStaffId"]
      : "";
    const employeeName = typeof current.state["employee"] === "string"
      ? current.state["employee"].trim()
      : "";
    const employeeMatches = employeeStaffId
      ? await db.select().from(staffAccounts).where(and(
          eq(staffAccounts.id, employeeStaffId),
          eq(staffAccounts.tenantId, actor.tenantId),
        )).limit(1)
      : employeeName
        ? await db.select().from(staffAccounts).where(and(
            eq(staffAccounts.tenantId, actor.tenantId),
            sql`lower(${staffAccounts.name}) = lower(${employeeName})`,
          )).limit(2)
        : [];
    const employee = employeeMatches.length === 1 ? employeeMatches[0] : undefined;
    if (!employee || !canApproveLeaveForEmployee(actor, employee)) {
      res.status(403).json({ error: "You may only decide leave for staff you supervise" });
      return;
    }
    if (actor.role === "human_resources") {
      const authorizationCode = typeof body["authorizationCode"] === "string"
        ? body["authorizationCode"].trim().toUpperCase()
        : "";
      const [confirmed] = authorizationCode
        ? await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
            eq(staffAccounts.id, actor.id),
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.role, "human_resources"),
            eq(staffAccounts.status, "approved"),
            eq(staffAccounts.code, authorizationCode),
          )).limit(1)
        : [];
      if (!confirmed) {
        res.status(401).json({ error: "Enter your valid HR access code" });
        return;
      }
    }
  }
  if (entity === "procurement" && action === "submit" &&
      current.createdBy !== actor.id) {
    res.status(403).json({ error: "Only the record owner may submit a procurement draft" });
    return;
  }
  if (!isValidEntityTransition(entity, action, current.state)) {
    res.status(409).json({
      error: "This workflow action is not valid for the current status",
    });
    return;
  }
  if (entity === "resident-reports" && action === "assign") {
    const assignedStaffId = typeof body["assignedStaffId"] === "string"
      ? body["assignedStaffId"]
      : "";
    const [target] = assignedStaffId
      ? await db.select().from(staffAccounts).where(and(
          eq(staffAccounts.id, assignedStaffId),
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.status, "approved"),
        )).limit(1)
      : [];
    if (!target || !canAssignStaff(actor, target, current.development)) {
      res.status(403).json({ error: "Select an operational staff member from your authorized group" });
      return;
    }
    body["assignedStaffId"] = target.id;
    body["assignedTo"] = target.name;
    delete body["assignedStaffName"];
    delete body["assignedToName"];
  }
  if (patchesWorkflowManagedFields(entity, body)) {
    res.status(403).json({
      error: "Workflow-managed fields are controlled by the selected action",
    });
    return;
  }
  const vendorRecipients = Array.isArray(body["vendorRecipients"])
    ? body["vendorRecipients"].flatMap((item) => {
        const contact = stateOf(item);
        const name = typeof contact?.["name"] === "string" ? contact["name"].trim() : "";
        const email = typeof contact?.["email"] === "string" ? contact["email"].trim() : "";
        return email ? [{ name, email }] : [];
      })
    : [];
  // Routing and review provenance are server-owned.  A caller may provide a
  // review note, but cannot redirect the resulting notification or forge the
  // reviewer identity/timestamp.
  const persistedBody = { ...body };
  delete persistedBody["vendorRecipients"];
  delete persistedBody["target"];
  delete persistedBody["authorizationCode"];
  const reviewNote = typeof body["note"] === "string" ? body["note"].trim() : "";
  delete persistedBody["note"];
  const now = new Date();
  const state: Record<string, unknown> = {
    ...current.state,
    ...persistedBody,
    status: nextStatus,
    ...(action === "clear" ? { clearedByMgmt: true } : {}),
    [`${action.replaceAll("-", "_")}At`]: now.toISOString(),
  };
  if (
    entity === "hud-inspections" &&
    ["approve", "deny", "correction"].includes(action)
  ) {
    state["review"] = {
      decision: action === "approve"
        ? "approved"
        : action === "deny"
          ? "rejected"
          : "needs_revision",
      decidedBy: actor.name,
      decidedAt: now.toISOString(),
      ...(reviewNote ? { notes: reviewNote } : {}),
    };
  }
  if (entity === "procurement" &&
      (action === "approve" || action === "reject" || action === "return") &&
      reviewNote) {
    state["reviewNote"] = reviewNote;
    state["reviewBy"] = actor.id;
    state["reviewAt"] = now.toISOString();
  }
  if (entity === "procurement" && action === "award") {
    const bidRows = await db.select().from(entityRecords).where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "procurement-bids"),
      eq(entityRecords.deleted, false),
    ));
    const bidId = typeof body["bidId"] === "string" ? body["bidId"] : "";
    if (!bidId) {
      res.status(400).json({ error: "An existing vendor bid is required" });
      return;
    }
    const selected = bidRows.find((bid) =>
      bid.id === bidId &&
      bid.state["requestId"] === current.id &&
      typeof bid.createdBy === "string" &&
      bid.createdBy.startsWith("public-vendor:") &&
      bid.tenantId === actor.tenantId);
    if (!selected) {
      res.status(400).json({ error: "An existing vendor bid for this scope is required" });
      return;
    }
    state["bidId"] = selected.id;
    state["vendor"] = selected.state["vendorName"];
    state["bidAmount"] = selected.state["amount"];
    state["bidNote"] = selected.state["note"];
    delete state["amount"];
  }
  let updated: typeof entityRecords.$inferSelect | undefined;
  const transitionAttempts = entity === "procurement" && action === "broadcast" ? 8 : 1;
  for (let attempt = 0; attempt < transitionAttempts && !updated; attempt++) {
    if (entity === "procurement" && action === "broadcast") {
      state["trackingId"] = `RC-${randomBytes(4).readUInt32BE(0) % 90000 + 10000}`;
    }
    try {
      updated = await db.transaction(async (tx) => {
        if (entity === "procurement" && action === "broadcast") {
          await tx.insert(publicAccessCodes).values({
            id: randomUUID(),
            kind: "vendor",
            code: String(state["trackingId"]),
            tenantId: actor.tenantId,
            recordId: current.id,
          });
        }
        const [row] = await tx
          .update(entityRecords)
          .set({
            state,
            version: sql`${entityRecords.version} + 1`,
            updatedAt: now,
          })
          .where(and(
            eq(entityRecords.id, current.id),
            eq(entityRecords.entity, entity),
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.deleted, false),
            eq(entityRecords.version, current.version),
          ))
          .returning();
        if (!row) {
          throw Object.assign(new Error("Concurrent update detected"), { status: 409 });
        }
        if (entity === "procurement" && !["bidding", "eligible", "eligible-awarded", "awarded"].includes(String(state["status"]))) {
          await tx.delete(publicAccessCodes).where(and(
            eq(publicAccessCodes.kind, "vendor"),
            eq(publicAccessCodes.recordId, current.id),
            eq(publicAccessCodes.tenantId, actor.tenantId),
          ));
        }
        return row;
      });
    } catch (error: any) {
      if (error?.status === 409) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error?.code === "23505" && attempt + 1 < transitionAttempts) continue;
      if (error?.code === "23505" && entity === "procurement" && action === "broadcast") {
        res.status(503).json({ error: "Could not issue a vendor access code" });
        return;
      }
      throw error;
    }
  }
  if (!updated) {
    res.status(503).json({ error: "Could not complete workflow transition" });
    return;
  }
  await audit(
    actor,
    `${entity}.${action}`,
    `${action} ${entity} record`,
    current.id,
  );
  if (entity === "procurement" && action === "broadcast") {
    try {
      const delivery = await emailReleasedScope(actor.tenantId, state, vendorRecipients);
      logger.info({ procurementId: current.id, ...delivery }, "Vendor scope emails processed");
    } catch (err) {
      logger.error({ err, procurementId: current.id }, "Vendor scope email delivery failed");
    }
  }
  let target = "";
  if (entity === "leave-requests") {
    target = typeof current.state["employeeStaffId"] === "string"
      ? current.state["employeeStaffId"]
      : "";
    if (!target) {
      const employeeName = typeof current.state["employee"] === "string"
        ? current.state["employee"].trim()
        : "";
      const employeeMatches = employeeName
        ? await db.select({ id: staffAccounts.id })
          .from(staffAccounts)
          .where(and(
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.status, "approved"),
            sql`lower(${staffAccounts.name}) = lower(${employeeName})`,
          ))
          .limit(2)
        : [];
      target = employeeMatches.length === 1
        ? employeeMatches[0]!.id
        : String(current.state["requesterStaffId"] ?? current.createdBy ?? "");
    }
  } else if (entity === "resident-reports" && action === "assign") {
    target = typeof state["assignedStaffId"] === "string"
      ? state["assignedStaffId"]
      : "";
  } else if (entity === "hud-inspections") {
    target = String(current.createdBy ?? "");
  } else if (entity === "procurement") {
    // Every procurement notification follows the canonical workflow.  Never
    // honor a client supplied target.
    if (action === "submit") target = "management";
    else if (action === "approve") target = "procurement";
    else if (action === "reject" || action === "return") {
      target = typeof current.state["cpmName"] === "string"
        ? current.state["cpmName"]
        : typeof current.state["inspectorName"] === "string"
          ? current.state["inspectorName"]
          : "management";
    }
  } else {
    target = "management";
  }
  if (target) {
    if (entity === "procurement" && action === "submit") {
      const reviewers = await db.select({ name: staffAccounts.name, position: staffAccounts.position })
        .from(staffAccounts)
        .where(and(
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.role, "management"),
          eq(staffAccounts.status, "approved"),
        ));
      for (const reviewer of reviewers) {
        if (["Borough Director", "Regional Director", "Superintendent"].includes(reviewer.position)) continue;
        await notify(actor, reviewer.name, "Scope submitted for Management review", undefined, current.id);
      }
    } else if (entity === "procurement" && action === "approve") {
      const recipients = await db.select({ name: staffAccounts.name })
        .from(staffAccounts)
        .where(and(eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.role, "procurement"), eq(staffAccounts.status, "approved")));
      for (const recipient of recipients) await notify(actor, recipient.name, "Scope approved for Procurement", undefined, current.id);
    } else if (entity === "procurement" && (action === "reject" || action === "return")) {
      const [origin] = await db.select({ name: staffAccounts.name, position: staffAccounts.position })
        .from(staffAccounts)
        .where(and(eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.id, current.createdBy || "")))
        .limit(1);
      if (origin && origin.position === "CPM") await notify(actor, origin.name, `Scope ${nextStatus}`, undefined, current.id);
    } else if (entity === "resident-reports" && action === "assign") {
      const detail = [
        typeof state["complaintNo"] === "string" ? state["complaintNo"] : "",
        typeof state["address"] === "string" ? state["address"] : "",
        typeof state["unit"] === "string" && state["unit"]
          ? `Unit ${state["unit"]}`
          : "",
        typeof state["development"] === "string" ? state["development"] : "",
      ].filter(Boolean).join(" · ");
      await notify(actor, target, "New job assigned", detail || undefined, current.id);
    } else {
      await notify(actor, target, `${entity.replaceAll("-", " ")} ${nextStatus}`, undefined, current.id);
    }
  }
  res.json(outward(actor, updated!));
  },
);

router.delete("/v1/:entity/:id", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
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
  if (!canDeleteOperationalRecords(actor)) {
    res.status(403).json({ error: "Only higher management can delete records" });
    return;
  }
  const [current] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.id, req.params["id"]!),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ),
    )
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!canReadEntityRecord(actor, current) ||
      !canDeleteEntity(actor, entity, current.state)) {
    res.status(403).json({ error: "Not allowed to delete this record" });
    return;
  }
  if (entity === "procurement" &&
      actor.role === "inspector" && actor.position === "CPM" &&
      !["draft", "returned"].includes(String(current.state["status"] ?? ""))) {
    res.status(403).json({ error: "Submitted procurement scopes cannot be deleted" });
    return;
  }
  if (entity === "procurement" && current.state["status"] === "closed") {
    res.status(409).json({ error: "Closed procurement records are immutable" });
    return;
  }
  const expectedVersion = (req.body as { version?: unknown })?.version;
  if (typeof expectedVersion !== "number") {
    res.status(400).json({ error: "version is required" });
    return;
  }
  if (expectedVersion !== current.version) {
    res.status(409).json({ error: "Concurrent update detected", current: outward(actor, current) });
    return;
  }
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(entityRecords)
      .set({
        deleted: true,
        version: sql`${entityRecords.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(entityRecords.id, current.id),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
        eq(entityRecords.version, expectedVersion),
      ))
      .returning();
    if (row && entity === "resident-reports") {
      await tx
        .delete(notifications)
        .where(and(
          eq(notifications.tenantId, actor.tenantId),
          eq(notifications.reportId, current.id),
        ));
    }
    return row;
  });
  if (!deleted) {
    res.status(409).json({ error: "Concurrent update detected" });
    return;
  }
  await audit(actor, `${entity}.deleted`, `Deleted ${entity} record`, current.id);
  res.status(204).send();
});

export default router;