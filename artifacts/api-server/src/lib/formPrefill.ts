// Fills a company form with the building it is for: the address the way each
// form asks for it, borough / ZIP / county, the HPD registration number, the
// owner and managing agent from that registration, and the building's name
// from the client's own list. Used by the Company Forms page ("Which
// building?"), by "Fill AEU2" from an OATH summons, and by the Command Center.
// Everything comes from the City's records (NYC GeoSearch, PLUTO, HPD
// registrations, OATH case status) — nothing is guessed.
import { and, eq } from "drizzle-orm";
import { db, organizationProperties } from "@workspace/db";
import { geocodeNycAddress } from "./nycProperty";

const REGISTRATIONS = "tesw-yqqr"; // HPD multiple dwelling registrations
const CONTACTS = "feu5-w2e2";      // HPD registration contacts
const PLUTO = "64uk-42ks";
const OATH_CASES = "jz4z-kudi";    // OATH Hearings Division case status
const COUNTY: Record<string, string> = { BRONX: "Bronx", BROOKLYN: "Kings", MANHATTAN: "New York", QUEENS: "Queens", "STATEN ISLAND": "Richmond" };
const BORO_CODE: Record<string, string> = { "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island", MN: "Manhattan", BX: "Bronx", BK: "Brooklyn", QN: "Queens", SI: "Staten Island" };

const txt = (v: unknown): string => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const title = (v: string) => v.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
function soql(dataset: string, params: Record<string, string>): string {
  const u = new URL(`https://data.cityofnewyork.us/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
async function rows(url: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "FIAREP/1.0 forms" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`NYC Open Data returned HTTP ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
const boroughName = (v: string) => { const b = v.toUpperCase(); return BORO_CODE[b] ?? (b === "STATEN ISLAND" ? "Staten Island" : b ? title(b) : ""); };

export type FormBuilding = {
  /** House number and street, e.g. "430 Belmont Avenue". */
  street: string; borough: string; zip: string; county: string; state: string;
  /** "430 Belmont Avenue, Brooklyn, NY 11207". */
  full: string;
  bbl: string; bin: string; block: string; lot: string; units: number | null;
  registrationId: string; owner: string; agent: string; agentAddress: string;
  /** The client's own name for the building (their building list), if it is one of theirs. */
  name: string;
};

async function registration(bbl: string) {
  if (!/^\d{10}$/.test(bbl)) return { registrationId: "", owner: "", agent: "", agentAddress: "" };
  const regs = await rows(soql(REGISTRATIONS, { $where: `boroid=${Number(bbl[0])} AND block=${Number(bbl.slice(1, 6))} AND lot=${Number(bbl.slice(6))}`, $order: "lastregistrationdate DESC", $limit: "1" })).catch(() => []);
  const registrationId = txt(regs[0]?.["registrationid"]);
  if (!registrationId) return { registrationId: "", owner: "", agent: "", agentAddress: "" };
  const cs = await rows(soql(CONTACTS, { registrationid: registrationId, $limit: "50" })).catch(() => []);
  const person = (c: Record<string, unknown>) => txt(c["corporationname"]) || [txt(c["firstname"]), txt(c["lastname"])].filter(Boolean).join(" ");
  const ownerRow = cs.find((c) => txt(c["type"]) === "CorporateOwner") || cs.find((c) => txt(c["type"]) === "IndividualOwner") || cs.find((c) => /owner/i.test(txt(c["type"])));
  const agentRow = cs.find((c) => txt(c["type"]) === "Agent");
  const addr = (c?: Record<string, unknown>) => c ? [[txt(c["businesshousenumber"]), txt(c["businessstreetname"])].filter(Boolean).join(" "), txt(c["businessapartment"]), txt(c["businesscity"]), [txt(c["businessstate"]), txt(c["businesszip"])].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  // Names and business addresses as HPD has them registered (upper case, "HDFC", "LLC").
  return { registrationId, owner: ownerRow ? person(ownerRow) : "", agent: agentRow ? person(agentRow) : "", agentAddress: addr(agentRow) };
}

async function clientName(tenantId: string, bbl: string, street: string): Promise<string> {
  const props = await db.select().from(organizationProperties).where(and(eq(organizationProperties.organizationId, tenantId), eq(organizationProperties.active, true))).limit(2000);
  const s = street.toLowerCase();
  const hit = props.find((p) => (bbl && p.bbl === bbl) || p.displayAddress.toLowerCase().startsWith(s));
  return hit?.development?.trim() || "";
}

async function finish(tenantId: string, p: { street: string; borough: string; zip: string; bbl: string; bin: string }): Promise<FormBuilding> {
  let { zip, bbl } = p; let units: number | null = null;
  if (/^\d{10}$/.test(bbl)) {
    const pl = (await rows(soql(PLUTO, { $select: "zipcode,unitsres", $where: `bbl=${Number(bbl)}`, $limit: "1" })).catch(() => []))[0];
    if (!zip) zip = txt(pl?.["zipcode"]);
    const n = Number(pl?.["unitsres"]); if (n > 0) units = n;
  }
  const reg = await registration(bbl);
  const borough = boroughName(p.borough);
  const full = [p.street, borough, ["NY", zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { street: p.street, borough, zip, county: COUNTY[borough.toUpperCase()] || borough, state: "NY", full, bbl, bin: p.bin, block: bbl.slice(1, 6), lot: bbl.slice(6), units, ...reg, name: await clientName(tenantId, bbl, p.street) };
}

/** A building by its address (NYC). */
export async function buildingByAddress(tenantId: string, address: string): Promise<FormBuilding | { error: string }> {
  const a = address.trim();
  if (a.length < 4) return { error: "Type the building's address." };
  const f = await geocodeNycAddress(a).catch(() => null);
  const pr = f?.properties as Record<string, unknown> & { addendum?: { pad?: Record<string, unknown> } } | undefined;
  if (!pr) return { error: `"${a}" could not be matched to a New York City building.` };
  const pad = pr.addendum?.pad || {};
  return finish(tenantId, { street: title(`${txt(pr["housenumber"])} ${txt(pr["street"])}`), borough: txt(pr["borough"]), zip: txt(pr["postalcode"]), bbl: txt(pad["bbl"]).replace(/\D/g, ""), bin: txt(pad["bin"]) });
}

export type OathSummons = { ticket: string; agency: string; respondent: string; violationDate: string; charge: string; penalty: number; balance: number; hearingStatus: string };

/** An OATH summons (as on the building lookup) and the building it was written at. */
export async function oathSummons(tenantId: string, ticket: string): Promise<{ summons: OathSummons; building: FormBuilding } | { error: string }> {
  const t = ticket.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (t.length < 6) return { error: "Give the summons (ticket) number." };
  const tries = [...new Set([t, t.replace(/^0+/, ""), `0${t}`])];
  let r: Record<string, unknown> | undefined;
  for (const n of tries) { r = (await rows(soql(OATH_CASES, { ticket_number: n, $limit: "1" })).catch(() => []))[0]; if (r) break; }
  if (!r) return { error: `OATH has no summons ${t}.` };
  const boro = txt(r["violation_location_borough"]);
  const block = txt(r["violation_location_block_no"]).replace(/\D/g, ""), lot = txt(r["violation_location_lot_no"]).replace(/\D/g, "");
  const boroCode = { MANHATTAN: "1", BRONX: "2", BROOKLYN: "3", QUEENS: "4", "STATEN ISLAND": "5" }[boro.toUpperCase()] ?? "";
  const bbl = boroCode && block && lot ? `${boroCode}${block.padStart(5, "0")}${lot.padStart(4, "0")}` : "";
  const street = title([txt(r["violation_location_house"]), txt(r["violation_location_street_name"])].filter(Boolean).join(" "));
  const building = await finish(tenantId, { street, borough: boro, zip: txt(r["violation_location_zip_code"]), bbl, bin: "" });
  return {
    building,
    summons: {
      ticket: txt(r["ticket_number"]), agency: title(txt(r["issuing_agency"])), respondent: [txt(r["respondent_first_name"]), txt(r["respondent_last_name"])].filter(Boolean).join(" "),
      violationDate: txt(r["violation_date"]).slice(0, 10), charge: txt(r["charge_1_code_description"]) || txt(r["violation_details"]),
      penalty: Number(r["penalty_imposed"]) || 0, balance: Number(r["balance_due"]) || 0, hearingStatus: txt(r["hearing_status"]),
    },
  };
}

/** The values a form takes from its building (and the summons, for the AEU2). Keys are the form's own field keys. */
export function formValuesFor(formId: string, b: FormBuilding, summons?: OathSummons): Record<string, unknown> {
  const property = b.name ? `${b.name} — ${b.full}` : b.full;
  switch (formId) {
    case "certificate-of-correction":
      return { address: b.street, boroughZip: [b.borough, ["NY", b.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "), notaryCounty: b.county, ...(summons ? { summonsNumber: summons.ticket } : {}) };
    case "violation-timeline": case "vermin-treatment-log":
      return { property };
    case "vermin-request":
      return { property, landlord: [b.agent || b.owner, b.agentAddress].filter(Boolean).join(", ") };
    case "vermin-compliance":
      return { address: b.street, borough: `${b.borough} / ${b.county} County`, registration: b.registrationId };
    case "lead-disclosure":
      return { address: b.full, owner: b.owner };
    case "af6-vermin":
      return { address: b.full, county: b.county, registrationNumber: b.registrationId };
    case "af7-mold": case "af8-mold":
      return { address: b.full, county: b.county };
    case "civ194-mold":
      return { county: b.county };
    case "lead-remediation": case "lead-work-log": case "mold-assessment": case "mold-remediation": case "tenant-notice":
      return { address: b.full };
    default:
      return { address: b.full, property };
  }
}

/** The client's own buildings, for the "Which building?" list. */
export async function clientBuildings(tenantId: string) {
  const props = await db.select().from(organizationProperties).where(and(eq(organizationProperties.organizationId, tenantId), eq(organizationProperties.active, true))).limit(2000);
  return props.map((p) => ({ id: p.id, address: p.displayAddress, name: p.development || "", bbl: p.bbl || "" })).sort((a, b) => a.address.localeCompare(b.address));
}

/** The forms on the Company Forms page (ids and titles as on the website, fiarep-web/src/lib/compliance-forms.ts). */
export const FORM_TITLES: Record<string, string> = {
  "certificate-of-correction": "DOB Certificate of Correction (AEU2)", "violation-timeline": "Violation Correction Timeline",
  "vermin-request": "Vermin Treatment Request", "vermin-compliance": "HPD / NYCHA Vermin Complaint & Compliance Form",
  "vermin-treatment-log": "Vermin Multi-Visit Treatment Log", "vermin-acknowledgment": "Vermin Tenant Acknowledgment",
  "lead-disclosure": "Lead Paint Disclosure & Compliance", "lead-remediation": "Lead Remediation Tracking", "lead-work-log": "Lead Hazard Work Log",
  "af6-vermin": "Affidavit of Compliance (AF-6)", "af7-mold": "Affidavit of Compliance (AF-7)", "af8-mold": "Affidavit of Compliance (AF-8)",
  "civ194-mold": "Certification of Correction of Violation(s) — Mold (CIV 194)", "mold-assessment": "Affidavit of Mold Assessment",
  "mold-remediation": "Affidavit of Mold Remediation", "tenant-notice": "Tenant Notice Form",
};
/** Which form someone means: its id, its title, or words from it ("AEU2", "AF-6", "lead disclosure"). */
export function findForm(ref: string): { id: string } | { error: string } {
  const r = ref.trim().toLowerCase();
  if (FORM_TITLES[r]) return { id: r };
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const words = norm(r).split(" ").filter(Boolean);
  const hits = Object.entries(FORM_TITLES).filter(([id, t]) => { const hay = `${norm(id)} ${norm(t)}`; return words.every((w) => hay.includes(w)); });
  if (hits.length === 1) return { id: hits[0]![0] };
  if (!hits.length) return { error: `No form called "${ref}". The forms: ${Object.values(FORM_TITLES).join("; ")}.` };
  return { error: `"${ref}" could be ${hits.map(([, t]) => t).join(" or ")}. Say which.` };
}
