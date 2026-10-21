// Mold violation monitoring (lib/mold.ts): the website page, the phone's check
// in an apartment, and Mold Removed.
import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { addMoldCase, activeMoldAt, buildingSummaries, markMoldRemoved, syncMoldFromHpd, ensureMoldTables, INSPECTION_THRESHOLD } from "../lib/mold";
import { isSafeTenantObjectPath } from "../lib/fileStorage";
import { cleanResidentSignOff } from "./entities";

const router: IRouter = Router();
router.use("/v1/mold", requireAuth);
const office = (role: string) => ["administrator", "management"].includes(role);
const s = (v: unknown, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : "");

router.get("/v1/mold/buildings", async (_req, res) => {
  const actor = actorFrom(res);
  if (!office(actor.role)) { res.status(403).json({ error: "Management only" }); return; }
  await ensureMoldTables();
  const [last] = (await db.execute(sql`select value from settings where tenant_id = ${actor.tenantId} and key = 'mold-sync' limit 1`) as unknown as { rows: Array<{ value: { at?: string } }> }).rows;
  res.setHeader("Cache-Control", "no-store");
  res.json({ buildings: await buildingSummaries(actor.tenantId), threshold: INSPECTION_THRESHOLD * 100, lastSync: last?.value?.at ?? null });
});

router.post("/v1/mold/sync", async (_req, res) => {
  const actor = actorFrom(res);
  if (!office(actor.role)) { res.status(403).json({ error: "Management only" }); return; }
  try {
    const out = await syncMoldFromHpd(actor.tenantId);
    await db.execute(sql`insert into settings (tenant_id, key, value, created_at, updated_at) values (${actor.tenantId}, 'mold-sync', ${JSON.stringify({ at: new Date().toISOString(), ...out })}::jsonb, now(), now())
      on conflict (tenant_id, key) do update set value = excluded.value, updated_at = now()`);
    res.json(out);
  } catch (err) { res.status(502).json({ error: `HPD could not be reached: ${err instanceof Error ? err.message : "try again"}` }); }
});

router.post("/v1/mold/cases", async (req, res) => {
  const actor = actorFrom(res);
  if (!office(actor.role)) { res.status(403).json({ error: "Management only" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const out = await addMoldCase(actor.tenantId, { address: s(b["address"]), apartment: s(b["apartment"], 20), class: s(b["class"], 1), description: s(b["description"], 600), certifyBy: s(b["certifyBy"], 10) });
  res.status("error" in out ? 400 : 201).json(out);
});

// The member's phone, in an apartment: any active mold here?
router.get("/v1/mold/check", async (req, res) => {
  const actor = actorFrom(res);
  res.setHeader("Cache-Control", "no-store");
  res.json({ cases: await activeMoldAt(actor.tenantId, s(req.query["address"]), s(req.query["apartment"], 20)) });
});

// Mold Removed: an after photo and the resident's sign-off (or not home / refused with the door video).
router.post("/v1/mold/cases/:id/removed", async (req, res) => {
  const actor = actorFrom(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const photo = s(b["photoObjectPath"], 400);
  if (!photo || !isSafeTenantObjectPath(actor.tenantId, photo)) { res.status(400).json({ error: "Take an after photo of the cleaned area." }); return; }
  const signOff = cleanResidentSignOff(b["signOff"], actor.tenantId);
  if (!signOff) { res.status(400).json({ error: "The resident's sign-off is needed (or mark not home / refused with the door video)." }); return; }
  if (signOff["status"] !== "signed" && !signOff["video"]) { res.status(400).json({ error: "Not home / refused needs the door video." }); return; }
  const out = await markMoldRemoved(actor, String(req.params["id"]), { note: s(b["note"], 1000) || undefined, photoObjectPath: photo, signOff, reportId: s(b["reportId"], 80) || undefined, at: new Date().toISOString() });
  res.status("error" in out ? 400 : 200).json(out);
});

export default router;
