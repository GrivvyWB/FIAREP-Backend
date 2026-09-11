import { randomUUID } from "node:crypto";
import { db, auditLog, notifications } from "@workspace/db";
import type { Actor } from "./auth";
import { logger } from "./logger";
import { deliverPushNotification } from "./push";

export async function audit(
  actor: Actor,
  action: string,
  detail: string,
  reportId?: string,
) {
  await db.insert(auditLog).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    actorRole: actor.role,
    actorName: actor.name,
    action,
    detail,
    reportId,
  });
}

export async function notify(
  actor: Actor,
  target: string,
  message: string,
  detail?: string,
  reportId?: string,
) {
  const [notification] = await db
    .insert(notifications)
    .values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      target,
      message,
      detail,
      reportId,
    })
    .returning();

  if (!notification) return undefined;
  void deliverPushNotification(notification).catch((error) => {
    logger.error(
      { err: error, notificationId: notification.id },
      "Unexpected push delivery error",
    );
  });
  return notification;
}