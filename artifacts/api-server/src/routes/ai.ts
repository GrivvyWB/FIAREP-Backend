import { Router, type IRouter } from "express";
import { ClassifyViolationBody } from "@workspace/api-zod";
import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizations, residentReportPhotos } from "@workspace/db";
import { classifyViolationImage } from "../lib/violationClassification";
import { classifyMaterialImage } from "../lib/materialClassification";
import { smartRepairTicket, verifyRepair, smartRepairDrawings, baselineFinding } from "../lib/smartRepair";
import { priorityQueue } from "../lib/priorityEngine";
import { synthesizeSpeech, transcribeAudio, translateText } from "../lib/translator";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { audit, notify } from "../lib/audit";
import { ReplitConnectors } from "@replit/connectors-sdk";
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

// FIAREP Smart Repair Instructions: photo + GPS address + compass heading → Smart Field Ticket.
// Off when the organization's master switch (features.modules.smartRepair) is false.
router.post("/ai/smart-repair", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  const modules = (org?.features as Record<string, unknown> | undefined)?.["modules"] as Record<string, unknown> | undefined;
  if (modules && modules["smartRepair"] === false) { res.status(403).json({ error: "Smart Repair is switched off for this organization." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const image = typeof b["image"] === "string" ? b["image"] : "";
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) { res.status(400).json({ error: "A JPEG, PNG or WebP photo is required" }); return; }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "Smart Repair is unavailable (AI key not configured)" }); return; }
  const heading = typeof b["heading"] === "number" && Number.isFinite(b["heading"]) ? b["heading"] : null;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).slice(0, 300) : "");
  try {
    res.json(await smartRepairTicket({ image, heading, address: str("address"), area: str("area"), note: str("note") }, apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Smart Repair failed");
    res.status(503).json({ error: "Smart Repair is temporarily unavailable" });
  }
});

// Building Baseline: one finding from one photo, the short fast version.
router.post("/ai/baseline-finding", requireAuth, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const image = typeof b["image"] === "string" ? b["image"] : "";
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) { res.status(400).json({ error: "A JPEG, PNG or WebP photo is required" }); return; }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "Analysis is unavailable (AI key not configured)" }); return; }
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).slice(0, 300) : "");
  try {
    res.json(await baselineFinding({ image, area: str("area"), note: str("note") }, apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Baseline finding analysis failed");
    res.status(503).json({ error: "Analysis is temporarily unavailable" });
  }
});

// Drawings for the ticket: exploded diagram, replacement part, each tool and material.
// Tools, materials and parts are drawn once and reused for every later ticket.
router.post("/ai/smart-repair/drawings", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  const modules = (org?.features as Record<string, unknown> | undefined)?.["modules"] as Record<string, unknown> | undefined;
  if (modules && modules["smartRepair"] === false) { res.status(403).json({ error: "Smart Repair is switched off for this organization." }); return; }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "Smart Repair is unavailable (AI key not configured)" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const str = (k: string, n = 300) => (typeof b[k] === "string" ? (b[k] as string).slice(0, n) : "");
  const arr = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 80)).slice(0, 12) : []);
  try {
    res.json(await smartRepairDrawings({ issue: str("issue"), trade: str("trade", 60), partLabel: str("partLabel", 120), spec: str("spec", 120), diagram: str("diagram", 800), tools: arr("tools"), materials: arr("materials") }, apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Smart Repair drawings failed");
    res.status(503).json({ error: "Drawings are temporarily unavailable" });
  }
});

// Smart Repair complete: the finished repair goes to management in the app, and a
// copy is emailed when Platform Control says so. Both are switches per organization:
// smartRepairToManagement (on unless switched off), smartRepairEmailCopy (off until
// switched on, with the address in smartRepairEmailTo).
const connectors = new ReplitConnectors();
const escHtml = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
router.post("/ai/smart-repair/complete", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const [org] = await db.select({ name: organizations.name, features: organizations.features }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  const features = (org?.features ?? {}) as Record<string, unknown>;
  const modules = (features["modules"] ?? {}) as Record<string, unknown>;
  if (modules["smartRepair"] === false) { res.status(403).json({ error: "Smart Repair is switched off for this organization." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const s = (k: string, n: number) => (typeof b[k] === "string" ? (b[k] as string).slice(0, n) : "");
  const jobId = s("jobId", 80), issue = s("issue", 200) || "Repair", address = s("address", 300), summary = s("summary", 8000);
  let notified = false, emailed = false;
  if (modules["smartRepairToManagement"] !== false) {
    await notify(actor, "management", `Smart Repair complete: ${issue}`, [address, `Verified by ${actor.name}`].filter(Boolean).join(" · "), jobId || undefined).catch(() => undefined);
    notified = true;
  }
  const to = typeof features["smartRepairEmailTo"] === "string" ? (features["smartRepairEmailTo"] as string).trim() : "";
  if (modules["smartRepairEmailCopy"] === true && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    try {
      const html = `<p><b>FIAREP Smart Repair — repair complete</b></p><p>${escHtml(org?.name)}${address ? " · " + escHtml(address) : ""}</p><pre style="font-family:Menlo,Consolas,monospace;font-size:13px">${escHtml(summary)}</pre><p>Verified by ${escHtml(actor.name)} on ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}.</p>`;
      const r = await connectors.proxy("outlook", "/v1.0/me/sendMail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: { subject: `Repair complete: ${issue}${address ? " — " + address : ""}`, body: { contentType: "HTML", content: html }, toRecipients: to.split(/[,;]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address } })) }, saveToSentItems: true }) });
      emailed = r.ok;
    } catch { emailed = false; }
  }
  res.json({ notified, emailed });
});

// FIAREP Multi-Complaint Priority Engine: open complaints per building, most critical first.
router.post("/v1/priority-queue", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const allowed = actor.role === "management" || actor.role === "administrator" || isBoroughDirector(actor) || isSupervisorPosition(actor);
  if (!allowed) { res.status(403).json({ error: "The priority queue is for management and administrators." }); return; }
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  const modules = (org?.features as Record<string, unknown> | undefined)?.["modules"] as Record<string, unknown> | undefined;
  if (modules && modules["priorityEngine"] === false) { res.status(403).json({ error: "The Priority Engine is switched off for this organization." }); return; }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "The Priority Engine is unavailable (AI key not configured)" }); return; }
  try {
    // Administrators and directors see every building; everyone else, their own developments.
    const all = actor.role === "administrator" || isBoroughDirector(actor);
    res.json(await priorityQueue({ tenantId: actor.tenantId, developments: all ? null : actor.developments }, apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Priority queue failed");
    res.status(503).json({ error: "The priority queue is temporarily unavailable" });
  }
});

// Completion verification: before photo vs after photo.
router.post("/ai/smart-repair/verify", requireAuth, async (req, res) => {
  const actor = actorFrom(res);
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, actor.tenantId)).limit(1);
  const modules = (org?.features as Record<string, unknown> | undefined)?.["modules"] as Record<string, unknown> | undefined;
  if (modules && modules["smartRepair"] === false) { res.status(403).json({ error: "Smart Repair is switched off for this organization." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const img = (k: string) => (typeof b[k] === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(b[k] as string) ? b[k] as string : "");
  const before = img("before"), after = img("after");
  if (!before || !after) { res.status(400).json({ error: "The before and after photos are both required" }); return; }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "Smart Repair is unavailable (AI key not configured)" }); return; }
  try {
    res.json(await verifyRepair(before, after, typeof b["issue"] === "string" ? (b["issue"] as string).slice(0, 200) : "", apiKey));
  } catch (error) {
    req.log.warn({ err: error }, "Smart Repair verification failed");
    res.status(503).json({ error: "Verification is temporarily unavailable" });
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