import { ClassifyViolationResponse } from "@workspace/api-zod";
import { lookupViolationCode, violationCodeCatalog } from "./violationCodes";

export type ViolationClassification = {
  classification: "A" | "B" | "C";
  confidence: number;
  condition: string;
  hpCode: string;
  trade: string;
  priority: "Low" | "Medium" | "High";
  description: string;
};

type FetchLike = typeof fetch;

const SYSTEM_PROMPT = `You classify visible NYC housing-maintenance violations for FIAREP field staff.
Return only JSON matching the supplied schema. Use:
- classification A for non-hazardous conditions
- classification B for hazardous conditions
- classification C for immediately hazardous conditions
You MUST set hpCode to the single best-matching code NUMBER from the official HPD/MDL/DOB
code list below (return just the code, e.g. "574", "081B", or "DOB-12"). Use BOTH the
resident's reported words and the photo. The reported words describe the real problem, so
when the photo is dark, blurry, or unclear, choose the code that fits the WORDS
(e.g. "no light"/"lights out"/"no power" -> an electrical/lighting code, "no heat"/"no hot
water" -> heat/hot water, "leak"/"water" -> plumbing/water, "mold" -> mold). Only use
"REVIEW REQUIRED" if neither the words nor the photo point to any code in the list.
Never invent a code that is not in the list. Keep the description concise and factual, and
set classification A/B/C by the actual hazard the words+photo describe, not by image quality.

OFFICIAL HPD/MDL and DOB CODE LIST (code: meaning [class]) — DOB codes are prefixed "DOB-":
${violationCodeCatalog()}`;

function responseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const textPart = content.find(
    (part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string",
  ) as { text: string } | undefined;
  return textPart?.text ?? null;
}

export function parseViolationClassification(
  providerPayload: unknown,
): ViolationClassification | null {
  const content = responseText(providerPayload);
  if (!content) return null;
  try {
    const parsed = ClassifyViolationResponse.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function classifyViolationImage(
  image: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  issueText: string = "",
): Promise<ViolationClassification> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: (issueText && issueText.trim()
                  ? `The resident reported this problem: "${issueText.trim()}". Use BOTH that description and the photo to choose the code. The words describe the actual problem, so lean on them when the photo is dark, blurry, or does not clearly show the condition — do not fall back to "REVIEW REQUIRED" if the reported words point to a real code.\n\n`
                  : "") + "Classify the reported housing-maintenance violation.",
              },
              { type: "image_url", image_url: { url: image, detail: "low" } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "violation_classification",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "classification",
                "confidence",
                "condition",
                "hpCode",
                "trade",
                "priority",
                "description",
              ],
              properties: {
                classification: { type: "string", enum: ["A", "B", "C"] },
                confidence: { type: "integer", minimum: 0, maximum: 100 },
                condition: { type: "string" },
                hpCode: { type: "string" },
                trade: { type: "string" },
                priority: {
                  type: "string",
                  enum: ["Low", "Medium", "High"],
                },
                description: { type: "string" },
              },
            },
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }
    const classification = parseViolationClassification(await response.json());
    if (!classification) {
      throw new Error("OpenAI returned an invalid violation classification");
    }
    // Enrich with the official code meaning so management/inspectors see a real
    // code and its HPD/MDL order text, not just a class letter.
    const matched = lookupViolationCode(classification.hpCode);
    if (matched) {
      (classification as Record<string, unknown>)["codeMeaning"] =
        matched.abstract || matched.full || matched.desc;
      (classification as Record<string, unknown>)["codeOrderText"] = matched.desc;
    }
    return classification;
  } finally {
    clearTimeout(timeout);
  }
}