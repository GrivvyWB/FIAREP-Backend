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
import { repairLegacyResidentDevelopment } from "../lib/legacyResidentDevelopment";
import { canReadEntityRecordForActor } from "../lib/hrAuthorization";

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

  const storedRows = await db
    .select()
    .from(entityRecords)
    .where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.deleted, false),
      inArray(entityRecords.entity, [...SCORE_ENTITIES]),
    ));
  // Work that came from a resident complaint an administrator deleted (a scope,
  // a violation sent to an inspector, a trade request …) no longer scores.
  const complaintRows = await db
    .select({ id: entityRecords.id, deleted: entityRecords.deleted, state: entityRecords.state })
    .from(entityRecords)
    .where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "resident-reports"),
    ));
  const liveComplaintIds = new Set(complaintRows.filter((row) => !row.deleted).map((row) => row.id));
  const deletedComplaintIds = new Set(complaintRows.filter((row) => row.deleted).map((row) => row.id));
  const complaintNoOf = (state: Record<string, unknown>) =>
    String(state["complaintNo"] || "").trim().toUpperCase();
  const liveComplaintNos = new Set(complaintRows.filter((row) => !row.deleted).map((row) => complaintNoOf(row.state)).filter(Boolean));
  const deletedComplaintNos = new Set(complaintRows.filter((row) => row.deleted).map((row) => complaintNoOf(row.state))
    .filter((no) => no && !liveComplaintNos.has(no)));
  const fromDeletedComplaint = (row: typeof storedRows[number]) => {
    if (row.entity === "resident-reports") return false;
    const state = row.state as Record<string, unknown>;
    const sourceId = String(state["sourceReportId"] || (state["sourceEntity"] === "resident-reports" ? state["sourceRecordId"] || "" : "") || "");
    if (sourceId && (deletedComplaintIds.has(sourceId) || !liveComplaintIds.has(sourceId))) return true;
    const refs = [state["complaintNo"], state["sourceRef"], state["sourceInspectionRef"]]
      .map((value) => String(value || "").trim().toUpperCase())
      .filter((value) => /^RC-\d+$/.test(value));
    if (refs.some((ref) => deletedComplaintNos.has(ref) || !liveComplaintNos.has(ref))) return true;
    const instructions = String(state["instructions"] || "").toUpperCase();
    const match = instructions.match(/COMPLAINT #:\s*(RC-\d+)/);
    return !!match && (deletedComplaintNos.has(match[1]!) || !liveComplaintNos.has(match[1]!));
  };
  const repaired = await Promise.all(storedRows.filter((row) => !fromDeletedComplaint(row)).map(repairLegacyResidentDevelopment));
  // Scores only count what this person is allowed to see: a supervisor who
  // hasn't been sent a development's complaints doesn't see them here either.
  const readable = await Promise.all(repaired.map((row) => canReadEntityRecordForActor(actor, row)));
  // A complaint also scores for whoever handled work that came out of it — the
  // Supervisor Inspector who reviewed its inspection, the CPM Supervisor who
  // received the scope, the trade that did the repair — even if the complaint
  // itself was never sent to them directly.
  const derivedFrom = (row: typeof storedRows[number]): { ids: string[]; nos: string[] } => {
    const state = row.state as Record<string, unknown>;
    const ids = [String(state["sourceReportId"] || ""), state["sourceEntity"] === "resident-reports" ? String(state["sourceRecordId"] || "") : ""].filter(Boolean);
    const nos = [state["complaintNo"], state["sourceRef"], state["sourceInspectionRef"]]
      .map((value) => String(value || "").trim().toUpperCase()).filter((value) => /^RC-\d+$/.test(value));
    const match = String(state["instructions"] || "").toUpperCase().match(/COMPLAINT #:\s*(RC-\d+)/);
    if (match) nos.push(match[1]!);
    return { ids, nos };
  };
  const handledComplaintIds = new Set<string>();
  const handledComplaintNos = new Set<string>();
  repaired.forEach((row, index) => {
    if (!readable[index] || row.entity === "resident-reports") return;
    const { ids, nos } = derivedFrom(row);
    ids.forEach((id) => handledComplaintIds.add(id));
    nos.forEach((no) => handledComplaintNos.add(no));
  });
  const rows = repaired.filter((row, index) =>
    readable[index] ||
    (row.entity === "resident-reports" &&
      (handledComplaintIds.has(row.id) || handledComplaintNos.has(complaintNoOf(row.state as Record<string, unknown>)))));

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