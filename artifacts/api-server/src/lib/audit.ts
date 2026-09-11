import { randomUUID } from "node:crypto";
import { db, auditLog, notifications, platformLicenseAudit } from "@workspace/db";
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

function safeSnapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!["code", "tokenHash", "sessionVersion"].includes(key)) output[key] = item;
  }
  return output;
}

export async function platformAudit(ownerName: string, action: string, organizationId: string, before: unknown, after: unknown) {
  await db.insert(platformLicenseAudit).values({
    id: randomUUID(), ownerName, action, organizationId,
    before: safeSnapshot(before), after: safeSnapshot(after),
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