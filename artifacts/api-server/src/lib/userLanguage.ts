// A person's own language (Settings → Language). The Command Center speaks it on
// a client's account (FIAREP's own stays English). US forms stay in English and US
// format; what someone typed in their language can be rewritten in English.
// Same record the Command Center's set_language writes.
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";
import { translateList } from "./translator";

export const LANGUAGES: Array<{ code: string; name: string; native: string }> = [
  { code: "en", name: "English", native: "English" }, { code: "es", name: "Spanish", native: "Español" },
  { code: "zh", name: "Chinese (Simplified)", native: "简体中文" }, { code: "zh-tw", name: "Chinese (Traditional)", native: "繁體中文" },
  { code: "ru", name: "Russian", native: "Русский" }, { code: "ko", name: "Korean", native: "한국어" },
  { code: "bn", name: "Bengali", native: "বাংলা" }, { code: "ht", name: "Haitian Creole", native: "Kreyòl ayisyen" },
  { code: "ar", name: "Arabic", native: "العربية" }, { code: "fr", name: "French", native: "Français" },
  { code: "pl", name: "Polish", native: "Polski" }, { code: "ur", name: "Urdu", native: "اردو" },
  { code: "yi", name: "Yiddish", native: "ייִדיש" }, { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" }, { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" }, { code: "ja", name: "Japanese", native: "日本語" },
  { code: "tl", name: "Tagalog", native: "Tagalog" }, { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "el", name: "Greek", native: "Ελληνικά" }, { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "sq", name: "Albanian", native: "Shqip" }, { code: "he", name: "Hebrew", native: "עברית" },
  { code: "tr", name: "Turkish", native: "Türkçe" }, { code: "de", name: "German", native: "Deutsch" },
];
const key = (staffId: string) => `command-language:${staffId}`;
const ENGLISH_GREETING = "Hey {name}, how are you doing? How can I help you today?";

export async function savedLanguage(tenantId: string, staffId: string): Promise<{ language: string; code: string } | null> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, key(staffId)))).limit(1);
  const v = row?.value as { language?: string; code?: string; picked?: string } | undefined;
  // code: the entry in the list it was picked from (Chinese Traditional is zh-tw there, zh for listening).
  return v?.language ? { language: String(v.language), code: String(v.picked || v.code || "") } : null;
}

/** Settings → Language. The Command Center greeting is written in the language too. */
export async function saveLanguage(tenantId: string, staffId: string, code: string) {
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) return { error: "Pick a language from the list." };
  let greeting = ENGLISH_GREETING;
  if (lang.code !== "en") {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (apiKey) { try { const [g] = await translateList([ENGLISH_GREETING], lang.name, apiKey, "This is a friendly greeting; keep {name} exactly where the person's name goes."); if (g && g.includes("{name}")) greeting = g; } catch { /* English greeting until the next save */ } }
  }
  const value = { language: lang.name, code: lang.code === "zh-tw" ? "zh" : lang.code, greeting, picked: lang.code }; const now = new Date();
  await db.insert(settings).values({ tenantId, key: key(staffId), value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedAt: now } });
  return { language: lang.name, code: lang.code };
}

/** What someone typed in their own language, in English for the City's form. Only lines that are not already English. */
export async function answersToEnglish(values: Record<string, unknown>): Promise<Record<string, unknown> | { error: string }> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return { error: "Translation is not set up (AI key)." };
  const keys = Object.keys(values).filter((k) => typeof values[k] === "string" && /[^\x00-\x7F]/.test(values[k] as string));
  if (!keys.length) return {};
  const tr = await translateList(keys.map((k) => values[k] as string), "English", apiKey, "These are answers typed into a New York City housing form; write them in plain American English as they would appear on the form.");
  return Object.fromEntries(keys.map((k, i) => [k, tr[i]]));
}
