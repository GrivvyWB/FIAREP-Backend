import { randomUUID } from "node:crypto";
import {
  db,
  auditLog,
  notifications,
  platformLicenseAudit,
  staffAccounts,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { Actor } from "./auth";
import { STAFF_ROLES } from "./domain";
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

export async function auditInTransaction(
  tx: Pick<typeof db, "insert">,
  actor: Actor,
  action: string,
  detail: string,
  reportId?: string,
) {
  await tx.insert(auditLog).values({
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
  // Keep role/name targets working for older producers, but persist a stable
  // staff id whenever a target resolves to an approved account. This avoids
  // notifications following a renamed staff member or being ambiguous when
  // names are duplicated.
  const [recipientById] = await db
    .select({ id: staffAccounts.id, role: staffAccounts.role })
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.tenantId, actor.tenantId),
        eq(staffAccounts.status, "approved"),
        eq(staffAccounts.id, target),
      ),
    )
    .limit(1);
  const isRoleTarget = [...STAFF_ROLES].some(
    (role) => role.toLowerCase() === target.trim().toLowerCase(),
  );
  const recipientsByName = recipientById || isRoleTarget
    ? []
    : await db
      .select({ id: staffAccounts.id, role: staffAccounts.role })
      .from(staffAccounts)
      .where(
        and(
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.status, "approved"),
          eq(staffAccounts.name, target),
        ),
      );
  const stableTarget =
    recipientById?.id ??
    (recipientsByName.length === 1 ? recipientsByName[0]!.id : target);
  const hrNotification = /\bhr\b|employee record|employee pending|payroll|discipline|termination|onboarding/i.test(message);
  if (
    hrNotification &&
    (target.trim().toLowerCase() === "management" ||
      recipientById?.role === "management" ||
      recipientsByName.some((recipient) => recipient.role === "management"))
  ) {
    return undefined;
  }
  const [notification] = await db
    .insert(notifications)
    .values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      target: stableTarget,
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