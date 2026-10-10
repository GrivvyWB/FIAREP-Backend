// What a building owes the City: OATH / ECB summons balances (DOB, FDNY,
// DSNY, DEP… — paid through the Department of Finance) and HPD Emergency
// Repair / Open Market Order charges billed to the owner. Looked up by the
// address → borough, block and lot, from NYC Open Data.
import { geocodeNycAddress, socrataUrl } from "./nycProperty";

const OATH_CASES = "jz4z-kudi";      // OATH Hearings Division Case Status
const HPD_OMO_CHARGES = "mdbu-nrqn"; // HPD Open Market Order (ERP) charges
const HPD_VIOLATIONS = "wvxf-dwi5";    // HPD housing maintenance code violations
const DOB_VIOLATIONS = "3h2n-5cm9";    // DOB violations
const PROPERTY_VALUATION = "8y4t-faws"; // DOF Property Valuation and Assessment Data (current)
// DOF property tax rates by class (FY2026) — used only to estimate the annual bill.
const TAX_RATES: Record<string, number> = { "1": 0.20085, "2": 0.125, "3": 0.11181, "4": 0.10762 };

const BOROUGH_NAMES: Record<string, string> = { "1": "MANHATTAN", "2": "BRONX", "3": "BROOKLYN", "4": "QUEENS", "5": "STATEN ISLAND" };
const text = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number => { const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };

function soql(dataset: string, params: Record<string, string>): string {
  const u = new URL(`https://data.cityofnewyork.us/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

async function fetchJson(url: string): Promise<unknown[]> {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "FIAREP/1.0 DOF lookup" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`NYC Open Data returned HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export type DofSummons = {
  ticket: string; agency: string; violationDate: string | null; hearingDate: string | null; hearingStatus: string; complianceStatus: string;
  charge: string; penalty: number; paid: number; lateFees: number; balance: number;
};
export type HpdCharge = { omo: string; createdAt: string | null; workType: string; description: string; amount: number; lifecycle: string };

export type PropertyTax = {
  year: string; taxClass: string; marketValue: number; assessedValue: number; taxableValue: number; taxRate: number | null;
  estimatedAnnualTax: number | null; owner: string; units: number; yearBuilt: string; dofLink: string;
};

// jobs = distinct apartments / locations cited for this type: one repair order each.
export type ViolationType = { type: string; count: number; a: number; b: number; c: number; jobs: number };
export type ViolationCounts = { hpdA: number; hpdB: number; hpdC: number; hpdOpen: number; hpdApartments: number; dobActive: number; hpdTypes: ViolationType[]; dobTypes: Array<{ type: string; count: number }> };

// What an HPD violation is about, from its notice text — first match wins.
const HPD_TYPES: Array<[string, RegExp]> = [
  ["Smoke detector", /SMOKE DETECT/],
  ["Carbon monoxide detector", /CARBON MONOXIDE/],
  ["Window guards", /WINDOW GUARD/],
  ["Roaches", /ROACH/],
  ["Mice / rats", /MICE|RATS|RODENT/],
  ["Bed bugs", /BEDBUG|BED BUG/],
  ["Lead paint", /LEAD[- ]BASED PAINT|LEAD PAINT|27-2056/],
  ["Mold", /MOLD/],
  ["Heat / hot water", /HOT WATER|HEAT(ING)? SYSTEM|PROVIDE HEAT|ADEQUATE HEAT|27-2029|27-2031/],
  ["Peeling paint / plaster", /PEELING PAINT|PAINT WITH|PLASTER/],
  ["Leak / plumbing", /LEAK|FAUCET|WASH BASIN|SINK|BATHTUB|TOILET|WATER CLOSET|SHOWER|PIPE/],
  ["Electrical", /ELECTRIC|OUTLET|LIGHT FIXTURE|WIRING/],
  ["Door / self-closing", /DOOR|SELF[- ]CLOS/],
  ["Window", /WINDOW|SASH/],
  ["Floor", /FLOOR/],
  ["Ceiling / wall", /CEILING|WALL/],
  ["Fire escape", /FIRE ESCAPE/],
  ["Caulking / tile / surfaces", /CAULK|TILE|GROUT/],
  ["Lighting (public hall)", /LIGHTING|PUBLIC HALL/],
  ["Garbage / cleanliness", /GARBAGE|REFUSE|RUBBISH|CLEAN/],
  ["Registration / certificate", /REGISTER|REGISTRATION|CERTIFICATE|POST|SIGN/],
];
export function hpdViolationType(description: string): string {
  const d = description.toUpperCase();
  for (const [label, re] of HPD_TYPES) if (re.test(d)) return label;
  return "Other";
}
// Where the violation is, so repeats in the same apartment count as one repair
// job. HPD's own apartment field is free text — "2NDFL", "SECOND", "2FLOOR",
// "2" are all the same apartment — so floor-style labels collapse to the story,
// real apartment numbers (5D, 3B) are kept, and no apartment means a public area.
const FLOOR_WORDS: Record<string, string> = { FIRST: "1", SECOND: "2", THIRD: "3", FOURTH: "4", FIFTH: "5", SIXTH: "6", BSMT: "0", BASEMENT: "0", CELLAR: "0", GROUND: "1", GRND: "1", TOP: "TOP" };
export function hpdViolationPlace(description: string, apartment: string, story: string): string {
  const d = description.toUpperCase();
  const apt = apartment.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (apt) {
    const floorWord = FLOOR_WORDS[apt.replace(/(FL|FLOOR|FLR|FLO|FLRR)$/, "")];
    const floorNum = apt.match(/^(\d{1,2})(ST|ND|RD|TH)?(FL|FLOOR|FLR|FLO)?$/);
    if (floorWord) return `FLOOR ${floorWord}`;
    if (floorNum) return `FLOOR ${floorNum[1]}`;
    return `APT ${apt}`;
  }
  const fromText = d.match(/\bAPT\.?\s*#?\s*([A-Z0-9-]+)/);
  if (fromText) return `APT ${fromText[1].replace(/[^A-Z0-9]/g, "")}`;
  for (const place of ["PUBLIC HALL", "BASEMENT", "CELLAR", "ROOF", "BULKHEAD", "YARD", "FIRE ESCAPE", "ENTRANCE", "LOBBY", "STAIR", "BOILER ROOM", "COMPACTOR", "ENTIRE BUILDING"]) if (d.includes(place)) return place;
  return story && story !== "0" ? `FLOOR ${story} (PUBLIC)` : "BUILDING";
}

export type DofLookup = {
  property: { query: string; formattedAddress: string; borough: string; block: string | null; lot: string | null; bbl: string | null; bin: string | null };
  propertyTax: PropertyTax | null;
  violations: ViolationCounts | null;
  oath: { openBalance: number; openCount: number; penaltiesImposed: number; paid: number; items: DofSummons[]; byAgency: Array<{ agency: string; balance: number; count: number }> };
  hpdCharges: { total: number; count: number; items: HpdCharge[] };
  warnings: string[];
  retrievedAt: string;
};

export async function lookupDofCharges(address: string): Promise<DofLookup | null> {
  const feature = await geocodeNycAddress(address);
  if (!feature?.properties) return null;
  const props = feature.properties;
  const pad = props.addendum?.pad || {};
  const bbl = text(pad["bbl"]).replace(/\D/g, "") || null;
  const bin = text(pad["bin"]).replace(/\D/g, "") || null;
  const boroughCode = bbl?.slice(0, 1) || "";
  const block = bbl?.slice(1, 6) || null;
  const lot = bbl?.slice(6, 10) || null;
  const boroughName = BOROUGH_NAMES[boroughCode] || text(props["borough"]).toUpperCase();
  const warnings: string[] = [];

  // OATH: every summons on this block & lot with money still owed.
  let oathRows: Record<string, unknown>[] = [];
  if (block && lot) {
    const where = `violation_location_borough='${boroughName}' AND violation_location_block_no='${block}' AND violation_location_lot_no='${lot}'`;
    try { oathRows = (await fetchJson(socrataUrl(OATH_CASES, where, "violation_date DESC", 2000))) as Record<string, unknown>[]; }
    catch (error) { warnings.push(`OATH / ECB summons: ${error instanceof Error ? error.message : "unavailable"}`); }
  } else {
    warnings.push("No block & lot found for this address — OATH summons could not be searched.");
  }
  const items: DofSummons[] = oathRows.map((r) => ({
    ticket: text(r["ticket_number"]), agency: text(r["issuing_agency"]), violationDate: text(r["violation_date"]).slice(0, 10) || null,
    hearingDate: text(r["hearing_date"]).slice(0, 10) || null, hearingStatus: text(r["hearing_status"]), complianceStatus: text(r["compliance_status"]),
    charge: text(r["charge_1_code_description"]), penalty: num(r["penalty_imposed"]), paid: num(r["paid_amount"]), lateFees: num(r["additional_penalties_or_late_fees"]), balance: num(r["balance_due"]),
  }));
  const open = items.filter((i) => i.balance > 0).sort((a, b) => b.balance - a.balance);
  const byAgencyMap = new Map<string, { balance: number; count: number }>();
  for (const i of open) { const cur = byAgencyMap.get(i.agency) || { balance: 0, count: 0 }; cur.balance += i.balance; cur.count += 1; byAgencyMap.set(i.agency, cur); }
  const byAgency = [...byAgencyMap.entries()].map(([agency, v]) => ({ agency, ...v })).sort((a, b) => b.balance - a.balance);

  // HPD Emergency Repair / Open Market Order charges billed against the BBL.
  let omoRows: Record<string, unknown>[] = [];
  if (bbl) {
    try { omoRows = (await fetchJson(socrataUrl(HPD_OMO_CHARGES, `bbl='${bbl}'`, "omocreatedate DESC", 500))) as Record<string, unknown>[]; }
    catch (error) { warnings.push(`HPD repair charges: ${error instanceof Error ? error.message : "unavailable"}`); }
  }
  const hpdItems: HpdCharge[] = omoRows.map((r) => ({
    omo: text(r["omonumber"]), createdAt: text(r["omocreatedate"]).slice(0, 10) || null, workType: text(r["worktypegeneral"]), description: text(r["omodescription"]),
    amount: num(r["omoawardamount"]) + num(r["netchangeorders"]), lifecycle: text(r["lifecycle"]),
  })).filter((c) => c.amount > 0);

  // DOF assessment roll: the values the property-tax bill is built on. The
  // balance itself is not on Open Data — the DOF link opens the live account.
  let propertyTax: PropertyTax | null = null;
  if (bbl) {
    try {
      const rows = (await fetchJson(socrataUrl(PROPERTY_VALUATION, `parid='${bbl}'`, "year DESC", 1))) as Record<string, unknown>[];
      const r = rows[0];
      if (r) {
        const taxClass = text(r["curtaxclass"]);
        const rate = TAX_RATES[taxClass.slice(0, 1)] ?? null;
        const taxable = num(r["curtxbtot"]);
        propertyTax = {
          year: text(r["year"]), taxClass, marketValue: num(r["curmkttot"]), assessedValue: num(r["curacttot"]), taxableValue: taxable,
          taxRate: rate, estimatedAnnualTax: rate == null ? null : Math.round(taxable * rate),
          owner: text(r["owner"]), units: num(r["units"]), yearBuilt: text(r["yrbuilt"]),
          dofLink: `https://propertyinformationportal.nyc.gov/parcels/parcel/${bbl}`,
        };
      }
    } catch (error) { warnings.push(`DOF property tax: ${error instanceof Error ? error.message : "unavailable"}`); }
  }

  // Open violation counts — HPD by class on the BBL, DOB active on the BIN.
  let violations: ViolationCounts | null = null;
  if (bbl || bin) {
    const counts: ViolationCounts = { hpdA: 0, hpdB: 0, hpdC: 0, hpdOpen: 0, hpdApartments: 0, dobActive: 0, hpdTypes: [], dobTypes: [] };
    try {
      if (bbl) {
        // Every open violation with its notice text, so the client sees what they are.
        const url = soql(HPD_VIOLATIONS, { $select: "class,novdescription,apartment,story", $where: `bbl='${bbl}' AND violationstatus='Open'`, $limit: "5000" });
        const byType = new Map<string, ViolationType & { places: Set<string> }>();
        const allPlaces = new Set<string>();
        for (const r of (await fetchJson(url)) as Record<string, unknown>[]) {
          const cls = text(r["class"]).toUpperCase();
          counts.hpdOpen += 1;
          if (cls === "A") counts.hpdA += 1; else if (cls === "B") counts.hpdB += 1; else if (cls === "C") counts.hpdC += 1;
          const desc = text(r["novdescription"]);
          const type = hpdViolationType(desc);
          const t = byType.get(type) || { type, count: 0, a: 0, b: 0, c: 0, jobs: 0, places: new Set<string>() };
          t.count += 1; if (cls === "A") t.a += 1; else if (cls === "B") t.b += 1; else if (cls === "C") t.c += 1;
          const place = hpdViolationPlace(desc, text(r["apartment"]), text(r["story"]));
          t.places.add(place); allPlaces.add(place);
          byType.set(type, t);
        }
        // Never more jobs than the building has units, plus a few public areas.
        const units = propertyTax?.units || 0;
        const cap = units > 0 ? units + 3 : Number.POSITIVE_INFINITY;
        counts.hpdApartments = Math.min(allPlaces.size, cap);
        counts.hpdTypes = [...byType.values()].map(({ places, ...t }) => ({ ...t, jobs: Math.min(places.size, cap, t.count) })).sort((x, y) => y.count - x.count);
      }
      if (bin) {
        const url = soql(DOB_VIOLATIONS, { $select: "violation_type,count(*) as n", $where: `bin='${bin}' AND violation_category like '%ACTIVE%'`, $group: "violation_type", $order: "n DESC" });
        for (const r of (await fetchJson(url)) as Record<string, unknown>[]) {
          const n = num(r["n"]); counts.dobActive += n;
          counts.dobTypes.push({ type: text(r["violation_type"]).replace(/^[A-Z0-9]+-/, "").trim() || "DOB violation", count: n });
        }
      }
      violations = counts;
    } catch (error) { warnings.push(`Open violations: ${error instanceof Error ? error.message : "unavailable"}`); }
  }

  return {
    property: {
      query: address.trim(), formattedAddress: text(props["label"]) || address.trim(), borough: boroughName, block, lot, bbl, bin,
    },
    oath: {
      openBalance: open.reduce((n, i) => n + i.balance, 0), openCount: open.length,
      penaltiesImposed: items.reduce((n, i) => n + i.penalty, 0), paid: items.reduce((n, i) => n + i.paid, 0),
      items: open.slice(0, 200), byAgency,
    },
    propertyTax,
    violations,
    hpdCharges: { total: hpdItems.reduce((n, c) => n + c.amount, 0), count: hpdItems.length, items: hpdItems.slice(0, 100) },
    warnings,
    retrievedAt: new Date().toISOString(),
  };
}

// The City's unit count for an address: DOF assessment roll first, PLUTO
// (residential units) if DOF has none. Used when a building is registered to
// a client so the licensed-unit check is against a City figure, not a typed one.
export async function lookupBuildingUnits(address: string): Promise<{ displayAddress: string; bbl: string | null; units: number; source: "DOF" | "PLUTO" | null } | null> {
  const feature = await geocodeNycAddress(address);
  if (!feature?.properties) return null;
  const props = feature.properties;
  const pad = props.addendum?.pad || {};
  const bbl = text(pad["bbl"]).replace(/\D/g, "") || null;
  const displayAddress = text(props["label"]) || address;
  if (!bbl) return { displayAddress, bbl: null, units: 0, source: null };
  try {
    const rows = (await fetchJson(soql(PROPERTY_VALUATION, { $select: "units", $where: `parid='${bbl}'`, $order: "year DESC", $limit: "1" }))) as Record<string, unknown>[];
    const u = num(rows[0]?.["units"]);
    if (u > 0) return { displayAddress, bbl, units: u, source: "DOF" };
  } catch { /* fall through to PLUTO */ }
  try {
    const rows = (await fetchJson(soql("64uk-42ks", { $select: "unitsres,unitstotal", $where: `bbl=${Number(bbl)}`, $limit: "1" }))) as Record<string, unknown>[];
    const u = num(rows[0]?.["unitsres"]) || num(rows[0]?.["unitstotal"]);
    if (u > 0) return { displayAddress, bbl, units: u, source: "PLUTO" };
  } catch { /* no figure */ }
  return { displayAddress, bbl, units: 0, source: null };
}
