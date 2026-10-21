// Smart Repair on all their phones: when Platform Control switches it on for a
// company (features.modules.smartRepairSync), each person's saved Smart Repairs
// (directions + before / after photos) are kept on their account, so every phone
// or iPad they sign in to shows the same list. Off: nothing is sent; the phone
// keeps them to itself as before.
import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, organizations } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { smartRepairPhotos } from "../lib/fileStorage";

const router: IRouter = Router();
router.use("/v1/smart-repairs", requireAuth);

type Row = { id: string; data: unknown; photo: string | null; after: string | null; updated_at: Date };
const rowsOf = (r: unknown) => (r as { rows: Row[] }).rows;
let ready: Promise<unknown> | null = null;
const table = () => (ready ??= db.execute(sql`create table if not exists smart_repairs (
  tenant_id text not null, staff_id text not null, id text not null, data jsonb not null,
  photo text, after text, deleted boolean not null default false, updated_at timestamptz not null default now(),
  primary key (tenant_id, staff_id, id))`).catch((e) => { ready = null; throw e; }));

export async function smartRepairSyncOn(tenantId: string): Promise<boolean> {
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = ((org?.features ?? {}) as { modules?: Record<string, unknown> }).modules ?? {};
  return modules["smartRepairSync"] === true && modules["smartRepair"] !== false;
}
const cleanId = (v: unknown) => (typeof v === "string" && /^[\w.-]{1,80}$/.test(v) ? v : null);

router.get("/v1/smart-repairs", async (_req, res) => {
  const actor = actorFrom(res);
  if (!(await smartRepairSyncOn(actor.tenantId))) { res.json({ on: false, items: [] }); return; }
  await table();
  const rows = rowsOf(await db.execute(sql`select id, data, photo, after, updated_at from smart_repairs
    where tenant_id = ${actor.tenantId} and staff_id = ${actor.id} and deleted = false order by updated_at desc limit 200`));
  const items = await Promise.all(rows.map(async (r) => ({
    id: r.id, data: r.data, updatedAt: new Date(r.updated_at).toISOString(),
    photoUrl: r.photo ? await smartRepairPhotos.downloadUrl(r.photo).catch(() => null) : null,
    afterUrl: r.after ? await smartRepairPhotos.downloadUrl(r.after).catch(() => null) : null,
  })));
  res.json({ on: true, items });
});

router.put("/v1/smart-repairs/:id", async (req, res) => {
  const actor = actorFrom(res);
  const id = cleanId(req.params["id"]);
  const data = (req.body as { data?: unknown } | undefined)?.data;
  if (!id || !data || typeof data !== "object" || Array.isArray(data)) { res.status(400).json({ error: "A repair id and its data are required" }); return; }
  if (JSON.stringify(data).length > 200_000) { res.status(413).json({ error: "Too large" }); return; }
  if (!(await smartRepairSyncOn(actor.tenantId))) { res.status(409).json({ error: "Smart Repair on all phones is off for this company", on: false }); return; }
  await table();
  await db.execute(sql`insert into smart_repairs (tenant_id, staff_id, id, data, deleted, updated_at)
    values (${actor.tenantId}, ${actor.id}, ${id}, ${JSON.stringify(data)}::jsonb, false, now())
    on conflict (tenant_id, staff_id, id) do update set data = excluded.data, deleted = false, updated_at = now()`);
  res.json({ ok: true });
});

// The phone uploads a photo straight to storage with this link (no photo passes through the API).
router.post("/v1/smart-repairs/:id/photo", async (req, res) => {
  const actor = actorFrom(res);
  const id = cleanId(req.params["id"]);
  const which = (req.body as { which?: unknown } | undefined)?.which === "after" ? "after" : "before";
  if (!id) { res.status(400).json({ error: "A repair id is required" }); return; }
  if (!(await smartRepairSyncOn(actor.tenantId))) { res.status(409).json({ error: "Smart Repair on all phones is off for this company", on: false }); return; }
  await table();
  const full = smartRepairPhotos.path(actor.tenantId, actor.id, id, which);
  const updated = which === "after"
    ? await db.execute(sql`update smart_repairs set after = ${full}, updated_at = now() where tenant_id = ${actor.tenantId} and staff_id = ${actor.id} and id = ${id} returning id`)
    : await db.execute(sql`update smart_repairs set photo = ${full}, updated_at = now() where tenant_id = ${actor.tenantId} and staff_id = ${actor.id} and id = ${id} returning id`);
  if (!rowsOf(updated).length) { res.status(404).json({ error: "Save the repair first" }); return; }
  try { res.json({ uploadUrl: await smartRepairPhotos.uploadUrl(full) }); }
  catch (err) { req.log.error({ err }, "Smart Repair photo link failed"); res.status(503).json({ error: "File storage is temporarily unavailable" }); }
});

router.delete("/v1/smart-repairs/:id", async (_req, res) => {
  const actor = actorFrom(res);
  const id = cleanId(_req.params["id"]);
  if (!id) { res.status(400).json({ error: "A repair id is required" }); return; }
  await table();
  const rows = rowsOf(await db.execute(sql`select id, data, photo, after, updated_at from smart_repairs where tenant_id = ${actor.tenantId} and staff_id = ${actor.id} and id = ${id}`));
  await db.execute(sql`update smart_repairs set deleted = true, data = '{}'::jsonb, photo = null, after = null, updated_at = now()
    where tenant_id = ${actor.tenantId} and staff_id = ${actor.id} and id = ${id}`);
  for (const r of rows) { if (r.photo) void smartRepairPhotos.remove(r.photo); if (r.after) void smartRepairPhotos.remove(r.after); }
  res.status(204).end();
});

export default router;
