import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, entityRecords, organizationProperties, organizations } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { isCoverageEligible } from "../lib/domain";
import { APP_READ_ONLY_MESSAGE, isAppReadOnlyActor, isMobileAppRequest } from "../lib/appReadOnly";
import { lockOn } from "../lib/locks";
import {
  COVERAGE_ENTITY,
  COVERAGE_WINDOW_MS,
  developmentCoverageCode,
  isHomeDevelopment,
  listActiveCoverage,
} from "../lib/coverage";

const router: IRouter = Router();
router.use("/v1/coverage", requireAuth);

const FIAREP_TENANT = "default";
const NOT_ON = "Cover a site is not switched on for your company.";
const normSite = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

/** Cover a site is OFF for a client until it is switched on in Platform Control. FIAREP keeps it. */
async function coverSiteOn(tenantId: string): Promise<boolean> {
  if (tenantId === FIAREP_TENANT) return true;
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = (org?.features as { modules?: Record<string, unknown> } | null)?.modules;
  return !!modules && modules["cover-site"] === true;
}

/** A client's own buildings (not NYCHA developments): the development name when the building has one, otherwise its address. */
async function clientSites(tenantId: string): Promise<{ name: string; address: string }[]> {
  const rows = await db.select({ address: organizationProperties.displayAddress, development: organizationProperties.development })
    .from(organizationProperties)
    .where(and(eq(organizationProperties.organizationId, tenantId), eq(organizationProperties.active, true)));
  const seen = new Map<string, { name: string; address: string }>();
  for (const r of rows) {
    const name = (r.development || "").trim() || r.address;
    if (!seen.has(normSite(name))) seen.set(normSite(name), { name, address: r.address });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The sites the picker lists: the client's own buildings; FIAREP keeps the NYCHA list (nycha: true). */
router.get("/v1/coverage/sites", async (_req, res) => {
  const actor = actorFrom(res);
  if (!isCoverageEligible(actor) || !(await coverSiteOn(actor.tenantId))) { res.json({ on: false, nycha: false, sites: [] }); return; }
  if (actor.tenantId === FIAREP_TENANT) { res.json({ on: true, nycha: true, sites: [] }); return; }
  res.json({ on: true, nycha: false, sites: await clientSites(actor.tenantId) });
});

/** For a client the site must be one of its own buildings. */
async function siteAllowed(tenantId: string, development: string): Promise<boolean> {
  if (tenantId === FIAREP_TENANT) return true;
  const target = normSite(development);
  return (await clientSites(tenantId)).some((s) => normSite(s.name) === target || normSite(s.address) === target);
}

// Look up a development's 2-digit code so the picker can populate it.
router.get("/v1/coverage/development-code", async (req, res) => {
  const actor = actorFrom(res);
  if (!isCoverageEligible(actor)) {
    res.status(403).json({ error: "You are not eligible for site coverage." });
    return;
  }
  if (!(await coverSiteOn(actor.tenantId))) { res.status(403).json({ error: NOT_ON }); return; }
  const development = typeof req.query.development === "string" ? req.query.development.trim() : "";
  if (!development) { res.status(400).json({ error: "development is required" }); return; }
  if (!(await siteAllowed(actor.tenantId, development))) { res.status(400).json({ error: "That is not one of your company's buildings." }); return; }
  res.json({ development, code: developmentCoverageCode(development) });
});

// The signed-in supervisor's active coverage unlocks.
router.get("/v1/coverage/active", async (_req, res) => {
  const actor = actorFrom(res);
  if (!isCoverageEligible(actor) || !(await coverSiteOn(actor.tenantId))) { res.json([]); return; }
  res.json(await listActiveCoverage(actor));
});

// Unlock a development for 24h by confirming its 2-digit code.
router.post("/v1/coverage/unlock", async (req, res) => {
  const actor = actorFrom(res);
  if (isMobileAppRequest(req) && isAppReadOnlyActor(actor) && await lockOn(actor.tenantId, "appViewOnly")) {
    res.status(403).json({ error: APP_READ_ONLY_MESSAGE, code: "app_read_only" });
    return;
  }
  if (!isCoverageEligible(actor)) {
    res.status(403).json({ error: "You are not eligible for site coverage." });
    return;
  }
  const body = req.body ?? {};
  const development = typeof body.development === "string" ? body.development.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!development) { res.status(400).json({ error: "development is required" }); return; }
  if (!(await coverSiteOn(actor.tenantId))) { res.status(403).json({ error: NOT_ON }); return; }
  if (!(await siteAllowed(actor.tenantId, development))) { res.status(400).json({ error: "That is not one of your company's buildings." }); return; }
  if (isHomeDevelopment(actor, development)) {
    res.status(400).json({ error: "That development is already part of your assignment." });
    return;
  }
  if (code !== developmentCoverageCode(development)) {
    res.status(400).json({ error: "That code does not match this development." });
    return;
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COVERAGE_WINDOW_MS);
  await db.insert(entityRecords).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    entity: COVERAGE_ENTITY,
    development,
    createdBy: actor.id,
    state: {
      staffId: actor.id,
      staffName: actor.name,
      development,
      code,
      grantedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  });
  res.status(201).json({ development, expiresAt: expiresAt.toISOString() });
});

export default router;
