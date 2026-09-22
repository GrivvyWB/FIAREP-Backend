import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, residentReportPhotos } from "@workspace/db";
import { classifyViolationImage } from "./violationClassification";
import { fileStorage } from "./fileStorage";

const ANALYZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

function hasScan(state: Record<string, unknown>, photoId: string): boolean {
  const scans = state["aiPhotoScans"];
  return Boolean(
    scans && typeof scans === "object" && !Array.isArray(scans) &&
      (scans as Record<string, unknown>)[photoId],
  );
}

/**
 * Classify a resident complaint photo and persist the violation code onto the
 * report, so management/supervisors see a real HPD/DOB code automatically
 * without pressing a button. Safe to call fire-and-forget: it swallows its own
 * errors and never throws. It is a no-op when the key is missing, the format is
 * not analyzable, or the photo was already analyzed.
 */
export async function classifyResidentPhotoAndSave(
  tenantId: string,
  photoId: string,
): Promise<void> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    const [photo] = await db.select().from(residentReportPhotos).where(and(
      eq(residentReportPhotos.id, photoId),
      eq(residentReportPhotos.tenantId, tenantId),
    )).limit(1);
    if (!photo || !ANALYZABLE.has(photo.contentType)) return;

    const [report] = await db.select().from(entityRecords).where(and(
      eq(entityRecords.id, photo.reportId),
      eq(entityRecords.entity, "resident-reports"),
      eq(entityRecords.tenantId, tenantId),
      eq(entityRecords.deleted, false),
    )).limit(1);
    if (!report) return;
    if (hasScan(report.state, photo.id)) return;

    const { downloadUrl } = await fileStorage.createDownload(tenantId, photo.objectPath);
    const response = await fetch(downloadUrl);
    if (!response.ok) return;
    const image = `data:${photo.contentType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    const issueText = [report.state["description"], report.state["details"], report.state["issue"]]
      .find((v): v is string => typeof v === "string" && Boolean(v.trim())) || "";
    const result = await classifyViolationImage(image, apiKey, fetch, issueText);

    const existingScans =
      report.state["aiPhotoScans"] &&
      typeof report.state["aiPhotoScans"] === "object" &&
      !Array.isArray(report.state["aiPhotoScans"])
        ? report.state["aiPhotoScans"] as Record<string, unknown>
        : {};

    await db.update(entityRecords).set({
      state: {
        ...report.state,
        aiPhotoScans: {
          ...existingScans,
          [photo.id]: { ...result, analyzedAt: new Date().toISOString(), analyzedByStaffId: "auto" },
        },
      },
      version: sql`${entityRecords.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(entityRecords.id, report.id),
      eq(entityRecords.tenantId, tenantId),
      eq(entityRecords.version, report.version),
    ));
  } catch {
    // best-effort: never let auto-classification break the upload flow
  }
}
