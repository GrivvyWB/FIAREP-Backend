import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  auditLog,
  db,
  deviceTokens,
  pushDeliveries,
  settings,
} from "@workspace/db";
import { notify } from "../lib/audit";
import { isElevated } from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/v1", requireAuth);

const DEFAULT_RATES = {
  waste: 1.12,
  sheetCost: 16,
  laborPerSqFt: 2.1,
  paintPerSqFt: 0.85,
  floorPerSqFt: 5.5,
};

router.post("/v1/devices/token", async (req, res) => {
  const actor = actorFrom(res);
  const body = req.body as Record<string, unknown>;
  const token = typeof body["token"] === "string" ? body["token"] : "";
  if (!/^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(token)) {
    res.status(400).json({ error: "A valid Expo push token is required" });
    return;
  }
  const [saved] = await db
    .insert(deviceTokens)
    .values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      staffId: actor.id,
      token,
      platform:
        typeof body["platform"] === "string" ? body["platform"] : "unknown",
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [deviceTokens.tenantId, deviceTokens.token],
      set: {
        staffId: actor.id,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  res.status(201).json(saved);
});

router.delete("/v1/devices/token", async (req, res) => {
  const actor = actorFrom(res);
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) { res.status(400).json({ error: "token is required" }); return; }
  await db.delete(deviceTokens).where(and(
    eq(deviceTokens.tenantId, actor.tenantId),
    eq(deviceTokens.staffId, actor.id),
    eq(deviceTokens.token, token),
  ));
  res.status(204).send();
});

router.get("/v1/settings/:key", async (req, res) => {
  const actor = actorFrom(res);
  const [row] = await db
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.tenantId, actor.tenantId),
        eq(settings.key, req.params["key"]!),
      ),
    )
    .limit(1);
  if (!row) {
    if (req.params["key"] === "default-rates") {
      res.json({ key: "default-rates", value: DEFAULT_RATES, updatedAt: null });
      return;
    }
    res.status(404).json({ error: "Setting not found" });
    return;
  }
  res.json({ key: row.key, value: row.value, updatedAt: row.updatedAt });
});

router.put("/v1/settings/:key", async (req, res) => {
  const actor = actorFrom(res);
  if (!isElevated(actor)) {
    res.status(403).json({ error: "Elevated management access required" });
    return;
  }
  const now = new Date();
  const [row] = await db
    .insert(settings)
    .values({
      tenantId: actor.tenantId,
      key: req.params["key"]!,
      value: (req.body as { value?: unknown }).value,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [settings.tenantId, settings.key],
      set: { value: (req.body as { value?: unknown }).value, updatedAt: now },
    })
    .returning();
  res.json(row);
});

router.get("/v1/audit-log", async (_req, res) => {
  const actor = actorFrom(res);
  if (!isElevated(actor)) {
    res.status(403).json({ error: "Elevated management access required" });
    return;
  }
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, actor.tenantId))
    .orderBy(desc(auditLog.at));
  res.json(rows);
});

router.get("/v1/push-deliveries", async (req, res) => {
  const actor = actorFrom(res);
  if (!isElevated(actor)) {
    res.status(403).json({ error: "Elevated management access required" });
    return;
  }
  const notificationId =
    typeof req.query["notificationId"] === "string"
      ? req.query["notificationId"]
      : undefined;
  const rows = await db
    .select()
    .from(pushDeliveries)
    .where(
      notificationId
        ? and(
            eq(pushDeliveries.tenantId, actor.tenantId),
            eq(pushDeliveries.notificationId, notificationId),
          )
        : eq(pushDeliveries.tenantId, actor.tenantId),
    )
    .orderBy(desc(pushDeliveries.attemptedAt))
    .limit(250);
  res.json(rows);
});

router.post("/v1/push-smoke-test", async (_req, res) => {
  const actor = actorFrom(res);
  const stagingTenant = process.env["FIAREP_STAGING_TENANT_ID"];
  if (
    process.env["FIAREP_ENABLE_STAGING_PUSH_SMOKE_TESTS"] !== "true" ||
    !stagingTenant ||
    actor.tenantId !== stagingTenant
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!isElevated(actor)) {
    res.status(403).json({ error: "Elevated management access required" });
    return;
  }
  const marker = new Date().toISOString();
  const notification = await notify(
    actor,
    actor.name,
    `FIAREP.COM staging alert ${marker}`,
    "Release smoke test. Confirm this alert is visible on the registered staging device.",
  );
  if (!notification) {
    res.status(500).json({ error: "Unable to create smoke-test notification" });
    return;
  }
  res.status(202).json({
    notificationId: notification.id,
    message: notification.message,
  });
});

export default router;