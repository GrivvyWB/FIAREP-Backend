// The Gemini API key, set from Platform Control's API (the set-gemini-key.sh
// Terminal script) instead of Replit Secrets. Stored encrypted (AES-256-GCM,
// key derived from SESSION_SECRET) in settings ("default", "command-center-keys").
// A GEMINI_API_KEY in Replit Secrets, if there is one, wins.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";

const KEY = "command-center-keys";
const TENANT = "default";
type Sealed = { iv: string; tag: string; data: string; last4: string; setAt: string; setBy: string };

const aesKey = () => createHash("sha256").update(`fiarep-command-keys:${process.env["SESSION_SECRET"] ?? ""}`).digest();
function seal(text: string): Pick<Sealed, "iv" | "tag" | "data"> {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function open(s: Sealed): string | null {
  try {
    const d = createDecipheriv("aes-256-gcm", aesKey(), Buffer.from(s.iv, "base64"));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(s.data, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}

let cache: { at: number; sealed: Sealed | null } | null = null;
async function stored(): Promise<Sealed | null> {
  if (cache && Date.now() - cache.at < 15_000) return cache.sealed;
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, TENANT), eq(settings.key, KEY))).limit(1);
  const v = (row?.value && typeof row.value === "object" ? (row.value as Record<string, unknown>)["gemini"] : null) as Sealed | null;
  cache = { at: Date.now(), sealed: v && typeof v.data === "string" ? v : null };
  return cache.sealed;
}

/** The key to call Gemini with: Replit Secrets first, then the one set from the Terminal. */
export async function geminiKey(): Promise<string | null> {
  if (process.env["GEMINI_API_KEY"]) return process.env["GEMINI_API_KEY"]!;
  const s = await stored();
  return s ? open(s) : null;
}

/** For Platform Control: is a key there, where from, and its last 4 characters (never the key). */
export async function geminiKeyStatus(): Promise<{ set: boolean; source: "replit-secrets" | "terminal" | null; last4: string | null; setAt: string | null }> {
  if (process.env["GEMINI_API_KEY"]) return { set: true, source: "replit-secrets", last4: process.env["GEMINI_API_KEY"]!.slice(-4), setAt: null };
  const s = await stored();
  return s && open(s) !== null ? { set: true, source: "terminal", last4: s.last4, setAt: s.setAt } : { set: false, source: null, last4: null, setAt: null };
}

/** Ask Google whether the key works before saving it (lists models; costs nothing). */
export async function checkGeminiKey(key: string): Promise<string | null> {
  const base = (process.env["GEMINI_BASE_URL"] || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/v1beta/models?pageSize=1`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) return null;
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    return `Google refused the key (HTTP ${r.status}${body.error?.message ? `: ${body.error.message}` : ""}).`;
  } catch (e) { return `Could not reach Google to check the key (${e instanceof Error ? e.message : "network error"}).`; }
}

export async function saveGeminiKey(key: string | null, by: string): Promise<void> {
  const now = new Date();
  const value = key ? { gemini: { ...seal(key), last4: key.slice(-4), setAt: now.toISOString(), setBy: by } } : {};
  await db.insert(settings).values({ tenantId: TENANT, key: KEY, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedAt: now } });
  cache = null;
}
