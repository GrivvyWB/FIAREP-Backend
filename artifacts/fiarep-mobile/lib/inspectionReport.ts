import { INSPECTION_TEMPLATE, OVERVIEW_CATEGORIES, type InspectionState } from './inspection';

const esc = (v: any) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildInspectionHTML(state: InspectionState, projectName = 'Building Inspection'): string {
  const ov = state.overview ?? {};
  const apts = state.apartments ?? [];
  const aptLabel = (id: string) => apts.find(a => a.id === id)?.label || '(unnamed)';

  const catSummaries = OVERVIEW_CATEGORIES.map(cat => {
    const txt = (ov.categorySummaries ?? {})[cat];
    if (!txt) return '';
    return `<div class="cat"><div class="catname">${esc(cat)}</div><div>${esc(txt)}</div></div>`;
  }).join('');

  const actions = (ov.actions ?? []).filter(a => a.category || a.action);
  const actionsRows = actions.map(a =>
    `<tr><td>${esc(a.category)}</td><td>${esc(a.action)}</td><td class="pri-${esc(a.priority).toLowerCase()}">${esc(a.priority)}</td></tr>`
  ).join('');
  const actionsTable = actions.length ? `
    <h2>Summary of Required Actions</h2>
    <table class="actions"><thead><tr><th>Category</th><th>Action Needed</th><th>Priority</th></tr></thead>
    <tbody>${actionsRows}</tbody></table>` : '';

  const sections = INSPECTION_TEMPLATE.map(sec => {
    const rows = sec.items.map(item => {
      const rec = state.items?.[item.id] ?? {};
      const bldg = rec.choice ? `<span class="choice">${esc(rec.choice)}</span>` : '';
      const bnote = rec.note ? `<div class="note">${esc(rec.note)}</div>` : '';
      const findings = (rec.findings ?? []).filter(f => f.note || f.aptIds.length);
      const findHtml = findings.map(f => {
        const tags = f.aptIds.map(id => `<span class="apt">${esc(aptLabel(id))}</span>`).join(' ');
        return `<div class="finding">${tags}<div class="note">${esc(f.note)}</div></div>`;
      }).join('');
      if (!bldg && !bnote && !findHtml) return '';
      return `<div class="item"><div class="itemlabel">${esc(item.label)}</div>${bldg}${bnote}${findHtml}</div>`;
    }).join('');
    if (!rows) return '';
    return `<h2>${esc(sec.title)}</h2>${rows}`;
  }).join('');

  const aptsList = apts.length
    ? `<h2>Apartments</h2><div class="apts">${apts.map(a => `<span class="apt">${esc(a.label || '(unnamed)')}</span>`).join(' ')}</div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.4; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 2px solid #185FA5; padding-bottom: 3px; color: #185FA5; }
    .meta { color: #555; font-size: 11px; margin-bottom: 12px; }
    .overview { background: #f5f7fa; padding: 12px; border-radius: 6px; margin-bottom: 8px; }
    .overview .row { margin-bottom: 4px; }
    .overview .k { font-weight: 600; }
    .cat { margin-bottom: 6px; }
    .catname { font-weight: 600; font-size: 12px; }
    .item { margin-bottom: 10px; page-break-inside: avoid; }
    .itemlabel { font-weight: 600; margin-bottom: 2px; }
    .choice { display: inline-block; background: #185FA5; color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 11px; }
    .note { color: #333; margin-top: 2px; white-space: pre-wrap; }
    .finding { margin-top: 4px; padding: 4px 8px; background: #f5f5f5; border-left: 3px solid #185FA5; }
    .apt { display: inline-block; background: #e6eef6; color: #185FA5; border-radius: 8px; padding: 1px 7px; font-size: 11px; margin-right: 3px; }
    .apts .apt { margin-bottom: 4px; }
    table.actions { width: 100%; border-collapse: collapse; margin-top: 6px; }
    table.actions th, table.actions td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; font-size: 11px; }
    table.actions th { background: #185FA5; color: #fff; }
    .pri-high { color: #c0392b; font-weight: 600; }
    .pri-medium { color: #d68910; font-weight: 600; }
    .pri-low { color: #148f77; font-weight: 600; }
  </style></head><body>
    <h1>${esc(projectName)}</h1>
    <div class="meta">Property Inspection Report &middot; ${esc(new Date().toLocaleDateString())}</div>
    <div class="overview">
      <div class="row"><span class="k">Total Violations:</span> ${esc(ov.totalViolations || '—')}</div>
      <div class="row"><span class="k">Scope:</span> ${esc(ov.scope || '—')}</div>
    </div>
    ${catSummaries ? `<h2>Building Condition Summary</h2>${catSummaries}` : ''}
    ${aptsList}
    ${sections}
    ${actionsTable}
  </body></html>`;
}
