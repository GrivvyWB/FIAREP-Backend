import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, sql, gt, isNull } from "drizzle-orm";
import {
  db,
  auditLog,
  entityRecords,
  notifications,
  nychaAddresses,
  nychaDevelopments,
  organizationProperties,
  organizations,
  publicAccessCodes,
  residentReportPhotos,
  residentPhotoUploadGrants,
  vendorWalkthroughCheckIns,
} from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { evaluateLicense, licenseAllows } from "../lib/auth";
import { fileStorage } from "../lib/fileStorage";
import { isBoroughDirector, isCoverageEligible } from "../lib/domain";
import { deliverPushNotification } from "../lib/push";
import { routedComplaintRecipientIds, tradesForComplaint } from "../lib/complaintRouting";
import { classifyResidentPhotoAndSave } from "../lib/residentPhotoAutoClassify";
import { rateLimit } from "../lib/rateLimit";
import { distanceMeters, geocodeNycPoint, lookupNychaResidentialAddress } from "../lib/nycProperty";
import { UpdateResidentReportPhotoBody } from "@workspace/api-zod";
import { audit } from "../lib/audit";
import { verifyVendorChangeOrder, type PhotoStamp } from "../lib/vendorChangeOrderVerification";

const router: IRouter = Router();
router.use("/v1/public", rateLimit("public-access", 60));
const normalize = (value: unknown) =>
  String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const code = () => `RC-${randomBytes(4).readUInt32BE(0) % 90000 + 10000}`;
const token = () => randomBytes(32).toString("base64url");
const VENDOR_VISIBLE_STATUSES = new Set(["bidding", "eligible", "eligible-awarded", "awarded"]);

// What a vendor may see of a released scope: the job, its reference and
// violation code, the walk-through, and the CPM's scope lines WITHOUT prices.
// Never the CPM's prices, internal notes, reviewers, or other vendors' data.
const VENDOR_FIELDS = [
  "trackingId", "status", "address", "scope", "scopeDescription", "scopeFileName",
  "walkthroughAt", "walkthroughNote", "bidCloseAt",
  "sourceRef", "complaintNo", "violationNo", "violationCode", "violationCodeDesc", "hazardClass",
  "vendorScopeTemplate",
] as const;
function vendorRecord(row: typeof entityRecords.$inferSelect, vendorName: string) {
  const state: Record<string, unknown> = {};
  for (const key of VENDOR_FIELDS) if (row.state[key] !== undefined) state[key] = row.state[key];
  const mine = normalize(row.state["vendor"]) === normalize(vendorName);
  if (mine) {
    for (const key of ["vendor", "startedAt", "completedAt", "vendorNote", "vendorStartedAt", "vendorCompletedAt"]) {
      if (row.state[key] !== undefined) state[key] = row.state[key];
    }
  }
  // The CPM's Nature of Work and elevator lines, without the CPM's prices,
  // so the vendor prices each line; and whether a scope file can be opened.
  const est = row.state["cpmEstimate"] as { categories?: Array<Record<string, unknown>> } | undefined;
  if (Array.isArray(est?.categories) && est!.categories.length) {
    state["vendorEstimate"] = est!.categories.map((c) => ({
      title: String(c["title"] ?? ""), location: String(c["location"] ?? ""), description: String(c["description"] ?? ""),
    }));
  }
  const elev = row.state["cpmElevator"] as { header?: Record<string, unknown>; items?: Array<Record<string, unknown>> } | undefined;
  if (Array.isArray(elev?.items) && elev!.items.length) {
    state["vendorElevator"] = {
      header: { elevatorId: String(elev!.header?.["elevatorId"] ?? ""), location: String(elev!.header?.["location"] ?? "") },
      items: elev!.items.map((it) => ({
        section: String(it["section"] ?? ""), label: String(it["label"] ?? ""),
        condition: String(it["condition"] ?? ""), note: String(it["note"] ?? ""),
      })),
    };
  }
  const file = row.state["scopeFileRemote"] as { objectPath?: string; name?: string } | undefined;
  if (file?.objectPath) state["scopeFileAvailable"] = String(file.name || row.state["scopeFileName"] || "Scope file");
  const checkIns = Array.isArray(row.state["walkthroughCheckIns"]) ? row.state["walkthroughCheckIns"] : [];
  state["walkthroughCheckIns"] = checkIns.filter((item) =>
    item && typeof item === "object" && normalize((item as Record<string, unknown>)["vendorName"]) === normalize(vendorName));
  return { ...record(row), state };
}

function record(row: typeof entityRecords.$inferSelect) {
  return {
    id: row.id, entity: row.entity, projectId: row.projectId,
    development: row.development, state: row.state, deleted: row.deleted,
    version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

router.post("/v1/public/resident-reports", async (req, res) => {
  const input = req.body && typeof req.body === "object" ? req.body : {};
  const rawState = input.state && typeof input.state === "object" ? input.state : {};
  const address = String(rawState.address ?? "").trim();
  const requestedDevelopment = String(rawState.development ?? "").trim();
  const normalizedAddress = normalize(address);
  const description = String(rawState.description ?? "").trim();
  const location = String(rawState.location ?? "Apartment/Unit").trim();
  const unit = String(rawState.unit ?? "").trim();
  if (!requestedDevelopment || !description || !address) {
    res.status(400).json({ error: "Development, building address, and complaint description are required" });
    return;
  }
  if (location === "Apartment/Unit" && !unit) {
    res.status(400).json({ error: "Apartment or unit is required for an apartment issue" });
    return;
  }
  const properties = address
    ? await db.select().from(organizationProperties).where(and(
      eq(organizationProperties.normalizedAddress, normalizedAddress), eq(organizationProperties.active, true),
    ))
    : [];
  const valid = [];
  for (const property of properties) {
    const org = await evaluateLicense(property.organizationId);
    if (licenseAllows(org, property.organizationId)) valid.push({ property, org });
  }
  const property = valid.length === 1 ? valid[0]!.property : null;
  const catalogMatches = !property
    ? await db.select({ address: nychaAddresses.address, development: nychaDevelopments.name })
      .from(nychaAddresses)
      .innerJoin(nychaDevelopments, eq(nychaAddresses.developmentId, nychaDevelopments.id))
      .where(and(
        eq(nychaAddresses.normalizedAddress, normalizedAddress),
        eq(nychaDevelopments.normalizedName, normalize(requestedDevelopment)),
      ))
      .limit(1)
    : [];
  const catalogAddress = catalogMatches[0] ?? null;
  let nychaAddress: Awaited<ReturnType<typeof lookupNychaResidentialAddress>> = null;
  if (!property && !catalogAddress && address) {
    try {
      nychaAddress = await lookupNychaResidentialAddress(address);
    } catch (error) {
      req.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "NYCHA address lookup failed",
      );
    }
  }
  // New public complaints must use an address returned by the property or
  // NYCHA catalog. This keeps the selected building tied to its development
  // instead of accepting arbitrary text that could route a report incorrectly.
  if (!property && !catalogAddress && !nychaAddress) {
    res.status(400).json({ error: "Select a valid building address for this development" });
    return;
  }
  const resolvedDevelopment = property?.development ?? catalogAddress?.development ?? nychaAddress?.development;
  if (resolvedDevelopment && normalize(resolvedDevelopment) !== normalize(requestedDevelopment)) {
    res.status(400).json({ error: "The selected building address does not belong to this development" });
    return;
  }
  let tenantId = property?.organizationId ?? "default";
  if (!property) {
    const customerOrganizations = await db
      .select({ id: organizations.id })
      .from(organizations);
    const licensedCustomerIds: string[] = [];
    for (const organization of customerOrganizations) {
      if (organization.id === "default") continue;
      const license = await evaluateLicense(organization.id);
      if (licenseAllows(license, organization.id)) {
        licensedCustomerIds.push(organization.id);
      }
    }
    if (licensedCustomerIds.length === 1) {
      tenantId = licensedCustomerIds[0]!;
    }
  }
  const reportAddress = property?.displayAddress ?? catalogAddress?.address ?? address;
  const reportDevelopment =
    property?.development ??
    catalogAddress?.development ??
    nychaAddress?.development ??
    requestedDevelopment;
  const now = new Date();
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID();
  let complaintNo = "";
  let residentToken = "";
  const created = await db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      complaintNo = code();
      residentToken = token();
      try {
        await tx.insert(publicAccessCodes).values({
          id: randomUUID(), kind: "resident", code: complaintNo, tenantId,
          recordId: id, tokenHash: hash(residentToken), propertyId: property?.id ?? null,
        });
        break;
      } catch (error: any) {
        if (error?.code !== "23505" || attempt === 7) throw new Error("Could not issue a complaint code");
      }
    }
    const state = {
      ...rawState, id, complaintNo, address: reportAddress, propertyId: property?.id ?? null,
      development: reportDevelopment,
      description, status: "submitted", photos: [],
      updates: [{ status: "submitted", by: "resident", at: now.toISOString() }], createdAt: now.toISOString(),
    } as Record<string, unknown>;
    state["routedTrades"] = tradesForComplaint(state);
    const [row] = await tx.insert(entityRecords).values({
      id, tenantId, entity: "resident-reports", development: reportDevelopment,
      state, createdBy: "public-resident", createdAt: now, updatedAt: now,
    }).returning();
    const recipientIds = await routedComplaintRecipientIds(tenantId, reportDevelopment, state);
    const createdNotifications = recipientIds.length
      ? await tx.insert(notifications).values(recipientIds.map((target) => ({
          id: randomUUID(),
          tenantId,
          target,
          message: "New resident report",
          detail: `${reportDevelopment} · ${complaintNo}`,
          reportId: id,
        }))).returning()
      : [];
    return { row, createdNotifications };
  }).catch(() => null);
  if (!created) { res.status(503).json({ error: "Could not issue a complaint code" }); return; }
  for (const notification of created.createdNotifications) {
    void deliverPushNotification(notification).catch(() => undefined);
  }
  res.status(201).json({ ...record(created.row!), statusToken: residentToken });
});

router.get("/v1/public/resident-reports/:complaintNo", async (req, res) => {
  const [access] = await db.select().from(publicAccessCodes).where(and(
    eq(publicAccessCodes.kind, "resident"), eq(publicAccessCodes.code, req.params.complaintNo!.toUpperCase()),
  )).limit(1);
  if (!access) {
    res.status(404).json({ error: "Report not found" }); return;
  }
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, access.recordId), eq(entityRecords.tenantId, access.tenantId),
    eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!row) { res.status(404).json({ error: "Report not found" }); return; }
  const state = row.state;
  const remoteFiles = Array.isArray(state["remoteFiles"])
    ? state["remoteFiles"].filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
    : [];
  const completionFile = [...remoteFiles].reverse().find((file) =>
    file["kind"] === "completion-photo" &&
    typeof file["objectPath"] === "string"
  );
  const completionDownload = completionFile
    ? await fileStorage.createDownload(access.tenantId, String(completionFile["objectPath"])).catch(() => null)
    : null;
  const updates = Array.isArray(state["updates"]) ? state["updates"] : [];
  const completionUpdate = [...updates].reverse().find((update: unknown) => {
    if (!update || typeof update !== "object") return false;
    const status = String((update as Record<string, unknown>)["status"] || "");
    return status === "done" || status === "resolved";
  }) as Record<string, unknown> | undefined;
  res.json({
    complaintNo: state["complaintNo"],
    status: state["status"],
    description: state["description"],
    updates,
    createdAt: state["createdAt"],
    completedAt: state["completeAt"] || state["resolveAt"] || state["completedAt"] || state["resolvedAt"],
    completionNote: state["completionNote"] || completionUpdate?.["note"],
    completionPhotoUrl: completionDownload?.downloadUrl,
    completionPhotoName: completionFile?.["name"],
  });
});

const residentPhotoTypes = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]);
const MAX_RESIDENT_PHOTO_BYTES = 10 * 1024 * 1024;
async function residentAccess(complaintNo: string, statusToken: string, address: string) {
  const [access] = await db.select().from(publicAccessCodes).where(and(
    eq(publicAccessCodes.kind, "resident"), eq(publicAccessCodes.code, complaintNo.toUpperCase()),
  )).limit(1);
  if (!access || !access.tokenHash || hash(statusToken) !== access.tokenHash) return null;
  const [row] = await db.select({ state: entityRecords.state }).from(entityRecords).where(and(
    eq(entityRecords.id, access.recordId), eq(entityRecords.tenantId, access.tenantId),
    eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false),
  )).limit(1);
  // The complaint number + secret status token already authenticate the
  // resident to this exact report. The stored address is the canonical
  // property.displayAddress, which differs from the raw address the client
  // re-sends, so matching on it wrongly rejected photo uploads. Token is enough.
  if (!row) return null;
  return { access };
}

router.post("/v1/public/resident-reports/:complaintNo/photos/upload-url", async (req, res) => {
  const body = req.body ?? {};
  const size = Number(body.size);
  const name = String(body.name ?? "").trim().slice(0, 200);
  const rawContentType = String(body.contentType ?? "").toLowerCase();
  const extContentType: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp" };
  const nameExt = name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = residentPhotoTypes.has(rawContentType) ? rawContentType : (extContentType[nameExt] ?? "image/jpeg");
  const auth = await residentAccess(req.params.complaintNo!, String(body.statusToken ?? ""), String(body.address ?? ""));
  if (!auth || !name || !Number.isInteger(size) || size <= 0 || size > MAX_RESIDENT_PHOTO_BYTES) {
    res.status(404).json({ error: "Report not found" }); return;
  }
  try {
     const result = await fileStorage.createUpload(auth.access.tenantId, `public-resident:${auth.access.recordId}`, {
      kind: "resident-report-photo", name, size, contentType,
    });
     const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
     await db.insert(residentPhotoUploadGrants).values({
       id: result.file.id, tenantId: auth.access.tenantId, reportId: auth.access.recordId,
       objectPath: result.file.objectPath, name, contentType, size, expiresAt,
     });
     res.json({ ...result, grantId: result.file.id, expiresAt });
  } catch {
    res.status(503).json({ error: "File storage is temporarily unavailable" });
  }
});

router.post("/v1/public/resident-reports/:complaintNo/photos/confirm", async (req, res) => {
  const body = req.body ?? {};
  const auth = await residentAccess(req.params.complaintNo!, String(body.statusToken ?? ""), String(body.address ?? ""));
  const grantId = typeof body.grantId === "string" ? body.grantId : "";
  const objectPath = String(body.objectPath ?? "");
  if (!auth || !grantId || objectPath.includes("..")) {
    res.status(404).json({ error: "Report not found" }); return;
  }
  const photo = await db.transaction(async (tx) => {
    const now = new Date();
    const [grant] = await tx.select().from(residentPhotoUploadGrants).where(and(
      eq(residentPhotoUploadGrants.id, grantId),
      eq(residentPhotoUploadGrants.tenantId, auth.access.tenantId),
      eq(residentPhotoUploadGrants.reportId, auth.access.recordId),
      eq(residentPhotoUploadGrants.objectPath, objectPath),
      gt(residentPhotoUploadGrants.expiresAt, now),
      isNull(residentPhotoUploadGrants.consumedAt),
    )).limit(1);
    if (!grant) return null;
    const [claimed] = await tx.update(residentPhotoUploadGrants).set({ consumedAt: now, updatedAt: now })
      .where(and(eq(residentPhotoUploadGrants.id, grant.id), isNull(residentPhotoUploadGrants.consumedAt))).returning();
    if (!claimed) return null;
    const [created] = await tx.insert(residentReportPhotos).values({
      id: randomUUID(), tenantId: grant.tenantId, reportId: grant.reportId,
      objectPath: grant.objectPath, name: grant.name, size: grant.size, contentType: grant.contentType,
    }).onConflictDoNothing().returning();
    return created ?? null;
  });
  if (!photo) { res.status(409).json({ error: "Photo confirmation is no longer available" }); return; }
  // Automatically read the photo for a violation code the moment it lands, so
  // supervisors/management see a real HPD/DOB code without pressing a button.
  // Fire-and-forget: it must never delay or break the resident's upload.
  void classifyResidentPhotoAndSave(auth.access.tenantId, photo.id);
  res.status(201).json({ id: photo.id, contentType: photo.contentType });
});

router.use("/v1/resident-report-photos", requireAuth);
function canReadReport(actor: ReturnType<typeof actorFrom>, report: typeof entityRecords.$inferSelect): boolean {
  const role = actor.role.toLowerCase();
  const isCanonicalAssignee =
    ["worker", "emergency"].includes(role) &&
    String(report.state["assignedStaffId"] || "") === actor.id;
  if (isCanonicalAssignee) return true;
  if (!["administrator", "management", "inspector", "borough-director"].includes(role)) return false;
  // Supervisors/superintendents who float between developments may VIEW reports
  // at any development. Acting on them still requires an active coverage unlock,
  // which is enforced at the action endpoints, not here.
  if (isCoverageEligible(actor)) return true;
  return !report.development || isBoroughDirector(actor) ||
    actor.developments.some((d) => d.toLowerCase() === report.development!.toLowerCase());
}
router.get("/v1/resident-report-photos", async (req, res) => {
  const actor = actorFrom(res);
  const reportId = typeof req.query.reportId === "string" ? req.query.reportId : "";
  if (!reportId) { res.status(400).json({ error: "reportId is required" }); return; }
  const [report] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, reportId), eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!report || !canReadReport(actor, report)) {
    res.status(404).json({ error: "Report not found" }); return;
  }
  const photos = await db.select({
    id: residentReportPhotos.id, reportId: residentReportPhotos.reportId,
    name: residentReportPhotos.name, size: residentReportPhotos.size,
    contentType: residentReportPhotos.contentType, createdAt: residentReportPhotos.createdAt,
  }).from(residentReportPhotos).where(and(
    eq(residentReportPhotos.tenantId, actor.tenantId), eq(residentReportPhotos.reportId, reportId),
  ));
  res.json(photos);
});
router.patch("/v1/resident-report-photos/:id", async (req, res) => {
  const parsed = UpdateResidentReportPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Photo name must be between 1 and 100 characters" });
    return;
  }
  const actor = actorFrom(res);
  const [photo] = await db.select().from(residentReportPhotos).where(and(
    eq(residentReportPhotos.id, req.params.id!),
    eq(residentReportPhotos.tenantId, actor.tenantId),
  )).limit(1);
  if (!photo) { res.status(404).json({ error: "Photo not found" }); return; }
  const [report] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, photo.reportId),
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.entity, "resident-reports"),
    eq(entityRecords.deleted, false),
  )).limit(1);
  if (!report || !canReadReport(actor, report)) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Photo name is required" });
    return;
  }
  const [updated] = await db.update(residentReportPhotos)
    .set({ name })
    .where(and(
      eq(residentReportPhotos.id, photo.id),
      eq(residentReportPhotos.tenantId, actor.tenantId),
    ))
    .returning({
      id: residentReportPhotos.id,
      reportId: residentReportPhotos.reportId,
      name: residentReportPhotos.name,
      size: residentReportPhotos.size,
      contentType: residentReportPhotos.contentType,
      createdAt: residentReportPhotos.createdAt,
    });
  if (!updated) { res.status(404).json({ error: "Photo not found" }); return; }
  await audit(actor, "resident-report-photo.renamed", `Renamed resident report photo to ${name}`, photo.id);
  res.json(updated);
});
router.post("/v1/resident-report-photos/:id/download-url", async (req, res) => {
  const actor = actorFrom(res);
  const [photo] = await db.select().from(residentReportPhotos).where(and(
    eq(residentReportPhotos.id, req.params.id!),
    eq(residentReportPhotos.tenantId, actor.tenantId),
  )).limit(1);
  if (!photo) { res.status(404).json({ error: "Photo not found" }); return; }
  const [report] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, photo.reportId), eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!report) { res.status(404).json({ error: "Photo not found" }); return; }
  if (!canReadReport(actor, report)) {
    res.status(404).json({ error: "Photo not found" }); return;
  }
  res.json(await fileStorage.createDownload(actor.tenantId, photo.objectPath));
});

async function releasedScope(trackingId: string) {
  const [registered] = await db.select().from(publicAccessCodes).where(and(
    eq(publicAccessCodes.kind, "vendor"), eq(publicAccessCodes.code, trackingId.toUpperCase()),
  )).limit(1);
  const rows = await db.select().from(entityRecords)
    .where(and(eq(entityRecords.entity, "procurement"), eq(entityRecords.deleted, false)))
    .orderBy(desc(entityRecords.updatedAt));
  if (registered) {
    const match = rows.find((row) => row.id === registered.recordId);
    if (match && VENDOR_VISIBLE_STATUSES.has(normalize(match.state["status"])) &&
        match.tenantId === registered.tenantId) return match;
  }
  const normalized = normalize(trackingId);
  const matches = rows.filter((row) => {
    const status = normalize(row.state["status"]);
    return normalize(row.state["trackingId"]) === normalized && VENDOR_VISIBLE_STATUSES.has(status);
  });
  return matches.length === 1 ? matches[0] : null;
}

router.get("/v1/public/vendor-scopes/:trackingId", async (req, res) => {
  const vendorName = normalize(req.query["vendorName"]);
  const scope = await releasedScope(req.params["trackingId"]!);
  if (!vendorName || !scope) { res.status(404).json({ error: "Released scope not found" }); return; }
  if (["awarded", "eligible-awarded"].includes(normalize(scope.state["status"])) && normalize(scope.state["vendor"]) !== vendorName) {
    res.status(404).json({ error: "Released scope not found" }); return;
  }
  const org = await evaluateLicense(scope.tenantId);
  if (!licenseAllows(org, scope.tenantId)) { res.status(404).json({ error: "Released scope not found" }); return; }
  res.json(vendorRecord(scope, vendorName));
});

// Open the CPM's attached scope file (PDF, drawings…) with the vendor code.
router.post("/v1/public/vendor-scopes/:trackingId/scope-file", async (req, res) => {
  const vendorName = normalize(req.body?.vendorName);
  const scope = await releasedScope(req.params["trackingId"]!);
  if (!vendorName || !scope) { res.status(404).json({ error: "Released scope not found" }); return; }
  if (["awarded", "eligible-awarded", "closed"].includes(normalize(scope.state["status"])) && normalize(scope.state["vendor"]) !== vendorName) {
    res.status(404).json({ error: "Released scope not found" }); return;
  }
  const org = await evaluateLicense(scope.tenantId);
  if (!licenseAllows(org, scope.tenantId)) { res.status(404).json({ error: "Released scope not found" }); return; }
  const file = scope.state["scopeFileRemote"] as { objectPath?: string; name?: string } | undefined;
  if (!file?.objectPath) { res.status(404).json({ error: "No scope file attached" }); return; }
  const download = await fileStorage.createDownload(scope.tenantId, String(file.objectPath));
  res.json({ downloadUrl: download.downloadUrl, name: file.name || "Scope file" });
});

router.post("/v1/public/vendor-scopes/:trackingId/walkthrough-check-ins", async (req, res) => {
  const trackingId = req.params["trackingId"]!;
  const vendorName = String(req.body?.vendorName ?? "").trim();
  const id = String(req.body?.id ?? "").trim();
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const accuracy = req.body?.accuracy == null ? null : Number(req.body.accuracy);
  const capturedAt = new Date(String(req.body?.capturedAt ?? ""));
  if (
    id.length < 8 || id.length > 128 || !vendorName ||
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10_000)) ||
    Number.isNaN(capturedAt.getTime())
  ) {
    res.status(400).json({ error: "A valid vendor name and GPS location are required" });
    return;
  }
  const scope = await releasedScope(trackingId);
  if (!scope) { res.status(404).json({ error: "Released scope not found" }); return; }
  const org = await evaluateLicense(scope.tenantId);
  if (!licenseAllows(org, scope.tenantId)) { res.status(404).json({ error: "Released scope not found" }); return; }

  // Where the building is, so Procurement can see the vendor was really there.
  // Street address without the unit ("… Unit 4B").
  const buildingAddress = String(scope.state["address"] ?? "").replace(/\s+(unit|apt|apartment|#)\s*\S+$/i, "").trim();
  const building = await geocodeNycPoint(buildingAddress);
  const existing = await db.select().from(vendorWalkthroughCheckIns).where(eq(vendorWalkthroughCheckIns.id, id)).limit(1);
  if (existing[0]) {
    if (existing[0].procurementId !== scope.id || normalize(existing[0].vendorName) !== normalize(vendorName)) {
      res.status(409).json({ error: "Check-in identifier is already in use" });
      return;
    }
    res.json(existing[0]);
    return;
  }

  try {
    const checkIn = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(entityRecords).where(and(
        eq(entityRecords.id, scope.id),
        eq(entityRecords.tenantId, scope.tenantId),
        eq(entityRecords.entity, "procurement"),
        eq(entityRecords.deleted, false),
      )).limit(1).for("update");
      if (!locked || !VENDOR_VISIBLE_STATUSES.has(normalize(locked.state["status"]))) {
        throw Object.assign(new Error("Released scope not found"), { status: 404 });
      }
      if (
        ["awarded", "eligible-awarded"].includes(normalize(locked.state["status"])) &&
        normalize(locked.state["vendor"]) !== normalize(vendorName)
      ) {
        throw Object.assign(new Error("Released scope not found"), { status: 404 });
      }
      if (!String(locked.state["walkthroughAt"] ?? "").trim()) {
        throw Object.assign(new Error("No walk-through is scheduled for this scope"), { status: 400 });
      }
      const receivedAt = new Date();
      const [created] = await tx.insert(vendorWalkthroughCheckIns).values({
        id,
        tenantId: locked.tenantId,
        procurementId: locked.id,
        trackingId: String(locked.state["trackingId"] ?? trackingId).toUpperCase(),
        vendorName,
        latitude,
        longitude,
        accuracy,
        capturedAt,
        receivedAt,
      }).returning();
      const previous = Array.isArray(locked.state["walkthroughCheckIns"])
        ? locked.state["walkthroughCheckIns"].filter((item) => item && typeof item === "object")
        : [];
      const distance = building ? distanceMeters(building, { latitude, longitude }) : null;
      // On site: within 150 m of the building, allowing for the phone's GPS accuracy.
      const onSite = distance == null ? null : distance <= Math.max(150, (accuracy ?? 0) + 75);
      const scheduled = new Date(String(locked.state["walkthroughAtIso"] ?? locked.state["walkthroughAt"] ?? ""));
      const minutesFromSchedule = Number.isNaN(scheduled.getTime())
        ? null
        : Math.round((capturedAt.getTime() - scheduled.getTime()) / 60_000);
      const summary = {
        id,
        vendorName,
        latitude,
        longitude,
        accuracy,
        capturedAt: capturedAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
        ...(building ? { buildingLatitude: building.latitude, buildingLongitude: building.longitude } : {}),
        distanceMeters: distance,
        onSite,
        minutesFromSchedule,
      };
      await tx.update(entityRecords).set({
        state: { ...locked.state, walkthroughCheckIns: [...previous, summary] },
        version: locked.version + 1,
        updatedAt: receivedAt,
      }).where(and(eq(entityRecords.id, locked.id), eq(entityRecords.tenantId, locked.tenantId)));
      await tx.insert(notifications).values({
        id: randomUUID(),
        tenantId: locked.tenantId,
        target: "procurement",
        message: `Walk-through check-in: ${vendorName}${onSite === true ? " (at the building)" : onSite === false ? " (NOT at the building)" : ""}`,
        detail: [
          String(locked.state["sourceRef"] ?? ""),
          String(locked.state["address"] ?? locked.development ?? "Scheduled site"),
          capturedAt.toLocaleString("en-US", { timeZone: "America/New_York" }),
          distance != null ? `${distance} m from the building` : "",
          minutesFromSchedule != null ? (minutesFromSchedule > 0 ? `${minutesFromSchedule} min late` : `${Math.abs(minutesFromSchedule)} min early`) : "",
        ].filter(Boolean).join(" · "),
        reportId: locked.id,
      });
      await tx.insert(auditLog).values({
        id: randomUUID(),
        tenantId: locked.tenantId,
        actorRole: "vendor",
        actorName: vendorName,
        action: "vendor.walkthrough-check-in",
        detail: `GPS check-in recorded for ${String(locked.state["trackingId"] ?? trackingId).toUpperCase()}`,
        reportId: locked.id,
        at: receivedAt,
      });
      return created!;
    });
    res.status(201).json(checkIn);
  } catch (error: any) {
    if (error?.status) { res.status(error.status).json({ error: error.message }); return; }
    if (error?.code === "23505") {
      const [duplicate] = await db.select().from(vendorWalkthroughCheckIns).where(eq(vendorWalkthroughCheckIns.id, id)).limit(1);
      if (duplicate) { res.json(duplicate); return; }
    }
    throw error;
  }
});

router.post("/v1/public/vendor-scopes/:trackingId/bids", async (req, res) => {
  const vendorName = String(req.body?.vendorName ?? "").trim();
  const amount = Number(req.body?.amount);
  const scope = await releasedScope(req.params["trackingId"]!);
  if (!scope || normalize(scope.state["status"]) !== "bidding" || !vendorName || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "A released scope, vendor name, and positive amount are required" }); return;
  }
  const org = await evaluateLicense(scope.tenantId);
  if (!licenseAllows(org, scope.tenantId)) { res.status(404).json({ error: "Released scope not found" }); return; }
  const now = new Date();
  const state = {
    requestId: scope.id, trackingId: String(scope.state["trackingId"] ?? req.params["trackingId"]),
    vendorName, amount, note: String(req.body?.note ?? "").trim() || undefined,
    development: scope.development, submittedAt: now.toISOString(),
  };
  const id = `public-bid-${createHash("sha256").update(`${scope.id}:${normalize(vendorName)}`).digest("hex").slice(0, 32)}`;
  const [bid] = await db.insert(entityRecords).values({
    id, tenantId: scope.tenantId, entity: "procurement-bids", projectId: scope.projectId,
    development: scope.development, state, createdBy: `public-vendor:${normalize(vendorName)}`,
    createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: entityRecords.id,
    set: { state, version: sql`${entityRecords.version} + 1`, updatedAt: now, deleted: false },
  }).returning();
  await db.insert(notifications).values({
    id: randomUUID(), tenantId: scope.tenantId, target: "procurement",
    message: `New bid on ${state.trackingId}`, detail: `${vendorName} · $${amount}`, reportId: scope.id,
  });
  res.status(201).json(record(bid!));
});

// The awarded vendor reports progress (no account: vendor name + code). This
// reaches Procurement, the CPM and the reviewing CPM Supervisor — previously
// "Start"/"Mark complete" stayed on the vendor's own device.
router.post("/v1/public/vendor-scopes/:trackingId/progress", rateLimit("vendor-progress", 30), async (req, res) => {
  const vendorName = String(req.body?.vendorName ?? "").trim();
  const step = String(req.body?.step ?? "").trim();
  const note = String(req.body?.note ?? "").trim().slice(0, 2000);
  const scope = await releasedScope(req.params["trackingId"]!);
  if (!scope || !vendorName || !["start", "complete"].includes(step) ||
      normalize(scope.state["status"]) !== "awarded" ||
      normalize(scope.state["vendor"]) !== normalize(vendorName)) {
    res.status(404).json({ error: "Only the awarded vendor can update this job" }); return;
  }
  const org = await evaluateLicense(scope.tenantId);
  if (!licenseAllows(org, scope.tenantId)) { res.status(404).json({ error: "Released scope not found" }); return; }
  const now = new Date().toISOString();
  const state: Record<string, unknown> = { ...scope.state };
  // vendorStartedAt/vendorCompletedAt for staff; startedAt/completedAt are what
  // the vendor screens read.
  state["vendorStartedAt"] = state["vendorStartedAt"] || now;
  state["startedAt"] = state["startedAt"] || state["vendorStartedAt"];
  if (step === "complete") {
    state["vendorCompletedAt"] = now;
    state["completedAt"] = now;
    if (note) state["vendorNote"] = note;
  }
  const [updated] = await db.update(entityRecords)
    .set({ state, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() })
    .where(eq(entityRecords.id, scope.id))
    .returning();
  const ref = [scope.state["sourceRef"], scope.state["trackingId"], scope.state["address"]].filter(Boolean).join(" · ");
  const message = step === "complete" ? `Vendor completed the work: ${vendorName}` : `Vendor started the work: ${vendorName}`;
  const targets = new Set(["procurement", String(scope.state["cpmId"] || ""), String(scope.state["handoffTargetId"] || "")].filter(Boolean));
  for (const target of targets) {
    await db.insert(notifications).values({
      id: randomUUID(), tenantId: scope.tenantId, target, message,
      detail: [ref, note ? `Note: ${note}` : ""].filter(Boolean).join(" — "), reportId: scope.id,
    });
  }
  res.json(vendorRecord(updated!, vendorName));
});

// ── Vendor change work orders ──────────────────────────────────────────────
// Once awarded and on site, a vendor can raise a change work order: what
// changed, why, measurements, notes and photos — all required so there is
// never a mix-up. It goes to the CPM Supervisor handling the scope (and the
// CPM who wrote it) to approve and send to Procurement, or decline. The vendor
// sees who received it and every status change on their page.
const VENDOR_CO_PHOTO_MAX = 6;
const VENDOR_CO_PHOTO_CHARS = 700_000; // ~500 KB each, as a data URL

function vendorChangeOrderView(row: typeof entityRecords.$inferSelect) {
  const st = row.state as Record<string, unknown>;
  return {
    id: row.id,
    createdAt: String(st["createdAt"] || row.createdAt),
    status: String(st["status"] || "submitted"),
    description: String(st["description"] || ""),
    vendorReason: String(st["vendorReason"] || ""),
    measurements: String(st["measurements"] || ""),
    notes: String(st["notes"] || ""),
    cost: Number(st["cost"] || 0) || 0,
    photoCount: Array.isArray(st["photos"]) ? (st["photos"] as unknown[]).length : 0,
    receivedBy: Array.isArray(st["receivedBy"]) ? (st["receivedBy"] as string[]) : [],
    receivedAt: String(st["receivedAt"] || ""),
    respondedByName: String(st["respondedByName"] || ""),
    respondedAt: String(st["respondedAt"] || ""),
    reason: String(st["reason"] || ""),
    vendorEmailed: st["vendorEmailed"] === true,
  };
}

async function vendorChangeOrders(scopeId: string, tenantId: string, vendorName: string) {
  const rows = await db.select().from(entityRecords).where(and(
    eq(entityRecords.tenantId, tenantId), eq(entityRecords.entity, "change-orders"), eq(entityRecords.deleted, false),
  )).orderBy(desc(entityRecords.createdAt));
  return rows
    .filter((row) => row.state["reportId"] === scopeId && row.state["isVendorCO"] === true &&
      normalize(row.state["vendor"]) === normalize(vendorName))
    .map(vendorChangeOrderView);
}

router.get("/v1/public/vendor-scopes/:trackingId/change-orders", async (req, res) => {
  const vendorName = String(req.query["vendorName"] ?? "").trim();
  const scope = await releasedScope(req.params["trackingId"]!);
  if (!scope || !vendorName || normalize(scope.state["vendor"]) !== normalize(vendorName)) {
    res.status(404).json({ error: "Only the awarded vendor can see these" }); return;
  }
  res.json(await vendorChangeOrders(scope.id, scope.tenantId, vendorName));
});

router.post("/v1/public/vendor-scopes/:trackingId/change-orders", rateLimit("vendor-change-order", 20), async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const vendorName = String(body.vendorName ?? "").trim();
  // The app queues change orders offline and retries: the same clientId is
  // never created twice.
  const clientId = String(body.clientId ?? "").trim().slice(0, 64);
  const clientCreatedAt = typeof body.createdAt === "string" && !Number.isNaN(Date.parse(body.createdAt)) ? new Date(body.createdAt).toISOString() : "";
  const description = String(body.description ?? "").trim().slice(0, 4000);
  const vendorReason = String(body.reason ?? "").trim().slice(0, 4000);
  const measurements = String(body.measurements ?? "").trim().slice(0, 2000);
  const notes = String(body.notes ?? "").trim().slice(0, 4000);
  const cost = Number(body.cost);
  const rawPhotos = (Array.isArray(body.photos) ? body.photos : []) as unknown[];
  // Each photo may come with the stamp the phone put on it at capture time.
  const photoItems = rawPhotos.map((p) => {
    if (typeof p === "string") return { dataUrl: p, stamp: {} as PhotoStamp };
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const stamp: PhotoStamp = {
      capturedAt: typeof o["capturedAt"] === "string" ? o["capturedAt"] : undefined,
      lat: typeof o["lat"] === "number" ? o["lat"] : undefined,
      lng: typeof o["lng"] === "number" ? o["lng"] : undefined,
      accuracy: typeof o["accuracy"] === "number" ? o["accuracy"] : undefined,
    };
    return { dataUrl: String(o["dataUrl"] || ""), stamp };
  }).filter((p) => /^data:image\/(jpeg|png|webp);base64,/.test(p.dataUrl) && p.dataUrl.length <= VENDOR_CO_PHOTO_CHARS).slice(0, VENDOR_CO_PHOTO_MAX);
  const photos = photoItems.map((p) => p.dataUrl);
  const photoStamps = photoItems.map((p) => ({ capturedAt: p.stamp.capturedAt || "", lat: p.stamp.lat, lng: p.stamp.lng, accuracy: p.stamp.accuracy }));
  const scope = await releasedScope(req.params["trackingId"]!);
  if (!scope || !vendorName || normalize(scope.state["status"]) !== "awarded" ||
      normalize(scope.state["vendor"]) !== normalize(vendorName)) {
    res.status(404).json({ error: "Only the awarded vendor can raise a change work order on this job" }); return;
  }
  if (!scope.state["startedAt"] && !scope.state["vendorStartedAt"]) {
    res.status(409).json({ error: "Press Start work first — change work orders are raised from the job site" }); return;
  }
  if (scope.state["completedAt"]) {
    res.status(409).json({ error: "This job is marked complete" }); return;
  }
  const missing = [
    !description ? "what changed" : "", !vendorReason ? "the reason why" : "", !measurements ? "measurements" : "",
    !notes ? "notes" : "", !photos.length ? "at least one photo" : "",
  ].filter(Boolean);
  if (missing.length) { res.status(400).json({ error: `Please provide ${missing.join(", ")}` }); return; }
  const org = await evaluateLicense(scope.tenantId);
  if (!licenseAllows(org, scope.tenantId)) { res.status(404).json({ error: "Released scope not found" }); return; }
  if (clientId) {
    const existing = (await db.select().from(entityRecords).where(and(
      eq(entityRecords.tenantId, scope.tenantId), eq(entityRecords.entity, "change-orders"), eq(entityRecords.deleted, false),
    ))).find((row) => row.state["clientId"] === clientId && row.state["reportId"] === scope.id);
    if (existing) { res.json(vendorChangeOrderView(existing)); return; }
  }

  // The chain of command: the CPM Supervisor handling this scope and the CPM
  // who wrote it.
  const supervisorId = String(scope.state["handoffTargetId"] || scope.state["cpmSupervisorId"] || "");
  const supervisorName = String(scope.state["handoffTargetName"] || scope.state["cpmSupervisorName"] || "");
  const cpmId = String(scope.state["cpmId"] || "");
  const cpmName = String(scope.state["cpmName"] || scope.state["requestedBy"] || "");
  const targets = [...new Set([supervisorId, cpmId].filter(Boolean))];
  const receivedBy = [...new Set([supervisorName, cpmName].filter(Boolean))];
  const now = new Date().toISOString();
  const ref = [scope.state["trackingId"], scope.state["sourceRef"], scope.state["address"]].filter(Boolean).join(" \u00b7 ");
  const id = randomUUID();
  const state = {
    id, clientId: clientId || undefined, reportId: scope.id, reportRef: ref, trackingId: String(scope.state["trackingId"] || ""),
    targetPosition: "CPM Supervisor", targetName: supervisorName, targetStaffId: supervisorId, cpmSupervisorId: supervisorId, cpmId,
    assignedStaffId: cpmId || supervisorId,
    isVendorCO: true, vendor: vendorName, createdByRole: "vendor", createdByName: vendorName,
    description, vendorReason, measurements, notes, cost: Number.isFinite(cost) && cost > 0 ? Math.round(cost * 100) / 100 : 0, photos, photoStamps,
    status: "submitted", reason: "", respondedByName: "", respondedAt: "", createdAt: clientCreatedAt || now, sentAt: now,
    receivedBy, receivedAt: targets.length ? now : "",
  };
  const [created] = await db.insert(entityRecords).values({
    id, tenantId: scope.tenantId, entity: "change-orders", development: scope.development, state, createdBy: null,
  }).returning();
  const detail = `${vendorName} \u00b7 ${ref}${state.cost ? ` \u00b7 $${state.cost}` : ""} \u2014 ${vendorReason.slice(0, 80)}`;
  for (const target of targets) {
    const [n] = await db.insert(notifications).values({
      id: randomUUID(), tenantId: scope.tenantId, target, message: "Vendor change work order to review", detail, reportId: id,
    }).returning();
    if (n) void deliverPushNotification(n).catch(() => undefined);
  }
  res.status(201).json(vendorChangeOrderView(created!));
  // Quietly verify where and what the photos show; only the supervisors
  // handling this job hear about anything doubtful.
  void verifyVendorChangeOrder({
    tenantId: scope.tenantId, changeOrderId: id, address: String(scope.state["address"] || ""),
    scope: String(scope.state["scope"] || scope.state["scopeDescription"] || ""), description, reason: vendorReason,
    photos, stamps: photoStamps, supervisorIds: targets, vendorName, ref,
  }).catch(() => undefined);
});

export default router;