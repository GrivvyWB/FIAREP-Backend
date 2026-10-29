// City records outside New York City: the owner, value, units and (where the city
// publishes them) the violations for a building, read from each place's own free
// open data. Each place has an On / Off button in Platform Control -> City Records;
// all start Off, and FIAREP reads a place only once it is switched on.
//
//  - Connecticut (every town, Stamford too): State of Connecticut, statewide parcel
//    and assessor (CAMA) file, data.ct.gov dataset rny9-6ak2.
//  - Philadelphia: Office of Property Assessment (opa_properties_public) and
//    Licenses & Inspections code violations (violations), phl.carto.com.
//  - Maryland (every county): State Department of Assessments and Taxation parcel
//    points, MD iMAP (mdgeodata.md.gov).
//  - Washington, DC: Office of Tax and Revenue owner and assessment layer, DC GIS
//    (maps2.dcgis.dc.gov, Property_and_Land layer 40).
//  - Chicago: Cook County Assessor parcel addresses (datacatalog.cookcountyil.gov
//    3723-97qp) and City of Chicago building violations (data.cityofchicago.org 22u3-xenr).
import { and, eq } from "drizzle-orm";
import { db, settings } from "@workspace/db";
import { geocodePlace } from "./geocode";
import { stateCode, US_STATES } from "./jurisdiction";
import { STATE_CATALOG, lookupStateRecords } from "./stateRecords";

// Built-in readers by id; every other state is "st-<two letters>" from STATE_CATALOG.
export type CitySourceId = string;
export type CitySource = { id: CitySourceId; label: string; covers: string; publisher: string; violations: boolean };
const BUILT_IN: CitySource[] = [
  { id: "ct", label: "Connecticut", covers: "Every town in Connecticut, Stamford included", publisher: "State of Connecticut — statewide parcel and assessor (CAMA) data, data.ct.gov", violations: false },
  { id: "phl", label: "Philadelphia", covers: "City of Philadelphia", publisher: "City of Philadelphia — Office of Property Assessment, and Licenses & Inspections code violations", violations: true },
  { id: "md", label: "Maryland", covers: "Every county in Maryland, Baltimore included", publisher: "State Department of Assessments and Taxation (SDAT) — MD iMAP parcel points", violations: false },
  { id: "dc", label: "Washington, DC", covers: "District of Columbia", publisher: "DC Office of Tax and Revenue — owner and assessment records, DC GIS", violations: false },
  { id: "chi", label: "Chicago", covers: "City of Chicago", publisher: "Cook County Assessor — parcel addresses, and City of Chicago building violations", violations: true },
];
// States with a built-in reader above (the catalog entry for them is not used).
const BUILT_IN_STATES = new Set(["CT", "MD", "DC"]);
/** Every place FIAREP can read: the built-in ones, then each state with a free statewide service. */
export const CITY_SOURCES: CitySource[] = [
  ...BUILT_IN,
  ...STATE_CATALOG.filter((e) => e.kind !== "none" && !BUILT_IN_STATES.has(e.state)).map((e) => ({ id: `st-${e.state.toLowerCase()}`, label: e.label, covers: `Every county in ${e.label}`, publisher: e.publisher, violations: false })),
];

/** What the page says about a typed state: its source if FIAREP can read it, else why not. */
export function stateStatus(typed: string): { state: string; label: string; source: CitySource | null; note: string } | null {
  const code = stateCode(typed) || (typed.trim().length === 2 ? typed.trim().toUpperCase() : "");
  if (!code || !US_STATES[code]) return null;
  const label = US_STATES[code]!;
  if (code === "CT") return { state: code, label, source: BUILT_IN.find((x) => x.id === "ct")!, note: "" };
  if (code === "MD") return { state: code, label, source: BUILT_IN.find((x) => x.id === "md")!, note: "" };
  if (code === "DC") return { state: code, label, source: BUILT_IN.find((x) => x.id === "dc")!, note: "" };
  const e = STATE_CATALOG.find((x) => x.state === code);
  const extra = code === "PA" ? " Philadelphia has its own button below." : code === "IL" ? " Chicago has its own button below." : "";
  if (!e || e.kind === "none") return { state: code, label, source: null, note: (e?.note || `${label} has no free statewide property service; its records are published county by county.`) + extra };
  return { state: code, label, source: CITY_SOURCES.find((x) => x.id === `st-${code.toLowerCase()}`) || null, note: (e.note || "") + extra };
}

const KEY = "city-records";
const PLATFORM = "default";

export async function citySwitches(): Promise<Record<CitySourceId, boolean>> {
  const [row] = await db.select().from(settings).where(and(eq(settings.tenantId, PLATFORM), eq(settings.key, KEY))).limit(1);
  const v = (row?.value || {}) as Record<string, unknown>;
  return Object.fromEntries(CITY_SOURCES.map((s) => [s.id, v[s.id] === true])) as Record<CitySourceId, boolean>;
}
export async function setCitySwitch(id: CitySourceId, on: boolean) {
  const cur = await citySwitches();
  const value = { ...cur, [id]: on };
  const now = new Date();
  await db.insert(settings).values({ tenantId: PLATFORM, key: KEY, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedAt: now } });
  return value;
}

export type CityRecord = { address: string; owner: string; units: number | null; value: number | null; use: string; yearBuilt: string; id: string; link: string };
export type CityViolation = { date: string; code: string; title: string; status: string; id: string; link: string };
export type CityRecordsResult = {
  source: { id: CitySourceId; label: string; publisher: string };
  matched: string;
  records: CityRecord[];
  violations: CityViolation[] | null;  // null: this place does not publish violations here
  openViolations: number;
  retrievedAt: string;
};

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const sq = (v: string) => v.replace(/'/g, "''");
const UA = { accept: "application/json", "user-agent": "FIAREP/1.0 (fiarep.com city records)" };
async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`The city's records service returned HTTP ${r.status}`);
  return r.json();
}

/** Which place's records cover this address (by state and city). */
export function sourceFor(city: string, state: string): CitySourceId | null {
  const st = stateCode(state) || state.toUpperCase();
  const ct = city.trim().toLowerCase();
  if (st === "CT") return "ct";
  if (st === "MD") return "md";
  if (st === "DC") return "dc";
  if (st === "PA" && ct === "philadelphia") return "phl";
  if (st === "IL" && ct === "chicago") return "chi";
  const e = STATE_CATALOG.find((x) => x.state === st && x.kind !== "none");
  return e ? `st-${st.toLowerCase()}` : null;
}

/** "1500 Market St" -> number 1500 and the main word of the street name (MARKET). */
function parts(street: string): { num: string; word: string } | null {
  const m = street.toUpperCase().replace(/[.,]/g, " ").trim().match(/^(\d+)[A-Z]?(?:-\d+)?\s+(.+)$/);
  if (!m) return null;
  const words = m[2]!.split(/\s+/).filter((w) => !/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)$/.test(w));
  const word = words.find((w) => /[A-Z0-9]/.test(w) && w.length > 1) || words[0];
  return word ? { num: m[1]!, word } : null;
}

async function connecticut(num: string, word: string, city: string): Promise<{ records: CityRecord[] }> {
  const where = `upper(location) like '${sq(num)} %${sq(word)}%'` + (city ? ` AND upper(property_city)='${sq(city.toUpperCase())}'` : "");
  const url = `https://data.ct.gov/resource/rny9-6ak2.json?$where=${encodeURIComponent(where)}&$select=${encodeURIComponent("location,property_city,owner,number_of_units,assessed_total,state_use_description,ayb,pid,cama_site_link")}&$limit=100`;
  const rows = (await getJson(url)) as Array<Record<string, unknown>>;
  return { records: rows.map((r) => ({ address: [s(r["location"]), s(r["property_city"])].filter(Boolean).join(", "), owner: s(r["owner"]), units: n(r["number_of_units"]), value: n(r["assessed_total"]), use: s(r["state_use_description"]), yearBuilt: s(r["ayb"]).replace(/\.0+$/, ""), id: s(r["pid"]), link: typeof r["cama_site_link"] === "object" && r["cama_site_link"] ? s((r["cama_site_link"] as { url?: unknown }).url) : s(r["cama_site_link"]) })) };
}

async function philadelphia(num: string, word: string): Promise<{ records: CityRecord[]; violations: CityViolation[] }> {
  const carto = (q: string) => `https://phl.carto.com/api/v2/sql?q=${encodeURIComponent(q)}`;
  const props = (await getJson(carto(`select location, owner_1, owner_2, market_value, category_code_description, building_code_description, year_built, parcel_number from opa_properties_public where location like '${sq(num)} %${sq(word)}%' or location like '${sq(num)}-%${sq(word)}%' limit 50`))) as { rows?: Array<Record<string, unknown>> };
  const records = (props.rows || []).map((r) => ({ address: s(r["location"]), owner: [s(r["owner_1"]), s(r["owner_2"])].filter(Boolean).join(" & "), units: null, value: n(r["market_value"]), use: [s(r["category_code_description"]), s(r["building_code_description"])].filter(Boolean).join(" · "), yearBuilt: s(r["year_built"]), id: s(r["parcel_number"]), link: s(r["parcel_number"]) ? `https://property.phila.gov/?p=${encodeURIComponent(s(r["parcel_number"]))}` : "" }));
  const ids = records.map((r) => r.id).filter((x) => /^\d+$/.test(x));
  let violations: CityViolation[] = [];
  if (ids.length) {
    const v = (await getJson(carto(`select violationdate, violationcode, violationcodetitle, violationstatus, violationnumber, casenumber from violations where opa_account_num in (${ids.map((x) => `'${x}'`).join(",")}) order by violationdate desc limit 100`))) as { rows?: Array<Record<string, unknown>> };
    violations = (v.rows || []).map((r) => ({ date: s(r["violationdate"]).slice(0, 10), code: s(r["violationcode"]), title: s(r["violationcodetitle"]), status: s(r["violationstatus"]), id: s(r["violationnumber"]) || s(r["casenumber"]), link: "" }));
  }
  return { records, violations };
}

async function maryland(num: string, word: string, city: string): Promise<{ records: CityRecord[] }> {
  const where = `ADDRESS LIKE '${sq(num)} %${sq(word)}%'` + (city ? ` AND UPPER(CITY) = '${sq(city.toUpperCase())}'` : "");
  const url = `https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent("ADDRESS,CITY,BLDG_UNITS,NFMTTLVL,DESCLU,DESCSTYL,YEARBLT,ACCTID,SDATWEBADR")}&returnGeometry=false&resultRecordCount=50&f=json`;
  const d = (await getJson(url)) as { features?: Array<{ attributes?: Record<string, unknown> }> };
  // SDAT's public points carry no owner name; the SDAT page linked on each row shows it.
  return { records: (d.features || []).map((f) => f.attributes || {}).map((r) => ({ address: [s(r["ADDRESS"]), s(r["CITY"])].filter(Boolean).join(", "), owner: "", units: n(r["BLDG_UNITS"]), value: n(r["NFMTTLVL"]), use: [s(r["DESCLU"]), s(r["DESCSTYL"])].filter(Boolean).join(" · "), yearBuilt: s(r["YEARBLT"]), id: s(r["ACCTID"]), link: s(r["SDATWEBADR"]) })) };
}

async function washingtonDc(num: string, word: string): Promise<{ records: CityRecord[] }> {
  const where = `PREMISEADD LIKE '${sq(num)} %${sq(word)}%'`;
  const url = `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/40/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent("PREMISEADD,OWNERNAME,OWNNAME2,ASSESSMENT,PROPTYPE,SSL,UNITNUMBER,COOPUNITS")}&returnGeometry=false&resultRecordCount=50&f=json`;
  const d = (await getJson(url)) as { features?: Array<{ attributes?: Record<string, unknown> }> };
  return { records: (d.features || []).map((f) => f.attributes || {}).map((r) => ({ address: [s(r["PREMISEADD"]), s(r["UNITNUMBER"]) ? `Unit ${s(r["UNITNUMBER"])}` : ""].filter(Boolean).join(" "), owner: [s(r["OWNERNAME"]), s(r["OWNNAME2"])].filter(Boolean).join(" & "), units: n(r["COOPUNITS"]) || null, value: n(r["ASSESSMENT"]), use: s(r["PROPTYPE"]), yearBuilt: "", id: s(r["SSL"]).replace(/\s+/g, " "), link: "" })) };
}

async function chicago(num: string, word: string): Promise<{ records: CityRecord[]; violations: CityViolation[] }> {
  const aw = `upper(prop_address_full) like '${sq(num)} %${sq(word)}%' AND upper(prop_address_city_name)='CHICAGO'`;
  const rows = (await getJson(`https://datacatalog.cookcountyil.gov/resource/3723-97qp.json?$where=${encodeURIComponent(aw)}&$order=${encodeURIComponent("year DESC")}&$limit=100`)) as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const records: CityRecord[] = [];
  for (const r of rows) {
    const pin = s(r["pin"]); if (!pin || seen.has(pin)) continue; seen.add(pin);
    records.push({ address: [s(r["prop_address_full"]), s(r["prop_address_city_name"])].filter(Boolean).join(", "), owner: s(r["owner_address_name"]) || s(r["mail_address_name"]), units: null, value: null, use: "", yearBuilt: "", id: pin, link: `https://www.cookcountyassessor.com/pin/${pin}` });
  }
  const vw = `upper(address) like '${sq(num)} %${sq(word)}%'`;
  const v = (await getJson(`https://data.cityofchicago.org/resource/22u3-xenr.json?$where=${encodeURIComponent(vw)}&$select=${encodeURIComponent("id,violation_date,violation_code,violation_description,violation_status")}&$order=${encodeURIComponent("violation_date DESC")}&$limit=100`)) as Array<Record<string, unknown>>;
  return { records, violations: v.map((r) => ({ date: s(r["violation_date"]).slice(0, 10), code: s(r["violation_code"]), title: s(r["violation_description"]), status: s(r["violation_status"]), id: s(r["id"]), link: "" })) };
}

/**
 * The city's record for an address, when its place is switched on.
 * { off } when the place has a reader but is switched off; null when no place covers it.
 */
export async function lookupCityRecords(address: string): Promise<CityRecordsResult | { off: CitySourceId; label: string } | null> {
  const place = await geocodePlace(address).catch(() => null);
  const city = place?.city || ""; const state = place?.state || "";
  const id = sourceFor(city, state);
  if (!id || !place) return null;
  const src = CITY_SOURCES.find((x) => x.id === id)!;
  if (!(await citySwitches())[id]) return { off: id, label: src.label };
  const p = parts(place.address || address);
  if (!p) return null;
  let records: CityRecord[] = []; let violations: CityViolation[] | null = null;
  if (id === "ct") ({ records } = await connecticut(p.num, p.word, city));
  else if (id === "phl") ({ records, violations } = await philadelphia(p.num, p.word));
  else if (id === "md") ({ records } = await maryland(p.num, p.word, city));
  else if (id === "dc") ({ records } = await washingtonDc(p.num, p.word));
  else if (id === "chi") ({ records, violations } = await chicago(p.num, p.word));
  else { const e = STATE_CATALOG.find((x) => `st-${x.state.toLowerCase()}` === id); if (e) records = await lookupStateRecords(e, p.num, p.word, city); }
  const open = (violations || []).filter((v) => /^(open|in violation|active|failed|non.?complied)/i.test(v.status)).length;
  return { source: { id, label: src.label, publisher: src.publisher }, matched: place.label, records, violations, openViolations: open, retrievedAt: new Date().toISOString() };
}
