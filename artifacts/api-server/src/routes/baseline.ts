// FIAREP Building Baseline: the onboarding walk-through for a new client building.
import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, entityRecords, organizationProperties, organizations } from "@workspace/db";
import { actorFrom, requireAuth, requirePlatformOwner } from "../middlewares/auth";
import { fileStorage } from "../lib/fileStorage";
import { lookupNycPropertyData } from "../lib/nycProperty";
import { AREAS, BASELINE_ENTITY, FIAREP_TENANT, assessmentsForClient, baselineGate, forView, fromRow, type Finding, type Priority } from "../lib/baseline";

const router: IRouter = Router();
const s = (v: unknown, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 120)).slice(0, 30) : []);
const PRI: Priority[] = ["Critical", "High", "Medium", "Low"];

// FIAREP's own people (administrators, inspectors, technicians, management) do the walk-through.
function fiarepStaff(res: Parameters<typeof actorFrom>[0]) {
  const a = actorFrom(res);
  return a.tenantId === FIAREP_TENANT && ["administrator", "inspector", "management"].includes(a.role) ? a : null;
}

async function load(id: string) {
  const [row] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.entity, BASELINE_ENTITY), eq(entityRecords.deleted, false))).limit(1);
  return row || null;
}

function cleanFinding(v: unknown): Finding | null {
  if (!v || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  const issue = s(f["issue"], 200);
  if (!issue) return null;
  return {
    id: s(f["id"], 60) || randomUUID(), area: s(f["area"], 80), floor: s(f["floor"], 40), unit: s(f["unit"], 40), wall: s(f["wall"], 120),
    issue, description: s(f["description"], 1000), trade: s(f["trade"], 80) || "General Maintenance",
    priority: PRI.includes(f["priority"] as Priority) ? f["priority"] as Priority : "Medium",
    time: s(f["time"], 60), action: s(f["action"], 500), tools: arr(f["tools"]), materials: arr(f["materials"]), fixtures: arr(f["fixtures"]),
    photos: arr(f["photos"]).filter((p) => p.startsWith(`/objects/tenants/${FIAREP_TENANT}/`)),
    existing: f["existing"] === true, sourceRef: s(f["sourceRef"], 80), status: f["status"] === "repaired" ? "repaired" : "open",
    createdAt: s(f["createdAt"], 40) || new Date().toISOString(),
  };
}

// ── FIAREP side ──
router.get("/v1/baseline/clients", requireAuth, async (_req, res) => {
  if (!fiarepStaff(res)) { res.status(403).json({ error: "For FIAREP staff." }); return; }
  const orgs = await db.select({ id: organizations.id, name: organizations.name, licensedUnits: organizations.licensedUnits }).from(organizations);
  const props = await db.select({ org: organizationProperties.organizationId, address: organizationProperties.displayAddress, units: organizationProperties.units, active: organizationProperties.active }).from(organizationProperties);
  res.json(orgs.filter((o) => o.id !== FIAREP_TENANT).map((o) => ({ ...o, buildings: props.filter((p) => p.org === o.id && p.active).map((p) => ({ address: p.address, units: p.units })) })));
});

router.get("/v1/baseline", requireAuth, async (_req, res) => {
  const a = actorFrom(res);
  if (a.tenantId === FIAREP_TENANT) {
    const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.entity, BASELINE_ENTITY), eq(entityRecords.deleted, false)));
    res.json(await Promise.all(rows.map(fromRow).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map(forView)));
    return;
  }
  // A client sees its own buildings' baselines, read-only.
  res.json(await Promise.all((await assessmentsForClient(a.tenantId)).filter((x) => x.status === "complete").map(forView)));
});

router.get("/v1/baseline/status", requireAuth, async (_req, res) => {
  const a = actorFrom(res);
  if (a.tenantId === FIAREP_TENANT) { res.json({ required: false, complete: true }); return; }
  res.json(await baselineGate(a.tenantId));
});

router.post("/v1/baseline", requireAuth, async (req, res) => {
  const a = fiarepStaff(res);
  if (!a) { res.status(403).json({ error: "For FIAREP staff." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const clientOrgId = s(b["clientOrgId"], 80);
  const [org] = clientOrgId ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, clientOrgId)).limit(1) : [];
  if (!org) { res.status(400).json({ error: "Pick the client." }); return; }
  const address = s(b["address"]);
  if (!address) { res.status(400).json({ error: "Enter the building address." }); return; }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(entityRecords).where(and(eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.entity, BASELINE_ENTITY)));
  const id = randomUUID();
  const now = new Date();
  const state = {
    reportId: `FIAREP-BR-${String((n || 0) + 1).padStart(4, "0")}`, clientOrgId: org.id, clientName: org.name, propertyName: s(b["propertyName"], 160),
    address, ownerCompany: s(b["ownerCompany"], 160) || org.name, buildingType: ["Residential", "Mixed Use", "Commercial"].includes(s(b["buildingType"])) ? s(b["buildingType"]) : "Residential",
    units: typeof b["units"] === "number" && Number.isFinite(b["units"]) ? Math.round(b["units"] as number) : null,
    inspectionDate: now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), inspector: a.name,
    areas: {}, findings: [], status: "in_progress", signatures: { inspector: "", representative: "", date: "" }, completedAt: null, createdAt: now.toISOString(),
  };
  await db.insert(entityRecords).values({ id, tenantId: FIAREP_TENANT, entity: BASELINE_ENTITY, development: address.slice(0, 200), state, createdBy: a.id, createdAt: now, updatedAt: now } as never);
  const row = await load(id);
  res.json(await forView(fromRow(row!)));
});

router.get("/v1/baseline/:id", requireAuth, async (req, res) => {
  const a = actorFrom(res);
  const row = await load(String(req.params["id"]));
  if (!row) { res.status(404).json({ error: "Not found." }); return; }
  const x = fromRow(row);
  if (a.tenantId !== FIAREP_TENANT && (x.clientOrgId !== a.tenantId || x.status !== "complete")) { res.status(404).json({ error: "Not found." }); return; }
  res.json(await forView(x));
});

router.put("/v1/baseline/:id", requireAuth, async (req, res) => {
  const a = fiarepStaff(res);
  if (!a) { res.status(403).json({ error: "For FIAREP staff." }); return; }
  const row = await load(String(req.params["id"]));
  if (!row) { res.status(404).json({ error: "Not found." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const cur = fromRow(row);
  const next = { ...row.state } as Record<string, unknown>;
  for (const k of ["propertyName", "address", "ownerCompany", "buildingType", "inspector"] as const) if (typeof b[k] === "string") next[k] = s(b[k], 300);
  if (typeof b["units"] === "number") next["units"] = Math.round(b["units"] as number);
  if (b["areas"] && typeof b["areas"] === "object") {
    const valid = new Set(Object.values(AREAS).flat());
    next["areas"] = Object.fromEntries(Object.entries(b["areas"] as Record<string, unknown>).filter(([k]) => valid.has(k)).map(([k, v]) => [k, v === true]));
  }
  if (b["areaNotes"] && typeof b["areaNotes"] === "object") {
    const valid = new Set(Object.values(AREAS).flat());
    next["areaNotes"] = Object.fromEntries(Object.entries(b["areaNotes"] as Record<string, unknown>).filter(([k, v]) => valid.has(k) && v && typeof v === "object").map(([k, v]) => {
      const n = v as Record<string, unknown>;
      return [k, { note: s(n["note"], 2000), photos: arr(n["photos"]).filter((p) => p.startsWith(`/objects/tenants/${FIAREP_TENANT}/`)).slice(0, 20) }];
    }));
  }
  if (Array.isArray(b["findings"])) next["findings"] = (b["findings"] as unknown[]).map(cleanFinding).filter(Boolean).slice(0, 500);
  if (b["signatures"] && typeof b["signatures"] === "object") {
    const g = b["signatures"] as Record<string, unknown>;
    next["signatures"] = { inspector: s(g["inspector"], 120), representative: s(g["representative"], 120), date: s(g["date"], 40) };
  }
  if (b["status"] === "complete" && cur.status !== "complete") { next["status"] = "complete"; next["completedAt"] = new Date().toISOString(); }
  if (b["status"] === "in_progress") next["status"] = "in_progress";
  const [updated] = await db.update(entityRecords).set({ state: next, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() }).where(eq(entityRecords.id, row.id)).returning();
  res.json(await forView(fromRow(updated!)));
});

// Delete a baseline (a mistake, or one not wanted). FIAREP staff only. The
// record is marked deleted, so the next report keeps its own number.
router.delete("/v1/baseline/:id", requireAuth, async (req, res) => {
  const a = fiarepStaff(res);
  if (!a) { res.status(403).json({ error: "For FIAREP staff." }); return; }
  const row = await load(String(req.params["id"]));
  if (!row) { res.status(404).json({ error: "Not found." }); return; }
  await db.update(entityRecords).set({ deleted: true, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() }).where(eq(entityRecords.id, row.id));
  res.status(204).send();
});

// A finding's photo goes straight to FIAREP's storage.
router.post("/v1/baseline/upload-url", requireAuth, async (req, res) => {
  const a = fiarepStaff(res);
  if (!a) { res.status(403).json({ error: "For FIAREP staff." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const size = typeof b["size"] === "number" ? b["size"] as number : 0;
  if (!size || size > 15 * 1024 * 1024) { res.status(400).json({ error: "Photo too large." }); return; }
  const { uploadUrl, file } = await fileStorage.createUpload(FIAREP_TENANT, a.id, { kind: "inspection-evidence", name: s(b["name"], 120) || "photo.jpg", size, contentType: "image/jpeg" });
  res.json({ uploadUrl, objectPath: file.objectPath });
});

// Existing known violations: the open HPD and DOB violations on the City's records.
router.post("/v1/baseline/:id/import-violations", requireAuth, async (req, res) => {
  const a = fiarepStaff(res);
  if (!a) { res.status(403).json({ error: "For FIAREP staff." }); return; }
  const row = await load(String(req.params["id"]));
  if (!row) { res.status(404).json({ error: "Not found." }); return; }
  const cur = fromRow(row);
  let data: Awaited<ReturnType<typeof lookupNycPropertyData>>;
  try { data = await lookupNycPropertyData(cur.address, 500); } catch { res.status(502).json({ error: "NYC records are temporarily unavailable." }); return; }
  if (!data) { res.status(404).json({ error: "That address could not be matched to an NYC property." }); return; }
  const have = new Set(cur.findings.map((f) => f.sourceRef).filter(Boolean));
  const hpd = (data as { hpdViolations?: Array<Record<string, string>> }).hpdViolations || [];
  const dob = (data as { dobViolations?: Array<Record<string, string>> }).dobViolations || [];
  const now = new Date().toISOString();
  const added: Finding[] = [
    ...hpd.filter((v) => !/close|resolved/i.test(v["status"] || "")).map((v) => ({
      id: randomUUID(), area: "", floor: v["story"] || "", unit: v["apartment"] || "", wall: "", issue: (v["description"] || "HPD violation").slice(0, 200), description: v["description"] || "",
      trade: "General Maintenance", priority: (v["class"] === "C" ? "Critical" : v["class"] === "B" ? "High" : "Medium") as Priority, time: "", action: "", tools: [], materials: [], fixtures: [], photos: [],
      existing: true, sourceRef: `HPD #${v["id"]}${v["class"] ? " · Class " + v["class"] : ""}`, status: "open" as const, createdAt: now,
    })),
    ...dob.filter((v) => v["status"] === "Open").map((v) => ({
      id: randomUUID(), area: "", floor: "", unit: "", wall: "", issue: (v["description"] || "DOB violation").slice(0, 200), description: v["description"] || "",
      trade: "General Maintenance", priority: "High" as Priority, time: "", action: "", tools: [], materials: [], fixtures: [], photos: [],
      existing: true, sourceRef: `DOB #${v["number"] || v["id"]}`, status: "open" as const, createdAt: now,
    })),
  ].filter((f) => !have.has(f.sourceRef));
  const [updated] = await db.update(entityRecords).set({ state: { ...row.state, findings: [...cur.findings, ...added] }, version: sql`${entityRecords.version} + 1`, updatedAt: new Date() }).where(eq(entityRecords.id, row.id)).returning();
  res.json({ added: added.length, assessment: await forView(fromRow(updated!)) });
});

// ── Platform Control ──
router.get("/v1/platform/baseline", requirePlatformOwner, async (_req, res) => {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.tenantId, FIAREP_TENANT), eq(entityRecords.entity, BASELINE_ENTITY), eq(entityRecords.deleted, false)));
  res.json(await Promise.all(rows.map(fromRow).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map(forView)));
});
router.get("/v1/platform/baseline/:id", requirePlatformOwner, async (req, res) => {
  const row = await load(String(req.params["id"]));
  if (!row) { res.status(404).json({ error: "Not found." }); return; }
  res.json(await forView(fromRow(row)));
});

export default router;
