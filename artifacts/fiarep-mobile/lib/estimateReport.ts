import { COST_CATEGORIES, COST_DISCLAIMER, type CostEstimateState } from './costEstimate';

const esc = (v: any) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

export function buildEstimateHTML(state: CostEstimateState): string {
  const h = state.header ?? {};
  const rows = state.rows ?? {};
  const parseNum = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
  const _estimate = COST_CATEGORIES.reduce((sum, c) => sum + parseNum((rows[c.id] ?? {}).cost), 0);
  const _cont = _estimate * 0.10;
  const _total = _estimate + _cont;
  const _units = parseNum((state.totals ?? {}).numUnits);
  const _perDU = _units > 0 ? _total / _units : 0;
  const _money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const t = {
    costEstimate: _money(_estimate),
    contingency: _money(_cont),
    total: _money(_total),
    costPerDU: _units > 0 ? _money(_perDU) : '',
  };

  const bodyRows = COST_CATEGORIES.map(cat => {
    const r = rows[cat.id] ?? {};
    // section header row (green) then the data row
    return `
      <tr class="secrow"><td colspan="3">${esc(cat.title)}</td></tr>
      <tr>
        <td class="loc">${esc(r.location)}</td>
        <td class="desc">${esc(r.description)}</td>
        <td class="cost">${r.cost ? esc(r.cost) : ''}</td>
      </tr>`;
  }).join('');

  const totalsRows = `
    <tr class="totrow"><td colspan="2" class="totlabel">COST ESTIMATE:</td><td class="cost">${esc(t.costEstimate)}</td></tr>
    <tr class="totrow"><td colspan="2" class="totlabel italic">CONTINGENCY (10%):</td><td class="cost italic">${esc(t.contingency)}</td></tr>
    <tr class="totrow"><td colspan="2" class="totlabel bold">TOTAL :</td><td class="cost bold">${esc(t.total)}</td></tr>
    <tr class="totrow"><td colspan="2" class="totlabel italic">COST/DU :</td><td class="cost italic">${esc(t.costPerDU)}</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: 'Times New Roman', Times, serif; color: #000; font-size: 11px; margin: 0; padding: 20px; }
    .title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 13px; margin-bottom: 12px; }
    .hdr { width: 100%; margin-bottom: 10px; }
    .hdr td { padding: 2px 4px; vertical-align: top; }
    .hdr .k { font-weight: normal; white-space: nowrap; }
    .hdr .v { font-weight: bold; border-bottom: 1px solid #000; }
    table.main { width: 100%; border-collapse: collapse; }
    table.main td { border: 1px solid #444; padding: 4px 6px; vertical-align: top; }
    thead th { border: 1px solid #444; background: #d9ead3; padding: 6px; font-weight: bold; text-align: center; font-size: 11px; }
    th.loc { width: 27%; } th.desc { width: 58%; } th.cost { width: 15%; }
    tr.secrow td { background: #d9ead3; font-weight: bold; font-size: 11px; }
    td.loc { width: 27%; }
    td.desc { width: 58%; }
    td.cost { width: 15%; text-align: right; white-space: nowrap; }
    tr.totrow td { border: 1px solid #444; padding: 5px 6px; }
    .totlabel { text-align: right; font-weight: bold; }
    .italic { font-style: italic; }
    .bold { font-weight: bold; }
    .note { margin-top: 16px; font-size: 10px; }
    .note .h { font-weight: bold; }
    .note .body { font-style: italic; }
  </style></head><body>
    <div class="title">NATURE OF WORK &amp; ESTIMATE OF COST</div>
    <table class="hdr">
      <tr><td class="k">DATE:</td><td class="v">${esc(h.date)}</td></tr>
      <tr><td class="k">BUILDING ADDRESS:</td><td class="v">${esc(h.buildingAddress)}</td></tr>
      <tr><td class="k">INSPECTION DATE(S):</td><td class="v">${esc(h.inspectionDates)}</td></tr>
      <tr><td class="k">CONST. PROJECT MANAGER:</td><td class="v">${esc(h.projectManager)}</td></tr>
      ${h.companyName ? `<tr><td class="k">COMPANY:</td><td class="v">${esc(h.companyName)}</td></tr>` : ''}
    </table>
    <table class="main">
      <thead><tr>
        <th class="loc">LOCATION:</th>
        <th class="desc">BRIEF DESCRIPTION OF THE WORK REQUIRED TO REMOVE OR REMEDY THE CONDITION:</th>
        <th class="cost">ESTIMATE OF COST:</th>
      </tr></thead>
      <tbody>
        ${bodyRows}
        ${totalsRows}
      </tbody>
    </table>
    <div class="note">
      <div class="h">PLEASE NOTE:</div>
      <div class="body">${esc(COST_DISCLAIMER)}</div>
    </div>
  </body></html>`;
}
