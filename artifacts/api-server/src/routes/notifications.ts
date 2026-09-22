import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db, notifications, staffAccounts } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { visibleNotificationsFor } from "../lib/notificationVisibility";
import { canDeleteOperationalRecords } from "../lib/domain";

const router: IRouter = Router();
router.use("/v1/notifications", requireAuth);

async function pendingEmployeeReminderIds(
  tenantId: string,
  rows: Array<typeof notifications.$inferSelect>,
) {
  const staffIds = [...new Set(rows
    .filter((row) => row.message === "Employee pending approval" && row.reportId)
    .map((row) => row.reportId!))];
  if (!staffIds.length) return new Set<string>();
  const pending = await db
    .select({ id: staffAccounts.id })
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.tenantId, tenantId),
      eq(staffAccounts.status, "pending"),
      inArray(staffAccounts.id, staffIds),
    ));
  const pendingIds = new Set(pending.map((staff) => staff.id));
  return new Set(rows
    .filter((row) => row.reportId && pendingIds.has(row.reportId))
    .map((row) => row.id));
}

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
  if ((await pendingEmployeeReminderIds(actor.tenantId, [candidate])).has(candidate.id)) {
    res.json(candidate);
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

// Permanently remove a notification so it does not return on the next sync.
// A person may remove notifications addressed to them; administrators and
// higher management may remove any notification in the organization.
router.delete("/v1/notifications/:id", async (req, res) => {
  const actor = actorFrom(res);
  const ownTargets = [actor.id, actor.name, actor.role];
  const [deleted] = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.id, req.params["id"]!),
        eq(notifications.tenantId, actor.tenantId),
        ...(canDeleteOperationalRecords(actor) ? [] : [inArray(notifications.target, ownTargets)]),
      ),
    )
    .returning({ id: notifications.id });
  if (!deleted) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.status(204).end();
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
  const protectedIds = await pendingEmployeeReminderIds(actor.tenantId, visible);
  const markableIds = visible
    .filter((notification) => !protectedIds.has(notification.id))
    .map((notification) => notification.id);
  if (!markableIds.length) {
    res.status(204).send();
    return;
  }
  await db
    .update(notifications)
    .set({ read: true, updatedAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, actor.tenantId),
        inArray(notifications.id, markableIds),
      ),
    );
  res.status(204).send();
});

export default router;