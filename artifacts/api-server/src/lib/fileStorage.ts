import { randomUUID } from "node:crypto";
import type { Actor } from "./auth";
import { canReadEntityRecordForActor } from "./hrAuthorization";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const UPLOAD_TTL_SECONDS = 15 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

export const FILE_KINDS = [
  "room-photo",
  "inspection-evidence",
  "completion-photo",
  "scan",
  "procurement-scope",
  "resident-report-photo",
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

export type StoredFileEnvelope = {
  id: string;
  kind: FileKind;
  name: string;
  size: number;
  contentType: string;
  objectPath: string;
  createdAt: string;
  createdBy: string;
};

type SignedMethod = "GET" | "PUT";

export type FileOwnershipRecord = {
  tenantId: string;
  objectPath: string;
  entity: string;
  recordId: string;
};

export type FileOwnerRecord = {
  tenantId: string;
  entity: string;
  id: string;
  deleted: boolean;
  development: string | null;
  state: Record<string, unknown>;
  createdBy: string | null;
};

/** Legacy records are consulted only while claiming an unowned path. */
export function stateReferencesObjectPath(
  value: unknown,
  objectPath: string,
  seen = new Set<object>(),
): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => stateReferencesObjectPath(item, objectPath, seen));
  }
  const record = value as Record<string, unknown>;
  if (record["objectPath"] === objectPath) return true;
  return Object.values(record).some((item) =>
    stateReferencesObjectPath(item, objectPath, seen),
  );
}

export function legacyFileOwnerCandidates(
  records: FileOwnerRecord[],
  objectPath: string,
): FileOwnerRecord[] {
  return records.filter((record) => stateReferencesObjectPath(record.state, objectPath));
}

export function isSafeTenantObjectPath(
  tenantId: string,
  objectPath: string,
): boolean {
  const prefix = `/objects/tenants/${safeSegment(tenantId)}/`;
  let decodedPath = objectPath;
  try {
    decodedPath = decodeURIComponent(objectPath);
  } catch {
    return false;
  }
  return objectPath.startsWith(prefix) &&
    !objectPath.includes("..") &&
    !objectPath.includes("\\") &&
    !decodedPath.includes("..") &&
    !decodedPath.includes("\\");
}

/**
 * Authorizes the immutable ownership row against the exact current owner
 * record. No mutable JSON file references participate in this decision.
 */
export async function canReadOwnedFile(
  actor: Actor,
  requestedObjectPath: string,
  ownership: FileOwnershipRecord,
  owner: FileOwnerRecord,
): Promise<boolean> {
  return ownership.tenantId === actor.tenantId &&
    ownership.objectPath === requestedObjectPath &&
    ownership.entity === owner.entity &&
    ownership.recordId === owner.id &&
    owner.tenantId === actor.tenantId &&
    await canReadEntityRecordForActor(actor, owner);
}

function privateObjectDir(): string {
  const value = process.env["PRIVATE_OBJECT_DIR"]?.replace(/\/+$/, "");
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is required");
  return value;
}

function parseStoragePath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const [, bucketName, ...objectParts] = normalized.split("/");
  const objectName = objectParts.join("/");
  if (!bucketName || !objectName) throw new Error("Invalid object storage path");
  return { bucketName, objectName };
}

function safeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

async function signObjectUrl(
  fullPath: string,
  method: SignedMethod,
  ttlSeconds: number,
): Promise<string> {
  const { bucketName, objectName } = parseStoragePath(fullPath);
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Object storage signing failed with status ${response.status}`);
  }
  const result = (await response.json()) as { signed_url?: unknown };
  if (typeof result.signed_url !== "string") {
    throw new Error("Object storage signing returned an invalid response");
  }
  return result.signed_url;
}

export class ReplitFileStorage {
  private fullPath(tenantId: string, objectPath: string): string {
    if (!isSafeTenantObjectPath(tenantId, objectPath)) {
      throw new Error("File does not belong to this tenant");
    }
    return `${privateObjectDir()}/${objectPath.slice("/objects/".length)}`;
  }

  async createUpload(
    tenantId: string,
    createdBy: string,
    input: {
      kind: FileKind;
      name: string;
      size: number;
      contentType: string;
    },
  ): Promise<{ uploadUrl: string; file: StoredFileEnvelope }> {
    const id = randomUUID();
    const relativePath = `tenants/${safeSegment(tenantId)}/${input.kind}/${id}`;
    const uploadUrl = await signObjectUrl(
      `${privateObjectDir()}/${relativePath}`,
      "PUT",
      UPLOAD_TTL_SECONDS,
    );
    return {
      uploadUrl,
      file: {
        id,
        ...input,
        objectPath: `/objects/${relativePath}`,
        createdAt: new Date().toISOString(),
        createdBy,
      },
    };
  }

  async createDownload(
    tenantId: string,
    objectPath: string,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const downloadUrl = await signObjectUrl(
      this.fullPath(tenantId, objectPath),
      "GET",
      DOWNLOAD_TTL_SECONDS,
    );
    return { downloadUrl, expiresIn: DOWNLOAD_TTL_SECONDS };
  }
}

/** Smart Repair drawings (tools, materials, parts, diagrams). Not tenant data:
 *  a drawing of an adjustable wrench is the same for everyone, so it is drawn
 *  once and kept under one shared folder. */
export const smartRepairArt = {
  path(key: string): string { return `${privateObjectDir()}/smart-repair-art/${safeSegment(key)}.png`; },
  async url(key: string, ttlSeconds = 60 * 60): Promise<string> { return signObjectUrl(this.path(key), "GET", ttlSeconds); },
  async exists(key: string): Promise<boolean> {
    try { const res = await fetch(await signObjectUrl(this.path(key), "GET", 60), { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(10_000) }); await res.body?.cancel().catch(() => undefined); return res.ok; } catch { return false; }
  },
  async put(key: string, bytes: Buffer): Promise<void> {
    const res = await fetch(await signObjectUrl(this.path(key), "PUT", 5 * 60), { method: "PUT", headers: { "Content-Type": "image/png" }, body: bytes, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Storing drawing failed with status ${res.status}`);
  },
};

/** Smart Repair photos kept on a person's account (Platform Control → "Smart Repair on all their phones"). */
export const smartRepairPhotos = {
  path(tenantId: string, staffId: string, repairId: string, which: "before" | "after"): string {
    return `${privateObjectDir()}/tenants/${safeSegment(tenantId)}/smart-repair-photo/${safeSegment(staffId)}/${safeSegment(repairId)}-${which}.jpg`;
  },
  uploadUrl(full: string): Promise<string> { return signObjectUrl(full, "PUT", UPLOAD_TTL_SECONDS); },
  downloadUrl(full: string): Promise<string> { return signObjectUrl(full, "GET", 60 * 60); },
  async remove(full: string): Promise<void> {
    try { const res = await fetch(await signObjectUrl(full, "DELETE" as SignedMethod, 60), { method: "DELETE", signal: AbortSignal.timeout(15_000) }); await res.body?.cancel().catch(() => undefined); } catch { /* left in storage */ }
  },
};

export const fileStorage = new ReplitFileStorage();