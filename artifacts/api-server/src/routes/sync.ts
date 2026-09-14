import { Router, type IRouter } from "express";
import { and, asc, eq, gt, lte, or } from "drizzle-orm";
import { db, entityRecords, notifications } from "@workspace/db";
import {
  ENTITIES,
  canReadEntity,
  canReadEntityRecord,
  entityDevelopmentAllowed,
  stripPricing,
  procurementRecordAllowed,
} from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { visibleNotificationsFor } from "../lib/notificationVisibility";

const router: IRouter = Router();
function emergencyVisible(actor: ReturnType<typeof actorFrom>, row: typeof entityRecords.$inferSelect): boolean {
  if (actor.role !== "emergency") return true;
  const normalizedActor = actor.name.trim().toLowerCase().replace(/\s+/g, " ");
  return (row.entity === "emergency-jobs" || row.entity === "emergency-units") &&
    [row.state["assignedTo"], row.state["assignedStaffId"], row.state["assignedUnitId"], row.state["unitId"], row.state["name"], row.state["unitName"]]
      .some((value) => typeof value === "string" && (value === actor.id || value.trim().toLowerCase().replace(/\s+/g, " ") === normalizedActor));
}

function privateVisible(actor: ReturnType<typeof actorFrom>, row: typeof entityRecords.$inferSelect): boolean {
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

function parseRecordCursors(value: string | undefined): Record<string, Date> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter(([entity, cursor]) => ENTITIES.has(entity) && typeof cursor === "string")
      .map(([entity, cursor]) => [entity, new Date(cursor as string)])
      .filter(([, cursor]) => !Number.isNaN((cursor as Date).getTime())),
  );
}

router.get("/v1/sync", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const sinceRaw = typeof req.query["since"] === "string" ? req.query["since"] : "";
  const legacySince = sinceRaw ? new Date(sinceRaw) : new Date(0);
  if (Number.isNaN(legacySince.getTime())) {
    res.status(400).json({ error: "since must be an ISO timestamp" });
    return;
  }
  const recordCursorRaw = typeof req.query["recordCursor"] === "string"
    ? req.query["recordCursor"]
    : undefined;
  const notificationCursorRaw = typeof req.query["notificationCursor"] === "string"
    ? req.query["notificationCursor"]
    : undefined;
  const recordSince = recordCursorRaw ? new Date(recordCursorRaw) : legacySince;
  const notificationSince = notificationCursorRaw
    ? new Date(notificationCursorRaw)
    : legacySince;
  if (
    (recordCursorRaw && Number.isNaN(recordSince.getTime())) ||
    (notificationCursorRaw && Number.isNaN(notificationSince.getTime()))
  ) {
    res.status(400).json({ error: "sync cursors must be ISO timestamps" });
    return;
  }
  const recordCursorsRaw = typeof req.query["recordCursors"] === "string"
    ? req.query["recordCursors"]
    : typeof req.query["entityCursors"] === "string"
      ? req.query["entityCursors"]
      : undefined;
  const recordCursors = parseRecordCursors(recordCursorsRaw);
  const requested =
    typeof req.query["entities"] === "string"
      ? req.query["entities"]
          .split(",")
          .map((item) => item.trim())
          .filter((item) => ENTITIES.has(item))
      : [...ENTITIES];
  const cursor = new Date();
  const readable = requested.filter((entity) => canReadEntity(actor, entity));
  const windows = readable.map((entity) =>
    and(
      eq(entityRecords.entity, entity),
      gt(entityRecords.updatedAt, recordCursors[entity] ?? recordSince),
      lte(entityRecords.updatedAt, cursor),
    ),
  );
  const records =
    readable.length === 0
      ? []
      : await db
        .select()
        .from(entityRecords)
        .where(
          and(
            eq(entityRecords.tenantId, actor.tenantId),
            or(...windows),
          ),
        )
        .orderBy(asc(entityRecords.updatedAt), asc(entityRecords.id));
  const alerts = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, actor.tenantId),
        gt(notifications.updatedAt, notificationSince),
        lte(notifications.updatedAt, cursor),
        or(
          eq(notifications.target, actor.id),
          eq(notifications.target, actor.name),
          eq(notifications.target, actor.role),
        ),
      ),
    )
    .orderBy(asc(notifications.updatedAt));
  const visibleAlerts = await visibleNotificationsFor(actor, alerts);
  const authorizedRecords = records
    .filter((row) => entityDevelopmentAllowed(actor, row.entity, row.development))
    .filter((row) => privateVisible(actor, row))
    .filter((row) => emergencyVisible(actor, row))
    .filter((row) => procurementRecordAllowed(actor, row))
    // Deleted rows are returned as tombstones, but they must pass the same
    // record-level boundary as live rows without letting the deleted flag
    // itself make them fail authorization.
    .filter((row) => canReadEntityRecord(actor, { ...row, deleted: false }));
  const visibleRecords = authorizedRecords.filter((row) => !row.deleted);
  // Deleted rows retain their metadata server-side.  Return a generic,
  // metadata-only tombstone after all of the same visibility checks as a live
  // record so private/development/role scopes are never disclosed.
  const tombstones = authorizedRecords
    .filter((row) => row.deleted)
    .map((row) => ({
      id: row.id,
      entity: row.entity,
      deleted: true,
      version: row.version,
      updatedAt: row.updatedAt,
    }));
  res.json({
    cursor: cursor.toISOString(),
    recordCursor: cursor.toISOString(),
    notificationCursor: cursor.toISOString(),
    recordCursors: Object.fromEntries(
      readable.map((entity) => [entity, cursor.toISOString()]),
    ),
    records: [...visibleRecords.map((row) => ({
      id: row.id,
      entity: row.entity,
      projectId: row.projectId,
      development: row.development,
      state: stripPricing(actor, row.state),
      deleted: row.deleted,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })), ...tombstones],
    notifications: visibleAlerts,
  });
});

export default router;