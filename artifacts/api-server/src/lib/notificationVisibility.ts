import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  entityRecords,
  notifications,
  staffAccounts,
} from "@workspace/db";
import type { Actor } from "./auth";
import { canReadEntityRecord, isBoroughDirector } from "./domain";
import { repairLegacyResidentDevelopment } from "./legacyResidentDevelopment";

type NotificationRow = typeof notifications.$inferSelect;

const normalize = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function isResidentReportAlert(notification: NotificationRow): boolean {
  return normalize(notification.message).includes("resident report");
}

export async function visibleNotificationsFor(
  actor: Actor,
  rows: NotificationRow[],
): Promise<NotificationRow[]> {
  const reportIds = [
    ...new Set(rows.map((row) => row.reportId).filter((id): id is string => Boolean(id))),
  ];
  if (!reportIds.length) return rows;

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

  return rows.filter((notification) => {
    if (!notification.reportId) return true;
    const record = byId.get(notification.reportId);
    if (!record) return !isResidentReportAlert(notification);
    return canReadEntityRecord(actor, record);
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
  const wanted = normalize(development);
  return staff
    .filter((account) => {
      const actor: Actor = {
        id: account.id,
        tenantId: account.tenantId,
        name: account.name,
        role: account.role,
        position: account.position,
        developments: account.developments,
        sessionVersion: account.sessionVersion,
      };
      if (isBoroughDirector(actor)) return true;
      return Boolean(wanted) &&
        account.developments.some((item) => normalize(item) === wanted);
    })
    .map((account) => account.id);
}