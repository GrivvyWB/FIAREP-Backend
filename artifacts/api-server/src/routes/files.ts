import { Router, type IRouter } from "express";
import {
  RequestFileDownloadUrlBody,
  RequestFileUploadUrlBody,
} from "@workspace/api-zod";
import { db, residentReportPhotos } from "@workspace/db";
import { eq } from "drizzle-orm";
import { audit } from "../lib/audit";
import { FILE_KINDS, fileStorage, type FileKind } from "../lib/fileStorage";
import { actorFrom, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/v1/files", requireAuth);

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);
const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);
const EVIDENCE_TYPES = new Set([
  ...DOCUMENT_TYPES,
  "video/mp4",
  "video/quicktime",
]);

function contentTypeAllowed(kind: FileKind, contentType: string): boolean {
  if (kind.endsWith("photo")) return IMAGE_TYPES.has(contentType);
  if (kind === "inspection-evidence") return EVIDENCE_TYPES.has(contentType);
  return DOCUMENT_TYPES.has(contentType);
}

router.post("/v1/files/upload-url", async (req, res) => {
  const parsed = RequestFileUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid file metadata", details: parsed.error.flatten() });
    return;
  }
  const actor = actorFrom(res);
  const input = parsed.data;
  if (!FILE_KINDS.includes(input.kind as FileKind)) {
    res.status(400).json({ error: "Unsupported file kind" });
    return;
  }
  if (input.size > MAX_FILE_BYTES) {
    res.status(413).json({ error: "Files must be 50 MB or smaller" });
    return;
  }
  if (!contentTypeAllowed(input.kind as FileKind, input.contentType)) {
    res.status(415).json({ error: "File type is not allowed for this file kind" });
    return;
  }
  try {
    const result = await fileStorage.createUpload(actor.tenantId, actor.id, {
      ...input,
      kind: input.kind as FileKind,
    });
    await audit(
      actor,
      "file.upload-requested",
      `Requested ${input.kind} upload for ${input.name}`,
      result.file.id,
    );
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Failed to create file upload URL");
    res.status(503).json({ error: "File storage is temporarily unavailable" });
  }
});

router.post("/v1/files/download-url", async (req, res) => {
  const parsed = RequestFileDownloadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid objectPath is required" });
    return;
  }
  const actor = actorFrom(res);
  const [residentPhoto] = await db.select({ id: residentReportPhotos.id }).from(residentReportPhotos)
    .where(eq(residentReportPhotos.objectPath, parsed.data.objectPath)).limit(1);
  if (residentPhoto) {
    res.status(403).json({ error: "Resident report photos require report-scoped access" });
    return;
  }
  try {
    const result = await fileStorage.createDownload(
      actor.tenantId,
      parsed.data.objectPath,
    );
    await audit(
      actor,
      "file.download-requested",
      "Requested a file download URL",
      parsed.data.objectPath,
    );
    res.json(result);
  } catch (error) {
    req.log.warn({ err: error }, "Rejected file download URL request");
    res.status(404).json({ error: "File not found" });
  }
});

export default router;