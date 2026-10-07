// What a building owes the City: OATH / ECB summons balances (DOB, FDNY,
// DSNY, DEP… — paid through the Department of Finance) and HPD Emergency
// Repair / Open Market Order charges billed to the owner. Looked up by the
// address → borough, block and lot, from NYC Open Data.
import { geocodeNycAddress, socrataUrl } from "./nycProperty";

const OATH_CASES = "jz4z-kudi";      // OATH Hearings Division Case Status
const HPD_OMO_CHARGES = "mdbu-nrqn"; // HPD Open Market Order (ERP) charges

const BOROUGH_NAMES: Record<string, string> = { "1": "MANHATTAN", "2": "BRONX", "3": "BROOKLYN", "4": "QUEENS", "5": "STATEN ISLAND" };
const text = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number => { const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };

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

export type DofLookup = {
  property: { query: string; formattedAddress: string; borough: string; block: string | null; lot: string | null; bbl: string | null; bin: string | null };
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

  return {
    property: {
      query: address.trim(), formattedAddress: text(props["label"]) || address.trim(), borough: boroughName, block, lot, bbl, bin,
    },
    oath: {
      openBalance: open.reduce((n, i) => n + i.balance, 0), openCount: open.length,
      penaltiesImposed: items.reduce((n, i) => n + i.penalty, 0), paid: items.reduce((n, i) => n + i.paid, 0),
      items: open.slice(0, 200), byAgency,
    },
    hpdCharges: { total: hpdItems.reduce((n, c) => n + c.amount, 0), count: hpdItems.length, items: hpdItems.slice(0, 100) },
    warnings,
    retrievedAt: new Date().toISOString(),
  };
}
