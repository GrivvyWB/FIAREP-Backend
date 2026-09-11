import { randomUUID } from "node:crypto";
import { db, auditLog, notifications } from "@workspace/db";
import type { Actor } from "./auth";

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
  await db.insert(notifications).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    target,
    message,
    detail,
    reportId,
  });
}