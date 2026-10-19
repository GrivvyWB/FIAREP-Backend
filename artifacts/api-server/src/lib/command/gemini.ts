// Google Gemini as the Command Center's interpreter (Platform Control →
// Command Center → Engine). Same tools, same rules, same Face ID approvals as
// Claude; only the model that reads the command changes.
//
// REST generateContent (ai.google.dev/api/generate-content, checked Oct 18 2026):
//   POST {base}/v1beta/models/{model}:generateContent   header x-goog-api-key
//   systemInstruction, contents[{role: user|model, parts}], tools[{functionDeclarations}]
//   The model's turn is sent back exactly as received (it carries thought
//   signatures on its functionCall parts); tool results go back as
//   functionResponse parts in a user turn.
// Key: GEMINI_API_KEY in Replit Secrets, or set from the Terminal (set-gemini-key.sh → keys.ts).
// GEMINI_BASE_URL is for tests only.

type Part = { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; [k: string]: unknown };
export type GeminiContent = { role: "user" | "model"; parts: Part[] };
type Tool = { name: string; description: string; input_schema: Record<string, unknown> };
type Result = { content: string; isError: boolean };

async function callGemini(model: string, system: string, tools: Tool[], contents: GeminiContent[], apiKey: string) {
  const base = (process.env["GEMINI_BASE_URL"] || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: 2048 },
  };
  if (tools.length) {
    body["tools"] = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }];
    body["toolConfig"] = { functionCallingConfig: { mode: "AUTO" } };
  }
  const response = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    candidates?: Array<{ content?: GeminiContent; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: Record<string, number>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Gemini API ${response.status}: ${data.error?.message ?? "request failed"}`);
  return data;
}

/** The tool loop with Gemini. Returns the spoken reply; adds tokens to usage
 *  (input_tokens = prompt + tool-use prompt; output_tokens = response + thinking, which Google bills as output). */
export async function geminiLoop(opts: {
  apiKey: string; model: string; system: string; tools: Tool[];
  history: Array<{ role: "user" | "assistant"; content: string }>; text: string; maxTurns: number;
  usage: Record<string, number>; runTool: (name: string, params: Record<string, unknown>) => Promise<Result>;
}): Promise<string> {
  const contents: GeminiContent[] = [
    ...opts.history.map((m) => ({ role: m.role === "assistant" ? "model" as const : "user" as const, parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: opts.text }] },
  ];
  let reply = "";
  for (let turn = 0; turn < opts.maxTurns; turn += 1) {
    const res = await callGemini(opts.model, opts.system, opts.tools, contents, opts.apiKey);
    const u = res.usageMetadata ?? {};
    opts.usage["input_tokens"] = (opts.usage["input_tokens"] ?? 0) + (u["promptTokenCount"] ?? 0) + (u["toolUsePromptTokenCount"] ?? 0);
    opts.usage["output_tokens"] = (opts.usage["output_tokens"] ?? 0) + (u["candidatesTokenCount"] ?? 0) + (u["thoughtsTokenCount"] ?? 0);
    const candidate = res.candidates?.[0];
    if (!candidate?.content) {
      if (res.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request (${res.promptFeedback.blockReason}).`);
      if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new Error(`Gemini stopped (${candidate.finishReason}).`);
      break;
    }
    const parts = candidate.content.parts ?? [];
    reply = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text!).join("\n").trim() || reply;
    const calls = parts.filter((p) => p.functionCall?.name);
    if (!calls.length) break;
    contents.push({ role: "model", parts }); // exactly as received: keeps the thought signatures
    const responses: Part[] = [];
    for (const p of calls) {
      const call = p.functionCall!;
      const out = await opts.runTool(call.name, call.args && typeof call.args === "object" ? call.args : {});
      responses.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: out.isError ? { error: out.content } : { result: out.content } } });
    }
    contents.push({ role: "user", parts: responses });
    if (turn === opts.maxTurns - 1) reply = reply || "I ran out of steps on that one. Try asking a narrower question.";
  }
  return reply;
}
