// The receipt for a quick quote. FIAREP prices a walk and either sends it or
// approves it; either way the owner gets a piece of paper that says what was
// bought, what each item cost off FIAREP's book, who approved it and when.
//
// Printed at 11pt and up, because it is read on paper as often as on a screen.

export type ReceiptLine = { id: string; label: string; unit: string; qty: number; unitPrice: number; amount: number; note?: string };
export type Receipt = {
  lines: ReceiptLine[];
  total: number;
  status: string;
  approvedBySelf: boolean;
  clientCompany: string;
  building: string;
  note: string;
  sentBy: string;
  sentAt: string;
  decidedBy: string;
  decidedAt: string;
};

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const day = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** A short human reference, stable for the same quote. */
export function receiptNumber(r: Receipt): string {
  const t = r.sentAt ? new Date(r.sentAt) : new Date();
  const stamp = `${t.getFullYear()}`.slice(2) + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0");
  const tail = Math.abs([...(r.lines[0]?.id || "x")].reduce((n, c) => n * 31 + c.charCodeAt(0), 7)) % 10000;
  return `QQ-${stamp}-${String(tail).padStart(4, "0")}`;
}

export function quoteReceiptHtml(r: Receipt): string {
  const tone = r.status === "approved" ? "ok" : r.status === "declined" ? "no" : "wait";
  // A sheet printed before it is sent must not claim anyone is waiting on it.
  const draft = r.status === "draft";
  const decided = draft ? "Not sent yet" : r.approvedBySelf
    ? `Approved by FIAREP${r.decidedBy ? ` · ${esc(r.decidedBy)}` : ""}`
    : r.status === "approved" ? `Approved by ${esc(r.clientCompany || "the owner")}${r.decidedBy ? ` · ${esc(r.decidedBy)}` : ""}`
    : r.status === "declined" ? `Declined by ${esc(r.decidedBy && !r.clientCompany ? r.decidedBy : r.clientCompany || "the owner")}`
    : r.status === "admin_review" ? "Waiting on FIAREP's administrator"
    : `Waiting on ${esc(r.clientCompany || "the owner")}`;
  const rows = r.lines.map((l) => `
      <tr>
        <td>${esc(l.label)}${l.note ? `<div class="note">${esc(l.note)}</div>` : ""}</td>
        <td class="n">${esc(l.qty)}</td>
        <td class="n">${money(l.unitPrice)}<div class="note">${esc(l.unit)}</div></td>
        <td class="n b">${money(l.amount)}</td>
      </tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(receiptNumber(r))}</title>
<style>
  body{font-family:'Source Sans 3',-apple-system,Segoe UI,sans-serif;color:#0B1F3A;margin:28px;font-size:12pt;line-height:1.4}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B1F3A;padding-bottom:10px}
  .brand{font-weight:800;font-size:20pt;letter-spacing:.02em}
  .brand span{color:#D97706}
  .ref{text-align:right;font-size:11pt;color:#475569}
  h1{font-size:14pt;margin:18px 0 2px}
  .meta{font-size:11pt;color:#475569;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{text-align:left;font-size:10.5pt;text-transform:uppercase;letter-spacing:.06em;color:#475569;border-bottom:1px solid #0B1F3A;padding:6px 8px}
  td{padding:8px;border-bottom:1px solid #e2e8f0;vertical-align:top}
  .n{text-align:right;white-space:nowrap}
  .b{font-weight:700}
  .note{font-size:10.5pt;color:#64748b}
  .total{display:flex;justify-content:space-between;font-weight:800;font-size:14pt;padding:10px 8px;border-top:2px solid #0B1F3A}
  .status{display:inline-block;border-radius:999px;padding:3px 10px;font-weight:700;font-size:11pt}
  .status.ok{background:#ECFDF5;border:1px solid #059669;color:#065F46}
  .status.no{background:#FEF2F2;border:1px solid #DC2626;color:#991B1B}
  .status.wait{background:#FFFBEB;border:1px solid #F59E0B;color:#92400E}
  footer{margin-top:22px;border-top:1px solid #cbd5e1;padding-top:10px;font-size:11pt;color:#475569}
  @media print{body{margin:14mm}}
</style></head><body>
<header>
  <div><div class="brand">FIA<span>REP</span></div><div class="ref">Field Infrastructure, Asset Reporting &amp; Evaluation Performance</div></div>
  <div class="ref"><div><b>${esc(receiptNumber(r))}</b></div><div>${esc(day(r.sentAt))}</div></div>
</header>
<h1>${esc(r.building || "Receipt")}</h1>
<div class="meta">${esc(r.clientCompany || "")}${r.clientCompany ? " · " : ""}Priced by ${esc(r.sentBy || "FIAREP")}</div>
<div class="status ${tone}">${decided}${r.decidedAt ? ` · ${esc(day(r.decidedAt))}` : ""}</div>
<table>
  <thead><tr><th>What the job needs</th><th class="n">Qty</th><th class="n">Each</th><th class="n">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="total"><span>Total</span><span>${money(r.total)}</span></div>
${r.note ? `<p>${esc(r.note)}</p>` : ""}
<footer>
  Every line is priced from FIAREP's repair price book. This covers the materials and the labour listed above; it does not include permits, engineers, lab testing or City fees, which are billed as incurred.
  <div style="margin-top:6px">fiarep@outlook.com · fiarep.com</div>
</footer>
</body></html>`;
}

/** Plain text, for pasting into a message. */
export function quoteReceiptText(r: Receipt): string {
  const lines = [
    `FIAREP · ${receiptNumber(r)}`,
    r.building,
    r.clientCompany,
    "",
    ...r.lines.map((l) => `${l.qty} × ${l.label} — ${money(l.amount)}${l.note ? ` (${l.note})` : ""}`),
    "",
    `Total: ${money(r.total)}`,
    r.status === "draft" ? "Not sent yet" : r.approvedBySelf ? `Approved by FIAREP${r.decidedBy ? ` · ${r.decidedBy}` : ""}` : `Status: ${r.status}`,
    r.note,
    "fiarep@outlook.com",
  ];
  return lines.filter(Boolean).join("\n");
}
