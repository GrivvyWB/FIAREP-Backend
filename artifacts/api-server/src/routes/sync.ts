import { Router, type IRouter } from "express";
import { and, asc, eq, gt, inArray, lte, or } from "drizzle-orm";
import { db, entityRecords, notifications } from "@workspace/db";
import {
  ENTITIES,
  canReadEntity,
  entityDevelopmentAllowed,
  stripPricing,
  procurementRecordAllowed,
} from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
function emergencyVisible(actor: ReturnType<typeof actorFrom>, row: typeof entityRecords.$inferSelect): boolean {
  if (actor.role !== "emergency") return true;
  const normalizedActor = actor.name.trim().toLowerCase().replace(/\s+/g, " ");
  return (row.entity === "emergency-jobs" || row.entity === "emergency-units") &&
    [row.state["assignedTo"], row.state["assignedStaffId"], row.state["assignedUnitId"], row.state["unitId"], row.state["name"], row.state["unitName"]]
      .some((value) => typeof value === "string" && (value === actor.id || value.trim().toLowerCase().replace(/\s+/g, " ") === normalizedActor));
}

router.get("/v1/sync", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const sinceRaw = typeof req.query["since"] === "string" ? req.query["since"] : "";
  const since = sinceRaw ? new Date(sinceRaw) : new Date(0);
  if (Number.isNaN(since.getTime())) {
    res.status(400).json({ error: "since must be an ISO timestamp" });
    return;
  }
  const requested =
    typeof req.query["entities"] === "string"
      ? req.query["entities"]
          .split(",")
          .map((item) => item.trim())
          .filter((item) => ENTITIES.has(item))
      : [...ENTITIES];
  const cursor = new Date();
  const readable = requested.filter((entity) => canReadEntity(actor, entity));
  const records =
      readable.length === 0
      ? []
      : await db
          .select()
          .from(entityRecords)
          .where(
            and(
              eq(entityRecords.tenantId, actor.tenantId),
              gt(entityRecords.updatedAt, since),
              lte(entityRecords.updatedAt, cursor),
        inArray(entityRecords.entity, readable),
            ),
          )
          .orderBy(asc(entityRecords.updatedAt), asc(entityRecords.id));
  const alerts = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, actor.tenantId),
        gt(notifications.updatedAt, since),
        lte(notifications.updatedAt, cursor),
        or(
          eq(notifications.target, actor.name),
          eq(notifications.target, actor.role),
        ),
      ),
    )
    .orderBy(asc(notifications.updatedAt));
  const visibleRecords = records
    .filter((row) => entityDevelopmentAllowed(actor, row.entity, row.development))
    .filter((row) => emergencyVisible(actor, row))
    .filter((row) => procurementRecordAllowed(actor, row));
  // A workflow transition can make a record disappear from a role's filtered
  // view.  Emit a metadata-only tombstone so mobile caches cannot retain the
  // old submitted/approved scope indefinitely.
  const tombstones = records
    .filter((row) => row.entity === "procurement" && !procurementRecordAllowed(actor, row))
    .filter((row) => {
      if (actor.role === "inspector" && actor.position === "CPM") return row.createdBy === actor.id;
      if (actor.role === "management") return actor.position !== "Borough Director" &&
        !["Regional Director", "Superintendent"].includes(actor.position);
      return actor.role === "procurement";
    })
    .map((row) => ({ id: row.id, entity: row.entity, deleted: true, version: row.version }));
  res.json({
    cursor: cursor.toISOString(),
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
    notifications: alerts,
  });
});

export default router;