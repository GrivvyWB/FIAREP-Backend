import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, sql, gt, isNull } from "drizzle-orm";
import {
  db,
  entityRecords,
  notifications,
  organizationProperties,
  publicAccessCodes,
  residentReportPhotos,
  residentPhotoUploadGrants,
} from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { evaluateLicense, licenseAllows } from "../lib/auth";
import { fileStorage } from "../lib/fileStorage";
import { rateLimit } from "../lib/rateLimit";

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
  const normalizedAddress = normalize(address);
  const description = String(rawState.description ?? "").trim();
  if (!address || !description) { res.status(400).json({ error: "Address and complaint description are required" }); return; }
  const properties = await db.select().from(organizationProperties).where(and(
    eq(organizationProperties.normalizedAddress, normalizedAddress), eq(organizationProperties.active, true),
  ));
  const valid = [];
  for (const property of properties) {
    const org = await evaluateLicense(property.organizationId);
    if (licenseAllows(org, property.organizationId)) valid.push({ property, org });
  }
  const property = valid.length === 1 ? valid[0]!.property : null;
  const tenantId = property?.organizationId ?? "default";
  const reportAddress = property?.displayAddress ?? address;
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
      ...rawState, complaintNo, address: reportAddress, propertyId: property?.id ?? null,
      development: property?.development ?? (String(rawState.development ?? "").trim() || null),
      description, status: "submitted", photos: [],
      updates: [{ status: "submitted", by: "resident", at: now.toISOString() }], createdAt: now.toISOString(),
    };
    const [row] = await tx.insert(entityRecords).values({
      id, tenantId, entity: "resident-reports", development: property?.development ?? (String(rawState.development ?? "").trim() || null),
      state, createdBy: "public-resident", createdAt: now, updatedAt: now,
    }).returning();
    await tx.insert(notifications).values([
      { id: randomUUID(), tenantId, target: "management", message: "New resident report", detail: `${reportAddress} · ${complaintNo}`, reportId: id },
      { id: randomUUID(), tenantId, target: "administrator", message: "New resident report", detail: `${reportAddress} · ${complaintNo}`, reportId: id },
    ]);
    return row;
  }).catch(() => null);
  if (!created) { res.status(503).json({ error: "Could not issue a complaint code" }); return; }
  res.status(201).json({ ...record(created!), statusToken: residentToken });
});

router.get("/v1/public/resident-reports/:complaintNo", async (req, res) => {
  const address = normalize(req.query.address);
  const suppliedToken = String(req.query.statusToken ?? "");
  const [access] = await db.select().from(publicAccessCodes).where(and(
    eq(publicAccessCodes.kind, "resident"), eq(publicAccessCodes.code, req.params.complaintNo!.toUpperCase()),
  )).limit(1);
  if (!access || !access.tokenHash || hash(suppliedToken) !== access.tokenHash || !address) {
    res.status(404).json({ error: "Report not found" }); return;
  }
  const [row] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, access.recordId), eq(entityRecords.tenantId, access.tenantId),
    eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false),
  )).limit(1);
  if (!row || normalize(row.state["address"]) !== address) { res.status(404).json({ error: "Report not found" }); return; }
  const state = row.state;
  res.json({ complaintNo: state["complaintNo"], status: state["status"], description: state["description"], updates: state["updates"], createdAt: state["createdAt"] });
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
  if (!photo) { res.status(409).json({ error: "Photo already confirmed" }); return; }
  res.status(201).json({ id: photo.id, contentType: photo.contentType });
});

router.use("/v1/resident-report-photos", requireAuth);
function canReadReport(actor: ReturnType<typeof actorFrom>, report: typeof entityRecords.$inferSelect): boolean {
  return ["administrator", "management", "inspector", "borough-director"].includes(actor.role.toLowerCase()) &&
    (!report.development || actor.role.toLowerCase() === "borough-director" ||
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
  if (!["administrator", "management", "inspector", "borough-director"].includes(actor.role.toLowerCase()) ||
      !canReadReport(actor, report)) {
    res.status(404).json({ error: "Photo not found" }); return;
  }
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