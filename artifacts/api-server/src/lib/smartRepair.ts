import { smartRepairArt } from "./fileStorage";
// FIAREP Smart Repair Instructions — photo in, repair plan out. The photo is
// read by the same AI as FIAREP Vision; the phone adds where it was taken
// (GPS address, typed apartment/area) and which way the camera faced (compass),
// so the ticket can name the wall ("north wall") from a real reading.
// Distances are estimates from the photo and are always worded "about".

export type SmartRepairTicket = {
  issueFound: string;
  location: string;
  exactArea: string;
  repairRequired: string;
  tools: string[];
  supplies: string[];
  fixtures: string[];
  steps: string[];
  trade: string;
  priority: "Low" | "Medium" | "High";
  priorityNote: string;
  estimatedTime: string;
  status: string;
  spec: string;
  issueDetail: string;
  room: string;
  spot: string;
  distance: string;
  specs: Array<{ label: string; value: string }>;
  diagram: string;
  partLabel: string;
  mark: { x: number; y: number; r: number };
  arrow: { x: number; y: number };
  facing: string | null;
};

export type RepairVerification = { before: string[]; after: string[]; compliant: boolean; summary: string };

export type SmartRepairInput = { image: string; heading?: number | null; address?: string; area?: string; note?: string };

/** Compass degrees → the wall the camera is pointed at. */
export function facingFromHeading(heading: number | null | undefined): string | null {
  if (heading == null || !Number.isFinite(heading)) return null;
  const h = ((heading % 360) + 360) % 360;
  return ["north", "east", "south", "west"][Math.round(h / 90) % 4]!;
}

const SYSTEM_PROMPT = `You are FIAREP Smart Repair, writing a field ticket for building maintenance staff in New York City from ONE photo.
Return only JSON matching the schema. Be specific and practical — a technician must be able to show up with the right tools,
supplies and replacement parts the first time.
- issueFound: the defect in a few words (e.g. "Active water leak from supply valve", "Peeling paint", "Handrail loose").
- location: the address and apartment/area exactly as given to you; if none given, describe the space you see (e.g. "Bathroom").
- exactArea: where in the space. When you are told which way the camera faced, the wall straight ahead is that wall
  (camera facing north = the north wall is in front of the member; their left is west, their right is east). Use it:
  e.g. "North wall behind toilet, about 4 ft in front of you". Any distance is an estimate from the photo — always say "about".
  Never invent a compass direction you were not given; then use "in front of you", "to your left", "above the window".
- repairRequired: one sentence of what must be done.
- tools: hand tools and equipment to bring. supplies: consumables. fixtures: replacement parts/fixtures (empty if none).
- steps: numbered-order repair instructions, short imperative sentences, ending with testing/verifying the repair.
- trade: one trade (Plumber, Electrician, Mason, Carpenter, Painter, Exterminator, Locksmith, HVAC, Elevator Service, Glazier,
  Roofer, Welder / Ironworker, Flooring, Fire Safety, General maintenance). Elevators, cabs, doors, buttons and machine rooms → Elevator Service;
  window glass and glazing → Glazier; roofs, flashing and parapet roofing → Roofer; railings, fire escapes and steel → Welder / Ironworker;
  sprinklers, extinguishers, alarms, fire doors and egress signs → Fire Safety.
- priority: High for active leaks, electrical, structural, fire/life-safety, lead, no heat/hot water; Medium for conditions
  that worsen; Low for cosmetic. priorityNote: e.g. "Repair within 24 hours".
- estimatedTime: a range, e.g. "30–60 minutes", "2–4 hours".
- status: "Action Required" unless the photo shows nothing to repair, then "No action needed".
- issueDetail: one sentence on what was detected (e.g. "Water leak detected at the P-trap connection.").
- room: the room (Kitchen, Bathroom, Bedroom, Stairwell, Basement, Exterior…). spot: where in it (e.g. "Under Sink",
  "Behind toilet", "15 ft above sidewalk"). distance: e.g. "Approximately 8 feet in front of you" ("" if it can't be judged).
- specs: 4–6 rows for the specification table, e.g. Pipe Size, Material, Type, Standards ("Code compliant (IPC/NYC)"),
  Replacement, Test — use the labels that fit the trade (for masonry: Brick, Mortar, Joint, Standards, Cure, Test).
- spec: the material specification that matters for the part (e.g. "Schedule 40 PVC", "Type L copper", "Type N mortar"); "" if none.
- diagram: a small plain-text repair diagram (max 16 lines, max 34 characters wide) of the assembly, top to bottom, using
  only │ ─ ┌ ┐ └ ┘ and letters, with "← Replace" (or "← Repair") next to the part to work on. Example for a sink:
  SINK BASIN / │ / TAILPIECE / │ / ┌─────┐ / │ P   │  ← Replace / │TRAP │ / └─────┘ / │ / WALL DRAIN (one item per line).
- partLabel: the replacement part in a few words (e.g. "Replace 1-1/2\" P-trap"); "" if nothing is replaced.
- mark: where the damaged part is in the photo, as fractions of the image (x from left, y from top, 0–1) and r the circle
  radius as a fraction of the image width (0.05–0.4). arrow: the point of the leak source / worst damage (0–1). Best estimates.
If the photo is unclear, say so in issueFound and keep the rest to what can honestly be inferred.`;

function responseText(payload: unknown): string | null {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const content = Array.isArray(choices) ? choices[0]?.message?.content : null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) { const t = content.find((p) => p && typeof p === "object" && (p as { type?: string }).type === "text") as { text?: string } | undefined; return t?.text ?? null; }
  return null;
}

const list = { type: "array", items: { type: "string" } };

export async function smartRepairTicket(input: SmartRepairInput, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<SmartRepairTicket> {
  const facing = facingFromHeading(input.heading ?? null);
  const facts = [
    input.address?.trim() ? `Address (from the phone's GPS, confirmed by the member): ${input.address.trim()}` : "",
    input.area?.trim() ? `Apartment / area typed by the member: ${input.area.trim()}` : "",
    facing ? `The camera was facing ${facing} (compass heading ${Math.round(((input.heading! % 360) + 360) % 360)}°) when the photo was taken.` : "No compass reading was available.",
    input.note?.trim() ? `What was reported: "${input.note.trim()}"` : "",
  ].filter(Boolean).join("\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: [
            { type: "text", text: facts + "\n\nWrite the Smart Field Ticket for this photo." },
            { type: "image_url", image_url: { url: input.image, detail: "high" } },
          ] },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "smart_repair_ticket",
            strict: true,
            schema: {
              type: "object", additionalProperties: false,
              required: ["issueFound", "location", "exactArea", "repairRequired", "tools", "supplies", "fixtures", "steps", "trade", "priority", "priorityNote", "estimatedTime", "status", "spec", "issueDetail", "room", "spot", "distance", "specs", "diagram", "partLabel", "mark", "arrow"],
              properties: {
                issueFound: { type: "string" }, location: { type: "string" }, exactArea: { type: "string" }, repairRequired: { type: "string" },
                tools: list, supplies: list, fixtures: list, steps: list,
                trade: { type: "string" }, priority: { type: "string", enum: ["Low", "Medium", "High"] },
                priorityNote: { type: "string" }, estimatedTime: { type: "string" }, status: { type: "string" },
                spec: { type: "string" }, diagram: { type: "string" }, partLabel: { type: "string" },
                issueDetail: { type: "string" }, room: { type: "string" }, spot: { type: "string" }, distance: { type: "string" },
                specs: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
                mark: { type: "object", additionalProperties: false, required: ["x", "y", "r"], properties: { x: { type: "number" }, y: { type: "number" }, r: { type: "number" } } },
                arrow: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "number" }, y: { type: "number" } } },
              },
            },
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}`);
    const text = responseText(await response.json());
    if (!text) throw new Error("OpenAI returned an invalid ticket");
    const t = JSON.parse(text) as Omit<SmartRepairTicket, "facing">;
    const c = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
    return {
      ...t,
      mark: { x: c(t.mark?.x, 0, 1, 0.5), y: c(t.mark?.y, 0, 1, 0.5), r: c(t.mark?.r, 0.05, 0.4, 0.15) },
      arrow: { x: c(t.arrow?.x, 0, 1, 0.5), y: c(t.arrow?.y, 0, 1, 0.5) },
      facing,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Completion verification: the before photo and the after photo, compared. */
export async function verifyRepair(before: string, after: string, issue: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<RepairVerification> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: "You verify building repairs for FIAREP. Compare the BEFORE photo with the AFTER photo of the same spot. Return only JSON. before: short findings in the before photo (e.g. \"Active leak detected\"). after: short findings in the after photo (e.g. \"Leak no longer visible\", \"New fixture installed\", \"Repair appears compliant\"). compliant: true only if the after photo shows the defect corrected and the work looks finished and code-appropriate; false if the defect is still visible, the photos are not the same spot, or it cannot be told. summary: one sentence." },
          { role: "user", content: [
            { type: "text", text: `The repair was for: ${issue || "the defect in the before photo"}. First image: BEFORE. Second image: AFTER.` },
            { type: "image_url", image_url: { url: before, detail: "high" } },
            { type: "image_url", image_url: { url: after, detail: "high" } },
          ] },
        ],
        response_format: { type: "json_schema", json_schema: { name: "repair_verification", strict: true, schema: {
          type: "object", additionalProperties: false, required: ["before", "after", "compliant", "summary"],
          properties: { before: list, after: list, compliant: { type: "boolean" }, summary: { type: "string" } },
        } } },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}`);
    const text = responseText(await response.json());
    if (!text) throw new Error("OpenAI returned an invalid verification");
    return JSON.parse(text) as RepairVerification;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Drawings: tools, materials, the replacement part and an exploded diagram ──

const slug = (v: string) => v.toLowerCase().replace(/["'’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

async function drawImage(prompt: string, quality: "low" | "medium", apiKey: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", quality, n: 1 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Image request failed with status ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image request returned no image");
  return Buffer.from(b64, "base64");
}

/** One drawing, made once and kept: the same key always comes back from storage. */
async function cachedDrawing(key: string, prompt: string, quality: "low" | "medium", apiKey: string): Promise<string | null> {
  try {
    if (!(await smartRepairArt.exists(key))) await smartRepairArt.put(key, await drawImage(prompt, quality, apiKey));
    return await smartRepairArt.url(key);
  } catch { return null; }
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export type SmartRepairDrawings = { diagram: string | null; part: string | null; items: Record<string, string | null> };

const NO_BRANDS = "No text, no words, no logos, no brand names or labels on the object.";

export async function smartRepairDrawings(input: { issue: string; trade: string; partLabel: string; spec: string; diagram: string; tools: string[]; materials: string[] }, apiKey: string): Promise<SmartRepairDrawings> {
  const names = [...new Set([...input.tools, ...input.materials].map((n) => n.trim()).filter(Boolean))].slice(0, 16);
  const itemJob = (name: string) => cachedDrawing(`item-${slug(name)}`, `Clean catalog illustration of a ${name} used in building repair, a single object centered on a plain white background, realistic, soft shadow. ${NO_BRANDS}`, "low", apiKey);
  const partJob = input.partLabel.trim()
    ? cachedDrawing(`part-${slug(input.partLabel + " " + input.spec)}`, `Catalog product illustration of the replacement part: ${input.partLabel.replace(/^replace\s+/i, "")}${input.spec ? ", " + input.spec : ""}. Single part centered on a plain white background, realistic. ${NO_BRANDS}`, "medium", apiKey)
    : Promise.resolve(null);
  const diagramKey = `diagram-${slug(input.issue + " " + input.partLabel)}`;
  const diagramJob = cachedDrawing(diagramKey,
    `Exploded-view technical illustration for a ${input.trade || "maintenance"} repair: ${input.issue}. Show the assembly from top to bottom as in this outline:\n${input.diagram}\n`
    + `Clean white background, simple realistic shading. Add short English part labels with thin arrows. Draw the part to be replaced${input.partLabel ? " (" + input.partLabel + ")" : ""} highlighted in red with the label "Replace". No brand names or logos.`,
    "medium", apiKey);
  const [diagram, part, itemUrls] = await Promise.all([diagramJob, partJob, inBatches(names, 6, itemJob)]);
  return { diagram, part, items: Object.fromEntries(names.map((n, i) => [n, itemUrls[i] ?? null])) };
}
