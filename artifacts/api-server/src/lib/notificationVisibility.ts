import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  entityRecords,
  notifications,
  staffAccounts,
} from "@workspace/db";
import type { Actor } from "./auth";
import { canReadEntityRecordForActor } from "./hrAuthorization";
import { repairLegacyResidentDevelopment } from "./legacyResidentDevelopment";

type NotificationRow = typeof notifications.$inferSelect;

const normalize = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function isResidentReportAlert(notification: NotificationRow): boolean {
  return normalize(notification.message).includes("resident report");
}

function isHrAlert(notification: NotificationRow): boolean {
  return /\bhr\b|employee record|employee pending|payroll|discipline|termination|onboarding/i
    .test(notification.message || "");
}

export async function visibleNotificationsFor(
  actor: Actor,
  rows: NotificationRow[],
): Promise<NotificationRow[]> {
  const candidateRows = actor.role === "management"
    ? rows.filter((row) => !isHrAlert(row))
    : rows;
  const reportIds = [
    ...new Set(candidateRows.map((row) => row.reportId).filter((id): id is string => Boolean(id))),
  ];
  if (!reportIds.length) return candidateRows;

  const storedRecords = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.tenantId, actor.tenantId),
        inArray(entityRecords.id, reportIds),
      ),
    );
  const records = await Promise.all(
    storedRecords.map(repairLegacyResidentDevelopment),
  );
  const byId = new Map(records.map((record) => [record.id, record]));

  const visibility = await Promise.all(candidateRows.map(async (notification) => {
    if (!notification.reportId) {
      return true;
    }
    const record = byId.get(notification.reportId);
    if (!record) return !isResidentReportAlert(notification);
    return canReadEntityRecordForActor(actor, record);
  }));
  return candidateRows
    .filter((_notification, index) => visibility[index])
    .map((notification) => {
      if (!notification.reportId) return notification;
      const record = byId.get(notification.reportId);
      if (record?.entity !== "manpower-requests") return notification;
      const sourceEntity = String(record.state["sourceEntity"] || "");
      const sourceRecordId = String(record.state["sourceRecordId"] || "");
      if (sourceEntity !== "resident-reports" || !sourceRecordId) return notification;
      return { ...notification, reportId: sourceRecordId };
    });
}

export async function residentReportRecipientIds(
  tenantId: string,
  development: string,
): Promise<string[]> {
  const staff = await db
    .select()
    .from(staffAccounts)
    .where(
      and(
        eq(staffAccounts.tenantId, tenantId),
        eq(staffAccounts.status, "approved"),
        inArray(staffAccounts.role, ["management", "administrator"]),
      ),
    );
  return staff
    .filter((account) =>
      account.role === "management" &&
      account.position === "Superintendent Ⓔ"
    )
    .map((account) => account.id);
}