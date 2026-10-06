import { Router, type IRouter } from "express";
import { ClassifyViolationBody } from "@workspace/api-zod";
import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizations, residentReportPhotos } from "@workspace/db";
import { classifyViolationImage } from "../lib/violationClassification";
import { classifyMaterialImage } from "../lib/materialClassification";
import { synthesizeSpeech, transcribeAudio, translateText } from "../lib/translator";
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

// ── Live translator (resident ⇄ staff, voice or text) ────────────────────
function openAiKey(res: Parameters<typeof actorFrom>[0]): string | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) res.status(503).json({ error: "The translator is unavailable (AI key not configured)" });
  return apiKey || null;
}

router.post("/ai/translate", requireAuth, async (req, res) => {
  const apiKey = openAiKey(res); if (!apiKey) return;
  const body = (req.body || {}) as { text?: unknown; to?: unknown; from?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  const to = typeof body.to === "string" ? body.to.trim().slice(0, 60) : "";
  const from = typeof body.from === "string" && body.from.trim() ? body.from.trim().slice(0, 60) : "auto";
  if (!text || !to) { res.status(400).json({ error: "text and to are required" }); return; }
  try {
    res.json(await translateText(text, to, apiKey, from));
  } catch (error) {
    req.log.warn({ err: error }, "Translation failed");
    res.status(503).json({ error: "Translation is temporarily unavailable" });
  }
});

router.post("/ai/transcribe", requireAuth, async (req, res) => {
  const apiKey = openAiKey(res); if (!apiKey) return;
  const body = (req.body || {}) as { audio?: unknown; mimeType?: unknown; language?: unknown };
  const audio = typeof body.audio === "string" ? body.audio : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
  const language = typeof body.language === "string" ? body.language : "";
  if (!audio) { res.status(400).json({ error: "audio is required" }); return; }
  try {
    res.json(await transcribeAudio(audio, mimeType, apiKey, language));
  } catch (error) {
    req.log.warn({ err: error }, "Transcription failed");
    res.status(503).json({ error: "Could not understand the recording — try again closer to the phone" });
  }
});

router.post("/ai/speak", requireAuth, async (req, res) => {
  const apiKey = openAiKey(res); if (!apiKey) return;
  const body = (req.body || {}) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) { res.status(400).json({ error: "text is required" }); return; }
  try {
    res.json(await synthesizeSpeech(text, apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Speech synthesis failed");
    res.status(503).json({ error: "Could not produce speech right now" });
  }
});

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

router.post("/ai/classify-material", requireAuth, async (req, res) => {
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
    res.json(await classifyMaterialImage(parsed.data.image, apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Material classification failed");
    res.status(503).json({ error: "AI classification is temporarily unavailable" });
  }
});

router.get("/v1/resident-report-photo-ai/config", requireAuth, async (_req, res) => {
  const actor = actorFrom(res);
  const authorized =
    actor.role === "management" ||
    actor.role === "administrator" ||
    isBoroughDirector(actor) ||
    isSupervisorPosition(actor);
  res.json({ enabled: authorized && Boolean(process.env.OPENAI_API_KEY) });
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
    const issueText = [report.state["description"], report.state["details"], report.state["issue"]]
      .find((v): v is string => typeof v === "string" && Boolean(v.trim())) || "";
    const result = await classifyViolationImage(image, apiKey, fetch, issueText);
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