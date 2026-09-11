import { randomUUID } from "node:crypto";

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
    const prefix = `/objects/tenants/${safeSegment(tenantId)}/`;
    if (!objectPath.startsWith(prefix) || objectPath.includes("..")) {
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

export const fileStorage = new ReplitFileStorage();