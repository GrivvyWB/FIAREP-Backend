// Vision classifier for the Measurement tab. Given a field photo, identify which
// take-off calculator applies: concrete, sheetrock (drywall), or a window opening.
// Mirrors the violation classifier's OpenAI wiring.

export type MaterialKind =
  | "concrete" | "sheetrock" | "plywood" | "window" | "door" | "room"
  | "floor-tile" | "wall-tile" | "wood-floor" | "unknown";

export type MaterialClassification = {
  material: MaterialKind;
  confidence: number; // 0..1
  note: string;
};

type FetchLike = typeof fetch;

const SYSTEM_PROMPT = `You identify the primary construction material or element in a field photo
so the app can pick the correct take-off calculator. Return only JSON matching the schema.
Choose exactly one:
- "concrete": a concrete slab, floor, sidewalk, footing, pour, or formed/curing concrete.
- "sheetrock": drywall / gypsum board on a wall or ceiling, taped seams, or a hole cut in drywall.
- "plywood": plywood / plyboard / OSB sheet goods (subfloor, sheathing, a stack of sheets).
- "window": a window, window frame, or a rough window opening / cut-out.
- "door": a door, door slab, or a door opening / rough door frame.
- "room": an empty room or floor area shown for square-footage (no single material dominates).
- "floor-tile": floor tile / ceramic or porcelain tile on the floor.
- "wall-tile": tile on a wall (backsplash, bathroom wall, shower surround).
- "wood-floor": wood, laminate, or vinyl-plank flooring / floor boards / a flooring box.
- "unknown": none of the above is clearly the subject.
Judge by the dominant subject of the photo. Set confidence to how sure you are (0 to 1).
Keep note to a short factual phrase describing what you see.`;

export async function classifyMaterialImage(
  image: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<MaterialClassification> {
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
              { type: "text", text: "Identify the primary material or element for take-off measurement." },
              { type: "image_url", image_url: { url: image, detail: "high" } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "material_classification",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["material", "confidence", "note"],
              properties: {
                material: { type: "string", enum: ["concrete", "sheetrock", "plywood", "window", "door", "room", "floor-tile", "wall-tile", "wood-floor", "unknown"] },
                confidence: { type: "number" },
                note: { type: "string" },
              },
            },
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
    const payload = (await response.json()) as any;
    const content = payload?.choices?.[0]?.message?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.find((p: any) => p?.type === "text")?.text
        : null;
    if (!text) throw new Error("OpenAI returned an invalid material classification");
    const parsed = JSON.parse(text) as Partial<MaterialClassification>;
    const material: MaterialKind = ["concrete", "sheetrock", "plywood", "window", "door", "room", "floor-tile", "wall-tile", "wood-floor", "unknown"].includes(
      String(parsed.material),
    )
      ? (parsed.material as MaterialKind)
      : "unknown";
    const confidence = typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;
    return { material, confidence, note: typeof parsed.note === "string" ? parsed.note : "" };
  } finally {
    clearTimeout(timeout);
  }
}
