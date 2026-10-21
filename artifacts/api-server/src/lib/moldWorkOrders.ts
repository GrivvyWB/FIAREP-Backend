// A work order in an apartment with an active mold violation: the work order
// shows the mold as a priority item, and the person assigned is told to inspect
// and address it while they're there (CV-MOLD-001 §2).
import { eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { notify } from "./audit";
import type { Actor } from "./auth";
import { activeMoldAt, type MoldCase } from "./mold";

export const moldLine = (cases: MoldCase[]) =>
  `Active mold violation${cases.length === 1 ? "" : "s"} in this apartment (${cases.map((c) => (c.class ? `Class ${c.class}` : "mold")).join(", ")}) — inspect and address the mold while doing this repair, then mark it Mold Removed.`;

/** Resident complaint (work order): attach the apartment's active mold cases; tell the assigned member once. */
export async function attachMoldToComplaint(recordId: string, actor: Actor | null): Promise<void> {
  const [row] = await db.select().from(entityRecords).where(eq(entityRecords.id, recordId)).limit(1);
  if (!row || row.entity !== "resident-reports") return;
  const st = row.state as Record<string, unknown>;
  const apt = String(st["unit"] ?? "").trim();
  if (!apt) return;
  const cases = await activeMoldAt(row.tenantId, String(st["address"] ?? ""), apt);
  if (!cases.length) return;
  const assignee = String(st["assignedStaffId"] ?? st["assignedTo"] ?? "");
  const told = (st["moldNotified"] as string[] | undefined) ?? [];
  const moldAlert = { priority: true, cases: cases.map((c) => ({ id: c.id, class: c.class, description: c.description.slice(0, 300), certifyBy: c.certifyBy })), text: moldLine(cases), at: new Date().toISOString() };
  const next = { ...st, moldAlert, ...(assignee && !told.includes(assignee) ? { moldNotified: [...told, assignee] } : {}) };
  await db.update(entityRecords).set({ state: next }).where(eq(entityRecords.id, row.id));
  if (assignee && !told.includes(assignee) && actor) {
    await notify(actor, assignee, `Mold in apt ${apt} — priority`, `${String(st["address"] ?? "")} · ${moldLine(cases)}`, row.id).catch(() => undefined);
  }
}
