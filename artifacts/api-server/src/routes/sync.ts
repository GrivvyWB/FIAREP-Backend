import { Router, type IRouter } from "express";
import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { db, entityRecords, notifications } from "@workspace/db";
import { ENTITIES, stripPricing } from "../lib/domain";
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
  const records =
    requested.length === 0
      ? []
      : await db
          .select()
          .from(entityRecords)
          .where(
            and(
              eq(entityRecords.tenantId, actor.tenantId),
              gt(entityRecords.updatedAt, since),
              inArray(entityRecords.entity, requested),
            ),
          )
          .orderBy(asc(entityRecords.updatedAt));
  const alerts = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, actor.tenantId),
        gt(notifications.updatedAt, since),
        or(
          eq(notifications.target, actor.name),
          eq(notifications.target, actor.role),
        ),
      ),
    )
    .orderBy(asc(notifications.updatedAt));
  res.json({
    cursor: cursor.toISOString(),
    records: records.map((row) => ({
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