import { ELEVATOR_SECTIONS, type ElevatorState } from './elevator';
import { geoLabel } from './geo';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const parseNum = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildElevatorHTML(s: ElevatorState): string {
  const h = s.header ?? {};
  let total = 0;

  const sections = ELEVATOR_SECTIONS.map(sec => {
    const rows = sec.components.map(c => {
      const rec = s.items?.[c.id];
      if (!rec || (!rec.condition && !rec.cost && !rec.note)) return '';
      const cost = parseNum(rec.cost); total += cost;
      const condClass = rec.condition ? rec.condition.toLowerCase().replace('/', '') : '';
      return `<tr>
        <td class="lbl">${esc(c.label)}</td>
        <td class="cond ${condClass}">${esc(rec.condition ?? '—')}</td>
        <td class="cost">${rec.cost ? money(cost) : ''}</td>
        <td class="note">${esc(rec.note ?? '')}</td>
      </tr>`;
    }).join('');
    if (!rows) return '';
    return `<h2>${esc(sec.title)}</h2><table><thead><tr><th>Component</th><th>Condition</th><th>Cost</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 12px; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { color: #555; font-size: 12px; margin-bottom: 14px; }
    h2 { font-size: 14px; color: #185FA5; border-bottom: 2px solid #185FA5; padding-bottom: 3px; margin: 16px 0 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; color: #888; border-bottom: 1px solid #ccc; padding: 4px 6px; }
    td { padding: 4px 6px; font-size: 11px; border-bottom: 1px solid #eee; vertical-align: top; }
    td.lbl { font-weight: 600; width: 30%; }
    td.cond { width: 14%; font-weight: 600; }
    td.cost { width: 14%; text-align: right; white-space: nowrap; }
    td.note { width: 42%; color: #444; }
    .repair { color: #d68910; } .replace { color: #c0392b; } .good { color: #2e7d32; }
    .total { margin-top: 16px; padding-top: 10px; border-top: 2px solid #185FA5; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; }
    .total .amt { color: #185FA5; }
  </style></head><body>
    <h1>Elevator Services Report</h1>
    ${(s as any)._geo ? `<div class="meta">Inspected at: ${esc(geoLabel((s as any)._geo))}</div>` : ''}
    <div class="meta">
      ${h.elevatorId ? 'Elevator: <b>' + esc(h.elevatorId) + '</b> &nbsp; ' : ''}
      ${h.type ? 'Type: <b>' + esc(h.type) + '</b> &nbsp; ' : ''}
      ${h.location ? 'Location: <b>' + esc(h.location) + '</b> &nbsp; ' : ''}
      ${h.date ? 'Date: <b>' + esc(h.date) + '</b>' : ''}
    </div>
    ${sections || '<p>No components assessed yet.</p>'}
    <div class="total"><span>Estimated Total</span><span class="amt">${money(total)}</span></div>
  </body></html>`;
}
