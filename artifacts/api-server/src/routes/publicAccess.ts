import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, sql, gt, isNull } from "drizzle-orm";
import {
  db,
  auditLog,
  entityRecords,
  notifications,
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
import { isBoroughDirector } from "../lib/domain";
import { deliverPushNotification } from "../lib/push";
import { residentReportRecipientIds } from "../lib/notificationVisibility";
import { rateLimit } from "../lib/rateLimit";
import { lookupNychaResidentialAddress } from "../lib/nycProperty";
import { UpdateResidentReportPhotoBody } from "@workspace/api-zod";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use("/v1/public", rateLimit("public-access", 60));
const normalize = (value: unknown) =>
  String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const code = () => `RC-${randomBytes(4).readUInt32BE(0) % 90000 + 10000}`;
const token = () => randomBytes(32).toString("base64url");
const VENDOR_VISIBLE_STATUSES = new Set(["bidding", "eligible", "eligible-awarded", "awarded"]);

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
  if (!requestedDevelopment || !description) {
    res.status(400).json({ error: "Development and complaint description are required" });
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
  let nychaAddress: Awaited<ReturnType<typeof lookupNychaResidentialAddress>> = null;
  if (!property && address) {
    try {
      nychaAddress = await lookupNychaResidentialAddress(address);
    } catch (error) {
      req.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "NYCHA address lookup failed",
      );
    }
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
  const reportAddress = property?.displayAddress ?? address;
  const reportDevelopment =
    property?.development ??
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
    };
    const [row] = await tx.insert(entityRecords).values({
      id, tenantId, entity: "resident-reports", development: reportDevelopment,
      state, createdBy: "public-resident", createdAt: now, updatedAt: now,
    }).returning();
    const recipientIds = await residentReportRecipientIds(tenantId, reportDevelopment);
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
  if (!row || normalize(row.state["address"]) !== normalize(address)) return null;
  return { access };
}

router.post("/v1/public/resident-reports/:complaintNo/photos/upload-url", async (req, res) => {
  const body = req.body ?? {};
  const size = Number(body.size);
  const contentType = String(body.contentType ?? "");
  const name = String(body.name ?? "").trim().slice(0, 200);
  const auth = await residentAccess(req.params.complaintNo!, String(body.statusToken ?? ""), String(body.address ?? ""));
  if (!auth || !name || !residentPhotoTypes.has(contentType) || !Number.isInteger(size) || size <= 0 || size > MAX_RESIDENT_PHOTO_BYTES) {
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
  res.status(201).json({ id: photo.id, contentType: photo.contentType });
});

router.use("/v1/resident-report-photos", requireAuth);
function canReadReport(actor: ReturnType<typeof actorFrom>, report: typeof entityRecords.$inferSelect): boolean {
  const role = actor.role.toLowerCase();
  const isCanonicalAssignee =
    ["worker", "emergency"].includes(role) &&
    String(report.state["assignedStaffId"] || "") === actor.id;
  if (isCanonicalAssignee) return true;
  return ["administrator", "management", "inspector", "borough-director"].includes(role) &&
    (!report.development || isBoroughDirector(actor) ||
      actor.developments.some((d) => d.toLowerCase() === report.development!.toLowerCase()));
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
  res.json(record(scope));
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
      const summary = {
        id,
        vendorName,
        latitude,
        longitude,
        accuracy,
        capturedAt: capturedAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
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
        message: `Walk-through check-in: ${vendorName}`,
        detail: `${String(locked.state["address"] ?? locked.development ?? "Scheduled site")} · ${receivedAt.toLocaleString("en-US")}`,
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

export default router;