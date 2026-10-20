// The language each person's Command Center speaks. FIAREP's own Command Center
// is English. On a client's, the first time someone uses it, it asks which
// language they want; from then on it speaks that language (and listens for it)
// until they say to change it. Kept per person (settings "command-language:<staff id>").
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";
const isPlatform = (tenantId: string) => tenantId === "default"; // FIAREP's own (as in actions.ts)

export type CommandLanguage = { language: string; code: string; greeting: string };
const key = (staffId: string) => `command-language:${staffId}`;
const ENGLISH: CommandLanguage = { language: "English", code: "en", greeting: "Hey {name}, how are you doing? How can I help you today?" };

/** The person's language: English on FIAREP's own; null on a client's until they pick one. */
export async function getLanguage(tenantId: string, staffId: string): Promise<CommandLanguage | null> {
  if (isPlatform(tenantId)) return ENGLISH;
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, key(staffId)))).limit(1);
  const v = row?.value as Partial<CommandLanguage> | undefined;
  return v?.language ? { language: String(v.language), code: String(v.code || ""), greeting: String(v.greeting || ENGLISH.greeting) } : null;
}

export async function setLanguage(tenantId: string, staffId: string, input: { language: string; code: string; greeting: string }) {
  if (isPlatform(tenantId)) return { error: "FIAREP's Command Center speaks English." };
  const language = input.language.trim().slice(0, 40);
  const code = input.code.trim().toLowerCase().slice(0, 8);
  const greeting = input.greeting.trim().slice(0, 200);
  if (!language || !/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(code)) return { error: "Give the language and its ISO code (for example Korean, ko)." };
  if (!greeting.includes("{name}")) return { error: "The greeting needs {name} where the person's name goes." };
  const value = { language, code, greeting }; const now = new Date();
  await db.insert(settings).values({ tenantId, key: key(staffId), value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedAt: now } });
  return { language, code };
}

/** What the Command Center says when it opens. */
export function greetingFor(lang: CommandLanguage | null, name: string): string {
  if (!lang) return `Hey ${name}, how are you doing? What language would you like me to use?`;
  return lang.greeting.replaceAll("{name}", name);
}

/** The language part of the instructions to the model. */
export function languageRules(lang: CommandLanguage | null, platform: boolean): string {
  if (platform) return "Always reply in English.";
  if (!lang) return "This person has not picked a language yet. Before anything else, ask which language they would like you to use (ask in English, and also in their language if they wrote in another one). When they answer, call set_language, then carry on in that language.";
  return `Always reply in ${lang.language}, whatever language the message is in. Names, addresses, violation numbers and form names stay as they are. If they ask to change the language, ask which one and call set_language.`;
}
