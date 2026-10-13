// A client company's complaint sent to FIAREP's own crew. The complaint is
// copied into FIAREP's organization ("default") where FIAREP management assigns
// it to a technician like any other complaint; every status change the
// technician makes is mirrored back onto the client's record, so the company
// and the resident keep seeing progress on the original.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, entityRecords, notifications, organizations, staffAccounts } from "@workspace/db";
import type { Actor } from "./auth";
import { audit } from "./audit";
import { deliverPushNotification } from "./push";
import { routedComplaintRecipientIds } from "./complaintRouting";
import { notifyResident } from "./residentNotify";

export const FIAREP_TENANT = "default";
type Row = typeof entityRecords.$inferSelect;

// Who had the work in the client's company is cleared on the copy; FIAREP assigns its own person.
const ASSIGNMENT_KEYS = ["assignedStaffId", "assignedTo", "assignedAt", "assignAt", "assignedByStaffId", "assignedByName", "handoffTargetId", "startedAt", "completedAt", "completedBy", "completedByName", "completionNote", "photoEvidence", "completionPhoto", "approvedAt", "approvedBy", "rejectedAt", "rejectNote"];
// What the technician does that the client should see.
const MIRROR_KEYS = ["status", "startedAt", "completedAt", "completedByName", "completionNote", "photoEvidence", "remoteFiles", "completionPhoto", "completionPhotoUrl", "completionPhotoPath", "releaseUpdate", "workLocation", "startLocation", "completeLocation", "updates", "etaAt", "etaLabel", "etaNote", "etaWho"];

async function alertStaff(tenantId: string, targets: string[], message: string, detail: string, reportId: string): Promise<void> {
  const ids = [...new Set(targets.filter(Boolean))];
  if (!ids.length) return;
  const rows = await db.insert(notifications).values(ids.map((target) => ({ id: randomUUID(), tenantId, target, message, detail, reportId }))).returning();
  for (const row of rows) void deliverPushNotification(row).catch(() => undefined);
}

/** Copy the complaint to FIAREP. Returns the client's updated record. */
export async function sendComplaintToFiarep(actor: Actor, source: Row): Promise<{ ok: true; record: Row } | { ok: false; status: number; error: string }> {
  if (actor.tenantId === FIAREP_TENANT) return { ok: false, status: 400, error: "This is already FIAREP's own complaint." };
  if (typeof source.state["fiarepRecordId"] === "string" && source.state["fiarepRecordId"]) return { ok: false, status: 409, error: "Already sent to FIAREP." };
  const [company] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  const companyName = company?.name || actor.tenantId;
  const now = new Date();
  const copyId = randomUUID();
  const copyState: Record<string, unknown> = { ...source.state };
  for (const key of ASSIGNMENT_KEYS) delete copyState[key];
  copyState["status"] = "submitted";
  copyState["fiarepClient"] = { tenantId: actor.tenantId, company: companyName, recordId: source.id, development: source.development || source.state["development"] || "", sentBy: actor.name, sentAt: now.toISOString() };
  // FIAREP's own record files under the client company, so its crew page reads "1555 Grand Concourse LLC".
  copyState["development"] = companyName;
  copyState["clientDevelopment"] = source.development || source.state["development"] || "";

  const record = await db.transaction(async (tx) => {
    await tx.insert(entityRecords).values({ id: copyId, tenantId: FIAREP_TENANT, entity: "resident-reports", projectId: null, development: companyName, state: copyState, createdBy: `fiarep-client:${actor.tenantId}`, deleted: false, version: 1, createdAt: now, updatedAt: now } as typeof entityRecords.$inferInsert);
    const [updated] = await tx.update(entityRecords).set({
      state: { ...source.state, fiarepRecordId: copyId, fiarepSentAt: now.toISOString(), fiarepSentBy: actor.name, assignedTo: "FIAREP", assignedStaffId: null, assignedAt: now.toISOString(), assignedByStaffId: actor.id, status: source.state["status"] === "submitted" ? "assigned" : source.state["status"] },
      version: (source.version ?? 1) + 1, updatedAt: now,
    }).where(and(eq(entityRecords.id, source.id), eq(entityRecords.tenantId, actor.tenantId))).returning();
    return updated!;
  });
  await audit(actor, "resident-reports.sent-to-fiarep", `Sent to FIAREP by ${actor.name}`, source.id);

  // FIAREP's office: everyone who manages FIAREP's own company, plus its keyword routing.
  const office = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"), inArray(staffAccounts.role, ["administrator", "management"])));
  const routed = await routedComplaintRecipientIds(FIAREP_TENANT, companyName, copyState).catch(() => [] as string[]);
  const ref = [String(source.state["complaintNo"] || ""), String(source.state["address"] || ""), source.state["unit"] ? `Apt ${String(source.state["unit"])}` : ""].filter(Boolean).join(" · ");
  await alertStaff(FIAREP_TENANT, [...office.map((o) => o.id), ...routed], `Complaint from ${companyName}`, ref, copyId);

  // The client and their resident both hear that FIAREP has it. This writes the
  // record straight to the database rather than going through the action
  // handler, so neither the client's own alerting nor the resident notice
  // fires by itself - and on the automatic route nobody at the client pressed
  // anything, so without this they would never know it had been handed over.
  const clientDev = String(source.development || source.state["development"] || "");
  const clientRouted = await routedComplaintRecipientIds(actor.tenantId, clientDev, record.state).catch(() => [] as string[]);
  await alertStaff(actor.tenantId, [...clientRouted, actor.id], "FIAREP is handling this complaint", ref, source.id);
  void notifyResident(record, "Passed to FIAREP", "Your complaint was passed to FIAREP, who carry out the work for your building. You will see each step as it happens.");
  return { ok: true, record };
}

/** After FIAREP's copy changes, write what the technician did onto the client's record. */
export async function mirrorFiarepProgress(actor: Actor, copy: Row): Promise<void> {
  if (actor.tenantId !== FIAREP_TENANT) return;
  const client = copy.state["fiarepClient"] as { tenantId?: string; recordId?: string } | undefined;
  if (!client?.tenantId || !client.recordId) return;
  const [source] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, client.recordId), eq(entityRecords.tenantId, client.tenantId), eq(entityRecords.deleted, false))).limit(1);
  if (!source) return;
  const patch: Record<string, unknown> = {};
  for (const key of MIRROR_KEYS) if (key in copy.state) patch[key] = copy.state[key];
  const tech = String(copy.state["assignedTo"] || "").trim();
  patch["assignedTo"] = tech ? `FIAREP · ${tech}` : "FIAREP";
  patch["fiarepStatus"] = copy.state["status"];
  patch["fiarepUpdatedAt"] = new Date().toISOString();
  const prevStatus = String(source.state["status"] || "");
  // FIAREP's own approval of its technician's work does not approve the
  // client's record for them: their supervisor still signs off on "done".
  if (patch["status"] === "approved" && ["done", "approved", "resolved", "cleared"].includes(prevStatus)) patch["status"] = prevStatus;
  const nextStatus = String(patch["status"] || "");
  await db.update(entityRecords).set({ state: { ...source.state, ...patch }, version: (source.version ?? 1) + 1, updatedAt: new Date() }).where(and(eq(entityRecords.id, source.id), eq(entityRecords.tenantId, source.tenantId)));
  if (nextStatus && nextStatus !== prevStatus) {
    const dev = String(source.development || source.state["development"] || "");
    const routed = await routedComplaintRecipientIds(source.tenantId, dev, { ...source.state, ...patch }).catch(() => [] as string[]);
    const sentBy = String(source.state["assignedByStaffId"] || "");
    const ref = [String(source.state["complaintNo"] || ""), String(source.state["address"] || "")].filter(Boolean).join(" · ");
    await alertStaff(source.tenantId, [...routed, sentBy], `FIAREP: ${nextStatus.replaceAll("_", " ")}${tech ? ` · ${tech}` : ""}`, ref, source.id);
  }
}

/** Every photo object path on FIAREP's copy — what the client is allowed to open. */
export function crewPhotoPaths(state: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["photoEvidence", "remoteFiles"]) {
    const list = state[key];
    if (!Array.isArray(list)) continue;
    for (const f of list) if (f && typeof f === "object" && typeof (f as Record<string, unknown>)["objectPath"] === "string") out.push(String((f as Record<string, unknown>)["objectPath"]));
  }
  return out;
}

/** The client's supervisor approved or sent back FIAREP's work: tell the copy and the technician. */
export async function mirrorClientDecision(actor: Actor, clientRecord: Row, action: "approve-work" | "reject-work", note: string): Promise<void> {
  const copyId = typeof clientRecord.state["fiarepRecordId"] === "string" ? clientRecord.state["fiarepRecordId"] : "";
  if (!copyId) return;
  const [copy] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, copyId), eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.deleted, false))).limit(1);
  if (!copy) return;
  const now = new Date();
  const patch: Record<string, unknown> = action === "approve-work"
    ? { clientApprovedAt: now.toISOString(), clientApprovedBy: actor.name, status: copy.state["status"] === "done" ? "approved" : copy.state["status"] }
    : { status: "in_progress", reworkNote: note, reworkByStaffName: `${actor.name} (client)`, reworkAt: now.toISOString(), clientSentBackAt: now.toISOString() };
  await db.update(entityRecords).set({ state: { ...copy.state, ...patch }, version: (copy.version ?? 1) + 1, updatedAt: now }).where(eq(entityRecords.id, copy.id));
  const tech = String(copy.state["assignedStaffId"] || "");
  const ref = [String(copy.state["complaintNo"] || ""), String(copy.state["address"] || "")].filter(Boolean).join(" \u00b7 ");
  const office = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(eq(staffAccounts.tenantId, FIAREP_TENANT), eq(staffAccounts.status, "approved"), inArray(staffAccounts.role, ["administrator", "management"])));
  await alertStaff(FIAREP_TENANT, [tech, ...office.map((o) => o.id)], action === "approve-work" ? "Client approved your work" : `Client sent the work back: ${note}`.slice(0, 200), ref, copy.id);
}

/** Whether this client pays for FIAREP to take their residents' complaints.
 *  Off unless the platform owner switched it on (Platform Control -> Module
 *  Management), so a client who does not pay for the service never reaches
 *  FIAREP's crew. */
export async function fiarepRoutingEnabled(tenantId: string): Promise<boolean> {
  if (tenantId === FIAREP_TENANT) return false;
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = org?.features?.["modules"];
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) return false;
  return (modules as Record<string, unknown>)["fiarepComplaintRouting"] === true;
}

/** A resident filed a complaint on a building that is on the plan, and the
 *  client pays for FIAREP to handle it: copy it to FIAREP with no one having
 *  to press anything. Nobody is acting, so the record is stamped to the plan
 *  rather than to a person. Never throws - a complaint is logged for the
 *  client whether or not the copy succeeds. */
export async function autoSendComplaintToFiarep(tenantId: string, source: Row): Promise<void> {
  try {
    if (!(await fiarepRoutingEnabled(tenantId))) return;
    const actor: Actor = { id: "", tenantId, name: "FIAREP plan", role: "management", position: "", developments: [], sessionVersion: 0 };
    await sendComplaintToFiarep(actor, source);
  } catch { /* the client's own complaint still stands */ }
}
