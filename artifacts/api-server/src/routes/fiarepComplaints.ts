// FIAREP's Complaint Dashboard: every resident complaint at every client that
// hires FIAREP, in one feed — for FIAREP's administrators / management on the
// FIAREP platform and for Platform Control.
import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { actorFrom, requireAuth, requirePlatformOwner } from "../middlewares/auth";
import { watchedClients, watchedComplaint } from "../lib/fiarepWatch";

const router: IRouter = Router();
const FIAREP_TENANT = "default";

async function feed() {
  const [rows, orgs] = await Promise.all([
    db.select().from(entityRecords)
      .where(and(eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false), ne(entityRecords.tenantId, FIAREP_TENANT)))
      .orderBy(desc(entityRecords.createdAt)).limit(5000),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
  ]);
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((r) => ({
    id: r.id, tenantId: r.tenantId, clientName: names.get(r.tenantId) || r.tenantId,
    development: r.development, state: r.state, createdAt: r.createdAt, updatedAt: r.updatedAt, version: r.version,
  }));
}

router.get("/v1/fiarep/complaint-feed", requireAuth, async (_req, res) => {
  const a = actorFrom(res);
  if (a.tenantId !== FIAREP_TENANT || !["administrator", "management"].includes(a.role)) { res.status(403).json({ error: "For FIAREP management." }); return; }
  // FIAREP's office sees the complaints clients sent FIAREP, and every complaint at a client FIAREP watches quietly.
  const watched = await watchedClients();
  res.json((await feed()).filter((r) => watched.has(r.tenantId) || typeof (r.state as Record<string, unknown>)["fiarepRecordId"] === "string").map((r) => ({ ...r, watched: watched.has(r.tenantId) })));
});

// One client complaint, read-only, at a client FIAREP watches quietly (the client is never told).
router.get("/v1/fiarep/watched/:id", requireAuth, async (req, res) => {
  const row = await watchedComplaint(actorFrom(res), String(req.params["id"] || ""));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, row.tenantId)).limit(1);
  res.setHeader("Cache-Control", "no-store");
  res.json({ id: row.id, tenantId: row.tenantId, clientName: org?.name || row.tenantId, development: row.development, state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt, watched: true });
});

router.get("/v1/platform/complaint-feed", requirePlatformOwner, async (_req, res) => {
  res.json(await feed());
});

export default router;
