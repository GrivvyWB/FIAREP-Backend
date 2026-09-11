import { SCOPE_ITEMS, APT_CHECK_ITEMS, SYSTEM_SECTIONS, BUILDING_TYPE_OPTS, type IntakeState } from './intake';
import { geoLabel } from './geo';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const chks = (arr?: string[]) => (arr && arr.length ? arr.map(esc).join(', ') : '—');

export function buildIntakeHTML(s: IntakeState): string {
  const h = s.header ?? {};
  const v = s.violations ?? {};

  const scope = SCOPE_ITEMS.filter(i => s.scopeOfWork[i.id])
    .map(i => `<li>${esc(i.label)}</li>`).join('') || '<li>—</li>';

  const systems = SYSTEM_SECTIONS.map(sec => {
    const rows = sec.fields.map(f => {
      const sel = chks(s.fields[f.id]);
      const tot = s.totals[f.id] ? ` &nbsp; <b>${esc(s.totals[f.id])}</b> ${esc(f.total ?? '')}` : '';
      if (sel === '—' && !s.totals[f.id]) return '';
      return `<tr><td class="fl">${esc(f.label)}</td><td>${sel}${tot}</td></tr>`;
    }).join('');
    const desc = s.describe[sec.id] ? `<div class="desc"><b>Describe/Recommend:</b> ${esc(s.describe[sec.id])}</div>` : '';
    if (!rows && !desc) return '';
    return `<h2>${esc(sec.title)}</h2><table class="sys">${rows}</table>${desc}`;
  }).join('');

  const apts = (s.apartments ?? []).map(a => {
    const checks = APT_CHECK_ITEMS.map(it => a.checks[it.id] ? `<tr><td class="fl">${esc(it.label)}</td><td>${esc(a.checks[it.id])}</td></tr>` : '').join('');
    const recs = (a.recommendations ?? []).filter(r => r.condition || r.work)
      .map(r => `<tr><td>${esc(r.condition)}</td><td>${esc(r.work)}</td></tr>`).join('');
    const recTable = recs ? `<table class="rec"><thead><tr><th>Condition and Location</th><th>Work Required</th></tr></thead><tbody>${recs}</tbody></table>` : '';
    return `<h2>Apartment ${esc(a.number)} ${a.bedrooms ? '(' + esc(a.bedrooms) + ' bed)' : ''}</h2><table class="sys">${checks}</table>${recTable}`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: 'Times New Roman', Times, serif; color: #000; font-size: 11px; margin: 0; padding: 20px; }
    .title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 14px; margin-bottom: 10px; }
    .hdr td { padding: 2px 4px; vertical-align: top; }
    .hdr .k { white-space: nowrap; } .hdr .v { font-weight: bold; border-bottom: 1px solid #000; }
    h2 { font-size: 12px; margin: 16px 0 6px; background: #d9ead3; padding: 4px 6px; border: 1px solid #444; }
    table.sys, table.rec { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    table.sys td { border: 1px solid #bbb; padding: 3px 6px; vertical-align: top; }
    table.sys td.fl { width: 32%; font-weight: 600; }
    table.rec th, table.rec td { border: 1px solid #444; padding: 4px 6px; text-align: left; vertical-align: top; }
    table.rec th { background: #cfe2f3; }
    .desc { margin: 4px 0 8px; padding: 4px 6px; border: 1px solid #ccc; }
    ol { margin: 4px 0 8px 18px; } li { margin-bottom: 2px; }
    .ov td { padding: 2px 6px; }
  </style></head><body>
    <div class="title">INTAKE REPORT</div>
    <table class="hdr">
      <tr><td class="k">DATE:</td><td class="v">${esc(h.date)}</td></tr>
      <tr><td class="k">BUILDING ADDRESS:</td><td class="v">${esc(h.address)}</td></tr>
      <tr><td class="k">INSPECTION DATE(S):</td><td class="v">${esc(h.dates)}</td></tr>
      <tr><td class="k">CONST. PROJECT MANAGER(S):</td><td class="v">${esc(h.cpm)}</td></tr>
      ${(s as any)._geo ? `<tr><td class="k">LOCATION STAMP:</td><td class="v">${esc(geoLabel((s as any)._geo))}</td></tr>` : ''}
    </table>

    <h2>Building Overview</h2>
    <table class="ov">
      <tr><td>Building Type:</td><td><b>${chks(s.buildingType)}</b></td></tr>
      <tr><td>Number of Stories:</td><td><b>${esc(s.stories)}</b></td></tr>
      <tr><td>Basement/Cellar:</td><td><b>${chks(s.basementCellar)}</b></td></tr>
      <tr><td>Total D.U.:</td><td><b>${esc(s.duTotal)}</b></td></tr>
      <tr><td>Apt Distribution:</td><td>1BR: <b>${esc(s.aptDist.oneBed)}</b> &nbsp; 2BR: <b>${esc(s.aptDist.twoBed)}</b> &nbsp; 3BR: <b>${esc(s.aptDist.threeBed)}</b></td></tr>
      <tr><td>Apts/Areas Inspected:</td><td><b>${esc(s.aptsInspected)}</b></td></tr>
    </table>

    <h2>Violation Summary Recorded to Date</h2>
    <table class="ov">
      <tr><td>Class "A":</td><td><b>${esc(v.classA)}</b></td><td>Class "B":</td><td><b>${esc(v.classB)}</b></td><td>Class "C":</td><td><b>${esc(v.classC)}</b></td></tr>
      <tr><td>Lead violations:</td><td><b>${esc(v.lead)}</b></td><td>Apts:</td><td colspan="3"><b>${esc(v.leadApts)}</b></td></tr>
      <tr><td>Mold violations:</td><td><b>${esc(v.mold)}</b></td><td>Apts:</td><td colspan="3"><b>${esc(v.moldApts)}</b></td></tr>
      <tr><td>Bldg Dept:</td><td><b>${esc(v.dob)}</b></td><td>ECB:</td><td><b>${esc(v.ecb)}</b></td><td></td><td></td></tr>
    </table>

    <h2>Recommended Scope of Work (Priority)</h2>
    <ol>${scope}</ol>

    ${s.highlights ? `<h2>Building Highlights</h2><div class="desc">${esc(s.highlights)}</div>` : ''}
    ${s.leadNote ? `<div class="desc"><b>Lead:</b> ${esc(s.leadNote)}</div>` : ''}
    ${s.moldNote ? `<div class="desc"><b>Mold:</b> ${esc(s.moldNote)}</div>` : ''}
    ${s.structuralNote ? `<div class="desc"><b>Structural:</b> ${esc(s.structuralNote)}</div>` : ''}

    ${systems}
    ${apts}
  </body></html>`;
}
