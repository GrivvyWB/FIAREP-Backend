import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  RequestFileDownloadUrlBody,
  RequestFileUploadUrlBody,
} from "@workspace/api-zod";
import {
  db,
  entityRecords,
  fileOwnership,
  residentReportPhotos,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { audit } from "../lib/audit";
import {
  ENTITIES,
  canMutateEntity,
} from "../lib/domain";
import { canReadEntityRecordForActor } from "../lib/hrAuthorization";
import {
  FILE_KINDS,
  canReadOwnedFile,
  fileStorage,
  isSafeTenantObjectPath,
  legacyFileOwnerCandidates,
  type FileKind,
  type FileOwnershipRecord,
} from "../lib/fileStorage";
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

class FileOwnerNotAccessibleError extends Error {}
class LegacyFileNotClaimableError extends Error {}

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
  if (!ENTITIES.has(input.entity)) {
    res.status(400).json({ error: "Unsupported file owner entity" });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [owner] = await tx
        .select()
        .from(entityRecords)
        .where(
          and(
            eq(entityRecords.id, input.recordId),
            eq(entityRecords.entity, input.entity),
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.deleted, false),
          ),
        )
        .limit(1);
       if (
         !owner ||
         !(await canReadEntityRecordForActor(actor, owner)) ||
         !canMutateEntity(actor, owner.entity)
       ) {
        throw new FileOwnerNotAccessibleError();
      }
      const upload = await fileStorage.createUpload(actor.tenantId, actor.id, {
        kind: input.kind as FileKind,
        name: input.name,
        size: input.size,
        contentType: input.contentType,
      });
      await tx.insert(fileOwnership).values({
        id: upload.file.id,
        tenantId: actor.tenantId,
        objectPath: upload.file.objectPath,
        entity: input.entity,
        recordId: input.recordId,
        createdBy: actor.id,
        kind: upload.file.kind,
        name: upload.file.name,
        contentType: upload.file.contentType,
        size: upload.file.size,
      });
      return upload;
    });
    await audit(
      actor,
      "file.upload-requested",
      `Requested ${input.kind} upload for ${input.name}`,
      result.file.id,
    );
    res.json(result);
  } catch (error) {
    if (error instanceof FileOwnerNotAccessibleError) {
      res.status(403).json({ error: "File owner record is not accessible" });
      return;
    }
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
  const objectPath = parsed.data.objectPath;
  if (
    objectPath.includes("..") ||
    objectPath.includes("\\") ||
    (() => {
      try {
        return decodeURIComponent(objectPath).includes("..");
      } catch {
        return true;
      }
    })()
  ) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  if (!isSafeTenantObjectPath(actor.tenantId, objectPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const [residentPhoto] = await db
    .select({ id: residentReportPhotos.id })
    .from(residentReportPhotos)
    .where(
      and(
        eq(residentReportPhotos.objectPath, objectPath),
        eq(residentReportPhotos.tenantId, actor.tenantId),
      ),
    )
    .limit(1);
  if (residentPhoto) {
    res.status(403).json({ error: "Resident report photos require report-scoped access" });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      const [existingOwnership] = await tx
        .select()
        .from(fileOwnership)
        .where(
          and(
            eq(fileOwnership.tenantId, actor.tenantId),
            eq(fileOwnership.objectPath, objectPath),
          ),
        )
        .limit(1);
      if (existingOwnership) {
        const [existingOwner] = await tx
          .select()
          .from(entityRecords)
          .where(
            and(
              eq(entityRecords.tenantId, actor.tenantId),
              eq(entityRecords.entity, existingOwnership.entity),
              eq(entityRecords.id, existingOwnership.recordId),
              eq(entityRecords.deleted, false),
            ),
          )
          .limit(1);
        if (
          !existingOwner ||
           !(await canReadOwnedFile(actor, objectPath, existingOwnership, existingOwner))
        ) {
          throw new LegacyFileNotClaimableError();
        }
        return { ownership: existingOwnership, owner: existingOwner };
      }

      if (!isSafeTenantObjectPath(actor.tenantId, objectPath)) {
        throw new LegacyFileNotClaimableError();
      }
      const legacyRecords = await tx
        .select()
        .from(entityRecords)
        .where(
          and(
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.deleted, false),
          ),
        );
      const candidates = legacyFileOwnerCandidates(legacyRecords, objectPath);
      if (candidates.length !== 1) {
        throw new LegacyFileNotClaimableError();
      }
      const legacyOwner = candidates[0]!;
      const candidateOwnership: FileOwnershipRecord = {
        tenantId: actor.tenantId,
        objectPath,
        entity: legacyOwner.entity,
        recordId: legacyOwner.id,
      };
       if (!(await canReadOwnedFile(actor, objectPath, candidateOwnership, legacyOwner))) {
        throw new LegacyFileNotClaimableError();
      }
      const [claimedOwnership] = await tx
        .insert(fileOwnership)
        .values({
          id: randomUUID(),
          tenantId: actor.tenantId,
          objectPath,
          entity: legacyOwner.entity,
          recordId: legacyOwner.id,
          createdBy: legacyOwner.createdBy ?? actor.id,
          kind: "legacy",
          name: objectPath.split("/").pop() || "legacy-file",
          contentType: "application/octet-stream",
          size: 0,
        })
        .onConflictDoNothing({
          target: [fileOwnership.tenantId, fileOwnership.objectPath],
        })
        .returning();
      if (claimedOwnership) {
        return { ownership: claimedOwnership, owner: legacyOwner };
      }

      // Another request claimed this path while this transaction was
      // resolving legacy state. Re-read the immutable winner and authorize
      // that exact owner; never fall back to the mutable candidate.
      const [winner] = await tx
        .select()
        .from(fileOwnership)
        .where(
          and(
            eq(fileOwnership.tenantId, actor.tenantId),
            eq(fileOwnership.objectPath, objectPath),
          ),
        )
        .limit(1);
      if (!winner) throw new LegacyFileNotClaimableError();
      const [winnerOwner] = await tx
        .select()
        .from(entityRecords)
        .where(
          and(
            eq(entityRecords.tenantId, actor.tenantId),
            eq(entityRecords.entity, winner.entity),
            eq(entityRecords.id, winner.recordId),
            eq(entityRecords.deleted, false),
          ),
        )
        .limit(1);
      if (
        !winnerOwner ||
         !(await canReadOwnedFile(actor, objectPath, winner, winnerOwner))
      ) {
        throw new LegacyFileNotClaimableError();
      }
      return { ownership: winner, owner: winnerOwner };
    });
  } catch (error) {
    if (!(error instanceof LegacyFileNotClaimableError)) {
      req.log.error({ err: error }, "Failed to resolve file ownership");
      res.status(503).json({ error: "File authorization is temporarily unavailable" });
      return;
    }
    res.status(404).json({ error: "File not found" });
    return;
  }
  try {
    const result = await fileStorage.createDownload(
      actor.tenantId,
      objectPath,
    );
    await audit(
      actor,
      "file.download-requested",
      "Requested a file download URL",
      objectPath,
    );
    res.json(result);
  } catch (error) {
    req.log.warn({ err: error }, "Rejected file download URL request");
    res.status(404).json({ error: "File not found" });
  }
});

export default router;