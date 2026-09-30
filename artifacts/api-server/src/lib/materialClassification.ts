// Vision classifier for the Measurement tab. Given a field photo, identify which
// take-off calculator applies: concrete, sheetrock (drywall), or a window opening.
// Mirrors the violation classifier's OpenAI wiring.

export type MaterialKind =
  | "concrete" | "sheetrock" | "plywood" | "window" | "door" | "room"
  | "floor-tile" | "wall-tile" | "wood-floor" | "paint" | "unknown";

export type MaterialClassification = {
  material: MaterialKind;
  confidence: number; // 0..1
  note: string;
  // Best-effort size estimate from the photo (feet), using standard reference
  // sizes visible in the shot. 0 when nothing reliable can be judged.
  estimatedAFt: number;   // first dimension: length / opening width / surface width
  estimatedBFt: number;   // second dimension: width / opening height / surface height
  sizeBasis: string;      // what the estimate was judged from
  // width ÷ height of the subject as it appears (perspective-corrected), so one
  // tape measurement on site can correct the other side. 0 when unknown.
  aspectRatio: number;
  // true when no reliable reference was visible and a catalog size was assumed.
  assumedStandard: boolean;
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
- "paint": a painted or to-be-painted wall or ceiling surface (bare/primed wall ready for paint).
- "unknown": none of the above is clearly the subject.
Judge by the dominant subject of the photo. Set confidence to how sure you are (0 to 1).
Keep note to a short factual phrase describing what you see.
Also MEASURE the subject's size in FEET (decimal). Work like a surveyor, not a catalog:
1. Find a reference of KNOWN size in the photo and use it as a ruler: a door knob / lever centre sits 36 in above
   the floor; an outlet or switch cover is 2.75 x 4.5 in; a standard ceiling is 8 ft; floor tiles are commonly
   12 or 24 in; subway wall tile is 3 x 6 in; a drywall or plywood sheet is 4 x 8 ft; a brick is 8 in long;
   a light switch is ~48 in above the floor; a standard hinge is 3.5 in tall; a baseboard is 3 to 5 in.
2. Set the scale from that reference, correct for perspective, and measure the subject's width and height in
   pixels against it. Report the MEASURED numbers (e.g. 3.21 ft = 38.5 in), NOT the nearest catalog size.
3. For a door or window measure the OPENING between the outer edges of the frame / jambs, not the slab: real
   openings are often 34 to 40 in wide even when the slab is 32 or 36 in. Do not round to 30/32/36 x 80.
estimatedAFt = length / opening width / surface width; estimatedBFt = width / opening height / surface height.
aspectRatio = the subject's width divided by its height as it truly is (perspective-corrected), 0 if unknown.
assumedStandard = true ONLY if no usable reference was visible and you fell back to a typical size; then say so
in sizeBasis. If nothing at all can be judged, return 0 for both sizes and say why in sizeBasis. sizeBasis names
the reference used and the pixel ratio you measured (e.g. "knob at 36 in; opening 1.09x knob height wide").`;

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
              required: ["material", "confidence", "note", "estimatedAFt", "estimatedBFt", "sizeBasis", "aspectRatio", "assumedStandard"],
              properties: {
                material: { type: "string", enum: ["concrete", "sheetrock", "plywood", "window", "door", "room", "floor-tile", "wall-tile", "wood-floor", "paint", "unknown"] },
                confidence: { type: "number" },
                note: { type: "string" },
                estimatedAFt: { type: "number" },
                estimatedBFt: { type: "number" },
                sizeBasis: { type: "string" },
                aspectRatio: { type: "number" },
                assumedStandard: { type: "boolean" },
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
    const material: MaterialKind = ["concrete", "sheetrock", "plywood", "window", "door", "room", "floor-tile", "wall-tile", "wood-floor", "paint", "unknown"].includes(
      String(parsed.material),
    )
      ? (parsed.material as MaterialKind)
      : "unknown";
    const confidence = typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;
    const feet = (value: unknown) => {
      const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
      return n > 0 && n < 500 ? Math.round(n * 100) / 100 : 0;
    };
    return {
      material,
      confidence,
      note: typeof parsed.note === "string" ? parsed.note : "",
      estimatedAFt: feet(parsed.estimatedAFt),
      estimatedBFt: feet(parsed.estimatedBFt),
      sizeBasis: typeof parsed.sizeBasis === "string" ? parsed.sizeBasis : "",
      aspectRatio: typeof parsed.aspectRatio === "number" && Number.isFinite(parsed.aspectRatio) && parsed.aspectRatio > 0 && parsed.aspectRatio < 50
        ? Math.round(parsed.aspectRatio * 1000) / 1000 : 0,
      assumedStandard: parsed.assumedStandard === true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
