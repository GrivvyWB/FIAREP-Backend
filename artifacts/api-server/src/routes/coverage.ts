import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { db, entityRecords } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { isCoverageEligible } from "../lib/domain";
import {
  COVERAGE_ENTITY,
  COVERAGE_WINDOW_MS,
  developmentCoverageCode,
  isHomeDevelopment,
  listActiveCoverage,
} from "../lib/coverage";

const router: IRouter = Router();
router.use("/v1/coverage", requireAuth);

// Look up a development's 2-digit code so the picker can populate it.
router.get("/v1/coverage/development-code", (req, res) => {
  const actor = actorFrom(res);
  if (!isCoverageEligible(actor)) {
    res.status(403).json({ error: "You are not eligible for site coverage." });
    return;
  }
  const development = typeof req.query.development === "string" ? req.query.development.trim() : "";
  if (!development) { res.status(400).json({ error: "development is required" }); return; }
  res.json({ development, code: developmentCoverageCode(development) });
});

// The signed-in supervisor's active coverage unlocks.
router.get("/v1/coverage/active", async (_req, res) => {
  const actor = actorFrom(res);
  if (!isCoverageEligible(actor)) { res.json([]); return; }
  res.json(await listActiveCoverage(actor));
});

// Unlock a development for 24h by confirming its 2-digit code.
router.post("/v1/coverage/unlock", async (req, res) => {
  const actor = actorFrom(res);
  if (!isCoverageEligible(actor)) {
    res.status(403).json({ error: "You are not eligible for site coverage." });
    return;
  }
  const body = req.body ?? {};
  const development = typeof body.development === "string" ? body.development.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!development) { res.status(400).json({ error: "development is required" }); return; }
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
