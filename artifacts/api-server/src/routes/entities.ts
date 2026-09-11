import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
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
} from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";

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
  ) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (
    entity === "procurement" &&
    current.state["status"] === "closed" &&
    !isBoroughDirector(actor)
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
  if (!current || !privateRecordAllowed(actor, current)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!entityDevelopmentAllowed(actor, entity, current.development)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (
    entity === "procurement" &&
    current.state["status"] === "closed" &&
    !isBoroughDirector(actor)
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
  if (!isValidEntityTransition(entity, action, current.state)) {
    res.status(409).json({
      error: "This workflow action is not valid for the current status",
    });
    return;
  }
  const body = stateOf(req.body) ?? {};
  if (patchesWorkflowManagedFields(entity, body)) {
    res.status(403).json({
      error: "Workflow-managed fields are controlled by the selected action",
    });
    return;
  }
  const now = new Date();
  const state = {
    ...current.state,
    ...body,
    status: nextStatus,
    ...(action === "clear" ? { clearedByMgmt: true } : {}),
    [`${action.replaceAll("-", "_")}At`]: now.toISOString(),
  };
  const [updated] = await db
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
  if (!updated) {
    res.status(409).json({ error: "Concurrent update detected" });
    return;
  }
  await audit(
    actor,
    `${entity}.${action}`,
    `${action} ${entity} record`,
    current.id,
  );
  const target =
    typeof body["target"] === "string"
      ? body["target"]
      : entity === "leave-requests"
        ? String(current.state["employee"] ?? "")
        : "management";
  if (target) {
    await notify(
      actor,
      target,
      `${entity.replaceAll("-", " ")} ${nextStatus}`,
      undefined,
      current.id,
    );
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
  if (!entityDevelopmentAllowed(actor, entity, current.development)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!canDeleteEntity(actor, current.state)) {
    res.status(403).json({ error: "Management clearance is required" });
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