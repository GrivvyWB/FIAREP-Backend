// FIAREP Multi-Complaint Priority Engine. Every open resident complaint in a
// building is read once (photo + the resident's words) for issue, safety,
// health and property-damage risk, violation severity, residents affected and
// repair complexity; the result is kept on the complaint. The building's
// complaints are then put in order, most critical first, and the same trade is
// grouped into one route.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, entityRecords, residentReportPhotos } from "@workspace/db";
import { fileStorage } from "./fileStorage";
import { assessmentsForClient, compareWithBaseline } from "./baseline";

export type Triage = {
  issue: string; room: string; trade: string;
  level: "Emergency" | "High" | "Medium" | "Low";
  safety: number; health: number; property: number;
  severity: "A" | "B" | "C"; affected: number; complexity: "Low" | "Medium" | "High";
  risk: string; action: string; at: string;
};
const ACTIONS = ["Dispatch immediately", "Same-day response", "Repair within 24 hours", "Repair within 3 days", "Schedule with next maintenance cycle"];
const OPEN = (status: unknown) => !["resolved", "closed", "rejected", "cancelled"].includes(String(status || "").toLowerCase());

const PROMPT = `You triage NYC residential maintenance complaints for FIAREP so a building's complaints can be put in priority order.
Return only JSON. From the photo (if any) and the resident's words:
- issue: the problem in a few words. room: the room/area if known ("" if not).
- trade: the trade(s) needed, e.g. "Plumber", "Plumber + Electrician", "Electrician", "Carpenter", "Mason", "Painter", "Exterminator",
  "Locksmith", "HVAC", "Elevator Service", "Glazier", "Roofer", "Welder / Ironworker", "Flooring", "Fire Safety", "General maintenance".
- safety, health, property: risk 0–10 each (10 = imminent danger / serious illness / major damage).
- severity: HPD class A (non-hazardous), B (hazardous), C (immediately hazardous).
- affected: how many residents/apartments are likely affected (1 if just this unit; more for leaks into units below, heat, building-wide).
- complexity: Low / Medium / High repair complexity.
- level: Emergency (water near electricity, gas, fire/life safety, no heat in cold, sewage, collapse, active flooding),
  High (fall hazards, active leaks, pests, mold, broken locks on entry doors), Medium (things that worsen, broken window locks),
  Low (cosmetic).
- risk: a short phrase, e.g. "Water and electrical hazard", "Potential gas leak", "Fall hazard", "Cosmetic".
- action: exactly one of: ${ACTIONS.map((a) => `"${a}"`).join(", ")}.`;

async function triageOne(image: string | null, words: string, apiKey: string): Promise<Omit<Triage, "at">> {
  const content: unknown[] = [{ type: "text", text: `Resident's complaint: "${words || "(no words given)"}"` }];
  if (image) content.push({ type: "image_url", image_url: { url: image, detail: "low" } });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [{ role: "system", content: PROMPT }, { role: "user", content }],
      response_format: { type: "json_schema", json_schema: { name: "complaint_triage", strict: true, schema: {
        type: "object", additionalProperties: false,
        required: ["issue", "room", "trade", "level", "safety", "health", "property", "severity", "affected", "complexity", "risk", "action"],
        properties: {
          issue: { type: "string" }, room: { type: "string" }, trade: { type: "string" },
          level: { type: "string", enum: ["Emergency", "High", "Medium", "Low"] },
          safety: { type: "integer", minimum: 0, maximum: 10 }, health: { type: "integer", minimum: 0, maximum: 10 }, property: { type: "integer", minimum: 0, maximum: 10 },
          severity: { type: "string", enum: ["A", "B", "C"] }, affected: { type: "integer", minimum: 1, maximum: 500 },
          complexity: { type: "string", enum: ["Low", "Medium", "High"] }, risk: { type: "string" }, action: { type: "string", enum: ACTIONS },
        },
      } } },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Triage failed with status ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("Triage returned nothing");
  return JSON.parse(text);
}

const LEVEL_W: Record<string, number> = { Emergency: 1000, High: 700, Medium: 400, Low: 100 };
const SEV_W: Record<string, number> = { C: 60, B: 30, A: 0 };
export function priorityScore(t: Triage): number {
  return (LEVEL_W[t.level] ?? 0) + t.safety * 30 + t.health * 20 + t.property * 15 + (SEV_W[t.severity] ?? 0) + Math.min(t.affected, 50) * 5 + (t.complexity === "High" ? 5 : 0);
}
const STATUS_WORD: Record<string, string> = { "Dispatch immediately": "Immediate", "Same-day response": "Same Day", "Repair within 24 hours": "24 Hours", "Repair within 3 days": "Scheduled", "Schedule with next maintenance cycle": "Low" };

export type QueueItem = { rank: number; reportId: string; location: string; issue: string; trade: string; level: Triage["level"]; risk: string; action: string; status: string; reportStatus: string; createdAt: string; baseline: string };
export type BuildingQueue = { building: string; items: QueueItem[]; routes: Array<{ trade: string; stops: string[] }> };

type Scope = { tenantId: string; developments: string[] | null };

/** Open complaints for the tenant (and the person's developments), triaged as needed, ranked per building. */
export async function priorityQueue(scope: Scope, apiKey: string, maxNew = 25): Promise<{ buildings: BuildingQueue[]; analyzed: number; pending: number }> {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, scope.tenantId), eq(entityRecords.entity, "resident-reports"), eq(entityRecords.deleted, false)));
  const open = rows.filter((r) => OPEN(r.state["status"]) && (!scope.developments || !r.development || scope.developments.some((d) => d.toLowerCase() === r.development!.toLowerCase())));
  const need = open.filter((r) => !r.state["aiTriage"]);
  const batch = need.slice(0, maxNew);
  const photos = batch.length ? await db.select().from(residentReportPhotos).where(and(eq(residentReportPhotos.tenantId, scope.tenantId), inArray(residentReportPhotos.reportId, batch.map((r) => r.id)))) : [];
  let analyzed = 0;
  for (let i = 0; i < batch.length; i += 4) {
    await Promise.all(batch.slice(i, i + 4).map(async (r) => {
      try {
        const photo = photos.find((p) => p.reportId === r.id && ["image/jpeg", "image/png", "image/webp"].includes(p.contentType));
        let image: string | null = null;
        if (photo) {
          const { downloadUrl } = await fileStorage.createDownload(scope.tenantId, photo.objectPath);
          const res = await fetch(downloadUrl);
          if (res.ok) image = `data:${photo.contentType};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
        }
        const words = [r.state["description"], r.state["details"], r.state["issue"]].find((v): v is string => typeof v === "string" && Boolean(v.trim())) || "";
        const t: Triage = { ...(await triageOne(image, words, apiKey)), at: new Date().toISOString() };
        const [updated] = await db.update(entityRecords).set({ state: { ...r.state, aiTriage: t }, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() })
          .where(and(eq(entityRecords.id, r.id), eq(entityRecords.tenantId, scope.tenantId), eq(entityRecords.version, r.version))).returning();
        r.state = updated ? updated.state : { ...r.state, aiTriage: t };
        analyzed += 1;
      } catch { /* left for the next time the queue is opened */ }
    }));
  }
  // Each complaint against the building's baseline: existing, new, reoccurring or escalating.
  const baselines = await assessmentsForClient(scope.tenantId).catch(() => []);
  const groups = new Map<string, typeof open>();
  for (const r of open) {
    const key = String(r.state["address"] || r.development || "Building not given").trim();
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const buildings: BuildingQueue[] = [...groups.entries()].map(([building, list]) => {
    const triaged = list.filter((r) => r.state["aiTriage"]).map((r) => ({ r, t: r.state["aiTriage"] as Triage }));
    triaged.sort((a, b) => priorityScore(b.t) - priorityScore(a.t) || String(a.r.state["createdAt"] || "").localeCompare(String(b.r.state["createdAt"] || "")));
    const items: QueueItem[] = triaged.map(({ r, t }, i) => {
      const unit = String(r.state["unit"] || "").trim();
      const where = [unit ? (/^apt/i.test(unit) ? unit : `Apt ${unit}`) : "", t.room || String(r.state["location"] || "").trim()].filter(Boolean).join(" · ") || "Location not given";
      return { rank: i + 1, reportId: r.id, location: where, issue: t.issue, trade: t.trade, level: t.level, risk: t.risk, action: t.action, status: STATUS_WORD[t.action] || t.action, reportStatus: String(r.state["status"] || ""), createdAt: String(r.state["createdAt"] || ""), baseline: compareWithBaseline(baselines, { address: building, unit, trade: t.trade, level: t.level }) };
    });
    const byTrade = new Map<string, string[]>();
    for (const it of items) {
      const trade = it.trade.split(/\s*\+\s*/)[0]!.trim() || "General maintenance";
      const stop = it.location.split(" · ")[0]!;
      const stops = byTrade.get(trade) || [];
      if (!stops.includes(stop)) stops.push(stop);
      byTrade.set(trade, stops);
    }
    const routes = [...byTrade.entries()].map(([trade, stops]) => ({ trade, stops })).sort((a, b) => b.stops.length - a.stops.length);
    return { building, items, routes };
  }).filter((b) => b.items.length > 0).sort((a, b) => b.items.length - a.items.length);
  return { buildings, analyzed, pending: Math.max(0, need.length - analyzed) };
}
