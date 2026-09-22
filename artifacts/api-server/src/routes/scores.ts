import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, entityRecords, organizationProperties } from "@workspace/db";
import { GetScoresResponse } from "@workspace/api-zod";
import { entityDevelopmentAllowed, isBoroughDirector, isElevated, isManagementSupervisor } from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";
import {
  calculateBuildingScores,
  calculateDevelopmentScores,
  calculateResidentialScores,
  calculateVendorScores,
  type ScoringRecord,
} from "../lib/scoring";
import { repairLegacyResidentDevelopment } from "../lib/legacyResidentDevelopment";

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

  const [storedRows, activeProperties] = await Promise.all([
    db
      .select()
      .from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
        inArray(entityRecords.entity, [...SCORE_ENTITIES]),
      )),
    db
      .select({ development: organizationProperties.development })
      .from(organizationProperties)
      .where(and(
        eq(organizationProperties.organizationId, actor.tenantId),
        eq(organizationProperties.active, true),
      )),
  ]);
  const rows = await Promise.all(storedRows.map(repairLegacyResidentDevelopment));

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

  const propertyDevelopments = new Set(
    activeProperties
      .map((property) => property.development?.trim().toLowerCase())
      .filter((development): development is string => Boolean(development)),
  );
  // Authorization above determines which developments the actor may see.
  // Do not require a matching property-catalog row here: a development can
  // contain many addresses, and valid operational records may arrive before
  // those addresses have been loaded into the property catalog.
  const developmentRecords = records.filter((record) => {
    const stateDevelopment = typeof record.state["development"] === "string"
      ? record.state["development"].trim()
      : "";
    return Boolean(record.development?.trim() || stateDevelopment);
  });
  const developments = calculateDevelopmentScores(developmentRecords);
  const knownDevelopments = new Set(
    developments.map((score) => score.development.trim().toLowerCase()),
  );
  const baselineDevelopments =
    actor.role === "administrator" || isElevated(actor) || isManagementSupervisor(actor)
      ? activeProperties.map((property) => property.development ?? "")
      : actor.developments;
  for (const development of baselineDevelopments) {
    const name = development.trim();
    if (
      !name ||
      !propertyDevelopments.has(name.toLowerCase()) ||
      knownDevelopments.has(name.toLowerCase())
    ) continue;
    developments.push({
      development: name,
      points: 0,
      scorePercent: 50,
      completed: 0,
      open: 0,
      overdue: 0,
      sampleSize: 0,
    });
    knownDevelopments.add(name.toLowerCase());
  }
  developments.sort((a, b) =>
    b.scorePercent - a.scorePercent ||
    a.development.localeCompare(b.development)
  );

  const response = {
    generatedAt: new Date().toISOString(),
    formulaVersion: "v2" as const,
    developments,
    vendors: calculateVendorScores(records),
    buildings: calculateBuildingScores(records),
    residential: calculateResidentialScores(records),
  };
  res.json(GetScoresResponse.parse(response));
});

export default router;