// Who was told about a complaint, who actually opened it, and "on my way".
//
// Every complaint / violation remembers the staff it was sent to
// (state.notifiedStaff) and everyone who opened it (state.opens). Whoever
// sent it hears the moment it is opened, and upper management sees a green
// light for each person who opened it and a red one for each who never did.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, entityRecords, notifications, staffAccounts } from "@workspace/db";
import { deliverPushNotification } from "./push";
import type { Actor } from "./auth";
import { routedComplaintRecipientIds } from "./complaintRouting";

export type Receipt = { id: string; name: string; position: string; at: string };
export type EtaNotice = { eta: string; crew: string; note: string; byId: string; byName: string; byPosition: string; at: string };

const RECEIPT_ENTITIES = new Set(["resident-reports", "building-violations"]);
export function tracksReceipts(entity: string): boolean {
  return RECEIPT_ENTITIES.has(entity);
}

export const ETA_OPTIONS = [
  "On my way — 10 minutes", "On my way — 15 minutes", "On my way — 30 minutes", "On my way — 1 hour",
  "On my way — 2 hours", "Later today", "Tomorrow morning", "Scheduled — see note",
];
export const CREW_OPTIONS = [
  "Plumber", "Electrician", "Carpenter", "Maintenance worker", "Elevator mechanic", "Exterminator",
  "Heating / boiler", "Painter", "Bricklayer / mason", "Roofer", "Emergency crew", "Superintendent",
];

type Row = { id: string; tenantId: string; entity: string; state: Record<string, unknown>; createdBy: string | null; development?: string | null };

const receipts = (value: unknown): Receipt[] =>
  Array.isArray(value) ? value.filter((v): v is Receipt => !!v && typeof v === "object" && typeof (v as Receipt).id === "string") : [];

export function refOf(state: Record<string, unknown>): string {
  return String(state["complaintNo"] || state["violationNo"] || state["trackingId"] || "the complaint");
}

/** Who sent / assigned it — the person who gets the "opened" and "on my way" alerts. */
export function senderStaffId(state: Record<string, unknown>, createdBy: string | null): string {
  for (const key of ["assignedByStaffId", "directedByStaffId", "sentByStaffId", "handoffByStaffId"]) {
    const v = state[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (createdBy && !createdBy.startsWith("public-")) return createdBy;
  return "";
}

async function mergeState(row: Pick<Row, "id" | "tenantId">, patch: Record<string, unknown>): Promise<void> {
  await db.update(entityRecords)
    .set({ state: sql`${entityRecords.state} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(entityRecords.id, row.id), eq(entityRecords.tenantId, row.tenantId)));
}

/** Remember who a complaint was sent to (called wherever alerts go out). */
export async function recordNotifiedStaff(tenantId: string, recordId: string, staffIds: string[]): Promise<void> {
  const ids = [...new Set(staffIds.filter(Boolean))];
  if (!ids.length) return;
  const [row] = await db.select({ id: entityRecords.id, tenantId: entityRecords.tenantId, entity: entityRecords.entity, state: entityRecords.state })
    .from(entityRecords).where(and(eq(entityRecords.id, recordId), eq(entityRecords.tenantId, tenantId))).limit(1);
  if (!row || !tracksReceipts(row.entity)) return;
  const existing = receipts(row.state["notifiedStaff"]);
  const missing = ids.filter((id) => !existing.some((e) => e.id === id));
  if (!missing.length) return;
  const people = await db.select({ id: staffAccounts.id, name: staffAccounts.name, position: staffAccounts.position })
    .from(staffAccounts).where(and(eq(staffAccounts.tenantId, tenantId), inArray(staffAccounts.id, missing)));
  const at = new Date().toISOString();
  await mergeState(row, { notifiedStaff: [...existing, ...people.map((p) => ({ id: p.id, name: p.name, position: String(p.position || ""), at }))] });
}

/** First time a staff member opens it: stamp it and tell whoever sent it. */
export async function recordOpened(actor: Actor, row: Row): Promise<{ isNew: boolean; opens: Receipt[] }> {
  if (!tracksReceipts(row.entity)) return { isNew: false, opens: [] };
  const opens = receipts(row.state["opens"]);
  if (opens.some((o) => o.id === actor.id)) return { isNew: false, opens };
  const at = new Date().toISOString();
  const next = [...opens, { id: actor.id, name: actor.name, position: actor.position, at }];
  // The resident sees it too: "Opened by …" lands in the complaint's history,
  // which their complaint-number lookup shows.
  const updates = Array.isArray(row.state["updates"]) ? row.state["updates"] as unknown[] : [];
  await mergeState(row, {
    opens: next,
    updates: [...updates, { at, by: actor.name, status: String(row.state["status"] || ""), note: `Opened by ${actor.name} (${actor.position})` }],
  });
  // Who hears about it: whoever sent / assigned it. A resident-filed
  // complaint has no sender, so when a worker, inspector or emergency crew
  // member opens one, their supervisors for that development hear instead.
  const targets = new Set<string>();
  const sender = senderStaffId(row.state, row.createdBy);
  if (sender) targets.add(sender);
  else if (["worker", "inspector", "emergency"].includes(actor.role)) {
    const dev = String(row.development || row.state["development"] || "").trim();
    if (dev) {
      for (const id of await routedComplaintRecipientIds(row.tenantId, dev, row.state, row.entity === "building-violations").catch(() => [] as string[])) targets.add(id);
    }
  }
  targets.delete(actor.id);
  if (targets.size) {
    const created = await db.insert(notifications).values([...targets].map((target) => ({
      id: randomUUID(),
      tenantId: row.tenantId,
      target,
      message: `${refOf(row.state)} was opened`,
      detail: `${actor.name} (${actor.position}) opened it at ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
      reportId: row.id,
    }))).returning();
    for (const n of created) void deliverPushNotification(n).catch(() => undefined);
  }
  return { isNew: true, opens: next };
}

/** "On my way in 15 minutes" / "Plumber on the way": logged on the complaint
 * and sent to whoever sent it. */
export async function recordEta(actor: Actor, row: Row, input: { eta: string; crew: string; note: string }): Promise<EtaNotice> {
  const at = new Date().toISOString();
  const notice: EtaNotice = {
    eta: input.eta.slice(0, 80), crew: input.crew.slice(0, 80), note: input.note.slice(0, 500),
    byId: actor.id, byName: actor.name, byPosition: actor.position, at,
  };
  const line = [notice.eta, notice.crew ? `${notice.crew} on the way` : "", notice.note].filter(Boolean).join(" · ");
  const updates = Array.isArray(row.state["updates"]) ? row.state["updates"] as unknown[] : [];
  await mergeState(row, {
    eta: notice,
    updates: [...updates, { at, by: actor.name, status: String(row.state["status"] || ""), note: line }],
  });
  const targets = new Set<string>();
  const sender = senderStaffId(row.state, row.createdBy);
  if (sender && sender !== actor.id) targets.add(sender);
  for (const key of ["assignedStaffId", "directedToStaffId"]) {
    const v = row.state[key];
    if (typeof v === "string" && v && v !== actor.id) targets.add(v);
  }
  if (targets.size) {
    const created = await db.insert(notifications).values([...targets].map((target) => ({
      id: randomUUID(),
      tenantId: row.tenantId,
      target,
      message: `${refOf(row.state)}: ${notice.eta}`,
      detail: `${actor.name} (${actor.position})${notice.crew ? ` · ${notice.crew} on the way` : ""}${notice.note ? ` · ${notice.note}` : ""}`,
      reportId: row.id,
    }))).returning();
    for (const n of created) void deliverPushNotification(n).catch(() => undefined);
  }
  return notice;
}
