import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { GetScoresResponse } from "@workspace/api-zod";
import { entityDevelopmentAllowed, isBoroughDirector } from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";
import {
  calculateBuildingScores,
  calculateDevelopmentScores,
  calculateResidentialScores,
  calculateVendorScores,
  type ScoringRecord,
} from "../lib/scoring";

const router: IRouter = Router();
const SCORE_ENTITIES = [
  "procurement",
  "route-assignments",
  "building-violations",
  "violations",
  "inspections",
  "resident-reports",
] as const;

router.get("/v1/scores", requireAuth, async (_req, res): Promise<void> => {
  const actor = actorFrom(res);
  if (!["administrator", "management"].includes(actor.role) && !isBoroughDirector(actor)) {
    res.status(403).json({ error: "Scores are restricted to administrators and management" });
    return;
  }

  const rows = await db
    .select()
    .from(entityRecords)
    .where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.deleted, false),
      inArray(entityRecords.entity, [...SCORE_ENTITIES]),
    ));

  const records: ScoringRecord[] = rows
    .filter((row) => {
      const stateDevelopment = typeof row.state["development"] === "string"
        ? row.state["development"]
        : null;
      const scopedDevelopment = row.development?.trim() || stateDevelopment;
      return entityDevelopmentAllowed(actor, row.entity, scopedDevelopment);
    })
    .map((row) => ({
      entity: row.entity,
      development: row.development,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

  const response = {
    generatedAt: new Date().toISOString(),
    formulaVersion: "v1" as const,
    developments: calculateDevelopmentScores(records),
    vendors: calculateVendorScores(records),
    buildings: calculateBuildingScores(records),
    residential: calculateResidentialScores(records),
  };
  res.json(GetScoresResponse.parse(response));
});

export default router;