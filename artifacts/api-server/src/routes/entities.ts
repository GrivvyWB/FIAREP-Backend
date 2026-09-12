import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { db, entityRecords, publicAccessCodes, staffAccounts } from "@workspace/db";
import { audit, notify } from "../lib/audit";
import {
  ENTITIES,
  canCreateEntity,
  canDeleteEntity,
  canMutateEntity,
  canPerformEntityAction,
  canReadEntity,
  entityDevelopmentAllowed,
  generatedCode,
  isBoroughDirector,
  isValidEntityTransition,
  patchesWorkflowManagedFields,
  recordId,
  stripPricing,
  withInitialWorkflowState,
  procurementRecordAllowed,
} from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { emailReleasedScope } from "../lib/vendorEmail";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use("/v1", requireAuth);

function validEntity(value: string | undefined): value is string {
  return typeof value === "string" && ENTITIES.has(value);
}

function stateOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const TRADE_SUPERVISOR_POSITIONS = new Set([
  "Plumber Supervisor",
  "Electric Supervisor",
  "Elevator Supervisor",
  "Painter Supervisor",
  "Carpenter Supervisor",
]);

function assignmentTargetAllowed(
  actor: ReturnType<typeof actorFrom>,
  target: typeof staffAccounts.$inferSelect,
  development: string | null,
) {
  if (target.id === actor.id || target.position === "Borough Director") return false;
  if (!["management", "worker", "inspector", "emergency"].includes(target.role)) return false;
  if (development && !target.developments.includes(development)) return false;
  if (isBoroughDirector(actor)) return true;
  if (!target.developments.length ||
      !target.developments.every((value) => actor.developments.includes(value))) return false;
  if (target.role === "management") {
    return actor.position === "Regional Director" ||
      TRADE_SUPERVISOR_POSITIONS.has(target.position);
  }
  return ["worker", "inspector", "emergency"].includes(target.role);
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

function privateRecordAllowed(
  actor: ReturnType<typeof actorFrom>,
  row: typeof entityRecords.$inferSelect,
): boolean {
  if (actor.role === "resident") {
    return row.entity === "resident-reports" && row.createdBy === actor.id;
  }
  if (
    actor.role === "vendor" &&
    (row.entity === "procurement-bids" || row.entity === "vendor-quotes")
  ) {
    return row.createdBy === actor.id;
  }
  return true;
}

function emergencyRecordAllowed(actor: ReturnType<typeof actorFrom>, row: typeof entityRecords.$inferSelect): boolean {
  if (actor.role !== "emergency") return true;
  const state = row.state;
  const normalizedActor = actor.name.trim().toLowerCase().replace(/\s+/g, " ");
  return (row.entity === "emergency-jobs" || row.entity === "emergency-units") &&
    [state["assignedTo"], state["assignedStaffId"], state["assignedUnitId"], state["unitId"], state["name"], state["unitName"]]
      .some((value) => typeof value === "string" && (value === actor.id || value.trim().toLowerCase().replace(/\s+/g, " ") === normalizedActor));
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
  const rows = await db
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
      .filter((row) => entityDevelopmentAllowed(actor, entity, row.development))
      .filter((row) => privateRecordAllowed(actor, row))
      .filter((row) => procurementRecordAllowed(actor, row))
      .filter((row) => emergencyRecordAllowed(actor, row))
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
  const createdState = withInitialWorkflowState(
    entity,
    entity === "leave-requests"
      ? { ...rawState, requesterStaffId: actor.id }
      : rawState,
  );
  if (entity === "procurement") {
    // Preserve a server-derived notification target; clients must not be able
    // to impersonate another CPM in workflow routing.
    createdState["cpmName"] = actor.name;
    createdState["cpmId"] = actor.id;
  }
  const [created] = await db
    .insert(entityRecords)
    .values({
      id,
      tenantId: actor.tenantId,
      entity,
      projectId,
      development,
      state: withGeneratedFields(entity, createdState),
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
  const [row] = await db
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
    !row ||
    !entityDevelopmentAllowed(actor, entity, row.development) ||
    !privateRecordAllowed(actor, row)
    || !procurementRecordAllowed(actor, row)
    || !emergencyRecordAllowed(actor, row)
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
    !entityDevelopmentAllowed(actor, entity, current.development) ||
    !privateRecordAllowed(actor, current)
    || !procurementRecordAllowed(actor, current)
    || !emergencyRecordAllowed(actor, current)
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
  const updatedState = { ...current.state, ...patch };
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

router.post("/v1/:entity/:id/actions/:action", async (req, res, next) => {
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
  if (!current || !privateRecordAllowed(actor, current) || !emergencyRecordAllowed(actor, current)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!procurementRecordAllowed(actor, current)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!entityDevelopmentAllowed(actor, entity, current.development)) {
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
    },
    "building-violations": {
      approve: "approved",
      route: "routed",
      complete: "done",
      clear: "done",
    },
    "leave-requests": {
      approve: "Approved",
      deny: "Denied",
      cancel: "Cancelled",
    },
    "elevator-jobs": { "on-my-way": "assigned", start: "assigned", complete: "done" },
    "emergency-jobs": { "on-my-way": "assigned", start: "assigned", complete: "done" },
  };
  const nextStatus = transitions[entity]?.[action];
  if (!nextStatus) {
    res.status(400).json({ error: "Unsupported workflow action" });
    return;
  }
  if (!canPerformEntityAction(actor, entity, action, current.state)) {
    res.status(403).json({ error: "Not allowed to perform this workflow action" });
    return;
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
  const body = stateOf(req.body) ?? {};
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
    if (!target || !assignmentTargetAllowed(actor, target, current.development)) {
      res.status(403).json({ error: "Select an operational staff member from your authorized group" });
      return;
    }
    body["assignedTo"] = target.name;
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
    target = String(current.state["employee"] ?? "");
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
    } else {
      await notify(actor, target, `${entity.replaceAll("-", " ")} ${nextStatus}`, undefined, current.id);
    }
  }
  res.json(outward(actor, updated!));
});

router.delete("/v1/:entity/:id", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
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
  if (!canReadEntity(actor, entity) || !procurementRecordAllowed(actor, current) ||
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
  if (!entityDevelopmentAllowed(actor, entity, current.development)) {
    res.status(404).json({ error: "Record not found" });
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
  const [deleted] = await db
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
  if (!deleted) {
    res.status(409).json({ error: "Concurrent update detected" });
    return;
  }
  await audit(actor, `${entity}.deleted`, `Deleted ${entity} record`, current.id);
  res.status(204).send();
});

export default router;