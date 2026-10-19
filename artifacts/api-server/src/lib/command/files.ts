// Files a computer sends to the phone ("send me the resident flyer"). The agent
// uploads the file; the phone opens it from a private link that works for 24
// hours. Kept 24 hours, then deleted.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const KEEP_MS = 24 * 3_600_000;

const TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", md: "text/plain; charset=utf-8", html: "text/plain; charset=utf-8",
  mp4: "video/mp4", mov: "video/quicktime", zip: "application/zip",
};
export const typeFor = (name: string) => TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
export const cleanName = (name: string) => (name.split(/[\\/]/).pop() || "file").replace(/[^\w .()-]/g, "_").slice(0, 120) || "file";

export async function ensureFilesTable() {
  await db.execute(sql`create table if not exists command_files (
    id text primary key, key text not null, tenant_id text not null, agent_id text not null, action_id text not null,
    name text not null, mime text not null, size integer not null, data bytea not null,
    created_at timestamptz not null default now(), expires_at timestamptz not null)`);
}

export async function saveFile(f: { tenantId: string; agentId: string; actionId: string; name: string; data: Buffer }) {
  await ensureFilesTable();
  await db.execute(sql`delete from command_files where expires_at < now()`);
  const id = randomBytes(9).toString("hex"), key = randomBytes(24).toString("base64url");
  const name = cleanName(f.name), mime = typeFor(name);
  await db.execute(sql`insert into command_files (id, key, tenant_id, agent_id, action_id, name, mime, size, data, expires_at)
    values (${id}, ${key}, ${f.tenantId}, ${f.agentId}, ${f.actionId}, ${name}, ${mime}, ${f.data.length}, ${f.data}, ${new Date(Date.now() + KEEP_MS)})`);
  return { id, key, name, mime, size: f.data.length };
}

export async function loadFile(id: string, key: string) {
  await ensureFilesTable();
  const r = await db.execute(sql`select key, name, mime, data from command_files where id = ${id} and expires_at > now() limit 1`);
  const row = (r as unknown as { rows: { key: string; name: string; mime: string; data: Buffer }[] }).rows[0];
  if (!row) return null;
  const a = Buffer.from(row.key), b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { name: row.name, mime: row.mime, data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data) };
}
