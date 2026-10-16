// FIAREP's Complaint Dashboard: every resident complaint at every client that
// hires FIAREP, in one feed — for FIAREP's administrators / management on the
// FIAREP platform and for Platform Control.
import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { actorFrom, requireAuth, requirePlatformOwner } from "../middlewares/auth";

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
  res.json(await feed());
});

router.get("/v1/platform/complaint-feed", requirePlatformOwner, async (_req, res) => {
  res.json(await feed());
});

export default router;
