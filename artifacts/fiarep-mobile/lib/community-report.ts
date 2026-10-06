// Community Coordinator visit report: the same record rendered as a printable
// page (PDF) and as plain text (copy / email). Shared by the website and the app.

export const MOLD_EXTENT = ["Small spot", "Several areas", "Widespread"];
export const VERMIN_TYPES = ["Mice", "Rats", "Roaches", "Bedbugs", "Other"];
export const VERMIN_FREQUENCY = ["Occasionally", "Weekly", "Daily"];
export const LEAD_TESTED = ["Not tested", "Tested – results pending", "Tested – positive", "Tested – negative"];
export const LEAD_DOCUMENTS = ["Lead test results", "XRF report", "Doctor's note", "HPD lead notice", "Photos", "Other"];

export type MoldInfo = { present?: boolean; locations?: string; extent?: string; since?: string; notes?: string };
export type VerminInfo = { present?: boolean; types?: string[]; locations?: string; frequency?: string; notes?: string };
export type LeadChild = { name?: string; age?: string; dob?: string };
export type LeadInfo = { present?: boolean; childUnder6?: boolean; children?: LeadChild[]; peelingPaint?: string; tested?: string; documents?: string[]; notes?: string };
export type AffidavitInfo = { given?: boolean; statement?: string; affiantName?: string; date?: string; witnessName?: string; affirmed?: boolean };

export type ResidentState = Record<string, any> & {
  mold?: MoldInfo; vermin?: VerminInfo; lead?: LeadInfo; affidavit?: AffidavitInfo;
};

const s = (v: unknown) => String(v ?? "").trim();
const esc = (v: unknown) => s(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const yes = (v: unknown) => (v === true ? "Yes" : "No");
const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(", ") : "");

export function sectionsOnRecord(st: ResidentState): string[] {
  const out: string[] = [];
  if (st.mold?.present) out.push("Mold");
  if (st.vermin?.present) out.push("Vermin");
  if (st.lead?.present) out.push("Lead");
  if (st.affidavit?.given) out.push("Affidavit");
  return out;
}

type Row = [string, string];
function residentRows(st: ResidentState, development: string): { title: string; rows: Row[]; text?: string }[] {
  const blocks: { title: string; rows: Row[]; text?: string }[] = [];
  blocks.push({
    title: "Resident",
    rows: [
      ["Name", s(st.name)], ["Phone", s(st.phone)], ["Email", s(st.email)],
      ["Building address", s(st.address)], ["Apartment", s(st.apartment)],
      ["Borough", s(st.borough)], ["Development", s(development)],
      ["Program", s(st.program)], ["Visit date", s(st.visitedOn)],
      ["Critical", st.critical === true ? `Yes${list(st.criticalTags) ? ` — ${list(st.criticalTags)}` : ""}` : "No"],
    ],
  });
  if (st.mold?.present) blocks.push({
    title: "Mold",
    rows: [["Where", s(st.mold.locations)], ["Extent", s(st.mold.extent)], ["Since", s(st.mold.since)], ["Notes", s(st.mold.notes)]],
  });
  if (st.vermin?.present) blocks.push({
    title: "Vermin / pests",
    rows: [["Type", list(st.vermin.types)], ["Where", s(st.vermin.locations)], ["How often", s(st.vermin.frequency)], ["Notes", s(st.vermin.notes)]],
  });
  if (st.lead?.present) blocks.push({
    title: "Lead paint",
    rows: [
      ["Child under 6 in the unit", yes(st.lead.childUnder6)],
      ["Children", (Array.isArray(st.lead.children) ? st.lead.children : []).filter((c: LeadChild) => s(c.name) || s(c.dob) || s(c.age))
        .map((c: LeadChild) => [s(c.name) || "Child", s(c.age) ? `age ${s(c.age)}` : "", s(c.dob) ? `DOB ${s(c.dob)}` : ""].filter(Boolean).join(", ")).join("; ")],
      ["Peeling / chipping paint", s(st.lead.peelingPaint)],
      ["Testing", s(st.lead.tested)], ["Documents provided", list(st.lead.documents)], ["Notes", s(st.lead.notes)],
    ],
  });
  if (st.affidavit?.given) blocks.push({
    title: "Affidavit",
    rows: [["Affiant", s(st.affidavit.affiantName) || s(st.name)], ["Date", s(st.affidavit.date) || s(st.visitedOn)], ["Witness", s(st.affidavit.witnessName)], ["Affirmed true and correct", yes(st.affidavit.affirmed)]],
    text: s(st.affidavit.statement),
  });
  if (s(st.notes)) blocks.push({ title: "Coordinator notes", rows: [], text: s(st.notes) });
  return blocks;
}

export function residentReportText(st: ResidentState, development: string, orgName = "FIAREP"): string {
  const lines: string[] = [orgName, "Community Coordinator Visit Report (FIAREP)", ""];
  for (const b of residentRows(st, development)) {
    lines.push(b.title.toUpperCase());
    for (const [k, v] of b.rows) if (v) lines.push(`${k}: ${v}`);
    if (b.text) lines.push(b.text);
    lines.push("");
  }
  if (s(st.loggedByName)) lines.push(`Logged by ${s(st.loggedByName)}${s(st.loggedByPosition) ? ` (${s(st.loggedByPosition)})` : ""}`);
  return lines.join("\n").trim();
}

export function residentReportHtml(st: ResidentState, development: string, orgName = "FIAREP"): string {
  const blocks = residentRows(st, development);
  const body = blocks.map((b) => `
    <section>
      <h2>${esc(b.title)}</h2>
      ${b.rows.length ? `<table>${b.rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
      ${b.text ? `<p class="text">${esc(b.text).replace(/\n/g, "<br>")}</p>` : ""}
      ${b.title === "Affidavit" ? `<div class="sig"><div><span></span>Affiant signature</div><div><span></span>Witness / Coordinator</div><div><span></span>Date</div></div>` : ""}
    </section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Visit report — ${esc(st.name)}</title>
  <style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;margin:36px;font-size:13px}
    header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #f2c14e;padding-bottom:10px;margin-bottom:18px}
    header h1{margin:0;font-size:20px} header .brand{font-weight:800;font-size:22px;max-width:70%} header .brand b{color:#d99a00}
    .meta{color:#555;font-size:12px}
    section{margin-bottom:16px;page-break-inside:avoid} h2{font-size:14px;margin:0 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px}
    table{border-collapse:collapse;width:100%} th{text-align:left;color:#555;font-weight:600;width:34%;padding:3px 8px 3px 0;vertical-align:top} td{padding:3px 0;vertical-align:top}
    .text{white-space:pre-wrap;border:1px solid #ddd;border-radius:6px;padding:8px;margin:6px 0 0}
    .sig{display:flex;gap:24px;margin-top:28px} .sig div{flex:1;font-size:11px;color:#555} .sig span{display:block;border-bottom:1px solid #111;height:28px;margin-bottom:4px}
    .critical{display:inline-block;background:#fef3c7;color:#92400e;font-weight:700;padding:2px 8px;border-radius:999px;font-size:11px}
    footer{margin-top:24px;color:#777;font-size:11px;border-top:1px solid #ddd;padding-top:8px}
    @media print{body{margin:18px}}
  </style></head><body>
  <header><div><div class="brand">${esc(orgName)}</div><h1>Community Coordinator Visit Report</h1></div>
  <div class="meta">${esc(st.visitedOn)}${st.critical === true ? ' <span class="critical">CRITICAL</span>' : ""}</div></header>
  ${body}
  <footer>${esc(s(st.loggedByName) ? `Logged by ${s(st.loggedByName)}${s(st.loggedByPosition) ? ` (${s(st.loggedByPosition)})` : ""}` : "")} · Confidential: for the Community Coordinator unit only. · Powered by FIAREP</footer>
  </body></html>`;
}
