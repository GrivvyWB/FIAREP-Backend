// FIAREP Building Baseline — the onboarding walk-through every new client
// building gets before ongoing complaint and violation management begins.
// Kept in FIAREP's own records ("default" tenant), linked to the client
// organization, and shown to that client read-only.
import { and, eq } from "drizzle-orm";
import { db, entityRecords, organizations } from "@workspace/db";
import { fileStorage } from "./fileStorage";

export const BASELINE_ENTITY = "baseline-assessments";
export const FIAREP_TENANT = "default";

export type Priority = "Critical" | "High" | "Medium" | "Low";
export type Finding = {
  id: string; code?: string; area: string; floor: string; unit: string; wall: string;
  issue: string; description: string; trade: string; priority: Priority; time: string; action: string;
  tools: string[]; materials: string[]; fixtures: string[]; photos: string[];
  existing: boolean; sourceRef: string; status: "open" | "repaired"; createdAt: string;
};
export type Assessment = {
  id: string; reportId: string; clientOrgId: string; clientName: string; propertyName: string; address: string;
  ownerCompany: string; buildingType: string; units: number | null; inspectionDate: string; inspector: string;
  areas: Record<string, boolean>; findings: Finding[]; status: "in_progress" | "complete";
  signatures: { inspector: string; representative: string; date: string }; completedAt: string | null; createdAt: string;
};

export const AREAS: Record<string, string[]> = {
  Exterior: ["Building Facade", "Sidewalks", "Entrances", "Windows", "Doors", "Fire Escapes", "Roof Conditions"],
  "Common Areas": ["Hallways", "Stairwells", "Elevators", "Laundry Rooms", "Community Areas"],
  "Mechanical Systems": ["Plumbing", "Electrical", "HVAC", "Boilers", "Water Systems"],
  "Safety Systems": ["Emergency Lighting", "Exit Signs", "Smoke Detectors", "Carbon Monoxide Detectors", "Fire Protection Equipment"],
  "Additional Areas": ["Basement", "Roof", "Storage Areas", "Trash Areas", "Mechanical Rooms"],
};
const P_ORDER: Priority[] = ["Critical", "High", "Medium", "Low"];
const DEDUCT: Record<Priority, number> = { Critical: 15, High: 7, Medium: 3, Low: 1 };

/** Building Health Score: 100 less 15 per critical, 7 per high, 3 per medium, 1 per low finding still open. */
export function healthScore(findings: Finding[]): number {
  return Math.max(0, 100 - findings.filter((f) => f.status !== "repaired").reduce((n, f) => n + (DEDUCT[f.priority] ?? 0), 0));
}
export const scoreBand = (s: number) => (s >= 90 ? "Excellent" : s >= 75 ? "Good" : s >= 60 ? "Fair" : "Poor");

/** Findings numbered by priority: P1-001 (Critical) … P4-00n (Low). */
export function numbered(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  P_ORDER.forEach((p, i) => findings.filter((f) => f.priority === p).forEach((f, j) => out.push({ ...f, code: `P${i + 1}-${String(j + 1).padStart(3, "0")}` })));
  return out;
}

export function fromRow(row: typeof entityRecords.$inferSelect): Assessment {
  const s = row.state as Partial<Assessment>;
  return {
    id: row.id, reportId: String(s.reportId || ""), clientOrgId: String(s.clientOrgId || ""), clientName: String(s.clientName || ""),
    propertyName: String(s.propertyName || ""), address: String(s.address || ""), ownerCompany: String(s.ownerCompany || ""),
    buildingType: String(s.buildingType || "Residential"), units: typeof s.units === "number" ? s.units : null,
    inspectionDate: String(s.inspectionDate || ""), inspector: String(s.inspector || ""), areas: (s.areas && typeof s.areas === "object" ? s.areas : {}) as Record<string, boolean>,
    findings: Array.isArray(s.findings) ? s.findings as Finding[] : [], status: s.status === "complete" ? "complete" : "in_progress",
    signatures: { inspector: String(s.signatures?.inspector || ""), representative: String(s.signatures?.representative || ""), date: String(s.signatures?.date || "") },
    completedAt: s.completedAt ? String(s.completedAt) : null, createdAt: String(s.createdAt || row.createdAt.toISOString()),
  };
}

/** The assessment with numbered findings, score, roadmap and short-lived photo links. */
export async function forView(a: Assessment) {
  const findings = numbered(a.findings);
  const photoUrls: Record<string, string> = {};
  for (const f of findings) for (const p of f.photos) {
    if (photoUrls[p]) continue;
    try { photoUrls[p] = (await fileStorage.createDownload(FIAREP_TENANT, p)).downloadUrl; } catch { /* missing photo */ }
  }
  const open = findings.filter((f) => f.status !== "repaired");
  return {
    ...a, findings, photoUrls, areaGroups: AREAS,
    score: healthScore(a.findings), band: scoreBand(healthScore(a.findings)),
    counts: Object.fromEntries(P_ORDER.map((p) => [p, open.filter((f) => f.priority === p).length])),
    roadmap: { immediate: open.filter((f) => f.priority === "Critical").length, shortTerm: open.filter((f) => f.priority === "High").length, longTerm: open.filter((f) => f.priority === "Medium" || f.priority === "Low").length },
  };
}

export async function assessmentsForClient(clientOrgId: string): Promise<Assessment[]> {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.entity, BASELINE_ENTITY), eq(entityRecords.deleted, false)));
  return rows.map(fromRow).filter((a) => a.clientOrgId === clientOrgId);
}

/** Whether a client's complaint tools wait for the baseline (Platform Control switch) and whether it is done. */
export async function baselineGate(clientOrgId: string): Promise<{ required: boolean; complete: boolean }> {
  const [org] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
  const modules = ((org?.features as Record<string, unknown> | undefined)?.["modules"] ?? {}) as Record<string, unknown>;
  const required = modules["requireBaseline"] === true;
  if (!required) return { required, complete: false };
  const list = await assessmentsForClient(clientOrgId);
  return { required, complete: list.some((a) => a.status === "complete") };
}

const tradeKey = (t: string) => {
  const s = t.toLowerCase();
  return /plumb/.test(s) ? "plumbing" : /electr/.test(s) ? "electrical" : /carpent|handrail|door|wood/.test(s) ? "carpentry" : /roof/.test(s) ? "roofing" : /mason|brick/.test(s) ? "masonry" : /paint/.test(s) ? "painting" : /hvac|heat|boiler/.test(s) ? "hvac" : "general";
};
const unitKey = (u: string) => u.toLowerCase().replace(/^apt\.?\s*/, "").replace(/[^a-z0-9]/g, "");
const LEVEL_RANK: Record<string, number> = { Emergency: 0, Critical: 0, High: 1, Medium: 2, Low: 3 };

/** How a new complaint compares with the building's baseline. */
export function compareWithBaseline(baseline: Assessment[], complaint: { address: string; unit: string; trade: string; level: string }): string {
  const addr = complaint.address.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = baseline.find((x) => x.status === "complete" && addr && x.address.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(addr.slice(0, 10)));
  if (!a) return "";
  const match = a.findings.find((f) => unitKey(f.unit) === unitKey(complaint.unit) && tradeKey(f.trade) === tradeKey(complaint.trade));
  if (!match) return "New condition";
  if (match.status === "repaired") return "Reoccurring issue — repaired since the baseline";
  if ((LEVEL_RANK[complaint.level] ?? 3) < (LEVEL_RANK[match.priority] ?? 3)) return "Escalating issue — worse than at the baseline";
  return "Existing condition — on the baseline";
}
