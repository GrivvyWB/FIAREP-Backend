// Live translator for field staff: what a resident says in their language,
// in English; what the staff member replies, back in the resident's
// language, as text and as speech. OpenAI does the work; nothing is stored.

type FetchLike = typeof fetch;

export type TranslateResult = {
  detectedLanguage: string;   // e.g. "Spanish"
  detectedCode: string;       // BCP-47-ish, e.g. "es"
  translation: string;
};

const withTimeout = async <T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await run(controller.signal); } finally { clearTimeout(timer); }
};

export async function translateText(
  text: string,
  targetLanguage: string,
  apiKey: string,
  sourceLanguage = "auto",
  fetchImpl: FetchLike = fetch,
): Promise<TranslateResult> {
  const response = await withTimeout(30_000, (signal) => fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: "You are a precise interpreter for a housing field worker talking with a tenant. Translate the user's text faithfully and naturally, keeping the meaning, tone and any names, addresses, apartment numbers, dates and amounts exactly. Do not add commentary. Detect the language the text is written in.",
        },
        {
          role: "user",
          content: `Source language: ${sourceLanguage === "auto" ? "detect it" : sourceLanguage}\nTarget language: ${targetLanguage}\n\nText:\n${text}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "translation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["detectedLanguage", "detectedCode", "translation"],
            properties: {
              detectedLanguage: { type: "string", description: "English name of the source language, e.g. Spanish" },
              detectedCode: { type: "string", description: "BCP-47 code of the source language, e.g. es, zh-CN, ht" },
              translation: { type: "string" },
            },
          },
        },
      },
    }),
  }));
  if (!response.ok) throw new Error(`OpenAI translate failed (${response.status})`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no translation");
  const parsed = JSON.parse(content) as TranslateResult;
  if (typeof parsed.translation !== "string") throw new Error("OpenAI returned an invalid translation");
  return {
    detectedLanguage: String(parsed.detectedLanguage || ""),
    detectedCode: String(parsed.detectedCode || ""),
    translation: parsed.translation,
  };
}

/** Speech → text. `audioBase64` is the recording (webm/opus, mp4/aac, wav…). */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  apiKey: string,
  languageHint = "",
  fetchImpl: FetchLike = fetch,
): Promise<{ text: string }> {
  const bytes = Buffer.from(audioBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
  const ext = mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a"
    : mimeType.includes("wav") ? "wav"
    : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3"
    : mimeType.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType || "audio/webm" }), `speech.${ext}`);
  form.append("model", "gpt-4o-mini-transcribe");
  if (languageHint && languageHint !== "auto") form.append("language", languageHint);
  const response = await withTimeout(60_000, (signal) => fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", signal, headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  }));
  if (!response.ok) throw new Error(`OpenAI transcribe failed (${response.status})`);
  const payload = await response.json() as { text?: string };
  return { text: String(payload.text || "").trim() };
}

/** Text → speech (mp3), so the phone or browser can say it out loud. */
export async function synthesizeSpeech(
  text: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ audioBase64: string; mimeType: string }> {
  const response = await withTimeout(60_000, (signal) => fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text.slice(0, 4000), response_format: "mp3" }),
  }));
  if (!response.ok) throw new Error(`OpenAI speech failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { audioBase64: buffer.toString("base64"), mimeType: "audio/mpeg" };
}
