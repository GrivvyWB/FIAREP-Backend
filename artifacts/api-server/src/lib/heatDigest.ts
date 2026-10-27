// Heat & hot water — urgent. Every 2 minutes, for each client with the Command Center on, anything new about
// heat or hot water at its buildings (residents' complaints, and the City's: HPD complaints and violations,
// DOB / OATH-ECB boiler and heat violations) is gathered into ONE open alert for that client — never one alert
// per item. The phones with that client's Command Center get a push, and it repeats every 5 minutes until
// someone presses "Got it" in the Command Center. The Command Center keeps it in a panel at the top and says it
// once: "You have heat and hot water violations at 6 buildings, 12 apartments." No AI is used for any of this.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, entityRecords, organizations, settings, staffAccounts } from "@workspace/db";
import { notify } from "./audit";
import { actorFromStaff } from "./auth";
import { commandDevices } from "./command/tables";
import { moduleOn } from "./command/switches";
import { logger } from "./logger";
import { requireAuth } from "../middlewares/auth";

const EVERY_MS = 2 * 60 * 1000;
const REPEAT_MS = 5 * 60 * 1000;
const KEY = "heat-digest-cursor";
const ENTITY = "heat-alerts";
const TITLE = "URGENT: Heat & hot water";
const HEAT = /heat\/hot water|\bno heat\b|\bheat\b|\bheating\b|\bheater\b|\bradiator|\bboiler|\bfurnace|hot water/i;
const DONE = new Set(["done", "resolved", "work_approved", "approved", "completed", "in_house_completed", "closed"]);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export type HeatItem = { key: string; building: string; apt: string; kind: "heat" | "hot water"; source: string; what: string; at: string };
type HeatState = { items: HeatItem[]; openedAt: string; lastPushAt: string | null; ackAt: string | null; ackBy: string | null };

async function cursorFor(tenantId: string): Promise<Date | null> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, KEY))).limit(1);
  const v = (row?.value as { at?: string } | undefined)?.at;
  return v ? new Date(v) : null;
}
async function saveCursor(tenantId: string, at: Date) {
  await db.insert(settings).values({ tenantId, key: KEY, value: { at: at.toISOString() }, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: { at: at.toISOString() }, updatedAt: at } });
}

async function newItems(tenantId: string, since: Date): Promise<HeatItem[]> {
  const items: HeatItem[] = [];
  const reports = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, tenantId), eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false), gt(entityRecords.createdAt, since)));
  for (const r of reports) {
    const s = (r.state ?? {}) as Record<string, unknown>;
    if (DONE.has(str(s["status"]).toLowerCase())) continue;
    const a = (s["assessment"] && typeof s["assessment"] === "object" ? s["assessment"] : {}) as Record<string, unknown>;
    const text = [s["category"], s["type"], s["complaintType"], s["title"], s["issue"], s["description"], s["details"], a["trade"], a["summary"]].map(str).join(" ");
    if (!HEAT.test(text)) continue;
    const hot = /hot water|water heater/i.test(text) && !/\bno heat\b/i.test(text);
    items.push({ key: `r:${r.id}`, building: str(s["address"]) || str(s["buildingAddress"]) || r.development || "Building not given", apt: str(s["unit"]) || str(s["apartment"]),
      kind: hot ? "hot water" : "heat", source: "Resident", what: (str(s["description"]) || str(s["title"])).slice(0, 120), at: r.createdAt.toISOString() });
  }
  const watched = await db.select({ id: entityRecords.id }).from(entityRecords).where(and(eq(entityRecords.entity, "watch-buildings"), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'organizationId' = ${tenantId}`));
  if (watched.length) {
    const alerts = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, "violation-alerts"), eq(entityRecords.deleted, false), gt(entityRecords.createdAt, since),
      inArray(sql<string>`${entityRecords.state}->>'watchId'`, watched.map((w) => w.id))));
    for (const r of alerts) {
      const s = (r.state ?? {}) as Record<string, unknown>;
      const t = `${str(s["title"])} ${str(s["detail"])}`;
      if (!HEAT.test(t)) continue;
      if (str(s["kind"]) === "HPD complaint" && /·\s*CLOSE/i.test(str(s["detail"]))) continue;
      const apt = (t.match(/\bApt\.?\s*([A-Z0-9-]+)/i) || [])[1] || "";
      items.push({ key: `c:${r.id}`, building: str(s["address"]) || "Building", apt, kind: /hot water/i.test(t) && !/\bheat\b(?!\/)/i.test(t) ? "hot water" : "heat",
        source: `City · ${str(s["kind"])}`, what: str(s["title"]).slice(0, 120), at: r.createdAt.toISOString() });
    }
  }
  return items;
}

/** "6 buildings, 12 apartments" — apartments counted per building (a building-wide item counts the building only). */
export function heatCounts(items: HeatItem[]) {
  const buildings = new Set(items.map((i) => i.building.toLowerCase()));
  const apartments = new Set(items.filter((i) => i.apt).map((i) => `${i.building.toLowerCase()}|${i.apt.toLowerCase()}`));
  return { buildings: buildings.size, apartments: apartments.size, heat: items.filter((i) => i.kind === "heat").length, hotWater: items.filter((i) => i.kind === "hot water").length };
}
export function heatSentence(items: HeatItem[]): string {
  const c = heatCounts(items);
  const what = c.heat && c.hotWater ? "heat and hot water violations" : c.hotWater ? "hot water violations" : "heat violations";
  return `You have ${what} at ${c.buildings} building${c.buildings === 1 ? "" : "s"}${c.apartments ? `, ${c.apartments} apartment${c.apartments === 1 ? "" : "s"}` : ""}.`;
}

async function openAlert(tenantId: string) {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, tenantId), eq(entityRecords.entity, ENTITY), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'ackAt' is null`))
    .orderBy(desc(entityRecords.createdAt)).limit(1);
  return row || null;
}

async function push(tenantId: string, alertId: string, items: HeatItem[]) {
  const phones = await db.selectDistinct({ staffId: commandDevices.staffId }).from(commandDevices).where(and(eq(commandDevices.tenantId, tenantId), eq(commandDevices.status, "active")));
  if (!phones.length) return 0;
  const staff = await db.select().from(staffAccounts).where(and(eq(staffAccounts.tenantId, tenantId), eq(staffAccounts.status, "approved"), inArray(staffAccounts.id, phones.map((p) => p.staffId))));
  // Same title and alert id each time: the Inbox keeps one line (refreshed), the phone gets the push again.
  for (const s of staff) await notify(actorFromStaff(s), s.id, TITLE, `${heatSentence(items)} Open the Command Center and press Got it.`, alertId).catch(() => undefined);
  return staff.length;
}

export async function runHeatDigest(): Promise<void> {
  const orgs = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.status, "active"));
  const now = new Date();
  for (const o of orgs) {
    if (o.id === "default") continue;
    try {
      if (!(await moduleOn(o.id))) continue;
      const since = await cursorFor(o.id);
      if (!since) { await saveCursor(o.id, now); continue; } // first time: start from now
      const fresh = await newItems(o.id, since);
      await saveCursor(o.id, now);
      let row = await openAlert(o.id);
      let added = 0;
      if (fresh.length) {
        if (row) {
          const st = row.state as unknown as HeatState;
          const have = new Set(st.items.map((i) => i.key));
          const more = fresh.filter((i) => !have.has(i.key));
          added = more.length;
          if (added) {
            const next = { ...st, items: [...st.items, ...more] };
            await db.update(entityRecords).set({ state: next as never, updatedAt: now }).where(eq(entityRecords.id, row.id));
            row = { ...row, state: next as never };
          }
        } else {
          const st: HeatState = { items: fresh, openedAt: now.toISOString(), lastPushAt: null, ackAt: null, ackBy: null };
          const id = randomUUID();
          await db.insert(entityRecords).values({ id, tenantId: o.id, entity: ENTITY, development: null, createdBy: "heat", state: st as never, createdAt: now, updatedAt: now });
          [row] = await db.select().from(entityRecords).where(eq(entityRecords.id, id)).limit(1);
          added = fresh.length;
        }
      }
      if (!row) continue;
      const st = row.state as unknown as HeatState;
      const due = added > 0 || !st.lastPushAt || now.getTime() - new Date(st.lastPushAt).getTime() >= REPEAT_MS;
      if (!due) continue;
      const people = await push(o.id, row.id, st.items);
      await db.update(entityRecords).set({ state: { ...st, lastPushAt: now.toISOString() } as never, updatedAt: now }).where(eq(entityRecords.id, row.id));
      logger.info({ organization: o.id, items: st.items.length, people }, "Heat & hot water alert sent");
    } catch (err) { logger.warn({ err, organization: o.id }, "Heat & hot water alert failed"); }
  }
}

let started = false;
export function startHeatDigest() {
  if (started) return; started = true;
  setTimeout(() => { void runHeatDigest().catch(() => undefined); }, 90_000).unref?.();
  setInterval(() => { void runHeatDigest().catch(() => undefined); }, EVERY_MS).unref?.();
}

/** The Command Center's holding panel: the open heat & hot water alert, and "Got it". */
export const heatRouter: IRouter = Router();
heatRouter.get("/v1/heat-alert", requireAuth, async (_req, res) => {
  const actor = res.locals["actor"] as { tenantId: string };
  res.setHeader("Cache-Control", "no-store");
  const row = await openAlert(actor.tenantId);
  if (!row) { res.json(null); return; }
  const st = row.state as unknown as HeatState;
  res.json({ id: row.id, items: st.items, openedAt: st.openedAt, counts: heatCounts(st.items), sentence: heatSentence(st.items) });
});
heatRouter.post("/v1/heat-alert/:id/ack", requireAuth, async (req, res) => {
  const actor = res.locals["actor"] as { tenantId: string; name: string };
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params["id"])), eq(entityRecords.tenantId, actor.tenantId), eq(entityRecords.entity, ENTITY))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const st = row.state as unknown as HeatState;
  if (!st.ackAt) await db.update(entityRecords).set({ state: { ...st, ackAt: new Date().toISOString(), ackBy: actor.name } as never, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  res.json({ ok: true });
});
