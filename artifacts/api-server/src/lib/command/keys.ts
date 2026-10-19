// API keys for the Command Center, set from the Terminal (set-gemini-key.sh,
// set-maps-key.sh) instead of Replit Secrets. Stored encrypted (AES-256-GCM,
// key derived from SESSION_SECRET) in settings ("default", "command-center-keys").
// The same key in Replit Secrets, if there is one, wins.
//   gemini      GEMINI_API_KEY        Google AI Studio (the Gemini engine)
//   googleMaps  GOOGLE_MAPS_API_KEY   Google Maps Routes API (drive time between jobs)
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";

export type KeyName = "gemini" | "googleMaps";
export const KEY_ENV: Record<KeyName, string> = { gemini: "GEMINI_API_KEY", googleMaps: "GOOGLE_MAPS_API_KEY" };
const KEY = "command-center-keys";
const TENANT = "default";
export type Sealed = { iv: string; tag: string; data: string; last4: string; setAt: string; setBy: string };

const aesKey = () => createHash("sha256").update(`fiarep-command-keys:${process.env["SESSION_SECRET"] ?? ""}`).digest();
export function seal(text: string): Pick<Sealed, "iv" | "tag" | "data"> {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
export function open(s: Sealed): string | null {
  try {
    const d = createDecipheriv("aes-256-gcm", aesKey(), Buffer.from(s.iv, "base64"));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(s.data, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}

let cache: { at: number; all: Record<string, Sealed> } | null = null;
async function storedAll(): Promise<Record<string, Sealed>> {
  if (cache && Date.now() - cache.at < 15_000) return cache.all;
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, TENANT), eq(settings.key, KEY))).limit(1);
  const v = (row?.value && typeof row.value === "object" ? row.value : {}) as Record<string, Sealed>;
  const all = Object.fromEntries(Object.entries(v).filter(([, s]) => s && typeof s.data === "string"));
  cache = { at: Date.now(), all };
  return all;
}

/** The key to use: Replit Secrets first, then the one set from the Terminal. */
export async function apiKey(name: KeyName): Promise<string | null> {
  const env = process.env[KEY_ENV[name]];
  if (env) return env;
  const s = (await storedAll())[name];
  return s ? open(s) : null;
}

export type KeyStatus = { set: boolean; source: "replit-secrets" | "terminal" | null; last4: string | null; setAt: string | null };
/** Is a key there, where from, and its last 4 characters (never the key). */
export async function keyStatus(name: KeyName): Promise<KeyStatus> {
  const env = process.env[KEY_ENV[name]];
  if (env) return { set: true, source: "replit-secrets", last4: env.slice(-4), setAt: null };
  const s = (await storedAll())[name];
  return s && open(s) !== null ? { set: true, source: "terminal", last4: s.last4, setAt: s.setAt } : { set: false, source: null, last4: null, setAt: null };
}

/** Ask Google whether the key works before saving it. Both checks cost nothing. */
export async function checkKey(name: KeyName, key: string): Promise<string | null> {
  try {
    let r: Response;
    if (name === "gemini") {
      const base = (process.env["GEMINI_BASE_URL"] || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
      r = await fetch(`${base}/v1beta/models?pageSize=1`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15_000) });
    } else {
      // An empty Routes request: a good key answers 400 "invalid argument"; a bad key answers 400/403 with API_KEY_INVALID or PERMISSION_DENIED.
      const base = (process.env["GOOGLE_ROUTES_BASE_URL"] || "https://routes.googleapis.com").replace(/\/$/, "");
      r = await fetch(`${base}/directions/v2:computeRoutes`, { method: "POST", headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.duration", "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
      const body = (await r.json().catch(() => ({}))) as { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } };
      const bad = r.status === 403 || body.error?.status === "PERMISSION_DENIED" || (body.error?.details ?? []).some((d) => d.reason === "API_KEY_INVALID");
      return bad ? `Google refused the key (${body.error?.message ?? `HTTP ${r.status}`}). Check that "Routes API" is enabled for it in Google Cloud.` : null;
    }
    if (r.ok) return null;
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    return `Google refused the key (HTTP ${r.status}${body.error?.message ? `: ${body.error.message}` : ""}).`;
  } catch (e) { return `Could not reach Google to check the key (${e instanceof Error ? e.message : "network error"}).`; }
}

export async function saveKey(name: KeyName, key: string | null, by: string): Promise<void> {
  const now = new Date();
  const all = { ...(await storedAll()) };
  if (key) all[name] = { ...seal(key), last4: key.slice(-4), setAt: now.toISOString(), setBy: by };
  else delete all[name];
  await db.insert(settings).values({ tenantId: TENANT, key: KEY, value: all, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: all, updatedAt: now } });
  cache = null;
}

// Gemini names kept for the engine and Platform Control.
export const geminiKey = () => apiKey("gemini");
export const geminiKeyStatus = () => keyStatus("gemini");
