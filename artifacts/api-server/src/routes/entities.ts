import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { db, entityRecords, notifications, organizations, publicAccessCodes, staffAccounts } from "@workspace/db";
import { audit, auditInTransaction, notify } from "../lib/audit";
import { deliverPushNotification } from "../lib/push";
import {
  ENTITIES,
  isAcceptedStaffPosition,
  canIssueStaffAccountRole,
  canAssignStaff,
  canSuperintendentEAssignResidentReport,
  canApproveLeaveForEmployee,
  shouldAlertLeaveReviewer,
  leaveNeedsHr,
  canApproveLeaveDuration,
  canDeleteOperationalRecords,
  isDeleteOverrideManager,
  canHrDeleteLeave,
  canCreateEntity,
  canPerformAssignedWorkflowAction,
  canDeleteEntity,
  canMutateEntity,
  canPerformEntityAction,
  canReadEntity,
  isHrEntity,
  isHrProtectedField,
  entityDevelopmentAllowed,
  generatedCode,
  isBoroughDirector,
  isAssignmentAuthority,
  isSupervisorPosition,
  isCpmSupervisor,
  isViolationAuthority,
  isLeaveApprovalAuthority,
  leaveRequestDurationDays,
  isValidEntityTransition,
  patchesWorkflowManagedFields,
  recordId,
  stripPricing,
  validLeaveRequestDuration,
  withInitialWorkflowState,
  procurementRecordAllowed,
  isProcurementActor,
  normalizeAssignment,
  isComplaintHandlingSupervisor,
  waitsToBeSentComplaints,
} from "../lib/domain";
import { canActOnDevelopment, hasAnyActiveCoverage, isHomeDevelopment } from "../lib/coverage";
import { isCommunityCoordinator, isCommunityCoordinatorSupervisor, isCommunityEntity, isCoverageEligible, isSuperintendentE } from "../lib/domain";
import { isCpmSupervisorTitle, isCrewForTrade, isOfficeTradeSupervisorTitle, isSupervisorForTrade, isSupervisorTitle, sameTitle } from "../lib/titles";
import { APP_READ_ONLY_MESSAGE, appReadOnlyDecision, isAppReadOnlyActor, isMobileAppRequest } from "../lib/appReadOnly";
import { hasScopePackage, snapshotElevator, snapshotEstimate, snapshotScope } from "../lib/scopeSnapshot";
import { canReadEntityRecordForActor } from "../lib/hrAuthorization";
import { actorFrom, requireAuth } from "../middlewares/auth";
import type { Actor } from "../lib/auth";
import { emailAwardedVendor, emailReleasedScope, emailVendorChangeOrderStatus } from "../lib/vendorEmail";
import { logger } from "../lib/logger";
import { emailHrLeaveRequest } from "../lib/staffEmail";
import { repairLegacyResidentDevelopment } from "../lib/legacyResidentDevelopment";
import { rateLimit } from "../lib/rateLimit";
import { getConfiguredDevelopmentNames } from "../lib/organizationDevelopments";
import { supervisorTargetForReleasedWork } from "../lib/manpower-routing";
import { routedComplaintRecipientIds } from "../lib/complaintRouting";

const router: IRouter = Router();
router.use("/v1", requireAuth);

// Supervisors/managers are view-only on the phone app (see appReadOnly.ts).
router.use("/v1/:entity", (req, res, next) => {
  const entity = req.params["entity"] || "";
  if (!validEntity(entity) || !isMobileAppRequest(req)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!isAppReadOnlyActor(actor)) {
    next();
    return;
  }
  const decision = appReadOnlyDecision(req.method, entity, req.path);
  if (decision === "block") {
    res.status(403).json({ error: APP_READ_ONLY_MESSAGE, code: "app_read_only" });
    return;
  }
  if (decision === "emergency-assign-only") res.locals["appEmergencyAssignOnly"] = true;
  next();
});
const hrLeaveDecisionRateLimit = rateLimit("hr-leave-decision", 12);

const HR_SENSITIVE_APPROVAL_PURPOSES = new Set([
  "pay-change",
  "discipline",
  "termination",
  "layoff",
]);
const HR_SENSITIVE_ACTIONS = new Set([
  "approve-pay-change",
  "approve-discipline",
  "approve-termination",
  "approve-layoff",
]);

function normalizeStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeLocation(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}

function purposeForTarget(entity: string, state: Record<string, unknown>): string | null {
  if (entity === "hr-payroll-benefits") return "pay-change";
  if (entity === "hr-discipline") return "discipline";
  if (entity === "hr-exits") {
    const exitType = normalizeStatus(state["exitType"]);
    return exitType === "layoff" ? "layoff" : exitType === "termination" ? "termination" : null;
  }
  return null;
}

function actionForPurpose(purpose: string): string {
  return `approve-${purpose}`;
}

function containsHrProtectedFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => isHrProtectedField(key));
}

// Supervisors look a complaint / violation up by its number (RC-12345,
// a violation number, a tracking id) and get the record plus every other
// issue logged at that address / unit, so they can send it to whoever
// should handle it.
router.get("/v1/reference-lookup", async (req, res) => {
  const actor = actorFrom(res);
  if (actor.role !== "management" && actor.role !== "administrator") {
    res.status(403).json({ error: "Only supervisors and management may look up a complaint or violation number" });
    return;
  }
  const ref = String(req.query["ref"] || "").trim().toUpperCase();
  if (ref.length < 3) { res.status(400).json({ error: "Enter the complaint or violation number" }); return; }
  const like = `%${ref.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
  const candidates = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.deleted, false),
    inArray(entityRecords.entity, ["resident-reports", "building-violations"]),
    or(
      sql`upper(${entityRecords.state}->>'complaintNo') LIKE ${like}`,
      sql`upper(${entityRecords.state}->>'violationNo') LIKE ${like}`,
      sql`upper(${entityRecords.state}->>'trackingId') LIKE ${like}`,
      sql`upper(${entityRecords.state}->>'sourceRef') LIKE ${like}`,
    ),
  )).orderBy(desc(entityRecords.createdAt)).limit(5);
  const exact = candidates.find((row) => [row.state["complaintNo"], row.state["violationNo"], row.state["trackingId"]]
    .some((v) => String(v || "").trim().toUpperCase() === ref)) || candidates[0];
  if (!exact || !(await canReadRecordForActor(actor, exact))) {
    res.status(404).json({ error: "No complaint or violation with that number" });
    return;
  }
  const st = exact.state as Record<string, unknown>;
  const address = String(st["address"] || st["building"] || "").trim();
  const unit = String(st["unit"] || "").trim();
  const norm = (v: unknown) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  const summary = (row: typeof entityRecords.$inferSelect) => {
    const s = row.state as Record<string, unknown>;
    return {
      id: row.id, entity: row.entity,
      ref: String(s["complaintNo"] || s["violationNo"] || s["trackingId"] || ""),
      status: String(s["status"] || ""),
      description: String(s["description"] || s["issue"] || s["title"] || "").slice(0, 200),
      location: String(s["location"] || ""), unit: String(s["unit"] || ""),
      assignedTo: String(s["assignedTo"] || ""), createdAt: row.createdAt,
      directedToName: String(s["directedToName"] || ""),
    };
  };
  let history: ReturnType<typeof summary>[] = [];
  if (address) {
    const rows = await db.select().from(entityRecords).where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.deleted, false),
      inArray(entityRecords.entity, ["resident-reports", "building-violations"]),
      sql`lower(coalesce(${entityRecords.state}->>'address', ${entityRecords.state}->>'building', '')) = ${norm(address)}`,
    )).orderBy(desc(entityRecords.createdAt)).limit(60);
    history = rows
      .filter((row) => row.id !== exact.id && (!unit || norm((row.state as Record<string, unknown>)["unit"]) === norm(unit)))
      .slice(0, 20).map(summary);
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({
    record: { ...summary(exact), development: exact.development || String(st["development"] || ""), address, unit, version: exact.version,
      reporterName: String(st["reporterName"] || ""), createdAt: exact.createdAt },
    history,
  });
});

router.get("/v1/deletion-policy", async (_req, res) => {
  const actor = actorFrom(res);
  const [organization] = await db
    .select({ features: organizations.features })
    .from(organizations)
    .where(eq(organizations.id, actor.tenantId))
    .limit(1);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    enabled: organization?.features?.["deletionEnabled"] === true,
    canDelete: canDeleteOperationalRecords(actor),
    // Supervisors / management may delete their own work (a copy stays in the
    // Deleted items box); upper management deletes anyone's with a code.
    canDeleteOwn: actor.role === "management" && !isDeleteOverrideManager(actor),
    overrideRequired: isDeleteOverrideManager(actor) || actor.role === "human_resources",
    // HR deletes leave requests only (a mistake — wrong person), with a two-digit code.
    hrLeaveDelete: actor.role === "human_resources",
  });
});

// ── Delete override codes ─────────────────────────────────────────────────
// Upper management deletes on the website only, with a one-time three-digit
// code issued to them for ten minutes. The code is written on the audit
// trail and into the alert the record's supervisor gets, so it is always
// clear who deleted what.
const deleteOverrides = new Map<string, { code: string; issuedAt: number; expiresAt: number }>();
const OVERRIDE_TTL_MS = 10 * 60 * 1000;
function issueDeleteOverride(actorId: string, digits: 2 | 3 = 3): { code: string; expiresAt: number } {
  // Upper management: three digits (100–999). HR: two digits (10–99).
  const code = digits === 2
    ? String(10 + (randomBytes(2).readUInt16BE(0) % 90))
    : String(100 + (randomBytes(2).readUInt16BE(0) % 900));
  const now = Date.now();
  const entry = { code, issuedAt: now, expiresAt: now + OVERRIDE_TTL_MS };
  deleteOverrides.set(actorId, entry);
  return { code, expiresAt: entry.expiresAt };
}
function consumeDeleteOverride(actorId: string, code: unknown): boolean {
  const entry = deleteOverrides.get(actorId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) { deleteOverrides.delete(actorId); return false; }
  if (String(code ?? "").trim() !== entry.code) return false;
  deleteOverrides.delete(actorId);
  return true;
}

router.post("/v1/delete-override", async (_req, res) => {
  const actor = actorFrom(res);
  const hrCode = actor.role === "human_resources";
  if (!isDeleteOverrideManager(actor) && actor.role !== "administrator" && !hrCode) {
    res.status(403).json({ error: "Only upper management or HR may request a delete override code" });
    return;
  }
  const [organization] = await db
    .select({ features: organizations.features })
    .from(organizations)
    .where(eq(organizations.id, actor.tenantId))
    .limit(1);
  if (organization?.features?.["deletionEnabled"] !== true) {
    res.status(403).json({ error: "Deletion is disabled for this organization" });
    return;
  }
  const issued = issueDeleteOverride(actor.id, hrCode ? 2 : 3);
  await audit(actor, "delete-override.issued", `Delete override code ${issued.code} issued to ${actor.name} (${actor.position})`);
  res.setHeader("Cache-Control", "no-store");
  res.json({ code: issued.code, digits: hrCode ? 2 : 3, expiresAt: new Date(issued.expiresAt).toISOString(), ttlMinutes: 10 });
});

// ── Deleted items box (upper management / administrators) ───────────────
// Every soft-deleted operational record, with who deleted it. Searched by the
// member's name (who deleted, or whose work it was). No alerts — it is a box
// upper management opens when they want to look.
router.get("/v1/deleted-items", async (req, res) => {
  const actor = actorFrom(res);
  if (!isDeleteOverrideManager(actor) && actor.role !== "administrator") {
    res.status(403).json({ error: "Upper management only" });
    return;
  }
  const q = String(req.query["q"] ?? "").trim().toLowerCase();
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.deleted, true),
  )).orderBy(desc(entityRecords.updatedAt)).limit(2000);
  const staff = await db.select({ id: staffAccounts.id, name: staffAccounts.name, position: staffAccounts.position })
    .from(staffAccounts).where(eq(staffAccounts.tenantId, actor.tenantId));
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const items = rows.filter((row) => !isHrEntity(row.entity) && !isCommunityEntity(row.entity)).map((row) => {
    const st = row.state as Record<string, unknown>;
    const owners = [...new Set([row.createdBy, st["assignedStaffId"], st["handoffTargetId"], st["cpmSupervisorId"], st["cpmId"], st["employeeStaffId"], st["requesterStaffId"]]
      .map((v) => String(v || "")).filter((v) => v && nameOf.has(v)).map((v) => nameOf.get(v)!))];
    for (const n of [st["cpmName"], st["employee"], st["assignedTo"], st["assignedStaffName"], st["vendor"]]) if (typeof n === "string" && n.trim()) owners.push(n.trim());
    return {
      id: row.id, entity: row.entity, development: row.development, label: deletionLabel(row.entity, row),
      deletedAt: String(st["deletedAt"] || row.updatedAt.toISOString()),
      deletedByName: String(st["deletedByName"] || nameOf.get(String(st["deletedById"] || "")) || ""),
      deletedByPosition: String(st["deletedByPosition"] || ""),
      overrideCode: String(st["deleteOverrideCode"] || ""),
      owners: [...new Set(owners)],
      state: st,
    };
  }).filter((item) => !q || [item.deletedByName, ...item.owners, item.label].some((v) => String(v || "").toLowerCase().includes(q)));
  res.setHeader("Cache-Control", "no-store");
  res.json({ items, members: staff.map((s) => ({ id: s.id, name: s.name, position: s.position })).sort((a, b) => a.name.localeCompare(b.name)) });
});

// Purge several at once (a member's whole list, or the ones ticked).
router.post("/v1/deleted-items/purge", async (req, res) => {
  const actor = actorFrom(res);
  if (!isDeleteOverrideManager(actor) && actor.role !== "administrator") {
    res.status(403).json({ error: "Upper management only" });
    return;
  }
  const ids = Array.isArray((req.body as any)?.ids) ? ((req.body as any).ids as unknown[]).map((v) => String(v)).filter(Boolean).slice(0, 500) : [];
  if (!ids.length) { res.status(400).json({ error: "ids required" }); return; }
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, actor.tenantId), eq(entityRecords.deleted, true), inArray(entityRecords.id, ids),
  ));
  let purged = 0;
  for (const row of rows) {
    if (isHrEntity(row.entity)) continue;
    await db.delete(notifications).where(and(eq(notifications.tenantId, actor.tenantId), eq(notifications.reportId, row.id)));
    await db.delete(entityRecords).where(and(eq(entityRecords.id, row.id), eq(entityRecords.tenantId, actor.tenantId)));
    await audit(actor, `${row.entity}.purged`, `Permanently removed by ${actor.name} (${actor.position}): ${deletionLabel(row.entity, row)}`, row.id);
    purged += 1;
  }
  res.json({ purged });
});

router.delete("/v1/deleted-items/:id", async (req, res) => {
  const actor = actorFrom(res);
  if (!isDeleteOverrideManager(actor) && actor.role !== "administrator") {
    res.status(403).json({ error: "Upper management only" });
    return;
  }
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, req.params["id"]!), eq(entityRecords.tenantId, actor.tenantId), eq(entityRecords.deleted, true),
  )).limit(1);
  if (!row || isHrEntity(row.entity)) { res.status(404).json({ error: "Deleted item not found" }); return; }
  await db.delete(notifications).where(and(eq(notifications.tenantId, actor.tenantId), eq(notifications.reportId, row.id)));
  await db.delete(entityRecords).where(and(eq(entityRecords.id, row.id), eq(entityRecords.tenantId, actor.tenantId)));
  await audit(actor, `${row.entity}.purged`, `Permanently removed by ${actor.name} (${actor.position}): ${deletionLabel(row.entity, row)}`, row.id);
  res.status(204).send();
});

/** Who should hear that a record was deleted: the supervisor / person it was with. */
function deletionWatchers(row: typeof entityRecords.$inferSelect): string[] {
  const st = row.state as Record<string, unknown>;
  const ids = [st["assignedStaffId"], st["handoffTargetId"], st["cpmSupervisorId"], st["assignedByStaffId"],
    st["targetStaffId"], st["directedToStaffId"], st["employeeStaffId"], st["requesterStaffId"], st["cpmId"], row.createdBy]
    .map((v) => String(v || "").trim())
    .filter((v) => v && !v.startsWith("public-"));
  return [...new Set(ids)];
}
function deletionLabel(entity: string, row: typeof entityRecords.$inferSelect): string {
  const st = row.state as Record<string, unknown>;
  const ref = [st["complaintNo"], st["violationNo"], st["trackingId"], st["sourceRef"]].map((v) => String(v || "").trim()).find(Boolean) || "";
  const where = [st["address"], st["unit"] ? `Unit ${st["unit"]}` : "", st["building"]].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  const what = String(st["description"] || st["scope"] || st["reason"] || st["employee"] || "").trim().slice(0, 80);
  return [entity.replace(/-/g, " "), ref, where, what].filter(Boolean).join(" · ");
}

/** Complaint / violation number carried on a scope from its source record. */
function scopeSourceRef(sourceEntity: string, state: Record<string, unknown>) {
  if (sourceEntity === "resident-reports") {
    const complaintNo = String(state["complaintNo"] || "").trim();
    return { label: complaintNo || "Resident complaint", title: "Resident complaint", fields: { complaintNo } };
  }
  const violationNo = String(state["violationNumber"] || state["violationNo"] || state["number"] || "").trim();
  const complaintNo = String(state["complaintNo"] || "").trim();
  return {
    label: violationNo ? `Violation ${violationNo}` : (complaintNo || "Building violation"),
    title: "Inspector violation",
    fields: {
      violationNo,
      ...(complaintNo ? { complaintNo } : {}),
      // The HPD violation code / type of work, e.g. "550" · mold · Class B.
      ...(String(state["violationCode"] ?? state["code"] ?? "").trim() ? { violationCode: String(state["violationCode"] ?? state["code"]).trim() } : {}),
      ...(String(state["codeDesc"] ?? state["violationDescription"] ?? "").trim() ? { violationCodeDesc: String(state["codeDesc"] ?? state["violationDescription"]).trim() } : {}),
      ...(String(state["hazardClass"] ?? state["class"] ?? "").trim() ? { hazardClass: String(state["hazardClass"] ?? state["class"]).trim() } : {}),
    },
  };
}

function validEntity(value: string | undefined): value is string {
  return typeof value === "string" && ENTITIES.has(value);
}

async function canReadRecordForActor(
  actor: ReturnType<typeof actorFrom>,
  row: typeof entityRecords.$inferSelect,
): Promise<boolean> {
  return canReadEntityRecordForActor(actor, row);
}

function stateOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function validateHrApprovalLinkage(
  actor: Actor,
  approvalState: Record<string, unknown>,
  requiredAction?: string,
): Promise<{ target: typeof entityRecords.$inferSelect; purpose: string; employee: typeof staffAccounts.$inferSelect } | null> {
  const targetRecordId = typeof approvalState["targetRecordId"] === "string"
    ? approvalState["targetRecordId"].trim()
    : "";
  const employeeStaffId = typeof approvalState["employeeStaffId"] === "string"
    ? approvalState["employeeStaffId"].trim()
    : "";
  const purpose = normalizeStatus(approvalState["approvalPurpose"]);
  if (!targetRecordId || !employeeStaffId || !HR_SENSITIVE_APPROVAL_PURPOSES.has(purpose)) return null;
  if (requiredAction && actionForPurpose(purpose) !== requiredAction) return null;
  const [target] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, targetRecordId),
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.deleted, false),
  )).limit(1);
  if (!target ||
      !["draft", "in_progress"].includes(normalizeStatus(target.state["status"])) ||
      purposeForTarget(target.entity, target.state) !== purpose) return null;
  const targetEmployeeStaffId = typeof target.state["employeeStaffId"] === "string"
    ? target.state["employeeStaffId"].trim()
    : "";
  if (!targetEmployeeStaffId || targetEmployeeStaffId !== employeeStaffId) return null;
  const [employee] = await db.select().from(staffAccounts).where(and(
    eq(staffAccounts.id, employeeStaffId),
    eq(staffAccounts.tenantId, actor.tenantId),
    eq(staffAccounts.status, "approved"),
  )).limit(1);
  if (!employee || employee.id === actor.id) return null;
  if (actor.role === "management" && !canApproveLeaveForEmployee(actor, employee)) return null;
  return { target, purpose, employee };
}

const ASSIGNMENT_FIELDS = new Set([
  "assignedStaffId",
  "assignedUnitId",
  "assignedTo",
  "assignedStaffName",
  "assignedToName",
]);
const ASSIGNMENT_SCOPED_ENTITIES = [
  "resident-reports",
  "violations",
  "building-violations",
  "priority-violations",
  "route-assignments",
  "elevator-jobs",
  "emergency-jobs",
];

function containsAssignmentFields(state: Record<string, unknown>): boolean {
  return Object.entries(state).some(([key, value]) =>
    ASSIGNMENT_FIELDS.has(key) &&
    value !== undefined &&
    (typeof value !== "string" || value.trim().length > 0),
  );
}

function hasAssignmentFields(state: Record<string, unknown>): boolean {
  return Object.keys(state).some((key) => ASSIGNMENT_FIELDS.has(key));
}

async function canonicalizeAssignment(
  actor: ReturnType<typeof actorFrom>,
  entity: string,
  state: Record<string, unknown>,
  development: string | null,
): Promise<{ state: Record<string, unknown> | null; error?: string }> {
  const includesAssignment = containsAssignmentFields(state);
  if (!ASSIGNMENT_SCOPED_ENTITIES.includes(entity) &&
    includesAssignment &&
    !isAssignmentAuthority(actor)) {
    return {
      state: null,
      error: "Only authorized supervisors may assign staff",
    };
  }
  if (
    !ASSIGNMENT_SCOPED_ENTITIES.includes(entity) ||
    !includesAssignment
  ) {
    return { state };
  }
  const rawId = state["assignedStaffId"];
  if (typeof rawId !== "string" || !rawId.trim()) {
    return {
      state: null,
      error: "Assignments must use an approved canonical staff id",
    };
  }
  const [target] = await db
    .select()
    .from(staffAccounts)
    .where(and(
      eq(staffAccounts.id, rawId.trim()),
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
    ))
    .limit(1);
  const inspectorSelfAssignment =
    actor.role === "inspector" &&
    ["violations", "building-violations", "priority-violations", "route-assignments"]
      .includes(entity) &&
    target?.id === actor.id;
  if (
    isSuperintendentE(actor) &&
    entity === "emergency-jobs" &&
    (target?.role !== "emergency" || target.position !== "Maintenance Worker")
  ) {
    return {
      state: null,
      error: "The Emergency Unit superintendent may assign only emergency maintenance workers",
    };
  }
  const superintendentEResidentAssignment =
    entity === "resident-reports" &&
    Boolean(target) &&
    canSuperintendentEAssignResidentReport(actor, target!);
  if (
    !target ||
    (
      !canAssignStaff(actor, target, development) &&
      !inspectorSelfAssignment &&
      !superintendentEResidentAssignment
    )
  ) {
    return {
      state: null,
      error: "Select an operational staff member from your authorized group",
    };
  }
  if (entity === "emergency-jobs") {
    const rawUnitId = state["assignedUnitId"];
    if (
      rawUnitId !== undefined &&
      (typeof rawUnitId !== "string" || !rawUnitId.trim())
    ) {
      return {
        state: null,
        error: "Emergency assignments must use an approved canonical unit id",
      };
    }
    if (typeof rawUnitId === "string" && rawUnitId.trim()) {
      const [unit] = await db
        .select({ id: entityRecords.id })
        .from(entityRecords)
        .where(and(
          eq(entityRecords.id, rawUnitId.trim()),
          eq(entityRecords.entity, "emergency-units"),
          eq(entityRecords.tenantId, actor.tenantId),
          eq(entityRecords.deleted, false),
        ))
        .limit(1);
      if (!unit) {
        return {
          state: null,
          error: "Select an existing emergency unit",
        };
      }
    }
  }
  return {
    state: {
      ...state,
      assignedStaffId: target.id,
      assignedTo: target.name,
    },
  };
}

function outward(
  actor: ReturnType<typeof actorFrom>,
  row: typeof entityRecords.$inferSelect,
) {
  const pricedState = stripPricing(actor, row.state) as Record<string, unknown>;
  const visibleState = row.entity === "procurement" && actor.role !== "procurement"
    ? Object.fromEntries(Object.entries(pricedState).filter(([key]) => key !== "walkthroughCheckIns"))
    : pricedState;
  return {
    id: row.id,
    entity: row.entity,
    projectId: row.projectId,
    development: row.development,
    state: visibleState,
    deleted: row.deleted,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function withGeneratedFields(
  entity: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const state = { ...input };
  const code = generatedCode(entity);
  if (entity === "resident-reports" && !state["complaintNo"]) {
    state["complaintNo"] = code;
    state["status"] ??= "submitted";
  }
  if (entity === "procurement" && !state["trackingId"]) {
    state["trackingId"] = code;
    state["status"] ??= "draft";
  }
  if (entity === "elevator-jobs" && !state["elId"]) state["elId"] = code;
  if (entity === "emergency-jobs" && !state["emId"]) state["emId"] = code;
  if (entity === "emergency-units" && !state["code"]) state["code"] = code;
  state["createdAt"] = new Date().toISOString();
  return state;
}

router.get("/v1/:entity", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!canReadEntity(actor, entity)) {
    res.status(403).json({ error: "This module is restricted for your role" });
    return;
  }
  const storedRows = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, entity),
        eq(entityRecords.deleted, false),
      ),
    )
    .orderBy(desc(entityRecords.updatedAt));
  const rows = entity === "resident-reports"
    ? await Promise.all(storedRows.map(repairLegacyResidentDevelopment))
    : storedRows;
  const projectId =
    typeof req.query["projectId"] === "string" ? req.query["projectId"] : null;
  const development =
    typeof req.query["development"] === "string"
      ? req.query["development"]
      : null;
  const status =
    typeof req.query["status"] === "string" ? req.query["status"] : null;
  const authorizedRows = await Promise.all(
    rows.map(async (row) => (await canReadRecordForActor(actor, row)) ? row : null),
  );
  // Procurement sees every vendor bid on the scopes it can see, carried on
  // the scope itself, so a bid can never be hidden from the Award step.
  let bidsByScope: Map<string, Array<Record<string, unknown>>> | null = null;
  if (entity === "procurement" && isProcurementActor(actor)) {
    const bidRows = await db.select().from(entityRecords).where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "procurement-bids"),
      eq(entityRecords.deleted, false),
    ));
    bidsByScope = new Map();
    for (const bid of bidRows) {
      const requestId = String(bid.state["requestId"] ?? "");
      if (!requestId || typeof bid.createdBy !== "string" || !bid.createdBy.startsWith("public-vendor:")) continue;
      const list = bidsByScope.get(requestId) ?? [];
      list.push({ id: bid.id, version: bid.version, state: bid.state, updatedAt: bid.updatedAt });
      bidsByScope.set(requestId, list);
    }
  }
  res.json(
    authorizedRows
      .filter((row): row is typeof rows[number] => row !== null)
      .map((row) => bidsByScope
        ? { ...row, state: { ...row.state, vendorBids: bidsByScope.get(row.id) ?? [] } }
        : row)
      .filter((row) => !projectId || row.projectId === projectId)
      .filter(
        (row) =>
          !development ||
          row.development?.toLowerCase() === development.toLowerCase(),
      )
      .filter((row) => !status || row.state["status"] === status)
      .map((row) => outward(actor, row)),
  );
});

router.post("/v1/:entity", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!canCreateEntity(actor, entity)) {
    res.status(403).json({ error: "Not allowed to create this record" });
    return;
  }
  const body = stateOf(req.body) ?? {};
  const rawState = stateOf(body?.["state"]);
  if (!body || !rawState) {
    res.status(400).json({ error: "A JSON state object is required" });
    return;
  }
  let id = recordId(body["id"]);
  let linkedAssignment: typeof entityRecords.$inferSelect | undefined;
  if (entity === "route-assignments") {
    // A violation may be sent by the Supervisor Inspector, by administration, or
    // by a development/emergency complaint-handling supervisor (who forwards it
    // to an inspector, the Supervisor Inspector, or a trade supervisor).
    if (
      !isViolationAuthority(actor) &&
      actor.role !== "administrator" &&
      !isComplaintHandlingSupervisor(actor)
    ) {
      res.status(403).json({ error: "Not allowed to send this violation" });
      return;
    }
    const assignmentKind = typeof rawState["assignmentKind"] === "string"
      ? rawState["assignmentKind"].trim() : "";
    const clientRequestId = typeof rawState["clientRequestId"] === "string"
      ? rawState["clientRequestId"].trim() : "";
    const development = typeof rawState["development"] === "string"
      ? rawState["development"].trim() : "";
    const location = typeof rawState["address"] === "string"
      ? rawState["address"].trim()
      : typeof rawState["location"] === "string" ? rawState["location"].trim() : "";
    const instructions = typeof rawState["instructions"] === "string"
      ? rawState["instructions"].trim() : "";
    const assignedStaffId = typeof rawState["assignedStaffId"] === "string"
      ? rawState["assignedStaffId"].trim() : "";
    if (assignmentKind !== "violation-inspection" || !clientRequestId ||
        !development || !location || !instructions || !assignedStaffId) {
      res.status(400).json({ error: "assignmentKind, clientRequestId, development, address/location, instructions, and assignedStaffId are required" });
      return;
    }
    // A resident complaint goes to an inspector only after building management
    // (development / emergency supervisor, upper management) has sent it to
    // this supervisor. Inspection, CPM and trade supervisors don't act on
    // their own.
    const sourceReportId = typeof rawState["sourceReportId"] === "string" ? rawState["sourceReportId"].trim() : "";
    if (waitsToBeSentComplaints(actor)) {
      const [complaint] = sourceReportId
        ? await db.select().from(entityRecords).where(and(
            eq(entityRecords.id, sourceReportId),
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.entity, "resident-reports"),
          )).limit(1)
        : [];
      const complaintState = (complaint?.state || {}) as Record<string, unknown>;
      const sentToActor = !!complaint && (
        complaintState["assignedStaffId"] === actor.id || complaintState["assignedByStaffId"] === actor.id
      );
      if (sourceReportId && !sentToActor) {
        res.status(403).json({ error: "Building management has not sent you this complaint yet" });
        return;
      }
    }
    // Who can be sent a violation: an Inspector, a CPM, the Supervisor
    // Inspector, a CPM Supervisor, a trade supervisor, or a worker / emergency
    // crew member. Office-based people (no developments) and emergency crews
    // cover every site; everyone else must cover this development. The
    // emergency supervisor sends across developments.
    const [target] = await db.select().from(staffAccounts).where(and(
        eq(staffAccounts.id, assignedStaffId),
        eq(staffAccounts.tenantId, actor.tenantId),
        eq(staffAccounts.status, "approved"),
      )).limit(1);
    const targetRoleOk = !!target && ["inspector", "worker", "emergency", "management"].includes(target.role) &&
      !["Borough Director", "Director"].includes(String(target.position || ""));
    const targetCovers = !!target && (
      target.role === "emergency" ||
      !target.developments.length ||
      isSuperintendentE(actor) ||
      target.developments.some((value) => value.trim().toLowerCase() === development.toLowerCase())
    );
    if (!target || !targetRoleOk || target.id === actor.id || !targetCovers) {
      res.status(403).json({ error: "Select an approved inspector, CPM, supervisor or worker covering this development" });
      return;
    }
    id = `route-assignment:${clientRequestId}`;
    rawState["assignedStaffId"] = target.id;
    rawState["assignedTo"] = target.name;
    rawState["assignmentSource"] = "supervisor-inspector";
    rawState["assignmentStatus"] = "pending";
    rawState["development"] = development;
    rawState["address"] = location;
    rawState["location"] = location;
  }
  if (entity === "building-violations") {
    const assignmentId = typeof rawState["routeAssignmentId"] === "string"
      ? rawState["routeAssignmentId"].trim()
      : typeof rawState["assignmentId"] === "string"
        ? rawState["assignmentId"].trim() : "";
    if (assignmentId) {
      const [assignment] = await db.select().from(entityRecords).where(and(
        eq(entityRecords.id, assignmentId),
        eq(entityRecords.entity, "route-assignments"),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
        sql`${entityRecords.state}->>'assignedStaffId' = ${actor.id}`,
        sql`${entityRecords.state}->>'assignmentKind' = 'violation-inspection'`,
        sql`${entityRecords.state}->>'assignmentStatus' = 'pending'`,
      )).limit(1);
      if (!assignment) {
        res.status(403).json({ error: "This route assignment is not assigned to you" });
        return;
      }
      rawState["routeAssignmentId"] = assignment.id;
      rawState["sourceAssignmentId"] = assignment.id;
      rawState["sourceRecordId"] = assignment.id;
      linkedAssignment = assignment;
      const violationDevelopment = typeof rawState["development"] === "string"
        ? rawState["development"].trim() : "";
      if (!violationDevelopment ||
          normalizeLocation(violationDevelopment) !== normalizeLocation(
            assignment.development || assignment.state["development"] || "",
          )) {
        res.status(403).json({ error: "Violation development must match the route assignment" });
        return;
      }
      const assignmentLocation = assignment.state["address"] ?? assignment.state["location"];
      // The app's Log Violations screen sends the address as "building".
      const violationLocation = rawState["address"] ?? rawState["location"] ?? rawState["building"];
      const normalizedViolation = normalizeLocation(violationLocation);
      const normalizedAssignment = normalizeLocation(assignmentLocation);
      // Same building with or without the unit ("60 EAST 104TH STREET" vs
      // "60 EAST 104TH STREET Unit K") still matches.
      const sameBuilding = !!normalizedViolation && !!normalizedAssignment && (
        normalizedViolation === normalizedAssignment ||
        normalizedViolation.startsWith(normalizedAssignment) ||
        normalizedAssignment.startsWith(normalizedViolation)
      );
      if (!sameBuilding) {
        res.status(403).json({ error: "Violation address/location must match the route assignment" });
        return;
      }
      rawState["development"] = assignment.development || assignment.state["development"];
      rawState["address"] = assignmentLocation;
      rawState["location"] = assignmentLocation;
      if (typeof rawState["building"] !== "string" || !rawState["building"].trim()) rawState["building"] = assignmentLocation;
    }
  }
  const [existing] = await db
    .select()
    .from(entityRecords)
    .where(eq(entityRecords.id, id))
    .limit(1);
  if (existing) {
    if (
      existing.entity === "procurement" &&
      (!canReadEntity(actor, entity) || !procurementRecordAllowed(actor, existing))
    ) {
      // Do not reveal whether an id belongs to a downstream scope.
      res.status(404).json({ error: "Record not found" });
      return;
    }
    if (
      existing.tenantId === actor.tenantId &&
      existing.entity === entity &&
      existing.createdBy === actor.id &&
      !existing.deleted &&
      await canReadRecordForActor(actor, existing)
    ) {
      res.json(outward(actor, existing));
      return;
    }
    res.status(409).json({ error: "A different record already uses this id" });
    return;
  }
  const projectId =
    typeof body["projectId"] === "string"
      ? body["projectId"]
      : typeof rawState["projectId"] === "string"
        ? rawState["projectId"]
        : null;
  let development =
    typeof body["development"] === "string"
      ? body["development"]
      : typeof rawState["development"] === "string"
        ? rawState["development"]
        : null;
  if (linkedAssignment) {
    development = linkedAssignment.development ||
      (typeof linkedAssignment.state["development"] === "string"
        ? linkedAssignment.state["development"] : development);
  }
  if (entity === "manpower-requests") {
    if (
      actor.role !== "management" &&
      actor.role !== "administrator" &&
      !isSupervisorPosition(actor)
    ) {
      res.status(403).json({ error: "Only supervisors and Management may request manpower" });
      return;
    }
    const sourceEntity = typeof rawState["sourceEntity"] === "string"
      ? rawState["sourceEntity"]
      : "";
    const sourceRecordId = typeof rawState["sourceRecordId"] === "string"
      ? rawState["sourceRecordId"]
      : "";
    const receiverSupervisorId = typeof rawState["receiverSupervisorId"] === "string"
      ? rawState["receiverSupervisorId"]
      : "";
    const requestedTrade = typeof rawState["requestedTrade"] === "string"
      ? rawState["requestedTrade"]
      : "";
    if (
      !["resident-reports", "building-violations"].includes(sourceEntity) ||
      !sourceRecordId ||
      !receiverSupervisorId ||
      !requestedTrade.trim()
    ) {
      res.status(400).json({ error: "Select a complaint or violation, trade, and receiving supervisor" });
      return;
    }
    // Supervisors pass work to the supervisor of whichever trade is needed
    // (CPM Supervisor -> Supervisor Inspector, Plumbing Supervisor, ...);
    // that supervisor assigns their own crew.
    const [[source], [receiver]] = await Promise.all([
      db.select().from(entityRecords).where(and(
        eq(entityRecords.id, sourceRecordId),
        eq(entityRecords.entity, sourceEntity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      )).limit(1),
      db.select().from(staffAccounts).where(and(
        eq(staffAccounts.id, receiverSupervisorId),
        eq(staffAccounts.tenantId, actor.tenantId),
        eq(staffAccounts.status, "approved"),
      )).limit(1),
    ]);
    if (!source || !(await canReadRecordForActor(actor, source))) {
      res.status(404).json({ error: "Complaint or violation not found" });
      return;
    }
    const [existingRequest] = await db.select({ id: entityRecords.id })
      .from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, "manpower-requests"),
        eq(entityRecords.deleted, false),
        sql`${entityRecords.state}->>'sourceEntity' = ${sourceEntity}`,
        sql`${entityRecords.state}->>'sourceRecordId' = ${source.id}`,
      ))
      .limit(1);
    if (existingRequest) {
      res.status(409).json({ error: "This complaint or violation has already been sent" });
      return;
    }
    const sourceStatus = normalizeStatus(source.state["status"]);
    const sourceReady =
      (sourceEntity === "resident-reports" && sourceStatus === "submitted") ||
      (sourceEntity === "building-violations" && sourceStatus === "approved");
    if (!sourceReady) {
      res.status(409).json({ error: "Only work that is ready for assignment can be sent as a trade request" });
      return;
    }
    if (
      !receiver ||
      receiver.id === actor.id ||
      !isSupervisorForTrade(receiver.position, requestedTrade)
    ) {
      res.status(403).json({ error: "Select the supervisor for the requested trade" });
      return;
    }
    development = source.development;
    if (
      development &&
      receiver.developments.length > 0 &&
      !receiver.developments.some((value) => sameTitle(value, development))
    ) {
      res.status(403).json({ error: "The receiving supervisor must cover this development" });
      return;
    }
    rawState["sourceEntity"] = sourceEntity;
    rawState["sourceRecordId"] = source.id;
    id = `manpower-request:${source.id}`;
    rawState["sourceTitle"] = String(
      source.state["title"] ||
      source.state["complaintNo"] ||
      source.state["violationNumber"] ||
      `${sourceEntity} record`,
    );
    rawState["sourceDetails"] = String(
      source.state["description"] ||
      source.state["details"] ||
      source.state["issue"] ||
      "",
    );
    // Carry the location fields the assigned tradesperson needs to find and do
    // the job (no pricing or procurement scope — just where and what).
    rawState["address"] = String(
      source.state["address"] || source.state["building"] || "",
    );
    rawState["unit"] = String(source.state["unit"] || "");
    rawState["location"] = String(source.state["location"] || "");
    rawState["receiverSupervisorId"] = receiver.id;
    rawState["receiverSupervisorName"] = receiver.name;
    rawState["requestedByStaffId"] = actor.id;
    rawState["requestedByName"] = actor.name;
    rawState["requestedTrade"] = requestedTrade;
    delete rawState["assignedStaffId"];
    delete rawState["assignedTo"];
    delete rawState["assignedStaffName"];
  }
  if (!development && projectId) {
    const [project] = await db.select({ development: entityRecords.development })
      .from(entityRecords)
      .where(and(eq(entityRecords.id, projectId), eq(entityRecords.entity, "projects"), eq(entityRecords.tenantId, actor.tenantId)))
      .limit(1);
    development = project?.development || null;
  }
  if (
    entity === "projects" &&
    !development &&
    actor.developments.length === 1
  ) {
    development = actor.developments[0]!;
  }
  // Vendor contacts are one company-wide list, not tied to a development.
  // Community outreach happens at any building, NYCHA or private.
  const companyWide = entity === "vendor-contacts" || isCommunityEntity(entity);
  if (isCommunityEntity(entity)) {
    rawState["loggedById"] = actor.id;
    rawState["loggedByName"] = actor.name;
    rawState["loggedByPosition"] = actor.position;
    // Every visit waits for the Community Coordinator Supervisor to read it
    // and confirm they received it. The supervisor's own entries need no one.
    delete rawState["reviewedById"]; delete rawState["reviewedByName"]; delete rawState["reviewedAt"];
    if (isCommunityCoordinatorSupervisor(actor)) {
      rawState["reviewStatus"] = "approved";
      rawState["reviewedById"] = actor.id; rawState["reviewedByName"] = actor.name; rawState["reviewedAt"] = new Date().toISOString();
    } else {
      rawState["reviewStatus"] = "submitted";
    }
  }
  if (!development && !companyWide && !isBoroughDirector(actor) && !isHrEntity(entity)) {
    res.status(403).json({ error: "A development is required for scoped records" });
    return;
  }
  if (!companyWide && !isHrEntity(entity) && !entityDevelopmentAllowed(actor, entity, development)) {
    res.status(403).json({ error: "Development access denied" });
    return;
  }
  if (entity === "hr-approvals" && actor.role === "management") {
    const linkage = await validateHrApprovalLinkage(actor, rawState);
    if (!linkage) {
      res.status(400).json({ error: "Approval must link to a matching sensitive HR record and employee" });
      return;
    }
  } else if (entity === "hr-approvals" && (actor.role === "human_resources" || actor.role === "administrator")) {
    if (!await validateHrApprovalLinkage(actor, rawState)) {
      res.status(400).json({ error: "Approval must link to a matching sensitive HR record and employee" });
      return;
    }
  } else if (isHrEntity(entity) && actor.role === "management" && entity !== "hr-approvals") {
    res.status(403).json({ error: "Supervisors may create only scoped company approvals" });
    return;
  }
  if (entity === "hr-employee-records") {
    if (actor.role !== "human_resources") {
      res.status(403).json({ error: "Only Human Resources may start an employee record" });
      return;
    }
    delete rawState["employeeStaffId"];
    delete rawState["employeeNumber"];
    const firstName = String(rawState["firstName"] || "").trim();
    const lastName = String(rawState["lastName"] || "").trim();
    const email = String(rawState["email"] || "").trim();
    const role = String(rawState["role"] || "").trim();
    const position = String(rawState["position"] || "").trim();
    if (!firstName || !lastName || !email.includes("@") ||
        !canIssueStaffAccountRole(role) ||
        !isAcceptedStaffPosition(position)) {
      res.status(400).json({ error: "First name, last name, email, role, and position are required" });
      return;
    }
    rawState["title"] = `${firstName} ${lastName} employee record`;
  }
  const now = new Date();
  let createdState = withInitialWorkflowState(
    entity,
    entity === "leave-requests"
      ? { ...rawState, requesterStaffId: actor.id }
      : rawState,
  );
  if (entity === "hr-approvals") {
    const linkage = await validateHrApprovalLinkage(actor, createdState);
    if (!linkage) {
      res.status(400).json({ error: "Approval linkage is invalid" });
      return;
    }
    createdState = {
      ...createdState,
      targetRecordId: linkage.target.id,
      employeeStaffId: linkage.employee.id,
      approvalPurpose: linkage.purpose,
    };
  }
  if (entity === "leave-requests") {
    delete createdState["employeeStaffId"];
    const employeeName = typeof createdState["employee"] === "string"
      ? createdState["employee"].trim()
      : "";
    if (employeeName) {
      const employeeMatches = await db.select({ id: staffAccounts.id, role: staffAccounts.role, position: staffAccounts.position, developments: staffAccounts.developments })
        .from(staffAccounts)
        .where(and(
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.status, "approved"),
          sql`lower(${staffAccounts.name}) = lower(${employeeName})`,
        ))
        .limit(2);
      if (employeeMatches.length === 1) {
        createdState["employeeStaffId"] = employeeMatches[0]!.id;
        // Snapshot who is asking, so the right management sees it.
        createdState["employeeRole"] = employeeMatches[0]!.role;
        if (!createdState["title"]) createdState["title"] = employeeMatches[0]!.position;
        if (!createdState["development"] && employeeMatches[0]!.developments?.[0]) createdState["development"] = employeeMatches[0]!.developments[0];
      }
    }
    // The requester may propose who covers the shift; the approver confirms or changes it.
    const proposedCover = typeof createdState["coveredByStaffId"] === "string" ? createdState["coveredByStaffId"].trim() : "";
    delete createdState["coveredByStaffId"]; delete createdState["coveredByName"]; delete createdState["coveredByPosition"];
    if (proposedCover) {
      const [cover] = await db.select({ id: staffAccounts.id, name: staffAccounts.name, position: staffAccounts.position }).from(staffAccounts).where(and(
        eq(staffAccounts.id, proposedCover), eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.status, "approved"))).limit(1);
      if (cover) { createdState["coveredByStaffId"] = cover.id; createdState["coveredByName"] = cover.name; createdState["coveredByPosition"] = cover.position; }
    }
    const leaveDays = leaveRequestDurationDays(createdState);
    if (leaveDays === null || !validLeaveRequestDuration(leaveDays)) {
      res.status(400).json({ error: "Time off must be 1 to 365 days" });
      return;
    }
    if (
      leaveDays >= 30 &&
      (typeof createdState["reasonableAccommodation"] !== "string" ||
        !createdState["reasonableAccommodation"].trim())
    ) {
      res.status(400).json({ error: "A reasonable accommodation is required for 30 to 365 days off" });
      return;
    }
  }
  if (
    actor.role === "inspector" &&
    ["violations", "building-violations", "priority-violations", "route-assignments"]
      .includes(entity) &&
    !containsAssignmentFields(createdState)
  ) {
    createdState = {
      ...createdState,
      assignedStaffId: actor.id,
      assignedTo: actor.name,
    };
  }
  // A trade supervisor (plumbing, electrical, CPM Supervisor …) normally acts
  // on a complaint only once it is sent to them. One they file themselves is
  // theirs from the start: mark it sent to them so they can assign it.
  if (
    entity === "resident-reports" &&
    actor.role === "management" &&
    waitsToBeSentComplaints(actor) &&
    typeof createdState["directedToStaffId"] !== "string"
  ) {
    createdState = {
      ...createdState,
      directedToStaffId: actor.id,
      directedToName: actor.name,
      directedAt: new Date().toISOString(),
    };
  }
  const canonicalCreated = await canonicalizeAssignment(
    actor,
    entity,
    createdState,
    development,
  );
  if (!canonicalCreated.state) {
    res.status(403).json({ error: canonicalCreated.error });
    return;
  }
  const persistedCreatedState = canonicalCreated.state;
  if (entity === "procurement") {
    // Preserve a server-derived notification target; clients must not be able
    // to impersonate another CPM in workflow routing.
    persistedCreatedState["cpmName"] = actor.name;
    persistedCreatedState["cpmId"] = actor.id;
    // A scope written from a complaint or violation carries its number through
    // review, procurement and the vendor release. The server derives the
    // number, development and reviewing CPM Supervisor from the source record.
    const sourceEntity = String(persistedCreatedState["sourceEntity"] || "");
    const sourceRecordId = String(persistedCreatedState["sourceRecordId"] || "");
    if (["resident-reports", "building-violations"].includes(sourceEntity) && sourceRecordId) {
      const [source] = await db.select().from(entityRecords).where(and(
        eq(entityRecords.id, sourceRecordId),
        eq(entityRecords.entity, sourceEntity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      )).limit(1);
      const assignedToMe = source && (
        normalizeAssignment(source.state).assignedStaffId === actor.id ||
        source.state["assignedCpmStaffId"] === actor.id
      );
      if (!source || !assignedToMe) {
        res.status(403).json({ error: "Only the CPM assigned to this complaint or violation can scope it" });
        return;
      }
      const ref = scopeSourceRef(sourceEntity, source.state);
      Object.assign(persistedCreatedState, ref.fields, { sourceRef: ref.label, sourceTitle: ref.title });
      if (!persistedCreatedState["address"]) {
        persistedCreatedState["address"] = [source.state["address"] || source.state["building"], source.state["unit"] ? `Unit ${String(source.state["unit"])}` : ""]
          .filter(Boolean).join(" ");
      }
      development = source.development || development;
      const reviewerId = String(source.state["cpmSupervisorId"] || source.state["assignedByStaffId"] || "");
      if (reviewerId) {
        const [reviewer] = await db.select().from(staffAccounts).where(and(
          eq(staffAccounts.id, reviewerId),
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.status, "approved"),
        )).limit(1);
        if (reviewer && isCpmSupervisor(reviewer as never)) {
          persistedCreatedState["handoffTargetId"] = reviewer.id;
          persistedCreatedState["handoffTargetName"] = reviewer.name;
        }
      }
    }
    if (persistedCreatedState["sourceRef"]) {
      persistedCreatedState["title"] = [persistedCreatedState["sourceRef"], persistedCreatedState["address"]].filter(Boolean).join(" · ");
    }
  }
  let created: typeof entityRecords.$inferSelect | undefined;
  if (linkedAssignment) {
    try {
      created = await db.transaction(async (tx) => {
        const [existingViolation] = await tx.select({ id: entityRecords.id })
          .from(entityRecords)
          .where(and(
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.entity, "building-violations"),
            eq(entityRecords.deleted, false),
            sql`${entityRecords.state}->>'routeAssignmentId' = ${linkedAssignment!.id}`,
          )).limit(1);
        if (existingViolation) {
          throw Object.assign(new Error("This route assignment already has a building violation"), { status: 409 });
        }
        const [inserted] = await tx.insert(entityRecords).values({
          id,
          tenantId: actor.tenantId,
          entity,
          projectId,
          development,
          state: withGeneratedFields(entity, persistedCreatedState),
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        }).returning();
        if (!inserted) throw Object.assign(new Error("Could not create building violation"), { status: 409 });
        const [completed] = await tx.update(entityRecords).set({
          state: { ...linkedAssignment!.state, assignmentStatus: "completed", returnedToSupervisor: true, resultRecordId: inserted.id },
          version: sql`${entityRecords.version} + 1`,
          updatedAt: now,
        }).where(and(
          eq(entityRecords.id, linkedAssignment!.id),
          eq(entityRecords.version, linkedAssignment!.version),
          eq(entityRecords.tenantId, actor.tenantId),
          eq(entityRecords.deleted, false),
        )).returning();
        if (!completed) throw Object.assign(new Error("The route assignment changed before completion"), { status: 409 });
        return inserted;
      });
    } catch (error: any) {
      if (error?.status === 409) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  } else {
    const insert = db
      .insert(entityRecords)
      .values({
        id,
        tenantId: actor.tenantId,
        entity,
        projectId,
        development,
        state: withGeneratedFields(entity, persistedCreatedState),
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      });
    [created] = entity === "manpower-requests"
      ? await insert.onConflictDoNothing().returning()
      : await insert.returning();
  }
  if (!created) {
    res.status(409).json({ error: "This complaint or violation has already been sent" });
    return;
  }
  await audit(actor, `${entity}.created`, `Created ${entity} record`, id);
  if (isCommunityEntity(entity) && !isCommunityCoordinatorSupervisor(actor)) {
    // The coordinator's supervisor hears about every visit — nobody else.
    const supervisors = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
      eq(staffAccounts.role, "community_coordinator"),
      sql`lower(${staffAccounts.position}) = 'community coordinator supervisor'`,
    ));
    if (supervisors.length) {
      const st = persistedCreatedState;
      const what = entity === "community-residents"
        ? `${String(st["name"] || "Resident")} · ${String(st["address"] || "")}${st["apartment"] ? ` Apt ${String(st["apartment"])}` : ""}`
        : `${String(st["address"] || "Building")}${st["units"] ? ` · ${String(st["units"])} units` : ""}`;
      const alerts = await db.insert(notifications).values(supervisors.map((target) => ({
        id: randomUUID(),
        tenantId: actor.tenantId,
        target: target.id,
        message: st["critical"] === true ? "Critical: community visit logged" : (entity === "community-residents" ? "Community visit logged" : "Building added by a coordinator"),
        detail: `${actor.name}: ${what}`,
        reportId: id,
      }))).returning();
      for (const alert of alerts) void deliverPushNotification(alert).catch(() => undefined);
    }
  }
  if (entity === "building-violations") {
    // Same routing as a complaint: the development's on-site supervisors, the
    // emergency supervisor, and the trade supervisor whose trade it is — all
    // at THIS development. An electrical supervisor never hears about a
    // plumbing leak, and nobody hears about another development's work
    // (they look that up themselves with their development code). Never the
    // Borough Director or upper management. No development → no inbox alerts.
    const dev = String(development || persistedCreatedState["development"] || rawState["development"] || "").trim();
    const routedIds = dev
      ? await routedComplaintRecipientIds(actor.tenantId, dev, { ...persistedCreatedState, ...rawState }, true)
      : [];
    const managers = routedIds.length
      ? await db.select().from(staffAccounts).where(and(
        eq(staffAccounts.tenantId, actor.tenantId),
        eq(staffAccounts.status, "approved"),
        inArray(staffAccounts.id, routedIds),
      ))
      : [];
    const reviewers = managers.filter((m) =>
      m.id !== actor.id &&
      !isBoroughDirector({ role: m.role, position: m.position } as Actor) &&
      !LEAVE_UPPER_MANAGEMENT_TITLES.has(String(m.position || "").trim()));
    for (const reviewer of reviewers) {
      await notify(
        actor,
        reviewer.id,
        "Inspection logged and awaiting review",
        typeof rawState["building"] === "string" ? rawState["building"] : undefined,
        id,
      );
    }
  } else if (entity === "resident-reports" && actor.role === "inspector") {
    await notify(
      actor,
      actor.id,
      "Report submitted",
      typeof persistedCreatedState["description"] === "string"
        ? persistedCreatedState["description"]
        : undefined,
      id,
    );
  } else if (entity === "leave-requests") {
    const reviewers = await db.select().from(staffAccounts).where(and(
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
    ));
    for (const reviewer of reviewers) {
      const reviewerActor: Actor = {
        id: reviewer.id,
        tenantId: reviewer.tenantId,
        name: reviewer.name,
        role: reviewer.role as Actor["role"],
        position: reviewer.position,
        developments: reviewer.developments,
        sessionVersion: reviewer.sessionVersion,
      };
      const employeeForLeave = {
        id: String(persistedCreatedState["employeeStaffId"] || ""),
        role: String(persistedCreatedState["employeeRole"] || actor.role),
        position: String(persistedCreatedState["title"] || actor.position),
        developments: development ? [development] : actor.developments,
      } as Pick<Actor, "id" | "role" | "position" | "developments">;
      const leaveDaysForAlert = leaveRequestDurationDays(persistedCreatedState) ?? undefined;
      if (
        (reviewerActor.role === "human_resources" && entityDevelopmentAllowed(reviewerActor, entity, development) && shouldAlertLeaveReviewer(reviewerActor, employeeForLeave, leaveDaysForAlert)) ||
        (reviewerActor.role === "management" && shouldAlertLeaveReviewer(reviewerActor, employeeForLeave, leaveDaysForAlert))
      ) {
        await notify(
          actor,
          reviewer.id,
          "Leave request",
          typeof persistedCreatedState["employee"] === "string"
            ? persistedCreatedState["employee"]
            : undefined,
          id,
        );
      }
    }
    // Over the 30 days management may decide: HR gets an email as well.
    const hrDays = leaveRequestDurationDays(persistedCreatedState);
    if (hrDays !== null && leaveNeedsHr(hrDays)) {
      try {
        const [org] = await db.select({ hrEmail: organizations.hrEmail }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
        if (org?.hrEmail) await emailHrLeaveRequest({
          hrEmail: org.hrEmail,
          employee: String(persistedCreatedState["employee"] || actor.name),
          title: String(persistedCreatedState["title"] || actor.position || ""),
          development: development || undefined,
          startAt: String(persistedCreatedState["startAt"] || persistedCreatedState["startDate"] || ""),
          endAt: String(persistedCreatedState["endAt"] || persistedCreatedState["endDate"] || ""),
          days: hrDays,
          reason: String(persistedCreatedState["reason"] || ""),
        });
      } catch (err) {
        logger.warn({ err, leaveId: id }, "HR leave email failed");
      }
    }
  } else if (entity === "manpower-requests") {
    await notify(
      actor,
      String(persistedCreatedState["receiverSupervisorId"] || ""),
      `${String(persistedCreatedState["requestedTrade"] || "Trade")} manpower requested`,
      String(persistedCreatedState["sourceTitle"] || ""),
      String(persistedCreatedState["sourceRecordId"] || id),
    );
  }
  res.status(201).json(outward(actor, created!));
});

router.get("/v1/:entity/:id", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!canReadEntity(actor, entity)) {
    res.status(403).json({ error: "This module is restricted for your role" });
    return;
  }
  const [storedRow] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.id, req.params["id"]!),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ),
    )
    .limit(1);
  const row = storedRow && entity === "resident-reports"
    ? await repairLegacyResidentDevelopment(storedRow)
    : storedRow;
  if (
    !row ||
    !(await canReadRecordForActor(actor, row))
  ) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  res.json(outward(actor, row));
});

router.patch("/v1/:entity/:id", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (!canMutateEntity(actor, entity)) {
    res.status(403).json({ error: "Not allowed to update this record" });
    return;
  }
  const input = stateOf(req.body);
  const expectedVersion = input?.["version"];
  if (typeof expectedVersion !== "number") {
    res.status(400).json({ error: "version is required" });
    return;
  }
  const patch = stateOf(input?.["state"]) ?? input;
  if (!patch) {
    res.status(400).json({ error: "A JSON update is required" });
    return;
  }
  if (isCommunityEntity(entity)) {
    delete patch["loggedById"]; delete patch["loggedByName"]; delete patch["loggedByPosition"];
  }
  if (isHrEntity(entity) && containsHrProtectedFields(patch)) {
    res.status(403).json({ error: "HR linkage, employee, exit type, and status fields are server controlled" });
    return;
  }
  if (patchesWorkflowManagedFields(entity, patch)) {
    res.status(403).json({
      error: "Workflow-managed fields must be changed through an authorized action",
    });
    return;
  }
  if (
    ["resident-reports", "building-violations", "manpower-requests"].includes(entity) &&
    hasAssignmentFields(patch)
  ) {
    res.status(403).json({
      error: "Assignments must be changed through the dedicated assign action",
    });
    return;
  }
  if (
    hasAssignmentFields(patch) &&
    actor.role !== "management" &&
    actor.role !== "administrator"
  ) {
    res.status(403).json({
      error: "Only authorized supervisors may change an assignment",
    });
    return;
  }
  const [current] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.id, req.params["id"]!),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ),
    )
    .limit(1);

  if (
    !current ||
    !(await canReadRecordForActor(actor, current))
  ) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (
    ["resident-reports", "building-violations", "manpower-requests"].includes(entity) &&
    hasAssignmentFields(patch) &&
    normalizeAssignment(current.state).assignedStaffId &&
    patch["assignedStaffId"] !== normalizeAssignment(current.state).assignedStaffId
  ) {
    res.status(409).json({
      error: "This record is assigned. The current assignee must release it with an update before reassignment.",
    });
    return;
  }
  if (entity === "hr-approvals" &&
      ["approved", "consumed"].includes(normalizeStatus(current.state["status"]))) {
    res.status(409).json({ error: "Approved company approval evidence is immutable" });
    return;
  }
  if (isCommunityEntity(entity)) {
    // Only the Community Coordinator Supervisor approves ("received"); the
    // server stamps who and when. A coordinator's edit sends it back for
    // review. Approval fields never come from the client.
    delete patch["reviewedById"]; delete patch["reviewedByName"]; delete patch["reviewedAt"];
    if (isCommunityCoordinatorSupervisor(actor)) {
      if (patch["reviewStatus"] === "approved") {
        patch["reviewedById"] = actor.id; patch["reviewedByName"] = actor.name; patch["reviewedAt"] = new Date().toISOString();
      } else {
        delete patch["reviewStatus"];
      }
    } else {
      patch["reviewStatus"] = current.state["reviewStatus"] === "approved" ? "updated" : "submitted";
    }
  }
  if (entity === "procurement" &&
      actor.role === "inspector" && actor.position === "CPM" &&
      !["draft", "returned"].includes(String(current.state["status"] ?? ""))) {
    res.status(403).json({ error: "Submitted procurement scopes are read-only" });
    return;
  }
  if (
    entity === "procurement" &&
     current.state["status"] === "closed"
  ) {
    res.status(409).json({ error: "Closed procurement records are immutable" });
    return;
  }
  if (expectedVersion !== current.version) {
    res.status(409).json({
      error: "Concurrent update detected",
      current: outward(actor, current),
    });
    return;
  }
  const canonicalPatch = await canonicalizeAssignment(
    actor,
    entity,
    patch,
    current.development,
  );
  if (!canonicalPatch.state) {
    res.status(403).json({ error: canonicalPatch.error });
    return;
  }
  const updatedState = { ...current.state, ...canonicalPatch.state };
  if (entity === "leave-requests") {
    const leaveDays = leaveRequestDurationDays(current.state);
    if (leaveDays === null || !validLeaveRequestDuration(leaveDays)) {
      res.status(400).json({ error: "Time off must be 1 to 365 days" });
      return;
    }
    if (
      leaveDays >= 30 &&
      (typeof updatedState["reasonableAccommodation"] !== "string" ||
        !updatedState["reasonableAccommodation"].trim())
    ) {
      res.status(400).json({ error: "A reasonable accommodation is required for 30 to 365 days off" });
      return;
    }
  }
  const updatedDevelopment =
    typeof updatedState["development"] === "string"
      ? updatedState["development"]
      : current.development;
  if (entity !== "vendor-contacts" && !isHrEntity(entity) && !entityDevelopmentAllowed(actor, entity, updatedDevelopment)) {
    res.status(403).json({ error: "Development access denied" });
    return;
  }
  const linkedPosition = entity === "hr-employee-records" &&
    typeof updatedState["position"] === "string"
      ? updatedState["position"].trim()
      : "";
  if (linkedPosition && !isAcceptedStaffPosition(linkedPosition)) {
    res.status(400).json({ error: "Select a valid staff position" });
    return;
  }
  const rawLinkedDevelopments = entity === "hr-employee-records"
    ? updatedState["assignedDevelopments"]
    : undefined;
  const linkedDevelopments = Array.isArray(rawLinkedDevelopments)
    ? [...new Set(rawLinkedDevelopments.filter(
        (development): development is string =>
          typeof development === "string" && Boolean(development.trim()),
      ).map((development) => development.trim()))]
    : null;
  if (linkedDevelopments) {
    const [organization] = await db.select({ features: organizations.features })
      .from(organizations)
      .where(eq(organizations.id, actor.tenantId))
      .limit(1);
    const configuredDevelopments = getConfiguredDevelopmentNames(organization?.features);
    if (
      configuredDevelopments !== null &&
      linkedDevelopments.some((development) => !configuredDevelopments.includes(development))
    ) {
      res.status(400).json({ error: "Assigned developments must be configured by Platform Control" });
      return;
    }
  }
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [updatedRecord] = await tx
      .update(entityRecords)
      .set({
        state: updatedState,
        projectId:
          typeof updatedState["projectId"] === "string"
            ? updatedState["projectId"]
            : current.projectId,
        development: updatedDevelopment,
        version: sql`${entityRecords.version} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(entityRecords.id, current.id),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
        eq(entityRecords.version, expectedVersion),
      ))
      .returning();
    if (!updatedRecord) return null;

    const employeeStaffId = entity === "hr-employee-records" &&
      typeof current.state["employeeStaffId"] === "string"
        ? current.state["employeeStaffId"]
        : "";
    if (employeeStaffId) {
      const [linkedStaff] = await tx.select().from(staffAccounts).where(and(
        eq(staffAccounts.id, employeeStaffId),
        eq(staffAccounts.tenantId, actor.tenantId),
      )).limit(1);
      if (linkedStaff) {
        const firstName = typeof updatedState["firstName"] === "string" &&
          updatedState["firstName"].trim()
            ? updatedState["firstName"].trim()
            : linkedStaff.firstName;
        const lastName = typeof updatedState["lastName"] === "string" &&
          updatedState["lastName"].trim()
            ? updatedState["lastName"].trim()
            : linkedStaff.lastName;
        await tx.update(staffAccounts).set({
          firstName,
          lastName,
          name: [firstName, lastName].filter(Boolean).join(" ") || linkedStaff.name,
          position: linkedPosition || linkedStaff.position,
          developments: linkedDevelopments ??
            (updatedDevelopment ? [updatedDevelopment] : linkedStaff.developments),
          updatedAt: now,
        }).where(and(
          eq(staffAccounts.id, linkedStaff.id),
          eq(staffAccounts.tenantId, actor.tenantId),
        ));
      }
    }
    return updatedRecord;
  });
  if (!updated) {
    res.status(409).json({ error: "Concurrent update detected" });
    return;
  }
  await audit(actor, `${entity}.updated`, `Updated ${entity} record`, current.id);
  // A vendor's change work order changed status (supervisor approved /
  // Procurement approved the cost / declined): the vendor gets an approved (or
  // declined) on their side — their page and app show it, and they are emailed
  // when a contact email is on file.
  if (
    entity === "change-orders" &&
    updated.state["isVendorCO"] === true &&
    String(updated.state["status"] || "") !== String(current.state["status"] || "")
  ) {
    void emailVendorChangeOrderStatus(actor.tenantId, updated.state as Record<string, unknown>)
      .then(async (sent) => {
        await db.update(entityRecords)
          .set({ state: sql`${entityRecords.state} || ${JSON.stringify({ vendorNotifiedAt: new Date().toISOString(), vendorEmailed: sent })}::jsonb` })
          .where(and(eq(entityRecords.id, updated.id), eq(entityRecords.tenantId, actor.tenantId)));
      })
      .catch(() => undefined);
  }
  res.json(outward(actor, updated));
});

// Management nudge: request the development's supervisors assign a complaint or
// violation right away, with a short note. Sends a notification (no status change).
// A CPM / inspector / worker attaches a saved measurement (picture, size,
// result) to the complaint or inspection they are handling. It lands on the
// record for the supervisor / management to see, and they are alerted.
router.post("/v1/:entity/:id/attach-measurement", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity) || !["resident-reports", "building-violations"].includes(entity)) { next(); return; }
  const actor = actorFrom(res);
  const [record] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, req.params["id"]!),
    eq(entityRecords.entity, entity),
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.deleted, false),
  )).limit(1);
  if (!record || !(await canReadRecordForActor(actor, record))) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const state = record.state as Record<string, unknown>;
  const handler =
    actor.role === "administrator" || actor.role === "management" ||
    record.createdBy === actor.id ||
    ["assignedStaffId", "assignedCpmStaffId", "handoffTargetId", "directedToStaffId", "completedByStaffId"]
      .some((field) => state[field] === actor.id);
  if (!handler) {
    res.status(403).json({ error: "Only the person handling this job can attach a measurement to it" });
    return;
  }
  const measurementId = typeof req.body?.["measurementId"] === "string" ? req.body["measurementId"].trim() : "";
  if (!measurementId) { res.status(400).json({ error: "measurementId is required" }); return; }
  const [measurement] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, measurementId),
    eq(entityRecords.entity, "measurements"),
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.deleted, false),
  )).limit(1);
  if (!measurement) { res.status(404).json({ error: "Measurement not found" }); return; }
  const m = measurement.state as Record<string, unknown>;
  const attached = {
    measurementId,
    material: String(m["materialLabel"] || m["material"] || ""),
    lengthFt: Number(m["lengthFt"] || 0) || 0,
    widthFt: Number(m["widthFt"] || 0) || 0,
    areaSqFt: Number(m["areaSqFt"] || 0) || 0,
    summary: String(m["summary"] || ""),
    note: String(m["note"] || ""),
    photoDataUrl: typeof m["photoDataUrl"] === "string" ? m["photoDataUrl"] : "",
    items: Array.isArray(m["items"]) ? m["items"] : undefined,
    measuredBy: String(m["by"] || actor.name || ""),
    measuredAt: String(m["createdAt"] || ""),
    attachedBy: actor.name || "",
    attachedByStaffId: actor.id,
    attachedAt: new Date().toISOString(),
  };
  // Who should see it: "all" = every supervisor and manager in the company
  // (an emergency), "development" = this development's supervisors and whoever
  // sent the job (the default), "staff" = one chosen supervisor / manager.
  const audience = ["all", "development", "staff"].includes(String(req.body?.["audience"] || "")) ? String(req.body["audience"]) : "development";
  const targetStaffId = typeof req.body?.["targetStaffId"] === "string" ? req.body["targetStaffId"].trim() : "";
  const development = record.development || String(state["development"] || "");
  const recipients = new Set<string>();
  if (audience === "staff") {
    const [target] = await db.select({ id: staffAccounts.id, role: staffAccounts.role, position: staffAccounts.position }).from(staffAccounts).where(and(
      eq(staffAccounts.id, targetStaffId), eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.status, "approved"))).limit(1);
    const ok = !!target && !["human_resources", "procurement", "vendor", "resident"].includes(target.role) &&
      (/supervisor|superintendent|manager|director/i.test(String(target.position || "")) || ["management", "administrator"].includes(target.role));
    if (!ok) { res.status(400).json({ error: "Pick a supervisor or manager from the list" }); return; }
    recipients.add(target.id);
  } else if (audience === "all") {
    const rows = await db.select({ id: staffAccounts.id, role: staffAccounts.role, position: staffAccounts.position }).from(staffAccounts).where(and(
      eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.status, "approved")));
    rows.filter((row) => !["human_resources", "procurement", "vendor", "resident", "worker", "inspector", "emergency"].includes(row.role) &&
        !/\bhr\b|human resources|procurement|payroll/i.test(String(row.position || "")) && String(row.position || "").trim().toLowerCase() !== "director")
      .forEach((row) => recipients.add(row.id));
  } else {
    ["assignedByStaffId", "cpmSupervisorId", "dispatchingSupervisorId", "directedToStaffId", "approvedByStaffId"]
      .forEach((field) => { if (typeof state[field] === "string" && state[field]) recipients.add(state[field] as string); });
    // Complaints and violations alike: this development's on-site supervisors,
    // the emergency supervisor, and the matching trade supervisor here — not
    // every supervisor at the development, and nobody from another one.
    (await routedComplaintRecipientIds(actor.tenantId, development, state, entity === "building-violations")).forEach((id) => recipients.add(id));
  }
  recipients.delete(actor.id);
  const existing = Array.isArray(state["measurements"]) ? (state["measurements"] as unknown[]) : [];
  const already = existing.some((x) => (x as Record<string, unknown>)?.["measurementId"] === measurementId);
  // Everyone it was sent to can open this record (and the picture) even if
  // the job itself was never sent to them.
  const sharedWith = new Set<string>(Array.isArray(state["measurementSharedWith"]) ? (state["measurementSharedWith"] as string[]) : []);
  recipients.forEach((id) => sharedWith.add(id));
  await db.update(entityRecords)
    .set({ state: sql`${entityRecords.state} || ${JSON.stringify({ measurements: already ? existing : [...existing, { ...attached, audience }], measurementSharedWith: [...sharedWith] })}::jsonb`, updatedAt: new Date() })
    .where(and(eq(entityRecords.id, record.id), eq(entityRecords.tenantId, actor.tenantId)));
  const ref = entity === "resident-reports"
    ? [String(state["complaintNo"] || ""), String(state["address"] || "")].filter(Boolean).join(" \u00b7 ")
    : [String(state["violationNo"] || ""), String(state["building"] || "")].filter(Boolean).join(" \u00b7 ");
  const sizeText = attached.lengthFt && attached.widthFt ? ` ${attached.lengthFt} \u00d7 ${attached.widthFt} ft` : "";
  const detail = `${audience === "all" ? "EMERGENCY \u00b7 " : ""}${attached.material}${sizeText}${attached.areaSqFt ? ` (${attached.areaSqFt} sq ft)` : ""}${ref ? ` \u00b7 ${ref}` : ""} \u2014 by ${actor.name}`;
  const message = entity === "resident-reports" ? "Measurement added to complaint" : "Measurement added to inspection";
  for (const target of recipients) await notify(actor, target, message, detail, record.id);
  await audit(actor, `${entity}.measurement-attached`, detail, record.id);
  res.json({ ok: true, notified: recipients.size, alreadyAttached: already });
});

const FINISHED_SENT_ON = new Set(["work_approved", "approved", "completed", "done", "resolved", "closed", "in_house_completed", "denied", "cancelled"]);
router.post("/v1/:entity/:id/request-assignment", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity) || !["resident-reports", "building-violations"].includes(entity)) { next(); return; }
  const actor = actorFrom(res);
  if (!(actor.role === "administrator" || actor.role === "management" || isBoroughDirector(actor) || isCoverageEligible(actor))) {
    res.status(403).json({ error: "Only management may request assignment" });
    return;
  }
  const [report] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, req.params["id"]!),
    eq(entityRecords.entity, entity),
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.deleted, false),
  )).limit(1);
  if (!report || !(await canReadRecordForActor(actor, report))) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const rawNote = typeof req.body?.["note"] === "string" ? req.body["note"].trim() : "";
  const note = rawNote || "Please assign this right away.";
  const development = report.development || String(report.state["development"] || "");
  const complaintNo = String(report.state["complaintNo"] || "");
  const rawTarget = typeof req.body?.["targetStaffId"] === "string" ? req.body["targetStaffId"].trim() : "";
  let recipients: string[];
  let directedTo = "";
  if (rawTarget) {
    // Management picked a specific manager/supervisor to handle this (e.g. the
    // usual superintendent is off). Direct the urgent note to that person only.
    const [target] = await db.select().from(staffAccounts).where(and(
      eq(staffAccounts.id, rawTarget),
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
    )).limit(1);
    const targetRole = String(target?.role || "");
    const targetPosition = String(target?.position || "");
    const targetIsComplaintHandler = !!target && (
      // The company/procurement "Director" (not Borough/Regional Director) never
      // handles or assigns a resident complaint.
      targetPosition !== "Director" &&
      (
        /supervisor|superintendent/i.test(targetPosition) ||
        (
          !["procurement", "human_resources", "vendor", "resident", "worker", "emergency"].includes(targetRole) &&
          (targetRole === "management" || targetRole === "administrator")
        )
      )
    );
    if (!target || !targetIsComplaintHandler) {
      res.status(400).json({ error: "Select a manager or supervisor from the list" });
      return;
    }
    recipients = [target.id];
    directedTo = target.name || "";
    // Asking a specific supervisor sends the complaint to them: record it on
    // the complaint so it shows in their inbox and Reports until it's assigned.
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { directedToStaffId: target.id, directedToName: target.name, directedAt: now };
    // A finished complaint sent to another supervisor to check becomes an
    // open complaint again for them: back to submitted, assignment cleared,
    // so they can send it to their own team. The earlier work stays in the
    // history.
    const currentStatus = String(report.state["status"] || "").toLowerCase();
    if (FINISHED_SENT_ON.has(currentStatus)) {
      const updates = Array.isArray(report.state["updates"]) ? (report.state["updates"] as unknown[]) : [];
      Object.assign(patch, {
        status: "submitted",
        reopenedAt: now, reopenedById: actor.id, reopenedByName: actor.name, reopenedFromStatus: currentStatus,
        assignedStaffId: null, assignedTo: null, assignedAt: null, assignedByStaffId: null,
        completedAt: null, completedByName: null, completedBy: null, completionNote: null,
        workApprovedAt: null, workApprovedByName: null,
        updates: [...updates, { at: now, by: actor.name || "management", status: "submitted", note: `Reopened and sent to ${target.name} to check: ${note}` }],
      });
      // Its prior alerts are stale now.
      await db.delete(notifications).where(and(eq(notifications.tenantId, actor.tenantId), eq(notifications.reportId, report.id)));
    }
    await db.update(entityRecords)
      .set({ state: sql`${entityRecords.state} || ${JSON.stringify(patch)}::jsonb`, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() })
      .where(and(eq(entityRecords.id, report.id), eq(entityRecords.tenantId, actor.tenantId)));
  } else {
    recipients = await routedComplaintRecipientIds(actor.tenantId, development, report.state, entity === "building-violations");
  }
  if (recipients.length) {
    const created = await db.insert(notifications).values(recipients.map((target) => ({
      id: randomUUID(),
      tenantId: actor.tenantId,
      target,
      message: FINISHED_SENT_ON.has(String(report.state["status"] || "").toLowerCase()) && rawTarget ? "Complaint reopened and sent to you" : "Urgent: assignment requested",
      detail: `${actor.name || "Management"}: ${note}${complaintNo ? ` \u00b7 ${complaintNo}` : ""}`,
      reportId: report.id,
    }))).returning();
    for (const notification of created) void deliverPushNotification(notification).catch(() => undefined);
  }
  await audit(actor, `${entity}.assignment-requested`, note, report.id);
  res.json({ ok: true, notified: recipients.length, directedTo });
});

router.post(
  "/v1/:entity/:id/actions/:action",
  (req, res, next) => {
    const actor = actorFrom(res);
    if (
      actor.role === "human_resources" &&
      req.params["entity"] === "leave-requests" &&
      (req.params["action"] === "approve" || req.params["action"] === "deny")
    ) {
      hrLeaveDecisionRateLimit(req, res, next);
      return;
    }
    next();
  },
  async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  const action = req.params["action"]!;
  const [current] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.id, req.params["id"]!),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ),
    )
    .limit(1);

  if (!current || !(await canReadRecordForActor(actor, current))) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  // Coverage gate: a coverage-eligible supervisor may VIEW any development's
  // complaints/violations, but to ACT on one that is not a home development they
  // must hold an active coverage unlock ("Cover a Site"). One unlock covers all
  // developments for the 24h window. Administrators and non-eligible roles (the
  // canonical worker/emergency assignees) are unaffected.
  if (
    actor.role !== "administrator" &&
    (entity === "resident-reports" || entity === "building-violations") &&
    isCoverageEligible(actor) &&
    current.development &&
    !isHomeDevelopment(actor, current.development) &&
    !(await hasAnyActiveCoverage(actor))
  ) {
    res.status(403).json({
      error: "Unlock this development with your coverage code (Cover a Site) before acting on it.",
    });
    return;
  }
  // Approval is stricter than viewing or handling. A supervisor may sign off on
  // completed work only when they are actually at that development — their home
  // site, or one they hold an active coverage unlock for TODAY — or when they
  // are the supervisor who assigned the work. A blanket "any unlock covers
  // everything" is not enough to approve another site's or another supervisor's
  // work. Administrators are unaffected.
  if (
    actor.role !== "administrator" &&
    action === "approve-work" &&
    (entity === "resident-reports" || entity === "building-violations") &&
    isCoverageEligible(actor)
  ) {
    const approvalDev = current.development || String(current.state["development"] || "");
    const isAssigner =
      typeof current.state["assignedByStaffId"] === "string" &&
      current.state["assignedByStaffId"] === actor.id;
    if (!isAssigner && !(await canActOnDevelopment(actor, approvalDev))) {
      res.status(403).json({
        error: "You can approve work only at your own development, one you're covering today, or work you assigned.",
      });
      return;
    }
  }
  if (
    entity === "procurement" &&
     current.state["status"] === "closed"
  ) {
    res.status(409).json({ error: "Closed procurement records are immutable" });
    return;
  }
  const transitions: Record<string, Record<string, string>> = {
    procurement: {
      submit: "submitted",
      approve: "approved",
      reject: "returned",
      "handoff-inhouse": "in_house",
      return: "returned",
      broadcast: "bidding",
      resend: "bidding",
      award: "awarded",
      pay: "awarded",
      "mark-started": "awarded",
      "mark-completed": "awarded",
      "rate-close": "closed",
    },
    "resident-reports": {
      assign: "assigned",
      release: "submitted",
      start: "in_progress",
      resolve: "resolved",
      clear: "resolved",
      complete: "done",
      "approve-work": "work_approved",
      "reject-work": "in_progress",
    },
    "building-violations": {
      approve: "approved",
      deny: "denied",
      "handoff-cpm-supervisor": "cpm_review",
      "assign-cpm": "cpm_scope_assigned",
      route: "routed",
      complete: "done",
      release: "approved",
      clear: "done",
      "approve-work": "work_approved",
    },
    "manpower-requests": {
      assign: "assigned",
      dispatch: "dispatched",
      start: "in_progress",
      complete: "completed",
      release: "pending",
    },
    "leave-requests": {
      approve: "Approved",
      deny: "Denied",
      cancel: "Cancelled",
      "send-to-hr": "Pending",
    },
    "hud-inspections": {
      approve: "Approved",
      deny: "Denied",
      correction: "Correction",
      resubmit: "Submitted",
    },
    "elevator-jobs": {
      "on-my-way": "assigned",
      start: "in_progress",
      complete: "done",
      "approve-work": "work_approved",
    },
    "emergency-jobs": {
      "on-my-way": "assigned",
      start: "in_progress",
      complete: "done",
      "approve-work": "work_approved",
    },
    "hr-approvals": {
      approve: "Approved",
    },
    "hr-employee-records": {
      advance: "in_progress",
      close: "closed",
    },
    "hr-recruiting": {
      advance: "in_progress",
      close: "closed",
    },
    "hr-onboarding": {
      advance: "in_progress",
      close: "closed",
    },
    "hr-payroll-benefits": {
      advance: "in_progress",
      "approve-pay-change": "Approved",
      close: "closed",
    },
    "hr-attendance": {
      advance: "in_progress",
      close: "closed",
    },
    "hr-relations": {
      advance: "in_progress",
      close: "closed",
    },
    "hr-performance": {
      advance: "in_progress",
      close: "closed",
    },
    "hr-discipline": {
      advance: "in_progress",
      "approve-discipline": "Disciplined",
      close: "closed",
    },
    "hr-investigations": {
      advance: "in_progress",
      close: "closed",
    },
    "hr-training-compliance": {
      advance: "in_progress",
      close: "closed",
    },
    "hr-exits": {
      advance: "in_progress",
      "approve-termination": "Terminated",
      "approve-layoff": "Laid Off",
      close: "closed",
    },
  };
  let nextStatus = transitions[entity]?.[action];
  if (!nextStatus) {
    res.status(400).json({ error: "Unsupported workflow action" });
    return;
  }
  if (action === "release" && !["resident-reports", "building-violations", "manpower-requests"].includes(entity)) {
    res.status(400).json({ error: "Unsupported workflow action" });
    return;
  }
  const body = stateOf(req.body) ?? {};
  if (isHrEntity(entity) && containsHrProtectedFields(body)) {
    res.status(403).json({ error: "HR linkage, employee, exit type, and status fields are server controlled" });
    return;
  }
  if (
    hasAssignmentFields(body) &&
    !(
      (
        (["resident-reports", "manpower-requests"].includes(entity) && action === "assign") ||
        (entity === "building-violations" && action === "route")
      ) &&
      Object.keys(body)
        .filter((key) => ASSIGNMENT_FIELDS.has(key))
        .every((key) => key === "assignedStaffId" || key === "assignedTo")
    )
  ) {
    res.status(403).json({
      error: "Assignments must be changed through the dedicated assignment action",
    });
    return;
  }
  if (!canPerformAssignedWorkflowAction(actor, entity, action, current.state)) {
    res.status(403).json({ error: "This workflow action is restricted to the assigned staff member" });
    return;
  }
  if (!canPerformEntityAction(actor, entity, action, current.state)) {
    res.status(403).json({ error: "Not allowed to perform this workflow action" });
    return;
  }
  if (entity === "hr-approvals" && action === "approve" && current.createdBy === actor.id) {
    res.status(403).json({ error: "Company approval must be completed by another authorized company approver" });
    return;
  }
  if (entity === "hr-approvals" && action === "approve") {
    if (normalizeStatus(current.state["status"]) !== "pending" ||
        !await validateHrApprovalLinkage(actor, current.state)) {
      res.status(409).json({ error: "This company approval has invalid or immutable linkage" });
      return;
    }
  }
  if (
    entity === "hr-exits" &&
    (action === "approve-termination" || action === "approve-layoff") &&
    current.state["employeeStaffId"] === actor.id
  ) {
    res.status(403).json({ error: "An employee may not approve their own departure" });
    return;
  }
  if (entity === "leave-requests" && action === "send-to-hr") {
    if (String(current.state["status"] || "Pending") !== "Pending") {
      res.status(409).json({ error: "This leave request has already been decided" });
      return;
    }
    const employeeForHr = {
      id: String(current.state["employeeStaffId"] || ""),
      role: String(current.state["employeeRole"] || "worker"),
      position: String(current.state["title"] || ""),
      developments: typeof current.state["development"] === "string" && current.state["development"] ? [String(current.state["development"])] : [],
    } as Pick<Actor, "id" | "role" | "position" | "developments">;
    if (!canApproveLeaveForEmployee(actor, employeeForHr)) {
      res.status(403).json({ error: "Only this employee's management may send the request to HR" });
      return;
    }
    state["sentToHrAt"] = new Date().toISOString();
    state["sentToHrById"] = actor.id;
    state["sentToHrByName"] = actor.name;
    state["sentToHrByPosition"] = actor.position;
    if (typeof body["note"] === "string" && body["note"].trim()) state["sentToHrNote"] = body["note"].trim().slice(0, 1000);
  }
  if (entity === "leave-requests" && (action === "approve" || action === "deny")) {
    // Whoever decides first completes it.
    const decided = String(current.state["status"] || "Pending");
    if (decided !== "Pending") {
      res.status(409).json({ error: `Already ${decided.toLowerCase()}${current.state["decidedByName"] ? ` by ${current.state["decidedByName"]}` : ""}` });
      return;
    }
    const leaveDays = leaveRequestDurationDays(current.state);
    if (leaveDays === null || !canApproveLeaveDuration(actor, leaveDays)) {
      res.status(403).json({
        error: actor.role === "human_resources"
          ? "HR may decide time off up to 365 days"
          : "Management and supervisors may decide up to 30 days; longer goes to HR",
      });
      return;
    }
    const employeeStaffId = typeof current.state["employeeStaffId"] === "string"
      ? current.state["employeeStaffId"]
      : "";
    const employeeName = typeof current.state["employee"] === "string"
        ? current.state["employee"].trim()
        : "";
    const employeeMatches = employeeStaffId
      ? await db.select().from(staffAccounts).where(and(
          eq(staffAccounts.id, employeeStaffId),
          eq(staffAccounts.tenantId, actor.tenantId),
        )).limit(1)
      : employeeName
        ? await db.select().from(staffAccounts).where(and(
            eq(staffAccounts.tenantId, actor.tenantId),
            sql`lower(${staffAccounts.name}) = lower(${employeeName})`,
          )).limit(2)
        : [];
    const employee = employeeMatches.length === 1 ? employeeMatches[0] : undefined;
    if (!employee || !canApproveLeaveForEmployee(actor, employee)) {
      res.status(403).json({
        error: employee && ["management", "administrator"].includes(String(employee.role))
          ? "A supervisor's time off is decided by HR or upper management (Property Manager, Regional Director)"
          : "You may only decide leave for staff you supervise",
      });
      return;
    }
    // Who covers the shift while they're out (picked from the supervisors list).
    const coverId = typeof body["coveredByStaffId"] === "string" ? body["coveredByStaffId"].trim() : "";
    if (action === "approve" && coverId) {
      const [cover] = await db.select({ id: staffAccounts.id, name: staffAccounts.name, position: staffAccounts.position }).from(staffAccounts).where(and(
        eq(staffAccounts.id, coverId), eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.status, "approved"))).limit(1);
      if (!cover) { res.status(400).json({ error: "Pick who covers the shift from the list" }); return; }
      body["coveredByStaffId"] = cover.id;
      body["coveredByName"] = cover.name;
      body["coveredByPosition"] = cover.position;
    } else {
      // No pick from the approver: keep whoever the requester proposed.
      delete body["coveredByStaffId"]; delete body["coveredByName"]; delete body["coveredByPosition"];
    }
    body["decidedByStaffId"] = actor.id;
    body["decidedByName"] = actor.name;
    body["decidedByPosition"] = actor.position;
    body["decidedAt"] = new Date().toISOString();
    if (actor.role === "human_resources") {
      const authorizationCode = typeof body["authorizationCode"] === "string"
        ? body["authorizationCode"].trim().toUpperCase()
        : "";
      const [confirmed] = authorizationCode
        ? await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
            eq(staffAccounts.id, actor.id),
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.role, "human_resources"),
            eq(staffAccounts.status, "approved"),
            eq(staffAccounts.code, authorizationCode),
          )).limit(1)
        : [];
      if (!confirmed) {
        res.status(401).json({ error: "Enter your valid HR access code" });
        return;
      }
    }
  }
  let sensitiveApproval: typeof entityRecords.$inferSelect | undefined;
  if (isHrEntity(entity) && HR_SENSITIVE_ACTIONS.has(action)) {
    const purpose = purposeForTarget(entity, current.state);
    if (!purpose || actionForPurpose(purpose) !== action) {
      res.status(409).json({ error: "This sensitive action does not match the HR record type" });
      return;
    }
    const approvalRows = await db
      .select({ id: entityRecords.id })
      .from(entityRecords)
      .where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, "hr-approvals"),
        eq(entityRecords.deleted, false),
        sql`${entityRecords.state}->>'targetRecordId' = ${current.id}`,
        sql`lower(${entityRecords.state}->>'status') = 'approved'`,
        sql`${entityRecords.state}->>'employeeStaffId' = ${current.state["employeeStaffId"]}`,
        sql`${entityRecords.state}->>'approvalPurpose' = ${purpose}`,
      ))
      .limit(1);
    if (approvalRows.length) {
      [sensitiveApproval] = await db.select().from(entityRecords).where(and(
        eq(entityRecords.id, approvalRows[0]!.id),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, "hr-approvals"),
        eq(entityRecords.deleted, false),
      )).limit(1);
    }
    if (!sensitiveApproval) {
      res.status(403).json({ error: "Company approval is required for this policy-sensitive action" });
      return;
    }
    if (actor.role === "human_resources") {
      const authorizationCode = typeof body["authorizationCode"] === "string"
        ? body["authorizationCode"].trim().toUpperCase()
        : "";
      const [confirmed] = authorizationCode
        ? await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
            eq(staffAccounts.id, actor.id),
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.role, "human_resources"),
            eq(staffAccounts.status, "approved"),
            eq(staffAccounts.code, authorizationCode),
          )).limit(1)
        : [];
      if (!confirmed) {
        res.status(401).json({ error: "Enter your valid HR access code" });
        return;
      }
    }
  }
  if (entity === "procurement" && action === "submit" &&
      current.createdBy !== actor.id) {
    res.status(403).json({ error: "Only the record owner may submit a procurement draft" });
    return;
  }
  if (!isValidEntityTransition(entity, action, current.state)) {
    res.status(409).json({
      error: "This workflow action is not valid for the current status",
    });
    return;
  }
  let inHouseReceiver: typeof staffAccounts.$inferSelect | undefined;
  let cpmSupervisorReceiver: typeof staffAccounts.$inferSelect | undefined;
  let cpmStaffReceiver: typeof staffAccounts.$inferSelect | undefined;
  if (entity === "building-violations" && action === "handoff-cpm-supervisor") {
    const receiverSupervisorId = typeof body["receiverSupervisorId"] === "string"
      ? body["receiverSupervisorId"].trim() : "";
    if (!receiverSupervisorId) {
      res.status(400).json({ error: "receiverSupervisorId is required" });
      return;
    }
    [cpmSupervisorReceiver] = await db.select().from(staffAccounts).where(and(
      eq(staffAccounts.id, receiverSupervisorId),
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
      eq(staffAccounts.role, "management"),
    )).limit(1);
    if (
      !cpmSupervisorReceiver ||
      !isCpmSupervisorTitle(cpmSupervisorReceiver.position) ||
      cpmSupervisorReceiver.id === actor.id ||
      !current.development ||
      // Office-based CPM Supervisors (no developments of their own) cover all.
      (cpmSupervisorReceiver.developments.length > 0 &&
        !cpmSupervisorReceiver.developments.some((value) =>
          value.trim().toLowerCase() === current.development!.trim().toLowerCase()))
    ) {
      res.status(403).json({
        error: "Select an approved CPM Supervisor covering this development",
      });
      return;
    }
  }
  if (entity === "building-violations" && action === "assign-cpm") {
    const cpmStaffId = typeof body["cpmStaffId"] === "string"
      ? body["cpmStaffId"].trim() : "";
    if (Object.keys(body).some((key) => key !== "cpmStaffId")) {
      res.status(400).json({ error: "assign-cpm accepts only cpmStaffId" });
      return;
    }
    if (!cpmStaffId) {
      res.status(400).json({ error: "cpmStaffId is required" });
      return;
    }
    [cpmStaffReceiver] = await db.select().from(staffAccounts).where(and(
      eq(staffAccounts.id, cpmStaffId),
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
      eq(staffAccounts.role, "inspector"),
      eq(staffAccounts.position, "CPM"),
    )).limit(1);
    if (
      !cpmStaffReceiver ||
      cpmStaffReceiver.id === actor.id ||
      !current.development ||
      !cpmStaffReceiver.developments.some((value) =>
        value.trim().toLowerCase() === current.development!.trim().toLowerCase())
    ) {
      res.status(403).json({ error: "Select an approved CPM covering this development" });
      return;
    }
  }
  if (entity === "procurement" && action === "handoff-inhouse") {
    const requestedTrade = typeof body["requestedTrade"] === "string"
      ? body["requestedTrade"].trim() : "";
    const receiverSupervisorId = typeof body["receiverSupervisorId"] === "string"
      ? body["receiverSupervisorId"].trim() : "";
    if (!requestedTrade || !receiverSupervisorId) {
      res.status(400).json({ error: "requestedTrade and receiverSupervisorId are required" });
      return;
    }
    [inHouseReceiver] = await db.select().from(staffAccounts).where(and(
      eq(staffAccounts.id, receiverSupervisorId),
      eq(staffAccounts.tenantId, actor.tenantId),
      eq(staffAccounts.status, "approved"),
    )).limit(1);
    if (!inHouseReceiver || inHouseReceiver.id === actor.id ||
        !isSupervisorForTrade(inHouseReceiver.position, requestedTrade) ||
        (current.development &&
          // Office-based trade supervisors cover every development.
          !isOfficeTradeSupervisorTitle(inHouseReceiver.position, inHouseReceiver.developments) &&
          !inHouseReceiver.developments.some((value) =>
            value.trim().toLowerCase() === current.development!.trim().toLowerCase()))) {
      res.status(403).json({ error: "Select an approved receiving supervisor for this trade and development" });
      return;
    }
    const [duplicate] = await db.select({ id: entityRecords.id }).from(entityRecords).where(and(
      eq(entityRecords.id, `manpower-request:${current.id}`),
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "manpower-requests"),
      eq(entityRecords.deleted, false),
    )).limit(1);
    if (duplicate) {
      res.status(409).json({ error: "This procurement scope already has an in-house manpower request" });
      return;
    }
    body["requestedTrade"] = requestedTrade;
    body["receiverSupervisorId"] = inHouseReceiver.id;
  }
  // A complaint sent TO a supervisor is theirs to hand down (CPM Supervisor →
  // CPM, trade supervisor → crew); the emergency supervisor may always
  // reassign. Anyone else must have it released first.
  const currentAssignee = normalizeAssignment(current.state).assignedStaffId;
  const handingDown = entity === "resident-reports" && currentAssignee === actor.id;
  if (
    action === "assign" &&
    ["resident-reports", "building-violations", "manpower-requests"].includes(entity) &&
    currentAssignee &&
    !(entity === "resident-reports" && isSuperintendentE(actor)) &&
    !handingDown
  ) {
    res.status(409).json({
      error: "This record is already assigned. The current assignee must release it with an update before reassignment.",
    });
    return;
  }
  if (
    entity === "building-violations" &&
    action === "route" &&
    normalizeAssignment(current.state).assignedStaffId
  ) {
    res.status(409).json({
      error: "This violation is already assigned. The current assignee must release it with an update before rerouting.",
    });
    return;
  }
  if (action === "release") {
    const update = typeof body["update"] === "string" ? body["update"].trim() : "";
    if (update.length < 3) {
      res.status(400).json({ error: "A non-empty update is required before releasing this assignment" });
      return;
    }
  }
  if (entity === "resident-reports" && action === "assign") {
    const assignedStaffId = typeof body["assignedStaffId"] === "string"
      ? body["assignedStaffId"]
      : "";
    const [target] = assignedStaffId
      ? await db.select().from(staffAccounts).where(and(
          eq(staffAccounts.id, assignedStaffId),
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.status, "approved"),
        )).limit(1)
      : [];
    // A supervisor with ANY active coverage unlock may assign across every
    // development for the 24h window, so treat this report's development and the
    // target's developments as within their scope for this assignment.
    let assigningActor = actor;
    if (target && isCoverageEligible(actor) && await hasAnyActiveCoverage(actor)) {
      assigningActor = {
        ...actor,
        developments: [
          ...actor.developments,
          ...target.developments,
          ...(current.development ? [current.development] : []),
        ],
      };
    }
    if (res.locals["appEmergencyAssignOnly"] && target && target.role !== "emergency") {
      res.status(403).json({ error: APP_READ_ONLY_MESSAGE, code: "app_read_only" });
      return;
    }
    if (
      !target ||
      (
        !canAssignStaff(assigningActor, target, current.development) &&
        !canSuperintendentEAssignResidentReport(assigningActor, target)
      )
    ) {
      res.status(403).json({ error: "Select an operational staff member from your authorized group" });
      return;
    }
    body["assignedStaffId"] = target.id;
    body["assignedTo"] = target.name;
    delete body["assignedStaffName"];
    delete body["assignedToName"];
  }
  if (entity === "building-violations" && action === "route") {
    const assignedStaffId = typeof body["assignedStaffId"] === "string"
      ? body["assignedStaffId"].trim()
      : "";
    const [target] = assignedStaffId
      ? await db.select().from(staffAccounts).where(and(
          eq(staffAccounts.id, assignedStaffId),
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.status, "approved"),
        )).limit(1)
      : [];
    if (!target || !canAssignStaff(actor, target, current.development)) {
      res.status(403).json({ error: "Select an operational staff member from your authorized group" });
      return;
    }
    body["assignedStaffId"] = target.id;
    body["assignedTo"] = target.name;
    delete body["assignedStaffName"];
    delete body["assignedToName"];
  }
  if (entity === "manpower-requests" && action === "assign") {
    const assignedStaffId = typeof body["assignedStaffId"] === "string"
      ? body["assignedStaffId"].trim()
      : "";
    const [target] = assignedStaffId
      ? await db.select().from(staffAccounts).where(and(
          eq(staffAccounts.id, assignedStaffId),
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.status, "approved"),
        )).limit(1)
      : [];
    if (
      !target ||
      !["worker", "inspector", "emergency"].includes(target.role) ||
      isSupervisorTitle(target.position) ||
      target.id === actor.id ||
      !isCrewForTrade(target.position, String(current.state["requestedTrade"] || "")) ||
      (current.development && !target.developments.some((value) =>
        value.trim().toLowerCase() === current.development!.trim().toLowerCase()))
    ) {
      res.status(403).json({ error: "Select an available employee from the requested trade" });
      return;
    }
    body["assignedStaffId"] = target.id;
    body["assignedTo"] = target.name;
  }
  if (entity === "manpower-requests" &&
      ["assign", "dispatch", "start", "complete"].includes(action) &&
      current.state["assignmentMode"] === "in_house" &&
      action === "complete") {
    const note = typeof body["completionNote"] === "string"
      ? body["completionNote"].trim() : "";
    const evidence = body["photoEvidence"];
    const validEvidence = Array.isArray(evidence) && evidence.length > 0 &&
      evidence.every((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const file = item as Record<string, unknown>;
        const objectPath = typeof file["objectPath"] === "string"
          ? file["objectPath"].trim() : "";
        const id = typeof file["id"] === "string" ? file["id"].trim() : "";
        const name = typeof file["name"] === "string" ? file["name"].trim() : "";
        const contentType = typeof file["contentType"] === "string"
          ? file["contentType"].trim().toLowerCase() : "";
        return Boolean(
          objectPath &&
          /^\/?objects\/.+/.test(objectPath) &&
          (id || name) &&
          /^image\/[a-z0-9.+-]+$/.test(contentType),
        );
      });
    if (!note || !validEvidence) {
      res.status(400).json({ error: "Completion note and photo evidence are required" });
      return;
    }
  }
  if (
    entity === "resident-reports" &&
    (action === "complete" || action === "resolve")
  ) {
    const requestedDevelopment = typeof body["development"] === "string"
      ? body["development"].trim()
      : "";
    const stateDevelopment = typeof current.state["development"] === "string"
      ? current.state["development"].trim()
      : "";
    const assignedDevelopments = actor.developments
      .map((development) => development.trim())
      .filter(Boolean);
    const development = current.development?.trim() ||
      stateDevelopment ||
      requestedDevelopment ||
      (assignedDevelopments.length === 1 ? assignedDevelopments[0]! : "");
    if (!development) {
      res.status(400).json({ error: "Development is required to complete a complaint" });
      return;
    }
    if (!entityDevelopmentAllowed(actor, entity, development)) {
      res.status(403).json({ error: "Select a development assigned to your account" });
      return;
    }
    body["development"] = development;
  }
  if (entity === "building-violations" && action === "complete") {
    const remoteFiles = Array.isArray(current.state["remoteFiles"])
      ? current.state["remoteFiles"]
      : [];
    const hasCompletionPhoto = remoteFiles.some((item) =>
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>)["objectPath"] === "string" &&
      String((item as Record<string, unknown>)["objectPath"]).trim().length > 0 &&
      String((item as Record<string, unknown>)["kind"] || "").toLowerCase() === "completion-photo",
    );
    if (!hasCompletionPhoto) {
      res.status(400).json({ error: "A completed-repair photo must finish uploading before this violation can be marked done" });
      return;
    }
  }
  if (patchesWorkflowManagedFields(entity, body)) {
    res.status(403).json({
      error: "Workflow-managed fields are controlled by the selected action",
    });
    return;
  }
  const vendorRecipients = Array.isArray(body["vendorRecipients"])
    ? body["vendorRecipients"].flatMap((item) => {
        const contact = stateOf(item);
        const name = typeof contact?.["name"] === "string" ? contact["name"].trim() : "";
        const email = typeof contact?.["email"] === "string" ? contact["email"].trim() : "";
        return email ? [{ name, email }] : [];
      })
    : [];
  // Routing and review provenance are server-owned.  A caller may provide a
  // review note, but cannot redirect the resulting notification or forge the
  // reviewer identity/timestamp.
  // CPM Supervisor review is a decision-only operation.  Do not merge any
  // client fields from this action into the scope (including pricing, vendor,
  // project, ownership, or workflow fields); the review note is persisted
  // separately below.
  const isScopeReview =
    entity === "procurement" &&
    isCpmSupervisor(actor) &&
    ["approve", "reject", "return", "handoff-inhouse"].includes(action);
  const persistedBody = isScopeReview
    ? {}
    : { ...body };
  delete persistedBody["vendorRecipients"];
  delete persistedBody["target"];
  delete persistedBody["authorizationCode"];
  const reviewNote = typeof body["note"] === "string" ? body["note"].trim() : "";
  delete persistedBody["note"];
  const releaseUpdate = typeof persistedBody["update"] === "string" ? String(persistedBody["update"]).trim() : "";
  delete persistedBody["update"];
  const now = new Date();
  const state: Record<string, unknown> = {
    ...current.state,
    ...persistedBody,
    status: nextStatus,
    ...(action === "clear" ? { clearedByMgmt: true } : {}),
    [`${action.replaceAll("-", "_")}At`]: now.toISOString(),
  };
  // Money released to the awarded vendor: server-kept list of payments.
  const paymentsSoFar = (Array.isArray(current.state["payments"]) ? current.state["payments"] : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
  const releasedSoFar = Math.round(paymentsSoFar.reduce((sum, p) => sum + (Number(p["amount"]) || 0), 0) * 100) / 100;
  if (entity === "procurement" && action === "pay") {
    const amount = Math.round(Number(body["amount"]) * 100) / 100;
    const contract = Number(current.state["finalAmount"] ?? current.state["bidAmount"]) || 0;
    delete state["amount"];
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "Enter the amount to release." });
      return;
    }
    if (contract > 0 && releasedSoFar + amount > contract + 0.005) {
      res.status(400).json({ error: `That's more than is left to release ($${(contract - releasedSoFar).toFixed(2)}).` });
      return;
    }
    state["payments"] = [...paymentsSoFar, {
      id: randomUUID(), amount, note: reviewNote.slice(0, 500),
      at: now.toISOString(), byId: actor.id, byName: actor.name,
    }];
    state["releasedTotal"] = Math.round((releasedSoFar + amount) * 100) / 100;
  }
  if (entity === "procurement" && (action === "mark-started" || action === "mark-completed")) {
    const at = now.toISOString();
    state["vendorStartedAt"] = current.state["vendorStartedAt"] || at;
    state["startedAt"] = current.state["startedAt"] || state["vendorStartedAt"];
    if (!current.state["vendorStartedAt"]) state["startedMarkedBy"] = actor.name;
    if (action === "mark-completed") {
      state["vendorCompletedAt"] = at;
      state["completedAt"] = at;
      state["completedMarkedBy"] = actor.name;
      if (reviewNote) state["completionNote"] = reviewNote.slice(0, 1000);
    }
  }
  if (entity === "procurement" && action === "rate-close") {
    // A job closes only when the work is finished and all the money is out.
    const finalAmount = Number(body["finalAmount"]);
    if (!Number.isFinite(finalAmount) || releasedSoFar + 0.005 < finalAmount) {
      const left = Math.max(0, (Number.isFinite(finalAmount) ? finalAmount : 0) - releasedSoFar);
      res.status(400).json({ error: `Release the remaining $${left.toFixed(2)} before closing this job.` });
      return;
    }
    state["releasedTotal"] = releasedSoFar;
  }
  if (entity === "procurement" && ["submit", "approve", "broadcast"].includes(action)) {
    // Carry the CPM's CSI scope (with prices for staff, without for vendors).
    const keys = [current.id, String(current.projectId || "")].filter(Boolean);
    const [scopeRow] = await db.select().from(entityRecords).where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "project-scopes"),
      eq(entityRecords.deleted, false),
      or(inArray(entityRecords.id, keys), inArray(entityRecords.projectId, keys)),
    )).orderBy(desc(entityRecords.updatedAt)).limit(1);
    const priced = scopeRow ? snapshotScope(scopeRow.state, true) : null;
    if (priced) {
      state["cpmScope"] = priced;
      state["cpmScopeTotal"] = priced.total;
      state["vendorScopeTemplate"] = snapshotScope(scopeRow!.state, false);
    }
    // The cost estimate and elevator survey, when the app didn't send a
    // readable copy with the submit (older app versions).
    for (const [sourceEntity, key, make] of [
      ["cost-estimates", "cpmEstimate", snapshotEstimate],
      ["elevators", "cpmElevator", snapshotElevator],
    ] as const) {
      if (state[key]) continue;
      const [row] = await db.select().from(entityRecords).where(and(
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.entity, sourceEntity),
        eq(entityRecords.deleted, false),
        or(inArray(entityRecords.id, keys), inArray(entityRecords.projectId, keys)),
      )).orderBy(desc(entityRecords.updatedAt)).limit(1);
      const copy = row ? make(row.state) : null;
      if (copy) state[key] = copy;
    }
    // The CPM Supervisor must be able to read the priced scope before it
    // can be sent on, so a scope with nothing in it is refused.
    if ((action === "submit" || action === "approve") && !hasScopePackage(state)) {
      res.status(400).json({
        error: action === "submit"
          ? "Add the scope details before sending: Nature of Work & Cost Estimate, Scope of Work (Divisions), Elevator Services, or attach a scope file."
          : "This scope has no prices or scope file to review. Return it to the CPM to add them.",
      });
      return;
    }
  }
  if (entity === "procurement" && action === "handoff-inhouse") {
    state["handoffMode"] = "in_house";
    state["linkedManpowerRequestId"] = `manpower-request:${current.id}`;
  }
  if (entity === "building-violations" && action === "deny") {
    state["denyReason"] = typeof body["reason"] === "string" ? body["reason"].trim() : "";
    state["deniedByStaffId"] = actor.id;
    state["deniedByName"] = actor.name;
    state["deniedAt"] = now.toISOString();
  }
  if (entity === "building-violations" && action === "handoff-cpm-supervisor") {
    state["cpmSupervisorId"] = cpmSupervisorReceiver?.id || "";
    state["cpmSupervisorName"] = cpmSupervisorReceiver?.name || "";
    state["handoffSource"] = "supervisor-inspector";
    state["handoffByStaffId"] = actor.id;
    state["handoffByName"] = actor.name;
    state["handoffAt"] = now.toISOString();
  }
  if (entity === "building-violations" && action === "assign-cpm") {
    state["assignedCpmStaffId"] = cpmStaffReceiver?.id || "";
    state["assignedCpmStaffName"] = cpmStaffReceiver?.name || "";
    state["requestedBy"] = cpmStaffReceiver?.name || "";
    state["assignedCpmAt"] = now.toISOString();
  }
  if (action === "assign") {
    // Record who assigned the work, so that supervisor can still approve it
    // later even if their coverage for the site has since lapsed.
    state["assignedByStaffId"] = actor.id;
    state["assignedByStaffName"] = actor.name;
  }
  if (action === "start") {
    state["startedByStaffId"] = actor.id;
    state["startedByStaffName"] = actor.name;
  }
  if (action === "complete" || action === "resolve") {
    state["completedByStaffId"] = actor.id;
    state["completedByStaffName"] = actor.name;
  }
  if (entity === "resident-reports" && action === "reject-work") {
    // The supervisor's reason is the worker's instructions for the redo, so
    // it must be persisted on the record (it was previously discarded).
    if (!reviewNote) {
      res.status(400).json({ error: "Add a reason so the worker knows what to fix" });
      return;
    }
    state["reworkNote"] = reviewNote;
    state["reworkByStaffId"] = actor.id;
    state["reworkByStaffName"] = actor.name;
    state["reworkAt"] = now.toISOString();
    const existingUpdates = Array.isArray(current.state["updates"])
      ? current.state["updates"].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [];
    state["updates"] = [
      ...existingUpdates,
      {
        status: "in_progress",
        note: `Sent back: ${reviewNote}`,
        by: actor.name,
        at: now.toISOString(),
        action: "reject-work",
        staffId: actor.id,
        staffName: actor.name,
      },
    ];
  }
  if (action === "release") {
    const existingUpdates = Array.isArray(current.state["updates"])
      ? current.state["updates"].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [];
    state["updates"] = [
      ...existingUpdates,
      {
        at: now.toISOString(),
        action: "release",
        staffId: actor.id,
        staffName: actor.name,
        update: releaseUpdate,
      },
    ];
    delete state["assignedStaffId"];
    delete state["assignedTo"];
    delete state["assignedStaffName"];
    delete state["assignedToName"];
    if (["resident-reports", "building-violations"].includes(entity)) {
      delete state["manpowerRequestId"];
    }
  }
  if (
    entity === "hud-inspections" &&
    ["approve", "deny", "correction"].includes(action)
  ) {
    state["review"] = {
      decision: action === "approve"
        ? "approved"
        : action === "deny"
          ? "rejected"
          : "needs_revision",
      decidedBy: actor.name,
      decidedAt: now.toISOString(),
      ...(reviewNote ? { notes: reviewNote } : {}),
    };
  }
  if (entity === "procurement" &&
      (action === "approve" || action === "reject" || action === "return") &&
      reviewNote) {
    state["reviewNote"] = reviewNote;
    state["reviewBy"] = actor.id;
    state["reviewAt"] = now.toISOString();
  }
  if (entity === "procurement" && action === "award") {
    const bidRows = await db.select().from(entityRecords).where(and(
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.entity, "procurement-bids"),
      eq(entityRecords.deleted, false),
    ));
    const bidId = typeof body["bidId"] === "string" ? body["bidId"] : "";
    if (!bidId) {
      res.status(400).json({ error: "An existing vendor bid is required" });
      return;
    }
    const selected = bidRows.find((bid) =>
      bid.id === bidId &&
      bid.state["requestId"] === current.id &&
      typeof bid.createdBy === "string" &&
      bid.createdBy.startsWith("public-vendor:") &&
      bid.tenantId === actor.tenantId);
    if (!selected) {
      res.status(400).json({ error: "An existing vendor bid for this scope is required" });
      return;
    }
    state["bidId"] = selected.id;
    state["vendor"] = selected.state["vendorName"];
    state["bidAmount"] = selected.state["amount"];
    state["bidNote"] = selected.state["note"];
    delete state["amount"];
  }
  let updated: typeof entityRecords.$inferSelect | undefined;
  let auditCommittedInTransition = false;
  const transitionAttempts = entity === "procurement" && action === "broadcast" ? 8 : 1;
  for (let attempt = 0; attempt < transitionAttempts && !updated; attempt++) {
    if (entity === "procurement" && action === "broadcast") {
      // Vendor code: SR- so it never looks like a complaint number (RC-).
      state["trackingId"] = `SR-${randomBytes(4).readUInt32BE(0) % 90000 + 10000}`;
    }
    try {
      updated = await db.transaction(async (tx) => {
        if (entity === "procurement" && action === "broadcast") {
          await tx.insert(publicAccessCodes).values({
            id: randomUUID(),
            kind: "vendor",
            code: String(state["trackingId"]),
            tenantId: actor.tenantId,
            recordId: current.id,
          });
        }
        const [row] = await tx
          .update(entityRecords)
          .set({
            ...(entity === "resident-reports" &&
            typeof state["development"] === "string" &&
            state["development"].trim()
              ? { development: state["development"].trim() }
              : {}),
            state,
            version: sql`${entityRecords.version} + 1`,
            updatedAt: now,
          })
          .where(and(
            eq(entityRecords.id, current.id),
            eq(entityRecords.entity, entity),
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.deleted, false),
            eq(entityRecords.version, current.version),
          ))
          .returning();
        if (!row) {
          throw Object.assign(new Error("Concurrent update detected"), { status: 409 });
        }
        if (
          ["resident-reports", "building-violations"].includes(entity) &&
          action === "release"
        ) {
          const manpowerRequestId = String(current.state["manpowerRequestId"] || "");
          if (manpowerRequestId) {
            const [request] = await tx.select().from(entityRecords).where(and(
              eq(entityRecords.id, manpowerRequestId),
              eq(entityRecords.entity, "manpower-requests"),
              eq(entityRecords.tenantId, actor.tenantId),
              eq(entityRecords.deleted, false),
            )).limit(1);
            if (request && normalizeAssignment(request.state).assignedStaffId !== actor.id) {
              throw Object.assign(new Error("The linked manpower request assignment no longer matches"), { status: 409 });
            }
            if (request && normalizeAssignment(request.state).assignedStaffId === actor.id) {
              const requestUpdates = Array.isArray(request.state["updates"])
                ? request.state["updates"].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
                : [];
              const requestState = { ...request.state };
              delete requestState["assignedStaffId"];
              delete requestState["assignedTo"];
              delete requestState["assignedStaffName"];
              delete requestState["assignedToName"];
              requestState["status"] = "pending";
              requestState["releasedAt"] = now.toISOString();
              requestState["updates"] = [
                ...requestUpdates,
                {
                  at: now.toISOString(),
                  action: "release",
                  staffId: actor.id,
                  staffName: actor.name,
                  update: releaseUpdate,
                },
              ];
              const [releasedRequest] = await tx.update(entityRecords).set({
                state: requestState,
                version: sql`${entityRecords.version} + 1`,
                updatedAt: now,
              }).where(and(
                eq(entityRecords.id, request.id),
                eq(entityRecords.entity, "manpower-requests"),
                eq(entityRecords.tenantId, actor.tenantId),
                eq(entityRecords.deleted, false),
                eq(entityRecords.version, request.version),
              )).returning();
              if (!releasedRequest) {
                throw Object.assign(new Error("The linked manpower request changed before release"), { status: 409 });
              }
              await auditInTransaction(
                tx,
                actor,
                "manpower-requests.released",
                "Released linked manpower assignment with update",
                request.id,
              );
            }
          }
        }
        if (entity === "manpower-requests" && action === "release") {
          const sourceEntity = String(current.state["sourceEntity"] || "");
          const sourceRecordId = String(current.state["sourceRecordId"] || "");
          if (["resident-reports", "building-violations"].includes(sourceEntity) && sourceRecordId) {
            const [source] = await tx.select().from(entityRecords).where(and(
              eq(entityRecords.id, sourceRecordId),
              eq(entityRecords.entity, sourceEntity),
              eq(entityRecords.tenantId, actor.tenantId),
              eq(entityRecords.deleted, false),
            )).limit(1);
            if (source && normalizeAssignment(source.state).assignedStaffId !== actor.id) {
              throw Object.assign(new Error("The linked complaint or violation assignment no longer matches"), { status: 409 });
            }
            if (source && normalizeAssignment(source.state).assignedStaffId === actor.id) {
              const sourceState = { ...source.state };
              delete sourceState["assignedStaffId"];
              delete sourceState["assignedTo"];
              delete sourceState["assignedStaffName"];
              delete sourceState["assignedToName"];
              sourceState["status"] = sourceEntity === "building-violations" ? "approved" : "submitted";
              sourceState["releasedAt"] = now.toISOString();
              const sourceUpdates = Array.isArray(source.state["updates"])
                ? source.state["updates"].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
                : [];
              sourceState["updates"] = [
                ...sourceUpdates,
                {
                  at: now.toISOString(),
                  action: "release",
                  staffId: actor.id,
                  staffName: actor.name,
                  update: releaseUpdate,
                },
              ];
              delete sourceState["manpowerRequestId"];
              const [releasedSource] = await tx.update(entityRecords).set({
                state: sourceState,
                version: sql`${entityRecords.version} + 1`,
                updatedAt: now,
              }).where(and(
                eq(entityRecords.id, source.id),
                eq(entityRecords.entity, source.entity),
                eq(entityRecords.tenantId, actor.tenantId),
                eq(entityRecords.deleted, false),
                eq(entityRecords.version, source.version),
              )).returning();
              if (!releasedSource) {
                throw Object.assign(new Error("The linked complaint or violation changed before release"), { status: 409 });
              }
              await auditInTransaction(
                tx,
                actor,
                `${sourceEntity}.released`,
                `Released linked assignment with update`,
                source.id,
              );
            }
          }
        }
        if (entity === "manpower-requests" && action === "dispatch") {
          const sourceEntity = String(current.state["sourceEntity"] || "");
          const sourceRecordId = String(current.state["sourceRecordId"] || "");
          const assignedStaffId = String(current.state["assignedStaffId"] || "");
          const assignedTo = String(current.state["assignedTo"] || "");
          const [source] = await tx.select().from(entityRecords).where(and(
            eq(entityRecords.id, sourceRecordId),
            eq(entityRecords.entity, sourceEntity),
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.deleted, false),
          )).limit(1);
          if (!source || !assignedStaffId) {
            throw Object.assign(new Error("The linked work record or assignment is missing"), { status: 409 });
          }
          const sourceStatus = normalizeStatus(source.state["status"]);
          const sourceRef = String(source.state["complaintNo"] || source.state["violationNumber"] ||
            source.state["violationNo"] || source.state["title"] || "The complaint or violation");
          const sourceAssignee = normalizeAssignment(source.state).assignedStaffId;
          // Already given to this same worker (e.g. assigned from the complaint
          // itself): just link the request instead of refusing.
          const alreadyWithWorker = sourceAssignee === assignedStaffId &&
            ["assigned", "in_progress", "routed", "rework", "in_house"].includes(sourceStatus);
          const sourceStatusAllowed = alreadyWithWorker ||
            (sourceEntity === "procurement" && sourceStatus === "in_house") ||
            (sourceEntity === "resident-reports" && ["submitted", "returned", "rework"].includes(sourceStatus) &&
              (!sourceAssignee || sourceAssignee === assignedStaffId)) ||
            (sourceEntity === "building-violations" && sourceStatus === "approved") ||
            // The dispatching supervisor holds it themselves: hand it to the crew.
            (sourceAssignee === actor.id && ["assigned", "routed"].includes(sourceStatus));
          if (!sourceStatusAllowed) {
            const done = ["done", "resolved", "work_approved", "completed", "closed", "in_house_completed"].includes(sourceStatus);
            const holder = String(source.state["assignedStaffName"] || source.state["assignedTo"] || "someone else");
            throw Object.assign(
              new Error(done
                ? `${sourceRef} is already completed, so it can't be dispatched again.`
                : sourceAssignee
                  ? `${sourceRef} is already assigned to ${holder}. They need to release it first, or assign this request to ${holder}.`
                  : `${sourceRef} is ${sourceStatus.replace(/_/g, " ") || "not ready"} and can't be dispatched right now.`),
              { status: 409 },
            );
          }
          const sourceState = {
            ...source.state,
            assignedStaffId,
            assignedTo,
            dispatchingSupervisorId: actor.id,
            dispatchingSupervisorName: actor.name,
            status: alreadyWithWorker
              ? source.state["status"]
              : sourceEntity === "procurement"
                ? "in_house"
                : sourceEntity === "building-violations" ? "routed" : "assigned",
            dispatchedAt: now.toISOString(),
            manpowerRequestId: current.id,
          };
          const [dispatchedSource] = await tx.update(entityRecords).set({
            state: sourceState,
            version: sql`${entityRecords.version} + 1`,
            updatedAt: now,
          }).where(and(
            eq(entityRecords.id, source.id),
            eq(entityRecords.entity, source.entity),
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.deleted, false),
            eq(entityRecords.version, source.version),
          )).returning();
          if (!dispatchedSource) {
            throw Object.assign(new Error("The linked work record changed before dispatch"), { status: 409 });
          }
          await auditInTransaction(
            tx,
            actor,
            `${sourceEntity}.dispatched`,
            `Dispatched through manpower request`,
            source.id,
          );
        }
        if (entity === "procurement" && action === "handoff-inhouse") {
          const requestedTrade = String(body["requestedTrade"] || "");
          const receiverSupervisorId = String(body["receiverSupervisorId"] || "");
          const requestId = `manpower-request:${current.id}`;
          const requestState: Record<string, unknown> = {
            sourceEntity: "procurement",
            sourceRecordId: current.id,
            assignmentMode: "in_house",
            requestedTrade,
            receiverSupervisorId,
            receiverSupervisorName: inHouseReceiver?.name || "",
            requestedByStaffId: actor.id,
            requestedByName: actor.name,
            status: "pending",
            ...(current.state["address"] !== undefined ? { address: current.state["address"] } : {}),
            ...(current.state["scope"] !== undefined ? { scope: current.state["scope"] } : {}),
            ...(current.state["fileRefs"] !== undefined ? { fileRefs: current.state["fileRefs"] } : {}),
            ...(current.state["scopeDescription"] !== undefined ? { scopeDescription: current.state["scopeDescription"] } : {}),
            ...(current.state["files"] !== undefined ? { files: current.state["files"] } : {}),
          };
          await tx.insert(entityRecords).values({
            id: requestId,
            tenantId: actor.tenantId,
            entity: "manpower-requests",
            projectId: current.projectId,
            development: current.development,
            state: requestState,
            createdBy: actor.id,
            createdAt: now,
            updatedAt: now,
          });
          await auditInTransaction(tx, actor, "manpower-requests.created", "Created in-house manpower request", requestId);
        }
        if (entity === "building-violations" && action === "handoff-cpm-supervisor") {
          await auditInTransaction(
            tx,
            actor,
            "building-violations.handoff-cpm-supervisor",
            "Handed building violation to CPM Supervisor",
            current.id,
          );
        }
        if (entity === "building-violations" && action === "assign-cpm") {
          const receiver = cpmStaffReceiver;
          if (!receiver) {
            throw Object.assign(new Error("The receiving CPM is no longer available"), { status: 409 });
          }
          const source = current.state;
          const code = String(source["violationCode"] ?? source["code"] ?? "").trim();
          const number = String(source["violationNumber"] ?? source["number"] ?? "").trim();
          const notes = String(source["notes"] ?? source["note"] ?? source["description"] ?? "").trim();
          const scope = [code, number, notes].filter(Boolean).join(" - ") ||
            "Building violation scope";
          const requestedTradeValue = [
            source["requestedTrade"],
            source["trade"],
            source["tradeType"],
          ].find((value): value is string => typeof value === "string" && Boolean(value.trim()));
          const reviewState: Record<string, unknown> = {
            status: "draft",
            sourceEntity: "building-violations",
            sourceRecordId: current.id,
            sourceHandoff: "supervisor-inspector-to-cpm-supervisor",
            scope,
            scopeDescription: scope,
            ...(requestedTradeValue ? { requestedTrade: requestedTradeValue.trim() } : {}),
            ...(source["address"] !== undefined ? { address: source["address"] } : {}),
            ...(source["evidence"] !== undefined ? { evidence: source["evidence"] } : {}),
            ...(source["photoEvidence"] !== undefined ? { photoEvidence: source["photoEvidence"] } : {}),
            ...(source["fileRefs"] !== undefined ? { fileRefs: source["fileRefs"] } : {}),
            ...(source["files"] !== undefined ? { files: source["files"] } : {}),
            handoffTargetId: String(current.state["cpmSupervisorId"] || ""),
            handoffTargetName: String(current.state["cpmSupervisorName"] || ""),
            requestedBy: receiver.name,
            requestedByName: receiver.name,
          };
          const violationRef = scopeSourceRef("building-violations", current.state);
          Object.assign(reviewState, violationRef.fields, {
            sourceRef: violationRef.label,
            sourceTitle: violationRef.title,
            title: [violationRef.label, source["address"]].filter(Boolean).join(" · "),
          });
          await tx.insert(entityRecords).values({
            id: `violation-scope:${current.id}`,
            tenantId: actor.tenantId,
            entity: "procurement",
            projectId: current.projectId,
            development: current.development,
            state: reviewState,
            createdBy: receiver.id,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing();
          await auditInTransaction(tx, actor, "procurement.created", "Created CPM procurement draft", `violation-scope:${current.id}`);
        }
        if (entity === "manpower-requests" && action === "complete" &&
            current.state["assignmentMode"] === "in_house") {
          const sourceRecordId = String(current.state["sourceRecordId"] || "");
          const [source] = await tx.select().from(entityRecords).where(and(
            eq(entityRecords.id, sourceRecordId),
            eq(entityRecords.entity, "procurement"),
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.deleted, false),
          )).limit(1);
          if (!source || normalizeStatus(source.state["status"]) !== "in_house") {
            throw Object.assign(new Error("The linked procurement scope is no longer in-house"), { status: 409 });
          }
          const completedSource = {
            ...source.state,
            status: "in_house_completed",
            completedAt: now.toISOString(),
            manpowerRequestId: current.id,
          };
          const [savedSource] = await tx.update(entityRecords).set({
            state: completedSource,
            version: sql`${entityRecords.version} + 1`,
            updatedAt: now,
          }).where(and(
            eq(entityRecords.id, source.id),
            eq(entityRecords.version, source.version),
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.deleted, false),
          )).returning();
          if (!savedSource) throw Object.assign(new Error("The linked procurement scope changed before completion"), { status: 409 });
        }
        if (
          entity === "hr-exits" &&
          (action === "approve-termination" || action === "approve-layoff")
        ) {
          const employeeStaffId = typeof current.state["employeeStaffId"] === "string"
            ? current.state["employeeStaffId"].trim()
            : "";
          if (!employeeStaffId || employeeStaffId === actor.id) {
            throw Object.assign(new Error("The departure employee linkage is invalid"), { status: 409 });
          }
          const [deactivated] = await tx
            .update(staffAccounts)
            .set({
              status: "revoked",
              sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
              updatedAt: now,
            })
            .where(and(
              eq(staffAccounts.id, employeeStaffId),
              eq(staffAccounts.tenantId, actor.tenantId),
              eq(staffAccounts.status, "approved"),
            ))
            .returning();
          if (deactivated) {
            await auditInTransaction(
              tx,
              actor,
              "staff.revoked",
              `Revoked ${deactivated.name} after ${action}`,
              deactivated.id,
            );
          } else {
            const [alreadyRevoked] = await tx
              .select()
              .from(staffAccounts)
              .where(and(
                eq(staffAccounts.id, employeeStaffId),
                eq(staffAccounts.tenantId, actor.tenantId),
                eq(staffAccounts.status, "revoked"),
              ))
              .limit(1);
            if (!alreadyRevoked) {
              throw Object.assign(new Error("The departure employee linkage is invalid"), { status: 409 });
            }
          }
        }
        if (sensitiveApproval) {
          const consumedState = {
            ...sensitiveApproval.state,
            status: "consumed",
            consumedAt: now.toISOString(),
            consumedBy: actor.id,
          };
          const [consumed] = await tx
            .update(entityRecords)
            .set({
              state: consumedState,
              version: sql`${entityRecords.version} + 1`,
              updatedAt: now,
            })
            .where(and(
              eq(entityRecords.id, sensitiveApproval.id),
              eq(entityRecords.tenantId, actor.tenantId),
              eq(entityRecords.entity, "hr-approvals"),
              eq(entityRecords.deleted, false),
              eq(entityRecords.version, sensitiveApproval.version),
              sql`lower(${entityRecords.state}->>'status') = 'approved'`,
            ))
            .returning();
          if (!consumed) {
            throw Object.assign(new Error("Company approval was already consumed"), { status: 409 });
          }
          await auditInTransaction(
            tx,
            actor,
            `${entity}.${action}`,
            `${action} ${entity} record`,
            current.id,
          );
          auditCommittedInTransition = true;
        }
        if (isHrEntity(entity) && !auditCommittedInTransition) {
          await auditInTransaction(
            tx,
            actor,
            `${entity}.${action}`,
            `${action} ${entity} record`,
            current.id,
          );
          auditCommittedInTransition = true;
        }
        if (entity === "procurement" && !["bidding", "eligible", "eligible-awarded", "awarded"].includes(String(state["status"]))) {
          await tx.delete(publicAccessCodes).where(and(
            eq(publicAccessCodes.kind, "vendor"),
            eq(publicAccessCodes.recordId, current.id),
            eq(publicAccessCodes.tenantId, actor.tenantId),
          ));
        }
        return row;
      });
    } catch (error: any) {
      if (error?.status === 409) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error?.code === "23505" && attempt + 1 < transitionAttempts) continue;
      if (error?.code === "23505" && entity === "procurement" && action === "broadcast") {
        res.status(503).json({ error: "Could not issue a vendor access code" });
        return;
      }
      if (error?.code === "23505" && entity === "procurement" && action === "handoff-inhouse") {
        res.status(409).json({ error: "This procurement scope already has an in-house manpower request" });
        return;
      }
      throw error;
    }
  }
  if (!updated) {
    res.status(503).json({ error: "Could not complete workflow transition" });
    return;
  }
  if (!auditCommittedInTransition) {
    await audit(
      actor,
      `${entity}.${action}`,
      `${action} ${entity} record`,
      current.id,
    );
  }
  // Once the CPM Supervisor has acted on a scope, the "waiting for your
  // review" alert is done — take it out of the inbox.
  if (entity === "procurement" && ["approve", "reject", "return", "handoff-inhouse"].includes(action)) {
    await db.delete(notifications).where(and(
      eq(notifications.tenantId, actor.tenantId),
      eq(notifications.reportId, current.id),
      eq(notifications.message, "Scope submitted for CPM Supervisor review"),
    )).catch(() => undefined);
  }
  if (entity === "procurement" && action === "award") {
    // The winner hears about it by email (contact on file) as well as on
    // their vendor page / app, which now show "Awarded to you" + Start work.
    let award: { sent: boolean; email?: string; reason?: string; error?: string } = { sent: false };
    try {
      award = await emailAwardedVendor(actor.tenantId, state);
      logger.info({ procurementId: current.id, ...award }, "Vendor award email processed");
    } catch (err) {
      award = { sent: false, error: "Email service unavailable" };
      logger.error({ err, procurementId: current.id }, "Vendor award email failed");
    }
    try {
      await db.update(entityRecords)
        .set({ state: sql`${entityRecords.state} || ${JSON.stringify({ awardEmail: { ...award, at: new Date().toISOString() } })}::jsonb` })
        .where(and(eq(entityRecords.id, current.id), eq(entityRecords.tenantId, actor.tenantId)));
    } catch (err) {
      logger.warn({ err, procurementId: current.id }, "Could not record award email report");
    }
  }
  if (entity === "procurement" && (action === "broadcast" || action === "resend")) {
    // Release emails every vendor contact plus any addresses typed in; a
    // resend with addresses goes only to those, otherwise to every contact.
    const includeContacts = action === "broadcast" || vendorRecipients.length === 0;
    let delivery: { sent: number; failed: number; recipients: number; error?: string } =
      { sent: 0, failed: 0, recipients: 0 };
    try {
      delivery = await emailReleasedScope(actor.tenantId, state, vendorRecipients, includeContacts);
      logger.info({ procurementId: current.id, ...delivery }, "Vendor scope emails processed");
    } catch (err) {
      delivery = { ...delivery, error: "Email service unavailable" };
      logger.error({ err, procurementId: current.id }, "Vendor scope email delivery failed");
    }
    // Delivery report for Procurement (merged without a version bump).
    const report = { ...delivery, action, at: new Date().toISOString() };
    try {
      await db.update(entityRecords)
        .set({ state: sql`${entityRecords.state} || ${JSON.stringify({ vendorEmail: report })}::jsonb` })
        .where(and(eq(entityRecords.id, current.id), eq(entityRecords.tenantId, actor.tenantId)));
    } catch (err) {
      logger.error({ err, procurementId: current.id }, "Could not record vendor email delivery");
    }
  }
  let target = "";
  if (entity === "leave-requests") {
    target = typeof current.state["employeeStaffId"] === "string"
      ? current.state["employeeStaffId"]
      : "";
    if (!target) {
      const employeeName = typeof current.state["employee"] === "string"
        ? current.state["employee"].trim()
        : "";
      const employeeMatches = employeeName
        ? await db.select({ id: staffAccounts.id })
          .from(staffAccounts)
          .where(and(
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.status, "approved"),
            sql`lower(${staffAccounts.name}) = lower(${employeeName})`,
          ))
          .limit(2)
        : [];
      target = employeeMatches.length === 1
        ? employeeMatches[0]!.id
        : String(current.state["requesterStaffId"] ?? current.createdBy ?? "");
    }
  } else if (
    (entity === "resident-reports" && action === "assign") ||
    (entity === "manpower-requests" && ["assign", "dispatch"].includes(action))
  ) {
    target = typeof state["assignedStaffId"] === "string"
      ? state["assignedStaffId"]
      : "";
  } else if (
    action === "release" &&
    ["resident-reports", "building-violations", "manpower-requests"].includes(entity)
  ) {
    target = supervisorTargetForReleasedWork(current.state);
    if (!target && entity !== "manpower-requests") {
      const manpowerRequestId = String(current.state["manpowerRequestId"] || "");
      if (manpowerRequestId) {
        const [request] = await db.select({ state: entityRecords.state })
          .from(entityRecords)
          .where(and(
            eq(entityRecords.id, manpowerRequestId),
            eq(entityRecords.entity, "manpower-requests"),
            eq(entityRecords.tenantId, actor.tenantId),
          ))
          .limit(1);
        if (request) target = supervisorTargetForReleasedWork(request.state);
      }
    }
  } else if (entity === "resident-reports" && action === "reject-work") {
    target = String(current.state["assignedStaffId"] || current.state["completedByStaffId"] || "");
  } else if (entity === "hud-inspections") {
    target = String(current.createdBy ?? "");
  } else if (isHrEntity(entity)) {
    target = "human_resources";
  } else if (entity === "procurement") {
    // Every procurement notification follows the canonical workflow.  Never
    // honor a client supplied target.
    if (action === "submit") target = "management";
    else if (action === "approve") target = "procurement";
    else if (action === "reject" || action === "return") {
      target = typeof current.state["cpmName"] === "string"
        ? current.state["cpmName"]
        : typeof current.state["inspectorName"] === "string"
          ? current.state["inspectorName"]
          : "management";
    }
  } else if (entity === "building-violations" && action === "deny") {
    target = String(current.createdBy || "");
  } else if (entity === "building-violations" && action === "handoff-cpm-supervisor") {
    target = String(state["cpmSupervisorId"] || "");
  } else if (entity === "building-violations" && action === "assign-cpm") {
    target = String(state["assignedCpmStaffId"] || "");
  } else {
    target = "management";
  }
  if (
    action === "complete" &&
    (entity === "resident-reports" || entity === "building-violations")
  ) {
    const development = String(state["development"] || current.development || "").trim();
    const photoReady = (
      (Array.isArray(state["remoteFiles"]) && state["remoteFiles"].some((file) =>
        file && typeof file === "object" && file["kind"] === "completion-photo" && typeof file["objectPath"] === "string",
      )) ||
      (Array.isArray(state["photoEvidence"]) && state["photoEvidence"].some((file) =>
        file && typeof file === "object" && typeof file["objectPath"] === "string",
      ))
    );
    const completionDetail = [
      String(state["complaintNo"] || state["violationNo"] || entity.replaceAll("-", " ")),
      String(state["address"] || state["building"] || development),
      photoReady ? "Repair photo ready for review" : "Repair completed for review",
    ].filter(Boolean).join(" · ");
    let recipients: string[] = await routedComplaintRecipientIds(actor.tenantId, development, { ...current.state, ...state }, entity === "building-violations");
    // The supervisor who assigned the complaint (e.g. an office-based CPM
    // Supervisor with no base development) must get the completed work back.
    const assignedBy = String(state["assignedByStaffId"] || current.state["assignedByStaffId"] || "");
    if (entity === "resident-reports" && assignedBy) {
      const [assigner] = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
        eq(staffAccounts.tenantId, actor.tenantId),
        eq(staffAccounts.status, "approved"),
        eq(staffAccounts.id, assignedBy),
      )).limit(1);
      if (assigner) recipients = [...recipients, assigner.id];
    }
    if (entity === "building-violations") {
      const candidateIds = [
        String(state["dispatchingSupervisorId"] || ""),
        String(state["receiverSupervisorId"] || ""),
        String(state["cpmSupervisorId"] || ""),
      ].filter(Boolean);
      const validCandidates = candidateIds.length
        ? await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
            eq(staffAccounts.tenantId, actor.tenantId),
            eq(staffAccounts.status, "approved"),
            inArray(staffAccounts.id, candidateIds),
          ))
        : [];
      recipients = [...new Set([...recipients, ...validCandidates.map((row) => row.id)])];
    }
    const uniqueRecipients = [...new Set(recipients)].filter((recipient) => recipient !== actor.id);
    if (uniqueRecipients.length) {
      for (const recipient of uniqueRecipients) {
        await notify(
          actor,
          recipient,
          entity === "building-violations"
            ? `Violation repair completed — ${photoReady ? "photo ready for review" : "ready for review"}`
            : `Complaint repair completed — ${photoReady ? "photo ready for review" : "ready for review"}`,
          completionDetail,
          current.id,
        );
      }
    }
  } else if (target) {
    // Every scope notification names the complaint/violation it came from.
    const scopeDetail = entity === "procurement"
      ? [
          [state["sourceRef"], state["address"]].filter(Boolean).join(" · "),
          reviewNote ? `Note: ${reviewNote}` : "",
        ].filter(Boolean).join(" — ") || undefined
      : undefined;
    if (entity === "procurement" && action === "submit") {
      const targetedSupervisorId = typeof current.state["handoffTargetId"] === "string"
        ? current.state["handoffTargetId"] : "";
      if (targetedSupervisorId) {
        await notify(actor, targetedSupervisorId, "Scope submitted for CPM Supervisor review", scopeDetail, current.id);
      } else {
        const reviewers = await db.select({
          id: staffAccounts.id,
          position: staffAccounts.position,
          developments: staffAccounts.developments,
        })
        .from(staffAccounts)
        .where(and(
          eq(staffAccounts.tenantId, actor.tenantId),
          eq(staffAccounts.role, "management"),
          eq(staffAccounts.status, "approved"),
        ));
        for (const reviewer of reviewers) {
          // Scope review is reserved for the exact CPM Supervisor position and
          // must remain within the supervisor's development coverage.
          const development = current.development?.trim().toLowerCase() || "";
          const covered = development &&
            reviewer.developments.some((item) => item.trim().toLowerCase() === development);
          if (!isCpmSupervisorTitle(reviewer.position) || !covered) continue;
          await notify(actor, reviewer.id, "Scope submitted for CPM Supervisor review", scopeDetail, current.id);
        }
      }
    } else if (entity === "procurement" && action === "approve") {
      // The Procurement desk: Procurement accounts plus the company "Director".
      const recipients = (await db.select({ name: staffAccounts.name, role: staffAccounts.role, position: staffAccounts.position })
        .from(staffAccounts)
        .where(and(eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.status, "approved"))))
        .filter((row) => isProcurementActor({ role: row.role, position: row.position || "" } as any));
      for (const recipient of recipients) await notify(actor, recipient.name, "Scope approved for Procurement", scopeDetail, current.id);
    } else if (entity === "procurement" && action === "handoff-inhouse") {
      await notify(
        actor,
        String(body["receiverSupervisorId"] || ""),
        "In-house procurement scope assigned",
        current.development || undefined,
        `manpower-request:${current.id}`,
      );
    } else if (entity === "building-violations" && action === "deny") {
      await notify(
        actor,
        target,
        "Inspection denied \u2014 review and log again",
        [String(state["violationNo"] || ""), String(state["building"] || ""), state["denyReason"] ? `Reason: ${state["denyReason"]}` : ""].filter(Boolean).join(" \u00b7 ") || undefined,
        current.id,
      );
    } else if (entity === "building-violations" && action === "handoff-cpm-supervisor") {
      await notify(
        actor,
        target,
        "Building violation handed off for CPM review",
        current.development || undefined,
        current.id,
      );
    } else if (entity === "building-violations" && action === "assign-cpm") {
      await notify(
        actor,
        target,
        "Building violation assigned to CPM",
        current.development || undefined,
        `violation-scope:${current.id}`,
      );
    } else if (entity === "leave-requests" && action === "send-to-hr") {
    const hrStaff = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(and(
      eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.status, "approved"), eq(staffAccounts.role, "human_resources"),
    ));
    const who = String(current.state["employee"] || "");
    for (const hr of hrStaff) await notify(actor, hr.id, "Leave request sent to HR by " + actor.name, who, current.id);
    try {
      const [org] = await db.select({ hrEmail: organizations.hrEmail }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
      const days = leaveRequestDurationDays(current.state) ?? 0;
      if (org?.hrEmail) await emailHrLeaveRequest({
        hrEmail: org.hrEmail, employee: who, title: String(current.state["title"] || ""), development: current.development || undefined,
        startAt: String(current.state["startAt"] || current.state["startDate"] || ""), endAt: String(current.state["endAt"] || current.state["endDate"] || ""),
        days, reason: String(current.state["reason"] || ""), sentBy: `${actor.name} (${actor.position})`, note: String(state["sentToHrNote"] || ""),
      });
    } catch (err) {
      logger.warn({ err, leaveId: current.id }, "HR leave email (send to HR) failed");
    }
  } else if (entity === "procurement" && (action === "reject" || action === "return")) {
      const [origin] = await db.select({ id: staffAccounts.id, position: staffAccounts.position })
        .from(staffAccounts)
        .where(and(eq(staffAccounts.tenantId, actor.tenantId), eq(staffAccounts.id, current.createdBy || "")))
        .limit(1);
      if (origin && sameTitle(origin.position, "CPM")) {
        await notify(actor, origin.id, nextStatus === "returned" ? "Scope returned — correct and resubmit" : `Scope ${nextStatus}`, scopeDetail, current.id);
      }
      // Returned by Procurement: the reviewing CPM Supervisor is told too.
      const reviewer = String(current.state["handoffTargetId"] || "");
      if (isProcurementActor(actor) && reviewer) {
        await notify(actor, reviewer, "Procurement returned a scope for revision", scopeDetail, current.id);
      }
    } else if (
      (entity === "resident-reports" && action === "assign") ||
      (entity === "manpower-requests" && action === "dispatch")
    ) {
      const detail = [
        typeof state["complaintNo"] === "string" ? state["complaintNo"] : "",
        typeof state["address"] === "string" ? state["address"] : "",
        typeof state["unit"] === "string" && state["unit"]
          ? `Unit ${state["unit"]}`
          : "",
        typeof state["development"] === "string" ? state["development"] : "",
      ].filter(Boolean).join(" · ");
      await notify(actor, target, "New job assigned", detail || undefined, current.id);
    } else if (entity === "resident-reports" && action === "reject-work") {
      const ref = [
        typeof state["complaintNo"] === "string" ? state["complaintNo"] : "",
        typeof state["address"] === "string" ? state["address"] : "",
      ].filter(Boolean).join(" · ");
      await notify(
        actor,
        target,
        "Work sent back — redo required",
        [ref, reviewNote].filter(Boolean).join(" — ") || undefined,
        current.id,
      );
    } else if (
      action === "release" &&
      ["resident-reports", "building-violations", "manpower-requests"].includes(entity)
    ) {
      await notify(
        actor,
        target,
        "Assignment released",
        releaseUpdate || undefined,
        current.id,
      );
    } else if (entity === "resident-reports" && target === "management") {
      // Complaint status alerts follow the keyword routing (on-site, emergency
      // and matching trade supervisors) plus whoever assigned it — not every
      // manager in the company.
      const development = String(state["development"] || current.development || "").trim();
      const routed = await routedComplaintRecipientIds(actor.tenantId, development, { ...current.state, ...state });
      const assignedBy = String(state["assignedByStaffId"] || current.state["assignedByStaffId"] || "");
      const recipients = [...new Set([...routed, ...(assignedBy ? [assignedBy] : [])])]
        .filter((recipient) => recipient !== actor.id);
      for (const recipient of recipients) {
        await notify(actor, recipient, `${entity.replaceAll("-", " ")} ${nextStatus}`, undefined, current.id);
      }
    } else if (entity === "building-violations") {
      // Inspection status alerts (approved / routed / cleared ...) open the
      // inspection itself, not a complaint: say so and carry its reference.
      const ref = [String(state["violationNo"] || current.state["violationNo"] || ""), String(state["building"] || current.state["building"] || "")]
        .filter(Boolean).join(" \u00b7 ");
      await notify(actor, target, `Inspection ${nextStatus.replaceAll("_", " ")}`, ref || undefined, current.id);
    } else {
      await notify(actor, target, `${entity.replaceAll("-", " ")} ${nextStatus}`, undefined, current.id);
    }
  }
  res.json(outward(actor, updated!));
  },
);

// Every live record that points at `root` — by id (sourceReportId,
// sourceRecordId, violationId, inspectionId, reportId …) or by its complaint /
// violation / tracking number — is soft-deleted, recursively, with its alerts.
const LEAVE_UPPER_MANAGEMENT_TITLES = new Set(["Regional Director", "Assistant Regional Director"]);
const CASCADE_ENTITIES = new Set([
  "route-assignments", "building-violations", "violations", "priority-violations", "inspections",
  "hud-inspections", "procurement", "procurement-bids", "vendor-quotes", "change-orders",
  "manpower-requests", "project-notes", "project-reviews", "elevator-jobs", "emergency-jobs",
]);
async function cascadeDelete(tenantId: string, root: typeof entityRecords.$inferSelect): Promise<string[]> {
  const removed: string[] = [];
  const queue: Array<typeof entityRecords.$inferSelect> = [root];
  const seen = new Set<string>([root.id]);
  while (queue.length && removed.length < 500) {
    const node = queue.shift()!;
    const tokens = [node.id,
      String(node.state["complaintNo"] || ""), String(node.state["violationNo"] || ""),
      String(node.state["trackingId"] || ""), String(node.state["sourceRef"] || "")]
      .map((t) => t.trim()).filter((t) => t.length >= 6);
    if (!tokens.length) continue;
    const pattern = tokens.map((t) => t.replace(/[%_\\]/g, (c) => "\\" + c));
    const hits = await db.select().from(entityRecords).where(and(
      eq(entityRecords.tenantId, tenantId),
      eq(entityRecords.deleted, false),
      inArray(entityRecords.entity, [...CASCADE_ENTITIES]),
      or(...pattern.map((p) => sql`${entityRecords.state}::text ILIKE ${"%" + p + "%"}`)),
    ));
    for (const hit of hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      // Only records that came OUT of the node: a number that merely appears in
      // free text still counts, which is what "deleted is deleted" asks for.
      await db.update(entityRecords)
        .set({ deleted: true, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() })
        .where(and(eq(entityRecords.id, hit.id), eq(entityRecords.tenantId, tenantId), eq(entityRecords.deleted, false)));
      await db.delete(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.reportId, hit.id)));
      removed.push(hit.id);
      queue.push(hit);
    }
  }
  return removed;
}

router.delete("/v1/:entity/:id", async (req, res, next) => {
  const entity = req.params["entity"];
  if (!validEntity(entity)) {
    next();
    return;
  }
  const actor = actorFrom(res);
  if (isHrEntity(entity) && actor.role !== "administrator") {
    res.status(403).json({ error: "HR lifecycle and approval records are retained and cannot be deleted" });
    return;
  }
  // Procurement keeps its own vendor email list (add / edit / remove).
  const vendorListEdit = entity === "vendor-contacts" && isProcurementActor(actor);
  const [organization] = await db
    .select({ features: organizations.features })
    .from(organizations)
    .where(eq(organizations.id, actor.tenantId))
    .limit(1);
  // The Community Coordinator Supervisor keeps their unit's records tidy.
  const communityDelete = isCommunityEntity(entity) && isCommunityCoordinatorSupervisor(actor);
  if (isCommunityEntity(entity) && !communityDelete) {
    res.status(403).json({ error: "Only the Community Coordinator Supervisor can delete this" });
    return;
  }
  if (!vendorListEdit && !communityDelete && organization?.features?.["deletionEnabled"] !== true) {
    res.status(403).json({ error: "Deletion is disabled for this organization" });
    return;
  }
  const ownWorkDelete = !vendorListEdit && actor.role === "management" && !isDeleteOverrideManager(actor);
  // HR fixing its own mistake: a leave request for the wrong person.
  // Leave requests are HR's alone to delete — not management, not an
  // administrator.
  const hrLeaveDelete = canHrDeleteLeave(actor, entity);
  if (entity === "leave-requests" && !hrLeaveDelete) {
    res.status(403).json({ error: "Only HR can delete a leave request" });
    return;
  }
  if (!vendorListEdit && !communityDelete && !canDeleteOperationalRecords(actor) && !ownWorkDelete && !hrLeaveDelete) {
    res.status(403).json({ error: "Only higher management can delete records" });
    return;
  }
  // Upper management (three digits) and HR (two digits) delete with a
  // one-time override code (website only).
  let overrideCode = "";
  if (!vendorListEdit && ((actor.role === "management" && !ownWorkDelete) || hrLeaveDelete)) {
    const supplied = (req.body as { overrideCode?: unknown })?.overrideCode;
    if (!consumeDeleteOverride(actor.id, supplied)) {
      res.status(403).json({ error: "Enter your delete override code (request a new one if it expired)" });
      return;
    }
    overrideCode = String(supplied).trim();
  }
  const [current] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.id, req.params["id"]!),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
      ),
    )
    .limit(1);

  if (!current) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (actor.role !== "administrator" &&
      entity === "hr-approvals" &&
      ["approved", "consumed"].includes(normalizeStatus(current.state["status"]))) {
    res.status(409).json({ error: "Approved company approval evidence is immutable" });
    return;
  }
  if (ownWorkDelete) {
    // A supervisor / manager removes work that is theirs: created by them, or
    // sent to / handled by them. A copy stays in the Deleted items box.
    const st = current.state as Record<string, unknown>;
    const mine = [current.createdBy, st["assignedStaffId"], st["handoffTargetId"], st["cpmSupervisorId"], st["assignedByStaffId"], st["targetStaffId"], st["requesterStaffId"]]
      .map((v) => String(v || "")).includes(actor.id);
    if (!mine || isHrEntity(entity)) {
      res.status(403).json({ error: "You can delete only your own work. Upper management deletes anyone's with an override code." });
      return;
    }
  } else if (!(await canReadRecordForActor(actor, current)) ||
      !(vendorListEdit || canDeleteEntity(actor, entity, current.state))) {
    res.status(403).json({ error: "Not allowed to delete this record" });
    return;
  }
  if (actor.role !== "administrator" &&
      entity === "procurement" &&
      actor.role === "inspector" && actor.position === "CPM" &&
      !["draft", "returned"].includes(String(current.state["status"] ?? ""))) {
    res.status(403).json({ error: "Submitted procurement scopes cannot be deleted" });
    return;
  }
  if (actor.role !== "administrator" &&
      entity === "procurement" && current.state["status"] === "closed") {
    res.status(409).json({ error: "Closed procurement records are immutable" });
    return;
  }
  const expectedVersion = (req.body as { version?: unknown })?.version;
  if (typeof expectedVersion !== "number") {
    res.status(400).json({ error: "version is required" });
    return;
  }
  if (expectedVersion !== current.version) {
    res.status(409).json({ error: "Concurrent update detected", current: outward(actor, current) });
    return;
  }
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(entityRecords)
      .set({
        deleted: true,
        version: sql`${entityRecords.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(entityRecords.id, current.id),
        eq(entityRecords.entity, entity),
        eq(entityRecords.tenantId, actor.tenantId),
        eq(entityRecords.deleted, false),
        eq(entityRecords.version, expectedVersion),
      ))
      .returning();
    if (row && entity === "resident-reports") {
      await tx
        .delete(notifications)
        .where(and(
          eq(notifications.tenantId, actor.tenantId),
          eq(notifications.reportId, current.id),
        ));
    }
    return row;
  });
  if (!deleted) {
    res.status(409).json({ error: "Concurrent update detected" });
    return;
  }
  const label = deletionLabel(entity, current);
  await audit(actor, `${entity}.deleted`, overrideCode
    ? `Deleted by ${actor.name} (${actor.position}) with override code ${overrideCode}: ${label}`
    : `Deleted ${entity} record: ${label}`, current.id);
  // Keep who deleted it on the record itself (soft-deleted rows stay in the table).
  try {
    await db.update(entityRecords)
      .set({ state: sql`${entityRecords.state} || ${JSON.stringify({ deletedById: actor.id, deletedByName: actor.name, deletedByPosition: actor.position, deletedAt: new Date().toISOString(), ...(overrideCode ? { deleteOverrideCode: overrideCode } : {}) })}::jsonb` })
      .where(and(eq(entityRecords.id, current.id), eq(entityRecords.tenantId, actor.tenantId)));
  } catch (err) {
    logger.warn({ err, recordId: current.id }, "Could not stamp deletion on record");
  }
  // The supervisor / person who had the record is told who deleted it.
  if (overrideCode) {
    for (const watcher of deletionWatchers(current)) {
      if (watcher === actor.id) continue;
      await notify(actor, watcher, `Deleted by ${actor.name} (${actor.position}) — override code ${overrideCode}`, label);
    }
  }
  // Deleted means gone everywhere: the work that came out of this record (a
  // violation sent to an inspector, the inspection, the route assignment, the
  // scope, the trade request, change orders) goes with it, along with their
  // alerts, so nothing lingers in inboxes or on the scores.
  if ((actor.role === "administrator" || overrideCode || ownWorkDelete || hrLeaveDelete) && !isHrEntity(entity) && entity !== "vendor-contacts") {
    try {
      const cascaded = await cascadeDelete(actor.tenantId, current);
      if (cascaded.length) await audit(actor, `${entity}.deleted.cascade`, `Also removed ${cascaded.length} linked record(s)`, current.id);
    } catch (err) {
      logger.warn({ err, recordId: current.id }, "Cascade delete failed");
    }
  }
  res.status(204).send();
});

export default router;
