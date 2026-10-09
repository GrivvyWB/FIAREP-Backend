// HPD dismissal request packet for violations written incorrectly (wrong
// apartment, wrong story, a story the building does not have).
//
// HPD has no separate "issued in error" form. The route is the Dismissal
// Request (Form DR-1): HPD inspects, and a violation whose condition does not
// exist at the location cited is dismissed. This packet is (1) a cover letter
// to the Code Enforcement Borough Office stating, violation by violation, why
// each should be dismissed, and (2) the DR-1 fields filled in so the official
// form can be copied over and signed. Fees and offices from HPD's "Clearing
// HPD Violations" guide and DR-1 instructions (nyc.gov/hpd).
import { BRAND } from "@/lib/contract";

export type DismissalViolation = { id: string; class: string; apartment: string; story: string; issued: string; description: string; reason: string };
export type DismissalInput = {
  address: string; borough: string; zip: string; bbl: string; units: number; openViolations: number; inAep: boolean;
  registrationId: string;
  requestor: { name: string; role: "Owner" | "Managing Agent"; organization: string; address: string; phone: string; email: string };
  representative: { name: string; phone: string; email: string };
  violations: DismissalViolation[];
  date: string;
};

export const BOROUGH_OFFICE: Record<string, { name: string; address: string; phone: string }> = {
  MANHATTAN: { name: "Manhattan Code Enforcement Borough Office", address: "94 Old Broadway, 7th Floor, New York, NY 10027", phone: "(212) 863-5030" },
  BRONX: { name: "Bronx Code Enforcement Borough Office", address: "1932 Arthur Avenue, 3rd Floor, Bronx, NY 10457", phone: "(212) 863-7050" },
  BROOKLYN: { name: "Brooklyn Code Enforcement Borough Office", address: "701 Euclid Avenue, Brooklyn, NY 11208", phone: "(212) 863-6620" },
  QUEENS: { name: "Queens Code Enforcement Borough Office", address: "120-55 Queens Boulevard, 1st Floor, Kew Gardens, NY 11424", phone: "(212) 863-5990" },
  "STATEN ISLAND": { name: "Staten Island Code Enforcement Borough Office", address: "Borough Hall, 10 Richmond Terrace, 2nd Floor, Staten Island, NY 10301", phone: "(212) 863-8100" },
};
export const AEP_OFFICE = { name: "HPD Alternative Enforcement Program", phone: "(212) 863-8262" };
// Effective July 1, 2026 HPD takes Dismissal Request applications centrally (HPD "Clear Violations" page).
export const CVAU_OFFICE = { name: "HPD Code Enforcement — Central Violations Administration Unit", address: "345 Adams Street, 10th Floor, Brooklyn, NY 11201" };
export const DR1_FORM_URL = "https://www.nyc.gov/assets/hpd/downloads/pdfs/services/dismissal-request-form-clear-violations.pdf";

/** DR-1 fee from HPD's schedule. */
export function dismissalFee(units: number, openViolations: number, inAep: boolean): { fee: number; basis: string } {
  if (inAep) return { fee: 1000, basis: "Multiple dwelling in the Alternative Enforcement Program — submit to the AEP office, not the borough office" };
  if (units <= 2) return { fee: 250, basis: "Private dwelling (1–2 units)" };
  if (openViolations <= 300) return { fee: 300, basis: "Multiple dwelling, 1–300 open violations" };
  if (openViolations <= 500) return { fee: 400, basis: "Multiple dwelling, 301–500 open violations" };
  return { fee: 500, basis: "Multiple dwelling, 501 or more open violations" };
}

const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function buildDismissalHtml(i: DismissalInput): string {
  const office = BOROUGH_OFFICE[i.borough.toUpperCase()] || BOROUGH_OFFICE["MANHATTAN"]!;
  const fee = dismissalFee(i.units, i.openViolations, i.inAep);
  const ids = i.violations.map((v) => v.id);
  const rows = i.violations.map((v, n) => `<tr><td>${n + 1}</td><td>${esc(v.id)}</td><td>${esc(v.class)}</td><td>${esc([v.apartment ? `Apt ${v.apartment}` : "", v.story && v.story !== "0" ? `Floor ${v.story}` : ""].filter(Boolean).join(", ") || "—")}</td><td>${esc(v.issued)}</td><td class="nov">${esc(v.description)}</td><td class="why">${esc(v.reason)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Dismissal Request — ${esc(i.address)}</title>
<style>
  body{font-family:Georgia,"Times New Roman",serif;color:#111;margin:0;padding:36px 44px;font-size:12.5px;line-height:1.45}
  h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
  .brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:16px}
  .brand .n{font-size:22px;font-weight:bold;letter-spacing:.04em;font-family:Arial,sans-serif}.brand small{display:block;color:#444;font-size:11px}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}th,td{border:1px solid #999;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eee}
  td.nov{width:38%}td.why{width:24%;font-weight:bold}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px}.grid div{border-bottom:1px dotted #999;padding:3px 0}.grid b{display:inline-block;min-width:170px}
  .sig{display:flex;gap:40px;margin-top:28px}.sig div{flex:1;border-top:1px solid #111;padding-top:4px;font-size:11px}
  .note{background:#f6f3e8;border:1px solid #d8cf9f;padding:8px 10px;font-size:11px;margin:10px 0}
  .page{page-break-before:always}
  @media print{body{padding:0}}
</style></head><body>
<div class="brand"><div><div class="n">${esc(BRAND.name)}</div><small>${esc(BRAND.long)} · ${esc(BRAND.email)}</small></div><div style="text-align:right;font-size:11px">${esc(i.date)}<br>Property: ${esc(i.address)}, ${esc(i.borough)} ${esc(i.zip)}<br>BBL ${esc(i.bbl)} · HPD registration ${esc(i.registrationId || "—")}</div></div>

<p>${esc(CVAU_OFFICE.name)}<br>NYC Department of Housing Preservation and Development<br>${esc(CVAU_OFFICE.address)}<br><span style="font-size:11px;color:#444">cc: ${esc(office.name)} · ${esc(office.phone)}</span></p>
<p><b>Re: Request for dismissal of violations issued in error — ${esc(i.address)}, ${esc(i.borough)} (HPD violation numbers ${esc(ids.join(", "))})</b></p>
<p>To the Central Violations Administration Unit:</p>
<p>On behalf of the registered ${esc(i.requestor.role.toLowerCase())} of the above property, ${esc(i.requestor.name)}${i.requestor.organization ? ` (${esc(i.requestor.organization)})` : ""}, we request review and dismissal of the ${i.violations.length} housing maintenance code violation${i.violations.length === 1 ? "" : "s"} listed below. In each case the Notice of Violation does not describe a condition at the location it cites: the apartment or floor named in the Notice does not match HPD's own apartment and floor record for the violation, or names a floor the building does not have. The conditions cannot be certified as corrected because they were not found at the location written. We ask that each be dismissed on inspection, or that the record be corrected to the actual location so it can be cured.</p>
<table><thead><tr><th>#</th><th>HPD violation</th><th>Class</th><th>Location on record</th><th>Issued</th><th>Notice of Violation as written</th><th>Why it should be dismissed</th></tr></thead><tbody>${rows}</tbody></table>
<p>A Dismissal Request (Form DR-1) covering only these violation numbers is enclosed with the fee of ${money(fee.fee)} (${esc(fee.basis)}) by certified check or money order payable to the NYC Department of Finance, with the property registration number noted. The building is ready for inspection at the earliest time HPD can schedule; the inspection contact is below.</p>
<div class="sig"><div>${esc(i.requestor.name)}${i.requestor.organization ? `, ${esc(i.requestor.organization)}` : ""}<br>Registered ${esc(i.requestor.role)} · ${esc(i.requestor.phone)} · ${esc(i.requestor.email)}<br><br>Signature / date</div><div>${esc(i.representative.name)}, ${esc(BRAND.name)}<br>Authorized representative · ${esc(i.representative.phone)} · ${esc(i.representative.email)}<br><br>Signature / date</div></div>

<div class="page"></div>
<h1>Dismissal Request — Form DR-1 (field sheet)</h1>
<p style="font-size:11px;color:#444">Copy these entries onto HPD's official Dismissal Request form (${esc(DR1_FORM_URL)}), sign it, and submit with payment to the office below. ${i.inAep ? `<b>This building is in the Alternative Enforcement Program: submit to the ${esc(AEP_OFFICE.name)}, ${esc(AEP_OFFICE.phone)}, fee ${money(1000)}.</b>` : ""}</p>
<h2>1. Building to be inspected</h2>
<div class="grid"><div><b>Building address</b> ${esc(i.address)}</div><div><b>Borough</b> ${esc(i.borough)}</div><div><b>Number of dwelling units</b> ${i.units || "—"}</div><div><b>Property registration number</b> ${esc(i.registrationId || "—")}</div></div>
<div style="margin-top:6px"><b>Violation numbers to be inspected:</b> ☐ ALL &nbsp; ☒ ONLY — ${esc(ids.join(", "))}</div>
<h2>2. Requestor information</h2>
<div class="grid"><div><b>Name (print)</b> ${esc(i.requestor.name)}</div><div><b>Requestor is</b> ${i.requestor.role === "Owner" ? "☒ Owner ☐ Managing Agent" : "☐ Owner ☒ Managing Agent"}</div><div><b>Address</b> ${esc(i.requestor.address)}</div><div><b>Telephone</b> ${esc(i.requestor.phone)}</div><div><b>Email</b> ${esc(i.requestor.email)}</div><div><b>Date</b> ${esc(i.date)}</div></div>
<p style="font-size:11px;margin-top:8px">Certification on the form: <i>“I understand that by submitting this application, I am confirming that the building is ready for inspection”</i> at the earliest time HPD can schedule. Only the registered owner / managing agent or an authorized representative may file; the property registration must be current; requests are rejected if there is pending HPD litigation, an uncollected HPD judgment, or unpaid HPD emergency repair charges.</p>
<h2>3. Contact to schedule inspection</h2>
<div class="grid"><div><b>Name</b> ${esc(i.representative.name)} (${esc(BRAND.name)})</div><div><b>Phone</b> ${esc(i.representative.phone)}</div><div><b>Email</b> ${esc(i.representative.email)}</div></div>
<h2>Fee and submission</h2>
<div class="grid"><div><b>Fee</b> ${money(fee.fee)}</div><div><b>Basis</b> ${esc(fee.basis)}</div><div><b>Payable to</b> NYC Department of Finance (certified check or money order; note registration no. ${esc(i.registrationId || "—")})</div><div><b>Submit to</b> ${i.inAep ? `${esc(AEP_OFFICE.name)} · ${esc(AEP_OFFICE.phone)}` : `${esc(CVAU_OFFICE.name)}, ${esc(CVAU_OFFICE.address)} (since July 1, 2026) · questions: ${esc(office.name)} ${esc(office.phone)}`}</div></div>
<div class="note">Source: NYC HPD, “Clear Violations” page (central submission effective July 1, 2026), “Clearing HPD Violations” guide and Dismissal Request Form DR-1 instructions (nyc.gov/hpd). HPD does not publish an email address for dismissal requests; the form is mailed or hand-delivered (credit card accepted only in person). This packet is prepared by ${esc(BRAND.name)} as authorized representative; the registered owner or managing agent signs the official form.</div>
</body></html>`;
}
