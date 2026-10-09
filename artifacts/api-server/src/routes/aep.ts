// AEP Owner Registry (Platform Control only): buildings currently in HPD's
// Alternative Enforcement Program, their latest HPD registration and the
// registered contacts — owners, agents, officers. All from NYC Open Data;
// the building list is cached for six hours.
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, entityRecords } from "@workspace/db";
import { requirePlatformOwner } from "../middlewares/auth";
import { platformAudit } from "../lib/audit";

const AEP = "hcir-3275";       // HPD Alternative Enforcement Program buildings
const REGISTRATIONS = "tesw-yqqr"; // HPD multiple dwelling registrations
const CONTACTS = "feu5-w2e2";  // HPD registration contacts
const HPD_VIOLATIONS = "wvxf-dwi5";
const HPD_OMO_CHARGES = "mdbu-nrqn";
const PROPERTY_VALUATION = "8y4t-faws";
const text = (v: unknown): string => (v == null ? "" : String(v).trim());

function soql(dataset: string, params: Record<string, string>): string {
  const u = new URL(`https://data.cityofnewyork.us/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
async function fetchJson(url: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "FIAREP/1.0 AEP registry" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`NYC Open Data returned HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export type AepBuilding = {
  buildingId: string; address: string; borough: string; zip: string; units: number; bbl: string; bin: string;
  aepStart: string | null; violationsAtStart: number; round: string; status: string; dischargeDate: string | null;
  registrationId: string | null; registeredAt: string | null; registrationEnds: string | null;
};

let cache: { at: number; rows: AepBuilding[] } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

async function loadBuildings(): Promise<AepBuilding[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const aep = await fetchJson(soql(AEP, { $order: "aep_start_date DESC", $limit: "10000" }));
  const ids = [...new Set(aep.map((b) => text(b["building_id"])).filter(Boolean))];
  const latest = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const rows = await fetchJson(soql(REGISTRATIONS, { $where: `buildingid in (${batch.join(",")})`, $order: "lastregistrationdate DESC", $limit: "5000" }));
    for (const r of rows) {
      const id = text(r["buildingid"]);
      const prev = latest.get(id);
      if (!prev || text(r["lastregistrationdate"]) > text(prev["lastregistrationdate"])) latest.set(id, r);
    }
  }
  const out: AepBuilding[] = aep.map((b) => {
    const reg = latest.get(text(b["building_id"]));
    return {
      buildingId: text(b["building_id"]), address: `${text(b["phn"])} ${text(b["street_address"])}`.trim(), borough: text(b["boro"]), zip: text(b["postcode"]),
      units: Number(b["total_units"]) || 0, bbl: text(b["bbl"]), bin: text(b["bin"]),
      aepStart: text(b["aep_start_date"]).slice(0, 10) || null, violationsAtStart: Number(b["of_b_c_violations_at_start"]) || 0, round: text(b["aep_round"]), status: text(b["current_status"]), dischargeDate: text(b["discharge_date"]).slice(0, 10) || null,
      registrationId: reg ? text(reg["registrationid"]) : null, registeredAt: reg ? text(reg["lastregistrationdate"]).slice(0, 10) || null : null, registrationEnds: reg ? text(reg["registrationenddate"]).slice(0, 10) || null : null,
    };
  });
  cache = { at: Date.now(), rows: out };
  return out;
}

// Buildings on track for the next AEP round, by HPD's published selection
// criteria (AEP annual report): open Class B and C violations issued in the past
// five years per dwelling unit, and HPD emergency-repair (OMO) charges over the
// same five years. Criteria I — 15+ units: ratio ≥ 3 and ERP ≥ $2,500;
// 3–15 units: ratio ≥ 5 and ERP ≥ $5,000. Criteria II — 6+ units: ratio ≥ 4.
// Ranked by ERP charges, as HPD does. Buildings already in AEP are left out.
export type AepCandidate = {
  bbl: string; address: string; borough: string; units: number; openBC: number; ratio: number; erpCharges: number;
  criteria: "I" | "II"; inAep: boolean;
};
let candidateCache: { at: number; rows: AepCandidate[]; since: string } | null = null;
const BOROUGH_NAMES: Record<string, string> = { "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island" };

async function loadCandidates(): Promise<{ rows: AepCandidate[]; since: string }> {
  if (candidateCache && Date.now() - candidateCache.at < CACHE_MS) return candidateCache;
  const since = new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  // 1. Open B/C violations issued in the past five years, by BBL. 9 is the floor (3 units × ratio 3).
  const counts = await fetchJson(soql(HPD_VIOLATIONS, {
    $select: "bbl,count(*) as n,max(housenumber) as hn,max(streetname) as st,max(boroid) as boroid",
    $where: `violationstatus='Open' AND class in('B','C') AND novissueddate > '${since}'`,
    $group: "bbl", $having: "n >= 9", $order: "n DESC", $limit: "4000",
  }));
  const bbls = counts.map((r) => text(r["bbl"])).filter((b) => /^\d{10}$/.test(b));
  // 2. Units per BBL from the DOF assessment roll (latest year).
  const units = new Map<string, { units: number; year: string }>();
  for (let i = 0; i < bbls.length; i += 100) {
    const batch = bbls.slice(i, i + 100).map((b) => `'${b}'`).join(",");
    const rows = await fetchJson(soql(PROPERTY_VALUATION, { $select: "parid,units,year", $where: `parid in (${batch})`, $order: "year DESC", $limit: "5000" }));
    for (const r of rows) { const id = text(r["parid"]); const y = text(r["year"]); const prev = units.get(id); if (!prev || y > prev.year) units.set(id, { units: Number(r["units"]) || 0, year: y }); }
  }
  // 3. HPD emergency-repair charges in the past five years, by BBL.
  const erp = new Map<string, number>();
  for (let i = 0; i < bbls.length; i += 100) {
    const batch = bbls.slice(i, i + 100).map((b) => `'${b}'`).join(",");
    const rows = await fetchJson(soql(HPD_OMO_CHARGES, { $select: "bbl,sum(omoawardamount) as erp", $where: `bbl in (${batch}) AND omocreatedate > '${since}'`, $group: "bbl", $limit: "5000" }));
    for (const r of rows) erp.set(text(r["bbl"]), Number(r["erp"]) || 0);
  }
  const inAep = new Set((await loadBuildings()).filter((b) => b.status === "AEP Active").map((b) => b.bbl));
  const rows: AepCandidate[] = [];
  for (const r of counts) {
    const bbl = text(r["bbl"]); const u = units.get(bbl)?.units || 0; const n = Number(r["n"]) || 0; const charges = erp.get(bbl) || 0;
    if (u < 3) continue;
    const ratio = n / u;
    let criteria: "I" | "II" | null = null;
    if ((u >= 15 && ratio >= 3 && charges >= 2500) || (u >= 3 && u <= 15 && ratio >= 5 && charges >= 5000)) criteria = "I";
    else if (u >= 6 && ratio >= 4) criteria = "II";
    if (!criteria) continue;
    rows.push({ bbl, address: `${text(r["hn"])} ${text(r["st"])}`.trim(), borough: BOROUGH_NAMES[text(r["boroid"])] || "", units: u, openBC: n, ratio: Math.round(ratio * 10) / 10, erpCharges: Math.round(charges), criteria, inAep: inAep.has(bbl) });
  }
  rows.sort((a, b) => (a.criteria === b.criteria ? b.erpCharges - a.erpCharges || b.ratio - a.ratio : a.criteria === "I" ? -1 : 1));
  candidateCache = { at: Date.now(), rows: rows.filter((r) => !r.inAep).slice(0, 1000), since };
  return candidateCache;
}

const router: IRouter = Router();
router.use("/v1/platform/aep", requirePlatformOwner);

router.get("/v1/platform/aep/buildings", async (_req, res) => {
  try { const rows = await loadBuildings(); res.json({ rows, cachedAt: cache?.at ? new Date(cache.at).toISOString() : null }); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "NYC Open Data unavailable" }); }
});

router.get("/v1/platform/aep/likely", async (_req, res) => {
  try { const c = await loadCandidates(); res.json({ rows: c.rows, since: c.since, cachedAt: new Date(candidateCache!.at).toISOString() }); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "NYC Open Data unavailable" }); }
});

// HPD's public registration file lists names, corporations and business
// addresses only — it carries no phone numbers.
async function loadContacts(registrationId: string) {
  const rows = await fetchJson(soql(CONTACTS, { registrationid: registrationId, $limit: "500" }));
  return rows.map((c) => ({
    id: text(c["registrationcontactid"]), type: text(c["type"]), description: text(c["contactdescription"]), title: text(c["title"]),
    name: [text(c["firstname"]), text(c["middleinitial"]), text(c["lastname"])].filter(Boolean).join(" "), organization: text(c["corporationname"]),
    address: [[text(c["businesshousenumber"]), text(c["businessstreetname"])].filter(Boolean).join(" "), text(c["businessapartment"]), text(c["businesscity"]), text(c["businessstate"]), text(c["businesszip"])].filter(Boolean).join(", "),
  }));
}

router.get("/v1/platform/aep/contacts/:registrationId", async (req, res) => {
  const id = String(req.params["registrationId"]).replace(/\D/g, "");
  if (!id) { res.status(400).json({ error: "registrationId required" }); return; }
  try { res.json(await loadContacts(id)); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "NYC Open Data unavailable" }); }
});

// Contacts for a building that is not (yet) in AEP: find its latest HPD
// registration by borough / block / lot, then the contacts on it.
router.get("/v1/platform/aep/contacts-by-bbl/:bbl", async (req, res) => {
  const bbl = String(req.params["bbl"]).replace(/\D/g, "");
  if (!/^\d{10}$/.test(bbl)) { res.status(400).json({ error: "10-digit BBL required" }); return; }
  try {
    const regs = await fetchJson(soql(REGISTRATIONS, { $where: `boroid=${Number(bbl[0])} AND block=${Number(bbl.slice(1, 6))} AND lot=${Number(bbl.slice(6))}`, $order: "lastregistrationdate DESC", $limit: "5" }));
    const reg = regs[0];
    if (!reg) { res.json({ registrationId: null, registeredAt: null, registrationEnds: null, contacts: [] }); return; }
    const registrationId = text(reg["registrationid"]);
    res.json({ registrationId, registeredAt: text(reg["lastregistrationdate"]).slice(0, 10) || null, registrationEnds: text(reg["registrationenddate"]).slice(0, 10) || null, contacts: await loadContacts(registrationId) });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "NYC Open Data unavailable" }); }
});

// Portfolio: every other building whose HPD registration names the same
// people or corporations as this one — what else the owner / manager runs.
// Matched on person first + last name and on corporation name, so a spelling
// variant of the LLC (MANAGMENT / MANAGEMENT) still comes in through the person.
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
router.get("/v1/platform/aep/portfolio/:registrationId", async (req, res) => {
  const id = String(req.params["registrationId"]).replace(/\D/g, "");
  if (!id) { res.status(400).json({ error: "registrationId required" }); return; }
  try {
    const here = await fetchJson(soql(CONTACTS, { registrationid: id, $limit: "500" }));
    const people = new Set<string>(); const corps = new Set<string>();
    for (const c of here) {
      const first = text(c["firstname"]).toUpperCase(); const last = text(c["lastname"]).toUpperCase(); const corp = text(c["corporationname"]).toUpperCase();
      if (first && last) people.add(`${first}|${last}`);
      if (corp) corps.add(corp);
    }
    const clauses = [
      ...[...people].map((p) => { const [f, l] = p.split("|"); return `(upper(firstname)=${q(f!)} AND upper(lastname)=${q(l!)})`; }),
      ...[...corps].map((c) => `upper(corporationname)=${q(c)}`),
    ];
    if (clauses.length === 0) { res.json({ names: [], rows: [] }); return; }
    const matches = await fetchJson(soql(CONTACTS, { $select: "registrationid,type,corporationname,firstname,lastname", $where: clauses.join(" OR "), $limit: "5000" }));
    const byReg = new Map<string, Set<string>>();
    for (const m of matches) {
      const rid = text(m["registrationid"]); if (!rid || rid === id) continue;
      const who = text(m["corporationname"]) || [text(m["firstname"]), text(m["lastname"])].filter(Boolean).join(" ");
      if (!byReg.has(rid)) byReg.set(rid, new Set());
      byReg.get(rid)!.add(`${who} (${text(m["type"]).replace(/([a-z])([A-Z])/g, "$1 $2")})`);
    }
    const regIds = [...byReg.keys()].slice(0, 400);
    const regs: Record<string, unknown>[] = [];
    for (let i = 0; i < regIds.length; i += 100) regs.push(...await fetchJson(soql(REGISTRATIONS, { $where: `registrationid in (${regIds.slice(i, i + 100).join(",")})`, $limit: "5000" })));
    // Open HPD violations per building, one grouped query per batch of BBLs.
    const bbls = regs.map((r) => `${text(r["boroid"])}${text(r["block"]).padStart(5, "0")}${text(r["lot"]).padStart(4, "0")}`);
    const open = new Map<string, { a: number; b: number; c: number }>();
    for (let i = 0; i < bbls.length; i += 100) {
      const batch = bbls.slice(i, i + 100).filter((b) => /^\d{10}$/.test(b)).map((b) => `'${b}'`).join(",");
      if (!batch) continue;
      const rows = await fetchJson(soql(HPD_VIOLATIONS, { $select: "bbl,class,count(*) as n", $where: `violationstatus='Open' AND bbl in (${batch})`, $group: "bbl,class", $limit: "5000" }));
      for (const r of rows) { const k = text(r["bbl"]); const cur = open.get(k) || { a: 0, b: 0, c: 0 }; const cls = text(r["class"]).toLowerCase() as "a" | "b" | "c"; if (cls in cur) cur[cls] += Number(r["n"]) || 0; open.set(k, cur); }
    }
    const aepById = new Map((await loadBuildings()).map((b) => [b.buildingId, b]));
    const rows = regs.map((r, i) => {
      const bbl = bbls[i]!; const v = open.get(bbl) || { a: 0, b: 0, c: 0 }; const aep = aepById.get(text(r["buildingid"]));
      return {
        registrationId: text(r["registrationid"]), buildingId: text(r["buildingid"]), address: `${text(r["housenumber"])} ${text(r["streetname"])}`.trim(), borough: BOROUGH_NAMES[text(r["boroid"])] || text(r["boro"]), zip: text(r["zip"]), bbl, bin: text(r["bin"]),
        hpdA: v.a, hpdB: v.b, hpdC: v.c, via: [...byReg.get(text(r["registrationid"])) || []].slice(0, 4),
        aep: aep ? { units: aep.units, buildingId: aep.buildingId, aepStart: aep.aepStart, round: aep.round, violationsAtStart: aep.violationsAtStart, status: aep.status, dischargeDate: aep.dischargeDate } : null,
      };
    }).sort((x, y) => (y.hpdB + y.hpdC) - (x.hpdB + x.hpdC));
    res.json({ names: [...corps, ...[...people].map((p) => p.split("|").join(" "))], rows });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "NYC Open Data unavailable" }); }
});

// Violation log: every open HPD violation on the lot, as HPD wrote it, and
// every active DOB violation on the building. For reading, not counting.
const DOB_VIOLATIONS = "3h2n-5cm9";
const ymd = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v.slice(0, 10));
router.get("/v1/platform/aep/violations/:bbl", async (req, res) => {
  const bbl = String(req.params["bbl"]).replace(/\D/g, "");
  const bin = String(req.query["bin"] || "").replace(/\D/g, "");
  if (!/^\d{10}$/.test(bbl)) { res.status(400).json({ error: "10-digit BBL required" }); return; }
  try {
    const hpdRows = await fetchJson(soql(HPD_VIOLATIONS, {
      $select: "violationid,class,apartment,story,inspectiondate,novissueddate,novdescription,currentstatus,currentstatusdate,originalcorrectbydate,newcorrectbydate,ordernumber",
      $where: `bbl='${bbl}' AND violationstatus='Open'`, $order: "class DESC,novissueddate DESC", $limit: "5000",
    }));
    const hpd = hpdRows.map((r) => ({
      id: text(r["violationid"]), class: text(r["class"]), apartment: text(r["apartment"]), story: text(r["story"]),
      inspected: text(r["inspectiondate"]).slice(0, 10), issued: text(r["novissueddate"]).slice(0, 10),
      description: text(r["novdescription"]).replace(/\s+/g, " "), status: text(r["currentstatus"]), statusDate: text(r["currentstatusdate"]).slice(0, 10),
      correctBy: (text(r["newcorrectbydate"]) || text(r["originalcorrectbydate"])).slice(0, 10), order: text(r["ordernumber"]),
    }));
    const dobRows = bin ? await fetchJson(soql(DOB_VIOLATIONS, {
      $select: "number,violation_number,violation_type,violation_type_code,issue_date,description,disposition_date,disposition_comments,violation_category",
      $where: `bin='${bin}' AND violation_category like '%ACTIVE%'`, $order: "issue_date DESC", $limit: "2000",
    })) : [];
    const dob = dobRows.map((r) => ({
      id: text(r["number"]) || text(r["violation_number"]), number: text(r["violation_number"]), type: text(r["violation_type"]).replace(/\s+/g, " ").trim(), code: text(r["violation_type_code"]),
      issued: ymd(text(r["issue_date"])), description: text(r["description"]).replace(/\s+/g, " ").trim(), category: text(r["violation_category"]),
      dispositionDate: ymd(text(r["disposition_date"])), dispositionComments: text(r["disposition_comments"]).replace(/\s+/g, " ").trim(),
    }));
    res.json({ hpd, dob, retrievedAt: new Date().toISOString() });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "NYC Open Data unavailable" }); }
});

// Saved searches: a named snapshot of a list as it was on screen — the rows and
// any contacts already opened — so it reopens without touching NYC Open Data.
const SAVED = "aep-saved-searches";
const savedView = (r: { id: string; state: Record<string, unknown>; createdAt: Date }) => ({ id: r.id, ...r.state, savedAt: r.createdAt.toISOString() });

router.get("/v1/platform/aep/saved", async (_req, res) => {
  const rows = await db.select().from(entityRecords).where(and(eq(entityRecords.entity, SAVED), eq(entityRecords.deleted, false))).orderBy(desc(entityRecords.createdAt)).limit(200);
  res.json(rows.map((r) => savedView(r as never)));
});

router.post("/v1/platform/aep/saved", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const b = (req.body ?? {}) as Record<string, unknown>;
  const name = text(b["name"]).slice(0, 120);
  const mode = ["active", "discharged", "likely"].includes(text(b["mode"])) ? text(b["mode"]) : "";
  const rows = Array.isArray(b["rows"]) ? (b["rows"] as unknown[]).slice(0, 2000) : [];
  if (!name || !mode || rows.length === 0) { res.status(400).json({ error: "A name and at least one row are required." }); return; }
  const contacts = b["contacts"] && typeof b["contacts"] === "object" ? (b["contacts"] as Record<string, unknown>) : {};
  const now = new Date();
  const id = randomUUID();
  const state = { name, mode, search: text(b["search"]).slice(0, 200), borough: text(b["borough"]).slice(0, 40), count: rows.length, rows, contacts };
  await db.insert(entityRecords).values({ id, tenantId: "default", entity: SAVED, development: name, state, createdBy: owner.name, createdAt: now, updatedAt: now });
  await platformAudit(owner.name, "aep-search.saved", id, null, { name, mode, count: rows.length });
  res.json(savedView({ id, state, createdAt: now }));
});

router.delete("/v1/platform/aep/saved/:id", async (req, res) => {
  const owner = res.locals["platformOwner"] as { name: string };
  const id = String(req.params["id"]);
  const [before] = await db.select().from(entityRecords).where(and(eq(entityRecords.id, id), eq(entityRecords.entity, SAVED))).limit(1);
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  await platformAudit(owner.name, "aep-search.deleted", id, { name: before.state["name"] }, null);
  await db.delete(entityRecords).where(eq(entityRecords.id, id));
  res.json({ ok: true });
});

export default router;
