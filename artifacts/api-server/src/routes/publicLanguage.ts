// Public routes with no FIAREP sign-in, mounted before the staff routers (which require
// a sign-in for everything after them): the website and app in each person's language,
// and the Translator for residents and vendors.
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, organizations } from "@workspace/db";
import { rateLimit } from "../lib/rateLimit";
import { organizationForResidentCode } from "../lib/residentRouting";
import { synthesizeSpeech, transcribeAudio, translateText } from "../lib/translator";
import { NATIVE_NAMES, UI_LANGUAGES, dictionary, translateLines } from "../lib/uiTranslations";
import { tenantForVendorCode } from "./publicAccess";

const router: IRouter = Router();

function openAiKey(res: { status: (n: number) => { json: (b: unknown) => void } }): string | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) res.status(503).json({ error: "The translator is unavailable (AI key not configured)" });
  return apiKey || null;
}

// ── The Translator for residents and vendors (no FIAREP sign-in) ──
// A resident proves their company with the phone's resident code, a vendor with the
// code Procurement emailed. Platform Control decides: the Translator module, and the
// Translator button on the Resident or Vendor home.
async function publicTranslatorAllowed(body: Record<string, unknown>): Promise<boolean> {
  const residentCode = typeof body["residentCode"] === "string" ? body["residentCode"] : "";
  const vendorCode = typeof body["vendorCode"] === "string" ? body["vendorCode"].trim().slice(0, 40) : "";
  let tenantId: string | null = null; let screen = "";
  if (residentCode) { tenantId = (await organizationForResidentCode(residentCode))?.id ?? null; screen = "resident"; }
  else if (vendorCode) { tenantId = await tenantForVendorCode(vendorCode); screen = "vendor"; }
  if (!tenantId) return false;
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  const modules = ((org?.features as { modules?: Record<string, unknown> } | null)?.modules || {}) as Record<string, unknown>;
  return modules["translator"] !== false && modules[`apptab.${screen}.translator`] !== false;
}

// ── The app and website in each person's language (lib/uiTranslations.ts) ──
router.get("/v1/public/i18n/languages", (_req, res) => {
  res.json(Object.entries(UI_LANGUAGES).map(([code, l]) => ({ code, name: NATIVE_NAMES[code] && NATIVE_NAMES[code] !== l.name.split(" (")[0] ? `${NATIVE_NAMES[code]} — ${l.name}` : l.name, rtl: !!l.rtl })));
});
router.get("/v1/public/i18n/:lang", rateLimit("i18n-dictionary", 60), async (req, res) => {
  const lang = String(req.params["lang"]);
  if (!UI_LANGUAGES[lang]) { res.status(404).json({ error: "Unknown language" }); return; }
  res.setHeader("Cache-Control", "no-cache");
  res.json(lang === "en" ? {} : await dictionary(lang).catch(() => ({})));
});
router.post("/v1/public/i18n/:lang", rateLimit("i18n-translate", 30), async (req, res) => {
  const lang = String(req.params["lang"]);
  if (!UI_LANGUAGES[lang]) { res.status(404).json({ error: "Unknown language" }); return; }
  const lines = Array.isArray((req.body as { lines?: unknown })?.lines) ? ((req.body as { lines: unknown[] }).lines.filter((l) => typeof l === "string") as string[]) : [];
  res.json(await translateLines(lang, lines, process.env.OPENAI_API_KEY).catch(() => ({})));
});

/** The resident line ("Talk to us" / the company's name button) for a company: Platform Control →
 *  Module Management → App tabs → Resident home → Talk to us. On unless switched off. */
export async function residentLineOn(residentCode: string): Promise<boolean> {
  const org = residentCode ? await organizationForResidentCode(residentCode) : null;
  if (!org) return true; // no company yet: the line finds it
  const [row] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, org.id)).limit(1);
  const modules = ((row?.features as { modules?: Record<string, unknown> } | null)?.modules || {}) as Record<string, unknown>;
  return modules["apptab.resident.talk-to-us"] !== false;
}
router.get("/v1/public/resident-switches", rateLimit("public-resident-switches", 60), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const code = typeof req.query["residentCode"] === "string" ? req.query["residentCode"] : "";
  res.json({ line: await residentLineOn(code).catch(() => true), translator: await publicTranslatorAllowed({ residentCode: code }).catch(() => false) });
});

router.get("/v1/public/translator-switch", rateLimit("public-translator-switch", 60), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ on: await publicTranslatorAllowed({ residentCode: req.query["residentCode"], vendorCode: req.query["vendorCode"] }).catch(() => false) });
});

router.post("/v1/public/translator/:op", rateLimit("public-translator", 40), async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  if (!(await publicTranslatorAllowed(body))) { res.status(403).json({ error: "The Translator is not on for this company." }); return; }
  const apiKey = openAiKey(res); if (!apiKey) return;
  const op = String(req.params["op"]);
  try {
    if (op === "translate") {
      const text = typeof body["text"] === "string" ? body["text"].trim().slice(0, 4000) : "";
      const to = typeof body["to"] === "string" ? body["to"].trim().slice(0, 60) : "";
      const from = typeof body["from"] === "string" && body["from"].trim() ? body["from"].trim().slice(0, 60) : "auto";
      if (!text || !to) { res.status(400).json({ error: "text and to are required" }); return; }
      res.json(await translateText(text, to, apiKey, from)); return;
    }
    if (op === "transcribe") {
      const audio = typeof body["audio"] === "string" ? body["audio"] : "";
      if (!audio || audio.length > 12_000_000) { res.status(400).json({ error: "audio is required" }); return; }
      res.json(await transcribeAudio(audio, typeof body["mimeType"] === "string" ? body["mimeType"] : "audio/mp4", apiKey, typeof body["language"] === "string" ? body["language"] : "", fetch, "")); return;
    }
    if (op === "speak") {
      const text = typeof body["text"] === "string" ? body["text"].trim().slice(0, 4000) : "";
      if (!text) { res.status(400).json({ error: "text is required" }); return; }
      res.json(await synthesizeSpeech(text, apiKey)); return;
    }
    res.status(404).json({ error: "Not found" });
  } catch (error) {
    req.log.warn({ err: error, op }, "Public translator failed");
    res.status(503).json({ error: "The Translator is temporarily unavailable — try again." });
  }
});

export default router;
