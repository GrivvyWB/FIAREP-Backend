// FIAREP service agreement — built in Platform Control from the repair price
// book and the client's details, then printed to PDF or emailed. All clause
// text lives here so it can be edited in one place.
import { FEES, PLAN, PLATFORM_INCLUDES, RETAINER_INCLUDES } from "./fiarep-plans";

export type ContractKind = "fiarep" | "platform" | "agency-major" | "agency-small";
export type Building = { name: string; address: string; units: number };
export type ScopeLine = { label: string; qty: number; unit: string; price: number };
export type ContractInput = {
  kind: ContractKind;
  number: string;
  date: string;              // ISO date
  fiarepSigner: string;      // "Tim Winn, Managing Member"
  fiarepEntity: string;      // "Grivvy Com LLC d/b/a FIAREP"
  client: { company: string; contact: string; title: string; address: string; email: string; phone: string };
  buildings: Building[];
  units: number;
  flatFee: number;           // agency contracts: monthly flat fee
  pilot: boolean;            // plans: first 60 days at half price
  startDate: string;         // ISO date
  termMonths: number;
  scope: ScopeLine[];
  engineering: { label: string; amount: number } | null;
  notes: string;
};

export const BRAND = { name: "FIAREP", long: "Field Infrastructure, Asset, Reporting and Evaluation Performance", site: "fiarep.com", email: "fiarep@outlook.com" };
export const KIND_LABEL: Record<ContractKind, string> = {
  fiarep: `${PLAN.fiarep.name} — $${PLAN.fiarep.perUnit} per unit per month`,
  platform: `${PLAN.platform.name} — $${PLAN.platform.perUnit} per unit per month`,
  "agency-major": `Housing authority / agency — major portfolio (${PLAN.agencyMinUnits.toLocaleString()}+ units), flat monthly fee`,
  "agency-small": `Housing authority / agency — small portfolio (under ${PLAN.agencyMinUnits.toLocaleString()} units), flat monthly fee`,
};

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const longDate = (iso: string) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "____________");

export function monthlyFee(c: ContractInput): { monthly: number; basis: string; setup: number } {
  if (c.kind === "fiarep") return { monthly: Math.max(c.units * PLAN.fiarep.perUnit, PLAN.fiarep.minimum), basis: `${c.units.toLocaleString()} units × $${PLAN.fiarep.perUnit} (minimum ${money(PLAN.fiarep.minimum)})`, setup: 0 };
  if (c.kind === "platform") return { monthly: Math.max(c.units * PLAN.platform.perUnit, PLAN.platform.minimum), basis: `${c.units.toLocaleString()} units × $${PLAN.platform.perUnit} (minimum ${money(PLAN.platform.minimum)})`, setup: PLAN.platform.setup };
  return { monthly: c.flatFee, basis: `flat fee for ${c.units.toLocaleString()} units across ${c.buildings.length} development${c.buildings.length === 1 ? "" : "s"}`, setup: 0 };
}
export const scopeTotal = (c: ContractInput) => c.scope.reduce((n, l) => n + l.qty * l.price, 0) + (c.engineering?.amount || 0);

export function contractNumber(date = new Date()): string {
  const d = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `FIAREP-${d}-${Math.floor(100 + Math.random() * 900)}`;
}

/** Self-contained HTML: prints to Letter from the browser and reads the same in email. */
export function buildContractHtml(c: ContractInput): string {
  const fee = monthlyFee(c);
  const includes = c.kind === "platform" ? PLATFORM_INCLUDES : RETAINER_INCLUDES.filter((l) => !l.startsWith("Pilot"));
  const repairs = c.scope.reduce((n, l) => n + l.qty * l.price, 0);
  const rows = c.scope.map((l) => `<tr><td>${esc(l.label)}</td><td class="r">${l.qty.toLocaleString()}</td><td>${esc(l.unit)}</td><td class="r">${money(l.price)}</td><td class="r">${money(l.qty * l.price)}</td></tr>`).join("");
  const bld = c.buildings.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.address)}</td><td class="r">${b.units.toLocaleString()}</td></tr>`).join("");
  const feeRows = FEES.map(([what, rate, detail]) => `<tr><td>${esc(what)}<div class="muted">${esc(detail)}</div></td><td class="r nowrap">${esc(rate)}</td></tr>`).join("");
  const planClause = c.kind === "fiarep"
    ? `Client pays FIAREP a monthly service fee of <b>${money(fee.monthly)}</b> (${esc(fee.basis)}). The fee covers the services in Section 2. Work beyond the included cures is billed at the Section 5 rates: OATH hearings at $400 instead of $600, and 20% off every other rate.${c.pilot ? ` <b>Pilot:</b> the first ${PLAN.fiarep.pilotDays} days are billed at half the monthly fee (${money(Math.round(fee.monthly / 2))}) and either party may end this Agreement during the pilot on written notice.` : ""}`
    : c.kind === "platform"
      ? `Client pays FIAREP a monthly platform fee of <b>${money(fee.monthly)}</b> (${esc(fee.basis)}) plus a one-time setup and staff-training fee of <b>${money(fee.setup)}</b>. Violation removal, expediting and hearings are available at the Section 5 rates with no plan discount.`
      : `Client pays FIAREP a flat monthly fee of <b>${money(fee.monthly)}</b> (${esc(fee.basis)}), covering the services in Section 2 for every development listed in Section 1. Work beyond the included cures is billed at the Section 5 rates with the plan discount: OATH hearings at $400 instead of $600, and 20% off every other rate.`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(BRAND.name)} Service Agreement ${esc(c.number)}</title>
<style>
  @page { size: Letter; margin: 0.75in; }
  body { font: 11pt/1.45 Georgia, "Times New Roman", serif; color: #111; margin: 0; }
  .wrap { max-width: 7.5in; margin: 0 auto; padding: 24px; }
  h1 { font: bold 20pt Helvetica, Arial, sans-serif; margin: 0; letter-spacing: 0.02em; }
  .brand { font: bold 12pt Helvetica, Arial, sans-serif; color: #b45309; }
  .sub { font: 9.5pt Helvetica, Arial, sans-serif; color: #555; }
  h2 { font: bold 12pt Helvetica, Arial, sans-serif; margin: 20px 0 6px; border-bottom: 1px solid #999; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 6px 0; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; vertical-align: top; text-align: left; }
  th { background: #f1f1f1; font-family: Helvetica, Arial, sans-serif; font-size: 9pt; }
  .r { text-align: right; } .nowrap { white-space: nowrap; } .muted { color: #666; font-size: 9pt; }
  .total td { font-weight: bold; background: #fafafa; }
  .sig { display: flex; gap: 32px; margin-top: 28px; page-break-inside: avoid; }
  .sig div { flex: 1; } .line { border-top: 1px solid #111; margin-top: 44px; padding-top: 4px; font-size: 9.5pt; }
  ul { margin: 4px 0 4px 18px; padding: 0; } li { margin: 2px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #b45309; padding-bottom: 10px; }
  .meta { text-align: right; font: 9.5pt Helvetica, Arial, sans-serif; color: #333; }
  @media print { .wrap { padding: 0; } }
</style></head><body><div class="wrap">
<div class="head">
  <div><div class="brand">${esc(BRAND.name)} · ${esc(BRAND.long)}</div><h1>Service Agreement</h1><div class="sub">${esc(KIND_LABEL[c.kind])}</div></div>
  <div class="meta">Agreement No. <b>${esc(c.number)}</b><br>Date: ${esc(longDate(c.date))}<br>${esc(BRAND.site)} · ${esc(BRAND.email)}</div>
</div>

<p>This Service Agreement (the "Agreement") is made on ${esc(longDate(c.date))} between <b>${esc(c.fiarepEntity)}</b> ("FIAREP") and <b>${esc(c.client.company)}</b>${c.client.address ? `, ${esc(c.client.address)}` : ""} ("Client"), represented by ${esc(c.client.contact)}${c.client.title ? `, ${esc(c.client.title)}` : ""}.</p>

<h2>1. Properties covered</h2>
<table><thead><tr><th>Development / building</th><th>Address</th><th class="r">Units</th></tr></thead><tbody>${bld || `<tr><td colspan="3" class="muted">To be listed</td></tr>`}<tr class="total"><td colspan="2">Total</td><td class="r">${c.units.toLocaleString()} units</td></tr></tbody></table>

<h2>2. Services</h2>
<ul>${includes.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p class="muted">Residents and staff use the FIAREP app and website; supervisors and management see the development's complaints, violations and work in real time. FIAREP monitors complaints through the platform 24 / 7 and keeps the resident informed at each step.</p>

<h2>3. Fees</h2>
<p>${planClause}</p>
<p>City penalties, DOB re-inspection fees, HPD dismissal-request fees, DOB filing fees and any permit or agency charge pass through to Client at cost. Fees are invoiced monthly in advance and due within 15 days of the invoice.</p>

<h2>4. Scope of repairs and professional work</h2>
${c.scope.length || c.engineering ? `<table><thead><tr><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit price</th><th class="r">Total</th></tr></thead><tbody>${rows}${c.engineering ? `<tr><td>Architect / engineer — ${esc(c.engineering.label)}</td><td class="r">1</td><td>each</td><td class="r">${money(c.engineering.amount)}</td><td class="r">${money(c.engineering.amount)}</td></tr>` : ""}<tr class="total"><td colspan="4">Repairs ${money(repairs)}${c.engineering ? ` + engineering ${money(c.engineering.amount)}` : ""}</td><td class="r">${money(scopeTotal(c))}</td></tr></tbody></table>
<p class="muted">Unit prices are FIAREP's contract prices for this work, drawn from HPD's contractor awards and the City's published cost schedules. Work is performed by licensed, insured contractors and design professionals engaged by FIAREP. Quantities found to differ on site are adjusted at the same unit price with Client's written approval before the work proceeds.</p>` : `<p class="muted">No repair scope at signing. Repairs and professional work are quoted per item from FIAREP's price book and added by written change order.</p>`}

<h2>5. Per-job rates</h2>
<table><thead><tr><th>Service</th><th class="r">Rate</th></tr></thead><tbody>${feeRows}</tbody></table>
<p class="muted">${c.kind === "platform" ? "Platform-only clients pay the rates above with no discount." : "Plan clients: OATH hearings $400; all other rates 20% off."}</p>

<h2>6. Term</h2>
<p>This Agreement starts on ${esc(longDate(c.startDate))} and runs for ${c.termMonths} months, then continues month to month. Either party may end it after the initial term on 30 days' written notice. Client may add or remove developments on written notice; the monthly fee adjusts from the next invoice.</p>

<h2>7. General</h2>
<p>FIAREP is an independent contractor and is not a law firm, an architecture or engineering firm, or a general contractor; licensed professionals and contractors engaged for Client's work are identified on each scope. FIAREP's liability under this Agreement is limited to the fees Client paid in the three months before the claim. Client is responsible for giving FIAREP access to its properties, records and City accounts needed to perform the services. This Agreement is governed by the laws of the State of New York and is the entire agreement between the parties; changes must be in writing and signed by both.</p>
${c.notes ? `<h2>8. Additional terms</h2><p>${esc(c.notes).replaceAll("\n", "<br>")}</p>` : ""}

<div class="sig">
  <div><b>${esc(c.fiarepEntity)}</b><div class="line">Signature</div><div class="line">${esc(c.fiarepSigner)}<br>Date</div></div>
  <div><b>${esc(c.client.company)}</b><div class="line">Signature</div><div class="line">${esc(c.client.contact)}${c.client.title ? `, ${esc(c.client.title)}` : ""}<br>Date</div></div>
</div>
<p class="muted" style="margin-top:24px">${esc(BRAND.name)} — ${esc(BRAND.long)} · Agreement ${esc(c.number)}</p>
</div></body></html>`;
}
