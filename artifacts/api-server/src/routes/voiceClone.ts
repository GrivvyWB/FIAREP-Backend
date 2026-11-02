// Voice Recorder: record a voice, ElevenLabs makes a copy of it, and the system talks back in that voice
// (the pitch slider is applied on the phone). Anyone's voice may be recorded, but only with their consent:
// the recording must start with them saying "I, <name>, agree to have my voice copied by FIAREP." — it is
// transcribed and checked before anything is sent to ElevenLabs. Each person sees and uses only the voices
// they recorded. Key: ELEVENLABS_API_KEY (Replit Secrets).
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";
import { actorFrom, requireAuth } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { transcribeAudio } from "../lib/translator";

const router: IRouter = Router();
const EL = "https://api.elevenlabs.io";
type Voice = { id: string; voiceId: string; name: string; speaker: string; consent: string; createdAt: string };
const key = (staffId: string) => `voice-clones:${staffId}`;
const elKey = () => process.env["ELEVENLABS_API_KEY"] || "";

async function list(tenantId: string, staffId: string): Promise<Voice[]> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, tenantId), eq(settings.key, key(staffId)))).limit(1);
  return Array.isArray((row?.value as { voices?: Voice[] } | undefined)?.voices) ? (row!.value as { voices: Voice[] }).voices : [];
}
async function save(tenantId: string, staffId: string, voices: Voice[]) {
  const now = new Date();
  await db.insert(settings).values({ tenantId, key: key(staffId), value: { voices }, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: { voices }, updatedAt: now } });
}
/** The consent line was said: "agree" and "voice" near the start, and the speaker's name when given. */
function consented(transcript: string, speaker: string): boolean {
  const start = transcript.toLowerCase().slice(0, 400);
  const first = speaker.trim().split(/\s+/)[0]?.toLowerCase() || "";
  return /\bagree\b/.test(start) && /\bvoice\b/.test(start) && (!first || first.length < 2 || start.includes(first));
}

router.get("/ai/voices", requireAuth, async (_req, res) => {
  const a = actorFrom(res);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ready: !!elKey(), voices: (await list(a.tenantId, a.id)).map(({ id, name, speaker, createdAt }) => ({ id, name, speaker, createdAt })) });
});

router.post("/ai/voices", requireAuth, async (req, res) => {
  const a = actorFrom(res);
  if (!elKey()) { res.status(503).json({ error: "Voice copying isn't set up yet." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const audio = typeof b["audio"] === "string" ? b["audio"] : "";
  const mimeType = typeof b["mimeType"] === "string" ? b["mimeType"] : "audio/mp4";
  const speaker = String(b["speaker"] ?? "").trim().slice(0, 80);
  const name = String(b["name"] ?? speaker).trim().slice(0, 60) || "My voice";
  if (!audio || audio.length < 40_000) { res.status(400).json({ error: "Record at least 30 seconds." }); return; }
  if (!speaker) { res.status(400).json({ error: "Whose voice is it?" }); return; }
  const oa = process.env["OPENAI_API_KEY"];
  if (!oa) { res.status(503).json({ error: "The consent check is unavailable right now." }); return; }
  let transcript = "";
  try { transcript = (await transcribeAudio(audio, mimeType, oa, "", fetch, "I agree to have my voice copied by FIAREP")).text || ""; }
  catch { res.status(503).json({ error: "Couldn't check the recording. Try again." }); return; }
  if (!consented(transcript, speaker)) {
    res.status(400).json({ error: `The recording has to start with ${speaker} saying: "I, ${speaker}, agree to have my voice copied by FIAREP." Record it again.` }); return;
  }
  const form = new FormData();
  form.append("name", `${name} (FIAREP ${a.id.slice(0, 8)})`);
  form.append("description", `Recorded in FIAREP by ${a.name}; consent said by ${speaker}.`);
  form.append("files", new Blob([Buffer.from(audio, "base64")], { type: mimeType }), mimeType.includes("mp4") || mimeType.includes("m4a") ? "voice.m4a" : "voice.webm");
  const r = await fetch(`${EL}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": elKey() }, body: form, signal: AbortSignal.timeout(120_000) });
  const data = (await r.json().catch(() => ({}))) as { voice_id?: string; detail?: { message?: string } | string };
  if (!r.ok || !data.voice_id) {
    const why = typeof data.detail === "string" ? data.detail : data.detail?.message;
    res.status(502).json({ error: `ElevenLabs didn't take it${why ? `: ${why}` : ""}.` }); return;
  }
  const v: Voice = { id: randomUUID(), voiceId: data.voice_id, name, speaker, consent: transcript.slice(0, 200), createdAt: new Date().toISOString() };
  await save(a.tenantId, a.id, [...(await list(a.tenantId, a.id)), v]);
  await audit(a, "voice.copied", `${name} · consent said by ${speaker}`, v.id);
  res.status(201).json({ id: v.id, name, speaker, createdAt: v.createdAt });
});

router.post("/ai/voices/:id/speak", requireAuth, async (req, res) => {
  const a = actorFrom(res);
  if (!elKey()) { res.status(503).json({ error: "Voice copying isn't set up yet." }); return; }
  const v = (await list(a.tenantId, a.id)).find((x) => x.id === String(req.params["id"]));
  if (!v) { res.status(404).json({ error: "That voice is gone." }); return; }
  const text = String((req.body as Record<string, unknown> | undefined)?.["text"] ?? "").trim().slice(0, 2000);
  if (!text) { res.status(400).json({ error: "What should it say?" }); return; }
  const r = await fetch(`${EL}/v1/text-to-speech/${encodeURIComponent(v.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": elKey(), "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }), signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) { res.status(502).json({ error: `ElevenLabs couldn't say it (${r.status}).` }); return; }
  res.json({ audioBase64: Buffer.from(await r.arrayBuffer()).toString("base64"), mimeType: "audio/mpeg" });
});

router.delete("/ai/voices/:id", requireAuth, async (req, res) => {
  const a = actorFrom(res);
  const all = await list(a.tenantId, a.id);
  const v = all.find((x) => x.id === String(req.params["id"]));
  if (!v) { res.status(404).json({ error: "That voice is gone." }); return; }
  // The copy is taken off ElevenLabs too, so the voice can't be used again.
  if (elKey()) await fetch(`${EL}/v1/voices/${encodeURIComponent(v.voiceId)}`, { method: "DELETE", headers: { "xi-api-key": elKey() } }).catch(() => undefined);
  await save(a.tenantId, a.id, all.filter((x) => x.id !== v.id));
  await audit(a, "voice.removed", v.name, v.id);
  res.json({ ok: true });
});

export default router;
