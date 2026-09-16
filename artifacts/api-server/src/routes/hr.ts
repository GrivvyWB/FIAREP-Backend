import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { auditLog, db, entityRecords, staffAccounts } from "@workspace/db";
import {
  canReadHrEntityRecord,
  isHrEntity,
  serializeHrStaff,
} from "../lib/domain";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/v1/hr", requireAuth);

function outward(row: typeof entityRecords.$inferSelect) {
  return {
    id: row.id,
    entity: row.entity,
    projectId: row.projectId,
    development: row.development,
    state: row.state,
    deleted: row.deleted,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/v1/hr/workspace", async (_req, res): Promise<void> => {
  const actor = actorFrom(res);
  if (actor.role !== "human_resources") {
    res.status(403).json({ error: "The HR workspace is restricted to Human Resources" });
    return;
  }
  const [staffRows, recordRows, audits] = await Promise.all([
    db.select().from(staffAccounts)
      .where(eq(staffAccounts.tenantId, actor.tenantId))
      .orderBy(staffAccounts.name),
    db.select().from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ))
      .orderBy(desc(entityRecords.updatedAt)),
    db.select().from(auditLog)
      .where(eq(auditLog.tenantId, actor.tenantId))
      .orderBy(desc(auditLog.at))
      .limit(100),
  ]);
  const staffById = new Map(staffRows.map((row) => [row.id, row]));
  const records = recordRows
    .filter((row) => isHrEntity(row.entity))
    .filter((row) => {
      const employeeId = typeof row.state["employeeStaffId"] === "string"
        ? row.state["employeeStaffId"].trim()
        : "";
      return canReadHrEntityRecord(actor, row, staffById.get(employeeId));
    })
    .map(outward);
  const visibleRecordIds = new Set(records.map((row) => row.id));
  const visibleStaffIds = new Set(staffRows.map((row) => row.id));
  const visibleAudits = audits.filter((row) => {
    const reportId = row.reportId || "";
    const actionEntity = row.action.split(".", 1)[0] || "";
    const isHrLifecycleAudit = isHrEntity(actionEntity);
    const isStaffLifecycleAudit = row.action.startsWith("staff.");
    return (
      (isHrLifecycleAudit && visibleRecordIds.has(reportId)) ||
      (isStaffLifecycleAudit && visibleStaffIds.has(reportId))
    );
  });
  res.json({
    staff: staffRows.map((row) => serializeHrStaff(row, true)),
    records,
    audit: visibleAudits.map((row) => ({
      id: row.id,
      actorRole: row.actorRole,
      actorName: row.actorName,
      action: row.action,
      detail: row.detail,
      reportId: row.reportId,
      at: row.at,
    })),
  });
});

export default router;