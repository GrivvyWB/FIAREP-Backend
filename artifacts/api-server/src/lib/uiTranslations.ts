// The app and website in each person's language.
//
// The screens are written in English. When somebody picks another language, the
// words on their screen are sent here; each line is translated once per language
// (OpenAI, the same key as the Translator) and kept in the database, so every
// later screen, person and phone gets it straight from the table with no AI cost.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/** The languages a person can pick, by code. English is the original. */
export const UI_LANGUAGES: Record<string, { name: string; rtl?: boolean }> = {
  en: { name: "English" }, es: { name: "Spanish" }, zh: { name: "Chinese (Simplified)" }, "zh-TW": { name: "Chinese (Traditional)" },
  yue: { name: "Cantonese (Traditional Chinese characters)" }, ru: { name: "Russian" }, bn: { name: "Bengali" }, ht: { name: "Haitian Creole" },
  ko: { name: "Korean" }, ar: { name: "Arabic", rtl: true }, fr: { name: "French" }, pl: { name: "Polish" }, ur: { name: "Urdu", rtl: true },
  yi: { name: "Yiddish", rtl: true }, it: { name: "Italian" }, pt: { name: "Portuguese" }, hi: { name: "Hindi" }, pa: { name: "Punjabi" },
  sq: { name: "Albanian" }, vi: { name: "Vietnamese" }, tl: { name: "Tagalog" }, el: { name: "Greek" }, he: { name: "Hebrew", rtl: true },
  ja: { name: "Japanese" }, uk: { name: "Ukrainian" }, tr: { name: "Turkish" }, de: { name: "German" }, nl: { name: "Dutch" },
  fa: { name: "Persian (Farsi)", rtl: true }, sw: { name: "Swahili" }, wo: { name: "Wolof" }, ff: { name: "Fulani" },
};

/** Each language by its own name, as the picker shows it ("Español"). */
export const NATIVE_NAMES: Record<string, string> = {"en": "English", "es": "Español", "zh": "简体中文", "zh-TW": "繁體中文", "yue": "粵語", "ru": "Русский", "bn": "বাংলা", "ht": "Kreyòl ayisyen", "ko": "한국어", "ar": "العربية", "fr": "Français", "pl": "Polski", "ur": "اردو", "yi": "ייִדיש", "it": "Italiano", "pt": "Português", "hi": "हिन्दी", "pa": "ਪੰਜਾਬੀ", "sq": "Shqip", "vi": "Tiếng Việt", "tl": "Tagalog", "el": "Ελληνικά", "he": "עברית", "ja": "日本語", "uk": "Українська", "tr": "Türkçe", "de": "Deutsch", "nl": "Nederlands", "fa": "فارسی", "sw": "Kiswahili", "wo": "Wolof", "ff": "Fulfulde"};

const MAX_LEN = 300;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export async function ensureUiTranslationsTable() {
  await db.execute(sql`create table if not exists ui_translations (
    lang text not null, source_hash text not null, source text not null, translation text not null,
    created_at timestamptz not null default now(), primary key (lang, source_hash))`);
}

/** Every line already translated into this language. */
export async function dictionary(lang: string): Promise<Record<string, string>> {
  const r = await db.execute(sql`select source, translation from ui_translations where lang = ${lang}`);
  const rows = ((r as unknown as { rows?: Array<{ source: string; translation: string }> }).rows ?? (r as unknown as Array<{ source: string; translation: string }>));
  return Object.fromEntries(rows.map((x) => [x.source, x.translation]));
}

async function aiTranslate(lines: string[], language: string, apiKey: string): Promise<string[]> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: `You translate the screens of FIAREP, a property-management and housing-repair app (buttons, menu items, headings, labels, short messages), from English into ${language}. Keep each translation short and natural for an app screen. Keep unchanged: the name FIAREP, people's names, street addresses, apartment numbers, codes and IDs, email addresses, web links, numbers, money amounts and dates. Keep leading emoji and punctuation. Return exactly one translation per input line, in the same order.` },
        { role: "user", content: JSON.stringify(lines) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "ui_translations", strict: true, schema: { type: "object", additionalProperties: false, required: ["translations"], properties: { translations: { type: "array", items: { type: "string" } } } } } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const out = (JSON.parse(data.choices?.[0]?.message?.content || "{}") as { translations?: unknown }).translations;
  if (!Array.isArray(out) || out.length !== lines.length) throw new Error("Translation came back the wrong length");
  return out.map((x, i) => (typeof x === "string" && x.trim() ? x : lines[i]!));
}

// One translation run per language at a time, so two screens asking for the same words don't pay twice.
const running = new Map<string, Promise<unknown>>();

/** Translations for these lines: from the table, the rest translated now and kept. */
export async function translateLines(lang: string, lines: string[], apiKey: string | undefined): Promise<Record<string, string>> {
  const language = UI_LANGUAGES[lang]?.name;
  if (!language || lang === "en") return {};
  const wanted = [...new Set(lines.map((l) => (typeof l === "string" ? l.trim() : "")).filter((l) => l && l.length <= MAX_LEN && /\p{L}/u.test(l)))].slice(0, 200);
  if (!wanted.length) return {};
  const prior = running.get(lang); if (prior) await prior.catch(() => undefined);
  const lookup = async () => {
    const hashes = wanted.map(hash);
    const r = await db.execute(sql`select source, translation from ui_translations where lang = ${lang} and source_hash in (${sql.join(hashes.map((h) => sql`${h}`), sql`, `)})`);
    const rows = ((r as unknown as { rows?: Array<{ source: string; translation: string }> }).rows ?? (r as unknown as Array<{ source: string; translation: string }>));
    return Object.fromEntries(rows.map((x) => [x.source, x.translation])) as Record<string, string>;
  };
  const have = await lookup();
  const missing = wanted.filter((l) => !(l in have));
  if (!missing.length || !apiKey) return have;
  const job = (async () => {
    for (let i = 0; i < missing.length; i += 60) {
      const chunk = missing.slice(i, i + 60);
      try {
        const done = await aiTranslate(chunk, language, apiKey);
        for (let j = 0; j < chunk.length; j += 1) {
          await db.execute(sql`insert into ui_translations (lang, source_hash, source, translation) values (${lang}, ${hash(chunk[j]!)}, ${chunk[j]!}, ${done[j]!}) on conflict (lang, source_hash) do nothing`);
          have[chunk[j]!] = done[j]!;
        }
      } catch (err) { logger.warn({ err, lang }, "Screen translation failed"); }
    }
  })();
  running.set(lang, job);
  try { await job; } finally { if (running.get(lang) === job) running.delete(lang); }
  return have;
}
