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
  facing: string | null;
};

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
- trade: one trade (Plumber, Electrician, Mason, Carpenter, Painter, Exterminator, Locksmith, HVAC, General maintenance).
- priority: High for active leaks, electrical, structural, fire/life-safety, lead, no heat/hot water; Medium for conditions
  that worsen; Low for cosmetic. priorityNote: e.g. "Repair within 24 hours".
- estimatedTime: a range, e.g. "30–60 minutes", "2–4 hours".
- status: "Action Required" unless the photo shows nothing to repair, then "No action needed".
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
              required: ["issueFound", "location", "exactArea", "repairRequired", "tools", "supplies", "fixtures", "steps", "trade", "priority", "priorityNote", "estimatedTime", "status"],
              properties: {
                issueFound: { type: "string" }, location: { type: "string" }, exactArea: { type: "string" }, repairRequired: { type: "string" },
                tools: list, supplies: list, fixtures: list, steps: list,
                trade: { type: "string" }, priority: { type: "string", enum: ["Low", "Medium", "High"] },
                priorityNote: { type: "string" }, estimatedTime: { type: "string" }, status: { type: "string" },
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
    return { ...t, facing };
  } finally {
    clearTimeout(timeout);
  }
}
