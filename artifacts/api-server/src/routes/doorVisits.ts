// Door Visit: a member at a resident's door (or a building) presses one button on the
// home screen. Where the phone is, the time (server clock), the direction the phone faces,
// the floor and which door, then up to a minute of video at the door: access given, no
// access, or nobody home. Sent to the administrator and management, and emailed if asked.
// Kept for good: a visit cannot be changed or deleted once it is sent.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { notify } from "../lib/audit";
import { fileStorage } from "../lib/fileStorage";
import { reverseGeocodeNyc } from "../lib/nycProperty";

const router: IRouter = Router();
router.use("/v1/door-visits", requireAuth);
const ENTITY = "door-visits";
const OUTCOMES: Record<string, string> = { access: "Access given", no_access: "No access", not_home: "Nobody home" };
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const office = (role: string) => role === "administrator" || role === "management";
const connectors = new ReplitConnectors();
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function load(id: string, tenantId: string) {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.entity, ENTITY), eq(entityRecords.tenantId, tenantId), eq(entityRecords.deleted, false))).limit(1);
  return row || null;
}

/** The visit, the moment the button is pressed. The server sets the time. */
router.post("/v1/door-visits", async (req, res) => {
  const a = actorFrom(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const lat = num(b["latitude"]), lng = num(b["longitude"]);
  const nyc = lat !== null && lng !== null ? await reverseGeocodeNyc(lat, lng).catch(() => null) : null;
  const heading = num(b["heading"]);
  const state = {
    staffId: a.id, staffName: a.name, staffPosition: a.position,
    at: new Date().toISOString(),
    latitude: lat, longitude: lng, accuracy: num(b["accuracy"]),
    address: str(b["address"], 200) || nyc || str(b["deviceAddress"], 200) || (lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : ""),
    heading, facing: str(b["facing"], 20),
    floor: str(b["floor"], 20), unit: str(b["unit"], 40), door: str(b["door"], 200),
    record: str(b["record"], 80), outcome: "", note: "", video: null as null | { objectPath: string; contentType: string; seconds: number }, sentAt: null as string | null,
  };
  const id = randomUUID();
  await db.insert(entityRecords).values({ id, tenantId: a.tenantId, entity: ENTITY, development: state.address || null, createdBy: a.id, state });
  res.status(201).json({ id, at: state.at, address: state.address });
});

/** The door video goes straight to storage (up to a minute). */
router.post("/v1/door-visits/:id/video-url", async (req, res) => {
  const a = actorFrom(res);
  const row = await load(String(req.params["id"]), a.tenantId);
  if (!row || row.createdBy !== a.id || row.state["sentAt"]) { res.status(404).json({ error: "Visit not found." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const size = Number(b["size"]);
  const contentType = b["contentType"] === "video/mp4" ? "video/mp4" : "video/quicktime";
  if (!size || size > 150 * 1024 * 1024) { res.status(400).json({ error: "Video too large." }); return; }
  const { uploadUrl, file } = await fileStorage.createUpload(a.tenantId, a.id, { kind: "inspection-evidence", name: contentType === "video/mp4" ? "door.mp4" : "door.mov", size, contentType });
  const seconds = Math.max(0, Math.min(60, Math.round(Number(b["seconds"]) || 0)));
  await db.update(entityRecords).set({ state: { ...row.state, video: { objectPath: file.objectPath, contentType, seconds } }, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  res.json({ uploadUrl, objectPath: file.objectPath });
});

/** Send: the outcome, a note, to the administrator and management; emailed when asked. */
router.post("/v1/door-visits/:id/send", async (req, res) => {
  const a = actorFrom(res);
  const row = await load(String(req.params["id"]), a.tenantId);
  if (!row || row.createdBy !== a.id) { res.status(404).json({ error: "Visit not found." }); return; }
  if (row.state["sentAt"]) { res.json({ ok: true, alreadySent: true }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const outcome = OUTCOMES[str(b["outcome"], 20)] ? str(b["outcome"], 20) : "";
  if (!outcome) { res.status(400).json({ error: "Pick Access given, No access or Nobody home." }); return; }
  const s = row.state as Record<string, unknown>;
  const next: Record<string, unknown> = { ...s, outcome, note: str(b["note"], 1000), floor: str(b["floor"], 20) || s["floor"], unit: str(b["unit"], 40) || s["unit"], door: str(b["door"], 200) || s["door"], record: str(b["record"], 80) || s["record"], sentAt: new Date().toISOString() };
  await db.update(entityRecords).set({ state: next, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  const where = [next["address"], next["floor"] ? `Floor ${next["floor"]}` : "", next["unit"] ? `Apt ${next["unit"]}` : "", next["door"], next["facing"] ? `facing ${next["facing"]}` : ""].filter(Boolean).join(" · ");
  const title = `Door visit — ${OUTCOMES[outcome]}: ${a.name}`;
  const when = new Date(String(next["at"])).toLocaleString("en-US", { timeZone: "America/New_York" });
  const detail = [where, when, next["record"] ? `Record ${next["record"]}` : "", next["video"] ? "Video at the door" : "", next["note"]].filter(Boolean).join(" · ");
  for (const role of ["administrator", "management"]) await notify(a, role, title, detail, row.id).catch(() => undefined);
  // Email: to the address typed on the phone, or the company's address on file when "Email the office" is on.
  let emailed = false;
  const [org] = await db.select({ name: organizations.name, features: organizations.features }).from(organizations).where(eq(organizations.id, a.tenantId)).limit(1);
  const onFile = typeof (org?.features as Record<string, unknown> | null)?.["smartRepairEmailTo"] === "string" ? String((org!.features as Record<string, unknown>)["smartRepairEmailTo"]).trim() : "";
  const to = str(b["emailTo"], 300) || (b["email"] === true ? onFile : "");
  if (to && /^[^@\s]+@[^@\s]+\.[^@\s]+/.test(to)) {
    try {
      const html = `<p><b>FIAREP Door Visit — ${esc(OUTCOMES[outcome])}</b></p><p>${esc(org?.name)}</p><p>${esc(a.name)}${a.position ? ` (${esc(a.position)})` : ""}<br>${esc(where)}<br>${esc(when)}${next["latitude"] != null ? `<br>GPS ${Number(next["latitude"]).toFixed(6)}, ${Number(next["longitude"]).toFixed(6)}` : ""}${next["record"] ? `<br>Record ${esc(next["record"])}` : ""}</p>${next["note"] ? `<p>${esc(next["note"])}</p>` : ""}<p>${next["video"] ? "The door video is on fiarep.com → Door Visits." : "No video was recorded."}</p>`;
      const r = await connectors.proxy("outlook", "/v1.0/me/sendMail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: { subject: `Door visit — ${OUTCOMES[outcome]} — ${where}`.slice(0, 250), body: { contentType: "HTML", content: html }, toRecipients: to.split(/[,;]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address } })) }, saveToSentItems: true }) });
      emailed = r.ok;
    } catch { emailed = false; }
  }
  res.json({ ok: true, notified: true, emailed });
});

/** The office sees every visit in the company; a member sees their own. */
router.get("/v1/door-visits", async (_req, res) => {
  const a = actorFrom(res);
  res.setHeader("Cache-Control", "no-store");
  const rows = await db.select().from(entityRecords)
    .where(and(eq(entityRecords.entity, ENTITY), eq(entityRecords.tenantId, a.tenantId), eq(entityRecords.deleted, false), ...(office(a.role) ? [] : [eq(entityRecords.createdBy, a.id)])))
    .orderBy(desc(entityRecords.createdAt)).limit(300);
  const items = await Promise.all(rows.map(async (r) => {
    const s = r.state as Record<string, unknown>;
    const v = s["video"] as { objectPath?: string } | null;
    const videoUrl = v?.objectPath ? await fileStorage.createDownload(r.tenantId, v.objectPath).then((d) => d.downloadUrl).catch(() => null) : null;
    return { id: r.id, ...s, outcomeLabel: OUTCOMES[String(s["outcome"] || "")] || "Not sent yet", videoUrl };
  }));
  res.json(items);
});

/** Email on file (to fill the email box on the phone). */
router.get("/v1/door-visits/email-on-file", async (_req, res) => {
  const a = actorFrom(res);
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, a.tenantId)).limit(1);
  const f = (org?.features ?? {}) as Record<string, unknown>;
  res.json({ email: typeof f["smartRepairEmailTo"] === "string" ? f["smartRepairEmailTo"] : "" });
});

export default router;
