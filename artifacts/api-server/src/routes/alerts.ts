// Violation alerts (Platform Control only). Every client building on the
// watch list is checked against NYC Open Data every 30 minutes — HPD
// complaints (311 → HPD), HPD violations, DOB violations, OATH / ECB
// summonses, and other 311 calls (DOB, DEP, FDNY, DSNY, DOHMH) — and anything
// new becomes an alert that stays red until it is marked seen.
//
// How fast the City publishes (checked Oct 8, 2026, Socrata metadata + latest
// rows): HPD complaints — same day; HPD violations — about one day after the
// inspection (the mailed NOV comes later); DOB and ECB — every weekday, about
// two days behind; 311 — daily, about two days behind.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { requireAuth, requirePlatformOwner } from "../middlewares/auth";
import { platformAudit } from "../lib/audit";

const HPD_COMPLAINTS = "ygpa-z7cr";
const HPD_VIOLATIONS = "wvxf-dwi5";
const DOB_VIOLATIONS = "3h2n-5cm9";
const ECB_VIOLATIONS = "6bgk-3dad";
const SR311 = "erm2-nwe9";
const WATCH = "watch-buildings";
const ALERT = "violation-alerts";
const CHECK_EVERY_MS = 30 * 60 * 1000;
const FIRST_LOOKBACK_DAYS = 14;

const text = (v: unknown): string => (v == null ? "" : String(v).trim());
function soql(dataset: string, params: Record<string, string>): string {
  const u = new URL(`https://data.cityofnewyork.us/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
async function fetchJson(url: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "FIAREP/1.0 alerts" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`NYC Open Data returned HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
const ymd = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v.slice(0, 10));
const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

export type WatchBuilding = { id: string; address: string; borough: string; company: string; organizationId: string; bbl: string; bin: string; addedBy: string; addedAt: string; lastCheckedAt: string | null; lastError: string | null };
export type Alert = { id: string; watchId: string; kind: "HPD complaint" | "HPD violation" | "DOB violation" | "OATH / ECB summons" | "311 call"; key: string; date: string; address: string; borough: string; company: string; bbl: string; bin: string; title: string; detail: string; seen: boolean; foundAt: string };

const watchView = (r: { id: string; state: Record<string, unknown>; createdAt: Date }): WatchBuilding => ({
  id: r.id, address: text(r.state["address"]), borough: text(r.state["borough"]), company: text(r.state["company"]), organizationId: text(r.state["organizationId"]), bbl: text(r.state["bbl"]), bin: text(r.state["bin"]),
  addedBy: text(r.state["addedBy"]), addedAt: r.createdAt.toISOString(), lastCheckedAt: text(r.state["lastCheckedAt"]) || null, lastError: text(r.state["lastError"]) || null,
});
const alertView = (r: { id: string; state: Record<string, unknown> }): Alert => ({ id: r.id, ...(r.state as Omit<Alert, "id">) });

async function listWatch(): Promise<Array<{ id: string; state: Record<string, unknown>; createdAt: Date }>> {
  return db.select().from(entityRecords).where(and(eq(entityRecords.entity, WATCH), eq(entityRecords.deleted, false))).orderBy(desc(entityRecords.createdAt)).limit(2000);
}

/** Pull everything new for one building since its last check. Returns how many alerts were added. */
async function checkBuilding(row: { id: string; state: Record<string, unknown> }): Promise<number> {
  const w = watchView({ ...row, createdAt: new Date() });
  const sinceDate = w.lastCheckedAt ? new Date(w.lastCheckedAt) : new Date(Date.now() - FIRST_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const since = sinceDate.toISOString().slice(0, 19); const since8 = yyyymmdd(sinceDate);
  const found: Omit<Alert, "id">[] = [];
  const base = { watchId: w.id, address: w.address, borough: w.borough, company: w.company, bbl: w.bbl, bin: w.bin, seen: false, foundAt: new Date().toISOString() };
  if (/^\d{10}$/.test(w.bbl)) {
    const complaints = await fetchJson(soql(HPD_COMPLAINTS, { $where: `bbl='${w.bbl}' AND received_date > '${since}'`, $order: "received_date DESC", $limit: "500" }));
    for (const c of complaints) found.push({ ...base, kind: "HPD complaint", key: `c:${text(c["problem_id"]) || text(c["unique_key"])}`, date: text(c["received_date"]).slice(0, 16).replace("T", " "),
      title: `${text(c["major_category"])} — ${text(c["minor_category"])}${text(c["type"]) === "EMERGENCY" ? " (EMERGENCY)" : ""}`,
      detail: [text(c["unit_type"]) === "APARTMENT" && text(c["apartment"]) ? `Apt ${text(c["apartment"])}` : text(c["unit_type"]), text(c["space_type"]), `Complaint ${text(c["complaint_id"])} · ${text(c["complaint_status"])}`].filter(Boolean).join(" · ") });
    const violations = await fetchJson(soql(HPD_VIOLATIONS, { $where: `bbl='${w.bbl}' AND inspectiondate > '${since}'`, $order: "inspectiondate DESC", $limit: "500" }));
    for (const v of violations) found.push({ ...base, kind: "HPD violation", key: `v:${text(v["violationid"])}`, date: text(v["inspectiondate"]).slice(0, 10),
      title: `Class ${text(v["class"])} · ${[text(v["apartment"]) ? `Apt ${text(v["apartment"])}` : "", text(v["story"]) && text(v["story"]) !== "0" ? `Floor ${text(v["story"])}` : ""].filter(Boolean).join(", ") || "building"}`,
      detail: `#${text(v["violationid"])} · ${text(v["novdescription"]).replace(/\s+/g, " ")}` });
    const calls = await fetchJson(soql(SR311, { $select: "unique_key,created_date,agency,complaint_type,descriptor,status", $where: `bbl='${w.bbl}' AND created_date > '${since}' AND agency in('DOB','DEP','FDNY','DSNY','DOHMH','DOT')`, $order: "created_date DESC", $limit: "500" }));
    for (const s of calls) found.push({ ...base, kind: "311 call", key: `s:${text(s["unique_key"])}`, date: text(s["created_date"]).slice(0, 16).replace("T", " "),
      title: `${text(s["agency"])} — ${text(s["complaint_type"])}`, detail: `${text(s["descriptor"])} · 311 #${text(s["unique_key"])} · ${text(s["status"])}` });
  }
  if (/^\d{7}$/.test(w.bin)) {
    const dob = await fetchJson(soql(DOB_VIOLATIONS, { $select: "number,violation_number,violation_type,issue_date,description", $where: `bin='${w.bin}' AND issue_date > '${since8}'`, $order: "issue_date DESC", $limit: "500" }));
    for (const d of dob) found.push({ ...base, kind: "DOB violation", key: `d:${text(d["number"]) || text(d["violation_number"])}`, date: ymd(text(d["issue_date"])),
      title: text(d["violation_type"]).replace(/\s+/g, " ").trim(), detail: `${text(d["violation_number"])} · ${text(d["description"]).replace(/\s+/g, " ").trim()}` });
    const ecb = await fetchJson(soql(ECB_VIOLATIONS, { $select: "ecb_violation_number,issue_date,violation_type,severity,violation_description,penality_imposed,hearing_date", $where: `bin='${w.bin}' AND issue_date > '${since8}'`, $order: "issue_date DESC", $limit: "500" }));
    for (const e of ecb) found.push({ ...base, kind: "OATH / ECB summons", key: `e:${text(e["ecb_violation_number"])}`, date: ymd(text(e["issue_date"])),
      title: `${text(e["violation_type"])} · ${text(e["severity"])} · $${Number(e["penality_imposed"]) || 0}${text(e["hearing_date"]) ? ` · hearing ${ymd(text(e["hearing_date"]))}` : ""}`,
      detail: `${text(e["ecb_violation_number"])} · ${text(e["violation_description"]).replace(/\s+/g, " ").trim()}` });
  }
  // Keep only what we have not already stored for this building.
  const existing = await db.select({ key: sql<string>`${entityRecords.state}->>'key'` }).from(entityRecords).where(and(eq(entityRecords.entity, ALERT), sql`${entityRecords.state}->>'watchId' = ${w.id}`));
  const have = new Set(existing.map((e) => e.key));
  const fresh = found.filter((f) => !have.has(f.key));
  const now = new Date();
  for (const f of fresh) await db.insert(entityRecords).values({ id: randomUUID(), tenantId: "default", entity: ALERT, development: w.company || null, state: f, createdBy: "alerts", createdAt: now, updatedAt: now });
  await db.update(entityRecords).set({ state: { ...row.state, lastCheckedAt: now.toISOString(), lastError: "" }, updatedAt: now }).where(eq(entityRecords.id, w.id));
  return fresh.length;
}

let running = false;
export async function checkAllWatched(): Promise<{ checked: number; added: number; errors: number }> {
  if (running) return { checked: 0, added: 0, errors: 0 };
  running = true;
  const out = { checked: 0, added: 0, errors: 0 };
  try {
    for (const row of await listWatch()) {
      try { out.added += await checkBuilding(row); out.checked++; }
      catch (error) { out.errors++; await db.update(entityRecords).set({ state: { ...row.state, lastError: error instanceof Error ? error.message : "check failed" }, updatedAt: new Date() }).where(eq(entityRecords.id, row.id)); }
    }
  } finally { running = false; }
  return out;
}
// Background sweep: first pass a minute after start, then every 30 minutes.
setTimeout(() => { void checkAllWatched(); }, 60_000);
setInterval(() => { void checkAllWatched(); }, CHECK_EVERY_MS);

const router: IRouter = Router();
router.use("/v1/platform/alerts", requirePlatformOwner);
router.use("/v1/platform/watch", requirePlatformOwner);

// Badge: how many alerts are unseen.
router.get("/v1/platform/alerts/summary", async (_req, res) => {
  const rows = await db.select({ seen: sql<string>`${entityRecords.state}->>'seen'` }).from(entityRecords).where(and(eq(entityRecords.entity, ALERT), eq(entityRecords.deleted, false)));
  res.json({ unseen: rows.filter((r) => r.seen !== "true").length, total: rows.length });
});
router.get("/v1/platform/alerts", async (_req, res) => {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, ALERT), eq(entityRecords.deleted, false))).orderBy(desc(entityRecords.createdAt)).limit(1000);
  res.json(rows.map((r) => alertView(r as never)));
});
router.post("/v1/platform/alerts/check", async (_req, res) => { res.json(await checkAllWatched()); });
router.post("/v1/platform/alerts/:id/seen", async (req, res) => {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params["id"])), eq(entityRecords.entity, ALERT))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(entityRecords).set({ state: { ...row.state, seen: true }, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  res.json({ ok: true });
});
router.post("/v1/platform/alerts/seen-all", async (_req, res) => {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, ALERT), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'seen' is distinct from 'true'`));
  const now = new Date();
  for (const row of rows) await db.update(entityRecords).set({ state: { ...row.state, seen: true }, updatedAt: now }).where(eq(entityRecords.id, row.id));
  res.json({ ok: true, marked: rows.length });
});

// Watch list
router.get("/v1/platform/watch", async (_req, res) => { res.json((await listWatch()).map((r) => watchView(r as never))); });
router.post("/v1/platform/watch", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  const bbl = text(b["bbl"]).replace(/\D/g, ""); const bin = text(b["bin"]).replace(/\D/g, "");
  const address = text(b["address"]).slice(0, 200);
  if (!address || !/^\d{10}$/.test(bbl)) { res.status(400).json({ error: "Address and a 10-digit BBL are required." }); return; }
  const dup = (await listWatch()).find((r) => text(r.state["bbl"]) === bbl);
  if (dup) { res.json(watchView(dup as never)); return; }
  const now = new Date(); const id = randomUUID();
  const state = { address, borough: text(b["borough"]).slice(0, 40), company: text(b["company"]).slice(0, 120), organizationId: text(b["organizationId"]).slice(0, 80), bbl, bin, addedBy: owner.name, lastCheckedAt: null, lastError: "" };
  await db.insert(entityRecords).values({ id, tenantId: "default", entity: WATCH, development: state.company || null, state, createdBy: owner.name, createdAt: now, updatedAt: now });
  await platformAudit(owner.name, "watch.added", id, null, state);
  // First check right away so the owner sees the last two weeks.
  void checkBuilding({ id, state }).catch(() => undefined);
  res.json(watchView({ id, state, createdAt: now }));
});
// Assign (or clear) the client organization a watched building belongs to.
router.patch("/v1/platform/watch/:id", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, String(req.params["id"])), eq(entityRecords.entity, WATCH))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const state = { ...row.state, organizationId: text(b["organizationId"]).slice(0, 80), company: b["company"] != null ? text(b["company"]).slice(0, 120) : text(row.state["company"]) };
  await db.update(entityRecords).set({ state, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  await platformAudit(owner.name, "watch.assigned", row.id, row.state, state);
  res.json(watchView({ id: row.id, state, createdAt: row.createdAt }));
});

// Client side: a signed-in organization's own alerts, only when the platform
// owner switched Violation Alerts on for that organization (Platform -> Modules).
async function alertsEnabled(tenantId: string): Promise<boolean> {
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = org?.features && typeof org.features === "object" ? (org.features as Record<string, unknown>)["modules"] : null;
  const m = modules && typeof modules === "object" ? (modules as Record<string, unknown>) : {};
  // Either switch opens the organization's alerts: the menu page, or the strip on
  // the Upper Management Complaint Command.
  return m["violation-alerts"] === true || m["violation-alerts-command"] === true;
}
router.get("/v1/violation-alerts", requireAuth, async (_req, res) => {
  const actor = res.locals["actor"] as { tenantId: string };
  if (!(await alertsEnabled(actor.tenantId))) { res.status(403).json({ error: "Violation alerts are not switched on for this organization" }); return; }
  const mine = (await listWatch()).filter((r) => text(r.state["organizationId"]) === actor.tenantId);
  const ids = new Set(mine.map((r) => r.id));
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, ALERT), eq(entityRecords.deleted, false))).orderBy(desc(entityRecords.createdAt)).limit(2000);
  res.setHeader("Cache-Control", "no-store");
  res.json({ buildings: mine.map((r) => watchView(r as never)), alerts: rows.map((r) => alertView(r as never)).filter((a) => ids.has(a.watchId)) });
});

router.delete("/v1/platform/watch/:id", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const id = String(req.params["id"]);
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.entity, WATCH))).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await platformAudit(owner.name, "watch.removed", id, row.state, null);
  await db.delete(entityRecords).where(and(eq(entityRecords.entity, ALERT), sql`${entityRecords.state}->>'watchId' = ${id}`));
  await db.delete(entityRecords).where(eq(entityRecords.id, id));
  res.json({ ok: true });
});

export default router;
