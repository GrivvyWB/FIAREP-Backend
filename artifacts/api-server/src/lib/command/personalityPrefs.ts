// Personality engine 2.0, per person (settings "command-personality:<staff id>"):
//  - their style (friendly | companion | professional), companion until they ask for another,
//  - what they told the Command Center about how they like to be talked to (greeting, humor, length…),
//  - the conversations from earlier today, so it carries on instead of starting over,
//  - the open things to bring up when a new conversation starts (approvals waiting, draft work orders,
//    the heat / hot water / hazard alarm).
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { db, entityRecords, settings } from "@workspace/db";
import { commandActions, commandRuns, commandWorkOrders } from "./tables";

export type Mode = "friendly" | "companion" | "professional";
type Prefs = { mode: Mode; notes: string[]; voice?: "man" | "woman" };
const key = (staffId: string) => `command-personality:${staffId}`;
const MODES: Mode[] = ["friendly", "companion", "professional"];

export async function getPrefs(tenantId: string, staffId: string): Promise<Prefs> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, key(staffId)))).limit(1);
  const v = (row?.value ?? {}) as Partial<Prefs>;
  return { mode: MODES.includes(v.mode as Mode) ? (v.mode as Mode) : "companion", notes: Array.isArray(v.notes) ? v.notes.filter((n) => typeof n === "string").slice(-25) : [], ...(v.voice === "man" || v.voice === "woman" ? { voice: v.voice } : {}) };
}
async function save(tenantId: string, staffId: string, value: Prefs) {
  const now = new Date();
  await db.insert(settings).values({ tenantId, key: key(staffId), value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedAt: now } });
}
export async function setMode(tenantId: string, staffId: string, mode: string) {
  const m = mode.trim().toLowerCase() as Mode;
  if (!MODES.includes(m)) return { error: "Friendly, companion or professional." };
  await save(tenantId, staffId, { ...(await getPrefs(tenantId, staffId)), mode: m });
  return { mode: m };
}
export async function remember(tenantId: string, staffId: string, note: string) {
  const n = note.trim().slice(0, 200);
  if (!n) return { error: "Nothing to remember." };
  const p = await getPrefs(tenantId, staffId);
  if (!p.notes.some((x) => x.toLowerCase() === n.toLowerCase())) p.notes.push(n);
  await save(tenantId, staffId, { ...p, notes: p.notes.slice(-25) });
  return { remembered: n };
}
export async function forget(tenantId: string, staffId: string, note: string) {
  const p = await getPrefs(tenantId, staffId);
  const q = note.trim().toLowerCase();
  const left = q ? p.notes.filter((x) => !x.toLowerCase().includes(q)) : [];
  await save(tenantId, staffId, { ...p, notes: left });
  return { forgot: p.notes.length - left.length };
}

/** A man's or a woman's voice, picked the first time they open the Command Center (or by asking). */
export async function setVoice(tenantId: string, staffId: string, voice: string) {
  const v = voice.trim().toLowerCase().startsWith("w") || /female|lady/i.test(voice) ? "woman" : voice.trim().toLowerCase().startsWith("m") || /male|guy/i.test(voice) ? "man" : "";
  if (!v) return { error: "A man's voice or a woman's voice?" };
  await save(tenantId, staffId, { ...(await getPrefs(tenantId, staffId)), voice: v });
  return { voice: v };
}
/** The speaking voice for this person: warm and friendly either way. */
export const ttsVoice = (v?: "man" | "woman") => (v === "man" ? "ash" : "coral");

/** What the voice should sound like for this style (the words are the AI's; this is the tone of voice). */
export function voiceTone(mode: Mode): string {
  return mode === "professional" ? "Speak calmly, clearly and confidently, polite and efficient, like a trusted professional assistant."
    : mode === "friendly" ? "Speak in a warm, relaxed, friendly American tone, natural and easygoing."
    : "Speak like a warm, upbeat friend: expressive, natural American conversation, smiling in your voice, light and lively, never robotic.";
}

/** The 2.0 part of the instructions for this person and this conversation. */
export async function personalityContext(tenantId: string, staffId: string, threadId: string, runId: string, newConversation: boolean): Promise<{ mode: Mode; prompt: string }> {
  const p = await getPrefs(tenantId, staffId);
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const earlier = await db.select({ text: commandRuns.text, reply: commandRuns.reply, at: commandRuns.createdAt }).from(commandRuns)
    .where(and(eq(commandRuns.staffId, staffId), ne(commandRuns.threadId, threadId), ne(commandRuns.id, runId), eq(commandRuns.status, "done"), gt(commandRuns.createdAt, since)))
    .orderBy(desc(commandRuns.createdAt)).limit(5);
  const lines: string[] = [
    "PERSONALITY ENGINE 2.0 — ACTIVE (on for everyone):",
    `- Their style is "${p.mode}". If they ask you to be more professional, friendlier, funnier, more serious, call set_personality (friendly, companion or professional) and switch at once.`,
    "- Personality memory: when they say how they like to be talked to (a greeting, a nickname, more or less humor, shorter or longer answers, what to skip), call remember_preference with one short note, and follow it from then on. If they say to drop one, call forget_preference. Never store anything private or sensitive about them.",
  ];
  if (p.notes.length) lines.push(`- What they told you they like: ${p.notes.map((n) => `"${n}"`).join("; ")}. Follow these.`);
  if (earlier.length) {
    lines.push("- Conversation awareness: earlier today you talked about (newest first) — carry on from these when it fits instead of starting over, and don't greet them again as if it were the first time today:");
    for (const r of earlier) lines.push(`  • ${new Date(r.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}: they said "${r.text.slice(0, 140)}"${r.reply ? ` — you answered "${r.reply.slice(0, 160)}"` : ""}`);
  }
  if (newConversation) {
    const [waiting] = await db.select({ n: sql<number>`count(*)::int` }).from(commandActions).where(and(eq(commandActions.staffId, staffId), eq(commandActions.status, "proposed")));
    const [drafts] = await db.select({ n: sql<number>`count(*)::int` }).from(commandWorkOrders).where(and(eq(commandWorkOrders.tenantId, tenantId), eq(commandWorkOrders.status, "draft")));
    const [heat] = await db.select({ state: entityRecords.state }).from(entityRecords).where(and(eq(entityRecords.tenantId, tenantId), eq(entityRecords.entity, "heat-alerts"), eq(entityRecords.deleted, false), sql`${entityRecords.state}->>'ackAt' is null`)).limit(1);
    const open: string[] = [];
    if (heat) open.push(`an open heat / hot water / hazard alarm with ${((heat.state as { items?: unknown[] }).items ?? []).length} item(s) — this comes first`);
    if (waiting?.n) open.push(`${waiting.n} action(s) waiting for their approval`);
    if (drafts?.n) open.push(`${drafts.n} work order(s) prepared and waiting`);
    if (open.length) lines.push(`- Proactive: this is a new conversation. After answering what they asked, mention briefly, once: ${open.join("; ")}. Don't repeat it later in the conversation.`);
  }
  return { mode: p.mode, prompt: lines.join("\n") };
}
