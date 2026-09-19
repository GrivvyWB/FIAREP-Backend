import { Router, type IRouter } from "express";
import { ClassifyViolationBody } from "@workspace/api-zod";
import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizations, residentReportPhotos } from "@workspace/db";
import { classifyViolationImage } from "../lib/violationClassification";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { isBoroughDirector, isSupervisorPosition } from "../lib/domain";
import { fileStorage } from "../lib/fileStorage";

const router: IRouter = Router();

function residentPhotoAiEnabled(features: Record<string, unknown>) {
  const modules = features["modules"];
  return Boolean(
    modules &&
    typeof modules === "object" &&
    !Array.isArray(modules) &&
    (modules as Record<string, unknown>)["residentPhotoAiViolationReader"] === true,
  );
}

export function hasSavedResidentPhotoScan(
  state: Record<string, unknown>,
  photoId: string,
): boolean {
  const scans = state["aiPhotoScans"];
  return Boolean(
    scans &&
    typeof scans === "object" &&
    !Array.isArray(scans) &&
    Object.prototype.hasOwnProperty.call(scans, photoId),
  );
}

async function tenantResidentPhotoAiEnabled(tenantId: string) {
  const [organization] = await db.select({ features: organizations.features })
    .from(organizations)
    .where(eq(organizations.id, tenantId))
    .limit(1);
  return organization ? residentPhotoAiEnabled(organization.features) : false;
}

router.post("/ai/classify-violation", requireAuth, async (req, res) => {
  const parsed = ClassifyViolationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid JPEG, PNG, or WebP image is required" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    req.log.error("OPENAI_API_KEY is not configured");
    res.status(503).json({ error: "AI classification is unavailable" });
    return;
  }

  try {
    res.json(await classifyViolationImage(parsed.data.image, apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Violation classification failed");
    const malformed =
      error instanceof Error &&
      error.message === "OpenAI returned an invalid violation classification";
    res.status(malformed ? 502 : 503).json({
      error: malformed
        ? "AI returned an unusable classification"
        : "AI classification is temporarily unavailable",
    });
  }
});

router.get("/v1/resident-report-photo-ai/config", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  const authorized =
    actor.role === "management" ||
    actor.role === "administrator" ||
    isBoroughDirector(actor) ||
    isSupervisorPosition(actor);
  res.json({ enabled: authorized && await tenantResidentPhotoAiEnabled(actor.tenantId) });
});

router.post("/v1/resident-report-photos/:id/classify", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  if (
    actor.role !== "management" &&
    actor.role !== "administrator" &&
    !isBoroughDirector(actor) &&
    !isSupervisorPosition(actor)
  ) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  if (!await tenantResidentPhotoAiEnabled(actor.tenantId)) {
    res.status(404).json({ error: "Photo analysis is not enabled" });
    return;
  }
  const photoId = String(req.params["id"] ?? "");
  const [photo] = await db.select().from(residentReportPhotos).where(and(
    eq(residentReportPhotos.id, photoId),
    eq(residentReportPhotos.tenantId, actor.tenantId),
  )).limit(1);
  if (!photo || !["image/jpeg", "image/png", "image/webp"].includes(photo.contentType)) {
    res.status(photo ? 400 : 404).json({ error: photo ? "This photo format cannot be analyzed" : "Photo not found" });
    return;
  }
  const [report] = await db.select().from(entityRecords).where(and(
    eq(entityRecords.id, photo.reportId),
    eq(entityRecords.entity, "resident-reports"),
    eq(entityRecords.tenantId, actor.tenantId),
    eq(entityRecords.deleted, false),
  )).limit(1);
  if (
    !report ||
    (report.development &&
      !isBoroughDirector(actor) &&
      !actor.developments.some((value) => value.toLowerCase() === report.development!.toLowerCase()))
  ) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  if (hasSavedResidentPhotoScan(report.state, photo.id)) {
    res.status(409).json({ error: "This complaint photo has already been analyzed" });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    req.log.error("OPENAI_API_KEY is not configured");
    res.status(503).json({ error: "AI classification is unavailable" });
    return;
  }
  try {
    const { downloadUrl } = await fileStorage.createDownload(actor.tenantId, photo.objectPath);
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error("Photo download failed");
    const image = `data:${photo.contentType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    const result = await classifyViolationImage(image, apiKey);
    const existingScans =
      report.state["aiPhotoScans"] &&
      typeof report.state["aiPhotoScans"] === "object" &&
      !Array.isArray(report.state["aiPhotoScans"])
        ? report.state["aiPhotoScans"] as Record<string, unknown>
        : {};
    const [updated] = await db.update(entityRecords).set({
      state: {
        ...report.state,
        aiPhotoScans: {
          ...existingScans,
          [photo.id]: {
            ...result,
            analyzedAt: new Date().toISOString(),
            analyzedByStaffId: actor.id,
          },
        },
      },
      version: sql`${entityRecords.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(entityRecords.id, report.id),
      eq(entityRecords.tenantId, actor.tenantId),
      eq(entityRecords.version, report.version),
    )).returning();
    if (!updated) {
      res.status(409).json({ error: "Complaint changed before analysis could be saved" });
      return;
    }
    await audit(actor, "resident-report-photo.classified", "Classified resident complaint photo", photo.id);
    res.json(result);
  } catch (error) {
    req.log.warn({ err: error, photoId: photo.id }, "Resident photo violation classification failed");
    res.status(503).json({ error: "AI classification is temporarily unavailable" });
  }
});

export default router;