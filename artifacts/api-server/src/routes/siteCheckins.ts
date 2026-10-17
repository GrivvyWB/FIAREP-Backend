// Building check-in: the member taps the building they are at; the phone sends
// where it actually is at that moment. The client's platform shows the building
// tapped next to where the phone really was, and every time the member left the
// building, where they went (e.g. a supply store) and when they came back.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizationProperties, organizations } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { geocodeNycPoint, reverseGeocodeNyc } from "../lib/nycProperty";
import { fileStorage } from "../lib/fileStorage";
import { readDoorNumber } from "../lib/smartRepair";

const router: IRouter = Router();
router.use("/v1/site-checkins", requireAuth);

export const SITE_CHECKIN_ENTITY = "site-checkins";
const FIAREP_TENANT = "default";
/** Farther than this from the building's point and the phone is not at the building. */
export const AT_BUILDING_M = 150;

type Point = { latitude: number; longitude: number; accuracyM: number | null };
function pointOf(v: unknown): Point | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o["latitude"]), lng = Number(o["longitude"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const acc = Number(o["accuracyM"] ?? o["accuracy"]);
  return { latitude: lat, longitude: lng, accuracyM: Number.isFinite(acc) ? acc : null };
}
export function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = 6371000; const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : "");
async function placeName(p: Point, fromDevice: unknown): Promise<string> {
  const nyc = await reverseGeocodeNyc(p.latitude, p.longitude).catch(() => null);
  return nyc || str(fromDevice, 200) || `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
}
const isManager = (role: string) => role === "administrator" || role === "management";

/** The buildings a member can check in at: their organization's buildings on the plan
 *  (FIAREP's crew: every client building on the plan). */
router.get("/v1/site-checkins/buildings", async (_req, res) => {
  const a = actorFrom(res);
  const rows = await db.select({ id: organizationProperties.id, organizationId: organizationProperties.organizationId, address: organizationProperties.displayAddress, development: organizationProperties.development, active: organizationProperties.active })
    .from(organizationProperties)
    .where(a.tenantId === FIAREP_TENANT ? eq(organizationProperties.active, true) : and(eq(organizationProperties.organizationId, a.tenantId), eq(organizationProperties.active, true)));
  const mine = (a.developments || []).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const list = a.tenantId !== FIAREP_TENANT && mine.length && !isManager(a.role)
    ? rows.filter((r) => !r.development || mine.includes(r.development.trim().toLowerCase()))
    : rows;
  res.json(list.map((r) => ({ id: r.id, address: r.address, development: r.development })).sort((x, y) => x.address.localeCompare(y.address)));
});

/** Out of network: the client companies a FIAREP member can file a check-in for. */
router.get("/v1/site-checkins/clients", async (_req, res) => {
  const a = actorFrom(res);
  if (a.tenantId !== FIAREP_TENANT) { res.json([]); return; }
  const rows = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  res.json(rows.filter((r) => r.id !== FIAREP_TENANT).sort((x, y) => x.name.localeCompare(y.name)));
});

async function loadRecord(id: string) {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.entity, SITE_CHECKIN_ENTITY), eq(entityRecords.deleted, false))).limit(1);
  return row || null;
}

/** Check in: the building tapped, and where the phone is right now. */
router.post("/v1/site-checkins", async (req, res) => {
  const a = actorFrom(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const at = pointOf(b["location"]);
  if (!at) { res.status(400).json({ error: "FIAREP could not read where your phone is. Turn Location on (Always) and try again." }); return; }
  const propertyId = str(b["propertyId"], 80);
  let address = str(b["address"], 200);
  let tenantId = a.tenantId;
  let inNyc = true;
  if (propertyId) {
    const [p] = await db.select().from(organizationProperties).where(eq(organizationProperties.id, propertyId)).limit(1);
    if (!p || (a.tenantId !== FIAREP_TENANT && p.organizationId !== a.tenantId)) { res.status(404).json({ error: "That building is not one of yours." }); return; }
    address = p.displayAddress; tenantId = p.organizationId;
    // Outside New York City the City's map does not apply (empty state = NYC by history).
    inNyc = !p.state || p.state.toUpperCase() === "NY";
  }
  // Out of network complaint: a building that is not in the system - the client
  // asked the member to go check it. Filed under that client (FIAREP's crew picks
  // the client; anyone else files under their own company).
  const outOfNetwork = !propertyId && b["outOfNetwork"] === true;
  const requestedBy = str(b["requestedBy"], 120);
  if (outOfNetwork && a.tenantId === FIAREP_TENANT) {
    const clientId = str(b["clientId"], 80);
    if (clientId) {
      const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, clientId)).limit(1);
      if (!org) { res.status(404).json({ error: "That client was not found." }); return; }
      tenantId = org.id;
    }
  }
  if (!propertyId && !outOfNetwork) { res.status(400).json({ error: "Pick the building you are at." }); return; }
  if (!address) { res.status(400).json({ error: outOfNetwork ? "Type the address of the building." : "Pick the building you are at." }); return; }
  // The building's own point: the City's map in New York, else the phone's map of the address.
  const fromPhone = pointOf(b["buildingLocation"]);
  const fromCity = inNyc ? await geocodeNycPoint(address).catch(() => null) : null;
  // A typed address outside the City can still match some NYC street by name: if the
  // City's point is miles from the phone's map of the same address, use the phone's.
  const building = fromCity && fromPhone && metersBetween(fromCity, fromPhone) > 20_000 ? fromPhone : (fromCity || fromPhone);
  const distanceM = building ? metersBetween(building, at) : null;
  const now = new Date();
  // Check in once, check out once. While checked in somewhere (a supply run
  // included) there is no new check-in; and a building checked out today stays
  // checked out until tomorrow.
  const mine = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, SITE_CHECKIN_ENTITY), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'staffId' = ${a.id}`));
  const open = mine.find((o) => !o.state["checkedOutAt"]);
  if (open) {
    res.status(409).json({ error: `You are still checked in at ${String((open.state["building"] as { address?: string })?.address || "a building")}. Check out there only when you are done for the day.` });
    return;
  }
  const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const sameBuilding = (o: typeof mine[number]) => {
    const bld = (o.state["building"] ?? {}) as { propertyId?: string | null; address?: string };
    return propertyId ? bld.propertyId === propertyId : String(bld.address || "").trim().toLowerCase() === address.trim().toLowerCase();
  };
  const doneToday = mine.find((o) => sameBuilding(o) && nyDay(new Date(String(o.state["checkedInAt"]))) === nyDay(now));
  if (doneToday) {
    const t = new Date(String(doneToday.state["checkedOutAt"])).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    res.status(409).json({ error: `You finished this building for today (checked out at ${t}). You can check in here again tomorrow.` });
    return;
  }
  const state = {
    staffId: a.id, staffName: a.name, position: a.position, role: a.role, staffTenant: a.tenantId,
    building: { address, propertyId: propertyId || null, latitude: building?.latitude ?? null, longitude: building?.longitude ?? null },
    phone: { ...at, address: await placeName(at, b["deviceAddress"]) },
    distanceM, atBuilding: distanceM == null ? null : distanceM <= AT_BUILDING_M + Math.min(at.accuracyM ?? 0, 100),
    checkedInAt: now.toISOString(), events: [] as unknown[], checkedOutAt: "",
    ...(outOfNetwork ? { outOfNetwork: true, requestedBy } : {}),
  };
  const id = randomUUID();
  await db.insert(entityRecords).values({ id, tenantId, entity: SITE_CHECKIN_ENTITY, development: address.slice(0, 200), state, createdBy: a.id, createdAt: now, updatedAt: now } as never);
  res.status(201).json({ id, ...state });
});

/** Movement while checked in: left the building, a stop somewhere, back at the building. */
router.post("/v1/site-checkins/:id/events", async (req, res) => {
  const a = actorFrom(res);
  const row = await loadRecord(String(req.params["id"]));
  if (!row || row.state["staffId"] !== a.id) { res.status(404).json({ error: "Not found." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const type = ["left", "stop", "back"].includes(String(b["type"])) ? String(b["type"]) : "";
  if (!type) { res.status(400).json({ error: "Unknown event." }); return; }
  const p = pointOf(b["location"]);
  const at = str(b["at"], 40) || new Date().toISOString();
  const key = str(b["key"], 80);
  const events = Array.isArray(row.state["events"]) ? (row.state["events"] as Record<string, unknown>[]) : [];
  if (key && events.some((e) => e["key"] === key)) { res.json({ ok: true }); return; }
  events.push({ type, at, until: str(b["until"], 40) || null, key: key || null, ...(p ? { latitude: p.latitude, longitude: p.longitude, address: await placeName(p, b["deviceAddress"]) } : {}) });
  await db.update(entityRecords).set({ state: { ...row.state, events: events.slice(-200) }, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  res.json({ ok: true });
});

/** A door photo for an apartment visit goes straight to storage. */
router.post("/v1/site-checkins/:id/upload-url", async (req, res) => {
  const a = actorFrom(res);
  const row = await loadRecord(String(req.params["id"]));
  if (!row || row.state["staffId"] !== a.id || row.state["checkedOutAt"]) { res.status(404).json({ error: "Check in at the building first." }); return; }
  const size = Number((req.body ?? {})["size"]);
  if (!size || size > 15 * 1024 * 1024) { res.status(400).json({ error: "Photo too large." }); return; }
  const { uploadUrl, file } = await fileStorage.createUpload(row.tenantId, a.id, { kind: "inspection-evidence", name: "door.jpg", size, contentType: "image/jpeg" });
  res.json({ uploadUrl, objectPath: file.objectPath });
});

const unitKey = (v: string) => v.toUpperCase().replace(/^(APT|APARTMENT|UNIT|#)\s*/i, "").replace(/[^A-Z0-9]/g, "");

/**
 * Apartment visit: the unit, the door photo, and Access Gained / Tenant Refused
 * Access. Timestamped by the server, with where the phone was. Kept for good:
 * there is no way to change or delete a visit.
 */
router.post("/v1/site-checkins/:id/visits", async (req, res) => {
  const a = actorFrom(res);
  const row = await loadRecord(String(req.params["id"]));
  if (!row || row.state["staffId"] !== a.id || row.state["checkedOutAt"]) { res.status(404).json({ error: "Check in at the building first." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const unit = str(b["unit"], 20);
  const outcome = b["outcome"] === "access" ? "access" : b["outcome"] === "refused" ? "refused" : "";
  const photo = str(b["photo"], 300);
  if (!unit) { res.status(400).json({ error: "Enter the apartment." }); return; }
  if (!outcome) { res.status(400).json({ error: "Pick Access Gained or Tenant Refused Access." }); return; }
  if (!photo.startsWith(`/objects/tenants/${row.tenantId}/`)) { res.status(400).json({ error: "Take a photo of the apartment door." }); return; }
  const p = pointOf(b["location"]);
  const bld = (row.state["building"] ?? {}) as { latitude?: number | null; longitude?: number | null };
  const distanceM = p && bld.latitude != null && bld.longitude != null ? metersBetween({ latitude: bld.latitude, longitude: bld.longitude }, p) : null;
  // The door photo's apartment number, read from the picture, against the unit typed.
  const image = typeof b["image"] === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(b["image"]) ? (b["image"] as string) : "";
  const doorNumber = image && process.env.OPENAI_API_KEY ? await readDoorNumber(image, process.env.OPENAI_API_KEY) : null;
  const visit = {
    id: randomUUID(), unit, outcome, photo, at: new Date().toISOString(),
    ...(p ? { latitude: p.latitude, longitude: p.longitude, accuracyM: p.accuracyM, address: await placeName(p, b["deviceAddress"]) } : {}),
    distanceM, atBuilding: distanceM == null ? null : distanceM <= AT_BUILDING_M + Math.min(p?.accuracyM ?? 0, 100),
    doorNumber, doorMatches: doorNumber ? unitKey(doorNumber) === unitKey(unit) : null,
  };
  const visits = Array.isArray(row.state["visits"]) ? (row.state["visits"] as unknown[]) : [];
  await db.update(entityRecords).set({ state: { ...row.state, visits: [...visits, visit].slice(-500) }, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  res.status(201).json(visit);
});

/** Short-lived links for the door photos on a list of check-ins. */
async function withPhotoUrls(list: Array<Record<string, unknown> & { id: string }>, tenantOf: Map<string, string>) {
  for (const r of list) {
    const visits = Array.isArray(r["visits"]) ? (r["visits"] as Record<string, unknown>[]) : [];
    for (const v of visits) {
      try { v["photoUrl"] = (await fileStorage.createDownload(tenantOf.get(r.id) || "", String(v["photo"] || ""))).downloadUrl; } catch { /* missing photo */ }
    }
  }
  return list;
}

router.post("/v1/site-checkins/:id/checkout", async (req, res) => {
  const a = actorFrom(res);
  const row = await loadRecord(String(req.params["id"]));
  if (!row || row.state["staffId"] !== a.id) { res.status(404).json({ error: "Not found." }); return; }
  if (row.state["checkedOutAt"]) { res.json({ ok: true }); return; }
  const p = pointOf((req.body ?? {})["location"]);
  const now = new Date().toISOString();
  await db.update(entityRecords).set({ state: { ...row.state, checkedOutAt: now, checkoutPhone: p ? { ...p, address: await placeName(p, (req.body ?? {})["deviceAddress"]) } : null }, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  res.json({ ok: true, checkedOutAt: now });
});

/** The member's own check-ins (the phone), newest first. */
router.get("/v1/site-checkins/mine", async (_req, res) => {
  const a = actorFrom(res);
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, SITE_CHECKIN_ENTITY), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'staffId' = ${a.id}`));
  const tenantOf = new Map(rows.map((r) => [r.id, r.tenantId]));
  const list = rows.map((r) => ({ id: r.id, ...r.state }) as Record<string, unknown> & { id: string }).sort((x, y) => String(y["checkedInAt"]).localeCompare(String(x["checkedInAt"]))).slice(0, 50);
  res.json(await withPhotoUrls(list, tenantOf));
});

/** The platform: every check-in at this organization's buildings (FIAREP: all), for a date range. */
router.get("/v1/site-checkins", async (req, res) => {
  const a = actorFrom(res);
  if (!isManager(a.role)) { res.status(403).json({ error: "For management." }); return; }
  const from = str(req.query["from"], 10), to = str(req.query["to"], 10);
  // ?archive=1: every closed (checked-out) check-in - the client's archive.
  const archive = req.query["archive"] === "1";
  const rows = await db.select().from(entityRecords).where(a.tenantId === FIAREP_TENANT
    ? and(eq(entityRecords.entity, SITE_CHECKIN_ENTITY), eq(entityRecords.deleted, false))
    : and(eq(entityRecords.entity, SITE_CHECKIN_ENTITY), eq(entityRecords.deleted, false), eq(entityRecords.tenantId, a.tenantId)));
  const list = rows.map((r) => ({ id: r.id, ...r.state }) as Record<string, unknown> & { id: string })
    .filter((r) => !archive || !!r["checkedOutAt"])
    .filter((r) => {
      const day = String(r["checkedInAt"] || "").slice(0, 10);
      return (!from || day >= from) && (!to || day <= to);
    })
    .sort((x, y) => String(y["checkedInAt"]).localeCompare(String(x["checkedInAt"])));
  res.json(await withPhotoUrls(list.slice(0, 1000), new Map(rows.map((r) => [r.id, r.tenantId]))));
});

/** Vendor walk-throughs: where each vendor's phone was when they checked in for a
 *  scheduled walk-through, against the building — the only time a vendor is located. */
router.get("/v1/site-checkins/vendors", async (req, res) => {
  const a = actorFrom(res);
  if (!isManager(a.role)) { res.status(403).json({ error: "For management." }); return; }
  const from = str(req.query["from"], 10), to = str(req.query["to"], 10);
  const rows = await db.select().from(entityRecords).where(a.tenantId === FIAREP_TENANT
    ? and(eq(entityRecords.entity, "procurement"), eq(entityRecords.deleted, false))
    : and(eq(entityRecords.entity, "procurement"), eq(entityRecords.deleted, false), eq(entityRecords.tenantId, a.tenantId)));
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const list = Array.isArray(r.state["walkthroughCheckIns"]) ? (r.state["walkthroughCheckIns"] as Record<string, unknown>[]) : [];
    for (const c of list) {
      const day = String(c["capturedAt"] || "").slice(0, 10);
      if ((from && day < from) || (to && day > to)) continue;
      out.push({ ...c, address: String(r.state["address"] ?? r.development ?? ""), trackingId: String(r.state["trackingId"] ?? ""), walkthroughAt: String(r.state["walkthroughAt"] ?? "") });
    }
  }
  out.sort((x, y) => String(y["capturedAt"]).localeCompare(String(x["capturedAt"])));
  res.json(out.slice(0, 500));
});

export default router;
