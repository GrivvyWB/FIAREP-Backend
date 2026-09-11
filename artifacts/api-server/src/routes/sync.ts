import { Router, type IRouter } from "express";
import { and, asc, eq, gt, inArray, lte, or } from "drizzle-orm";
import { db, entityRecords, notifications } from "@workspace/db";
import {
  ENTITIES,
  canReadEntity,
  entityDevelopmentAllowed,
  stripPricing,
} from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

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
  res.json({
    cursor: cursor.toISOString(),
    records: records
      .filter((row) =>
        entityDevelopmentAllowed(actor, row.entity, row.development),
      )
      .map((row) => ({
      id: row.id,
      entity: row.entity,
      projectId: row.projectId,
      development: row.development,
      state: stripPricing(actor, row.state),
      deleted: row.deleted,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      })),
    notifications: alerts,
  });
});

export default router;