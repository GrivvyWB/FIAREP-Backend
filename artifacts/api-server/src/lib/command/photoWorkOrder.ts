// Resident photo → repair instructions → work order.
// When a resident sends a complaint with a photo, FIAREP Smart Repair reads the
// photo (what's wrong, where, the trade, tools, parts, steps, priority) and the
// Command Center drafts a work order with those repair instructions, then tells
// the people the complaint is routed to (the superintendent / supervisors).
// Assigning it (assign_work_order) books the member and tells the resident the visit time.
// Automatic per organization (Command Center page → "Work orders from resident photos"),
// and on demand with the complaint_to_work_order action.
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, entityRecords, organizations, residentReportPhotos } from "@workspace/db";
import { fileStorage } from "../fileStorage";
import { smartRepairTicket, type SmartRepairTicket } from "../smartRepair";
import { notify } from "../audit";
import type { Actor } from "../auth";
import { staffToTell } from "./residentChat";
import { commandWorkOrders } from "./tables";
import { effectiveSwitches } from "./switches";
import { commandAuditLog } from "./audit";

const ANALYZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);
const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const officeActor = (tenantId: string): Actor => ({ id: "command-center", tenantId, name: "Command Center", role: "administrator", position: "", developments: [], sessionVersion: 0 });

export async function autoWorkOrdersOn(tenantId: string): Promise<boolean> {
  const sw = await effectiveSwitches(tenantId);
  return sw.enabled && sw.autoWorkOrders;
}

/** Draft a work order from a resident complaint's photo. Returns the work order, or why not. Never throws. */
export async function residentPhotoToWorkOrder(tenantId: string, reportId: string, by = "Command Center"): Promise<{ workOrder: typeof commandWorkOrders.$inferSelect; created: boolean } | { error: string }> {
  try {
    const [existing] = await db.select().from(commandWorkOrders).where(eq(commandWorkOrders.alertId, `resident:${reportId}`)).limit(1);
    if (existing) return { workOrder: existing, created: false };
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "Smart Repair needs OPENAI_API_KEY on the server." };
    const [report] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, reportId), eq(entityRecords.tenantId, tenantId), eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false))).limit(1);
    if (!report) return { error: "No complaint with that number." };
    const photos = await db.select().from(residentReportPhotos).where(and(eq(residentReportPhotos.reportId, reportId), eq(residentReportPhotos.tenantId, tenantId)));
    const photo = photos.find((p) => ANALYZABLE.has(p.contentType));
    if (!photo) return { error: "This complaint has no photo Smart Repair can read (JPEG, PNG or WebP)." };
    const { downloadUrl } = await fileStorage.createDownload(tenantId, photo.objectPath);
    const img = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
    if (!img.ok) return { error: "Couldn't load the photo." };
    const image = `data:${photo.contentType};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
    const st = report.state;
    const address = s(st["address"], 200), unit = s(st["unit"], 20);
    // SMART_REPAIR_TEST_URL: tests only (points Smart Repair at a stand-in).
    const testUrl = process.env["SMART_REPAIR_TEST_URL"];
    const ticket: SmartRepairTicket = await smartRepairTicket({ image, address, area: unit ? `Apartment ${unit}${s(st["location"], 60) ? ` · ${s(st["location"], 60)}` : ""}` : s(st["location"], 60), note: s(st["description"], 500) }, apiKey,
      testUrl ? ((_u: string | URL | Request, init?: RequestInit) => fetch(testUrl, init)) as typeof fetch : fetch);
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
    const detail = [
      ticket.repairRequired,
      ticket.exactArea ? `Where: ${ticket.exactArea}` : "",
      ticket.steps.length ? `Steps: ${ticket.steps.map((x, i) => `${i + 1}. ${x}`).join(" ")}` : "",
      ticket.tools.length ? `Tools: ${ticket.tools.join(", ")}` : "",
      ticket.supplies.length ? `Supplies: ${ticket.supplies.join(", ")}` : "",
      ticket.fixtures.length ? `Parts: ${ticket.fixtures.join(", ")}` : "",
      ticket.estimatedTime ? `Time: ${ticket.estimatedTime}` : "",
      `Resident said: "${s(st["description"], 300)}"`,
    ].filter(Boolean).join("\n").slice(0, 4000);
    const [wo] = await db.insert(commandWorkOrders).values({
      id: randomUUID(), tenantId, alertId: `resident:${reportId}`, alertKey: s(st["complaintNo"], 20), address, borough: "", company: org?.name ?? "",
      bbl: "", kind: "Resident complaint", title: `${ticket.issueFound}${unit ? ` · Apt ${unit}` : ""}`.slice(0, 200), detail, trade: ticket.trade || null,
      urgency: ticket.priority === "High" ? "urgent" : "routine", status: "draft",
    }).onConflictDoNothing().returning();
    if (!wo) {
      const [again] = await db.select().from(commandWorkOrders).where(eq(commandWorkOrders.alertId, `resident:${reportId}`)).limit(1);
      return again ? { workOrder: again, created: false } : { error: "Couldn't save the work order." };
    }
    // Merge into the current state (the photo classifier may have written meanwhile).
    const add = JSON.stringify({ smartTicket: { ...ticket, at: new Date().toISOString(), by }, commandWorkOrderId: wo.id });
    await db.update(entityRecords).set({ state: sql`${entityRecords.state} || ${add}::jsonb`, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() }).where(eq(entityRecords.id, report.id));
    await commandAuditLog({ tenantId, actor: by, event: "work-order.from-resident-photo", detail: { complaint: st["complaintNo"], workOrder: wo.id, issue: ticket.issueFound, trade: ticket.trade, priority: ticket.priority } });
    const tell = await staffToTell(report);
    for (const id of tell) await notify(officeActor(tenantId), id, `${wo.urgency === "urgent" ? "URGENT — " : ""}Work order ready: ${wo.title}`, `#${s(st["complaintNo"], 20)} at ${address} · ${ticket.trade || "trade?"} · ${ticket.estimatedTime || ""}`.trim(), report.id).catch(() => undefined);
    return { workOrder: wo, created: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Smart Repair failed." };
  }
}

/** Called after a resident's photo is stored (fire-and-forget). */
export async function maybeAutoWorkOrder(tenantId: string, reportId: string): Promise<void> {
  if (!(await autoWorkOrdersOn(tenantId).catch(() => false))) return;
  await residentPhotoToWorkOrder(tenantId, reportId, "Command Center (automatic)");
}
