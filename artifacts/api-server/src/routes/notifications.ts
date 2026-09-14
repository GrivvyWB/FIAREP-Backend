import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db, notifications } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { visibleNotificationsFor } from "../lib/notificationVisibility";

const router: IRouter = Router();
router.use("/v1/notifications", requireAuth);

router.get("/v1/notifications", async (_req, res) => {
  const actor = actorFrom(res);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, actor.tenantId),
        or(
          eq(notifications.target, actor.id),
          eq(notifications.target, actor.name),
          eq(notifications.target, actor.role),
        ),
      ),
    )
    .orderBy(desc(notifications.at));
  res.json(await visibleNotificationsFor(actor, rows));
});

router.get("/v1/notifications/unread-count", async (_req, res) => {
  const actor = actorFrom(res);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, actor.tenantId),
        eq(notifications.read, false),
        or(
          eq(notifications.target, actor.id),
          eq(notifications.target, actor.name),
          eq(notifications.target, actor.role),
        ),
      ),
    );
  const visible = await visibleNotificationsFor(actor, rows);
  res.json({ count: visible.length });
});

router.post("/v1/notifications/:id/read", async (req, res) => {
  const actor = actorFrom(res);
  const [candidate] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, req.params["id"]!),
        eq(notifications.tenantId, actor.tenantId),
        inArray(notifications.target, [actor.id, actor.name, actor.role]),
      ),
    )
    .limit(1);
  if (!candidate || (await visibleNotificationsFor(actor, [candidate])).length === 0) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  const [updated] = await db
    .update(notifications)
    .set({ read: true, updatedAt: new Date() })
    .where(
      and(
        eq(notifications.id, req.params["id"]!),
        eq(notifications.tenantId, actor.tenantId),
        inArray(notifications.target, [actor.id, actor.name, actor.role]),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(updated);
});

router.post("/v1/notifications/read-all", async (_req, res) => {
  const actor = actorFrom(res);
  const candidates = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, actor.tenantId),
        inArray(notifications.target, [actor.id, actor.name, actor.role]),
      ),
    );
  const visible = await visibleNotificationsFor(actor, candidates);
  if (!visible.length) {
    res.status(204).send();
    return;
  }
  await db
    .update(notifications)
    .set({ read: true, updatedAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, actor.tenantId),
        inArray(notifications.id, visible.map((notification) => notification.id)),
      ),
    );
  res.status(204).send();
});

export default router;