import { and, eq, inArray, sql } from "drizzle-orm";
import { db, notificationReads, notifications } from "@workspace/db";
import type { Actor } from "./auth";

type NotificationRow = typeof notifications.$inferSelect;

// Shared (role / name) notifications that were marked read before per-person
// read tracking existed keep their old read state, so nobody's inbox floods.
const PER_PERSON_READS_SINCE = new Date("2026-09-27T13:00:00Z");

/** A notification addressed to this exact account (its read flag is theirs). */
export function isPersonalNotification(actor: Actor, row: NotificationRow): boolean {
  return row.target === actor.id;
}

export async function ensureNotificationReadsTable(): Promise<void> {
  await db.execute(sql`
    create table if not exists notification_reads (
      id text primary key,
      tenant_id text not null default 'default',
      notification_id text not null,
      staff_id text not null,
      read_at timestamp with time zone not null default now()
    )`);
  await db.execute(sql`
    create index if not exists notification_reads_staff_idx
      on notification_reads (tenant_id, staff_id)`);
  // One alert per person per item: drop older duplicates (same person, same
  // message, same record) left from before alerts were de-duplicated.
  await db.execute(sql`
    delete from notifications a
      using notifications b
     where a.tenant_id = b.tenant_id
       and a.target = b.target
       and a.message = b.message
       and a.report_id is not null
       and a.report_id = b.report_id
       and (a.at < b.at or (a.at = b.at and a.id < b.id))`);
}

/** Returns the rows with `read` reflecting THIS person, not whoever read it first. */
export async function withPersonalReadState<T extends NotificationRow>(actor: Actor, rows: T[]): Promise<T[]> {
  const sharedIds = rows.filter((row) => !isPersonalNotification(actor, row)).map((row) => row.id);
  if (!sharedIds.length) return rows;
  const reads = await db
    .select({ notificationId: notificationReads.notificationId })
    .from(notificationReads)
    .where(and(
      eq(notificationReads.tenantId, actor.tenantId),
      eq(notificationReads.staffId, actor.id),
      inArray(notificationReads.notificationId, sharedIds),
    ));
  const readIds = new Set(reads.map((row) => row.notificationId));
  return rows.map((row) => {
    if (isPersonalNotification(actor, row)) return row;
    const legacyRead = row.read && new Date(row.at) < PER_PERSON_READS_SINCE;
    return { ...row, read: readIds.has(row.id) || legacyRead };
  });
}

/** Marks rows read for this person only. */
export async function markReadForActor(actor: Actor, rows: NotificationRow[]): Promise<void> {
  const personal = rows.filter((row) => isPersonalNotification(actor, row)).map((row) => row.id);
  const shared = rows.filter((row) => !isPersonalNotification(actor, row)).map((row) => row.id);
  const now = new Date();
  if (personal.length) {
    await db.update(notifications)
      .set({ read: true, updatedAt: now })
      .where(and(eq(notifications.tenantId, actor.tenantId), inArray(notifications.id, personal)));
  }
  if (shared.length) {
    await db.insert(notificationReads)
      .values(shared.map((notificationId) => ({
        id: `${notificationId}:${actor.id}`,
        tenantId: actor.tenantId,
        notificationId,
        staffId: actor.id,
        readAt: now,
      })))
      .onConflictDoNothing();
  }
}
