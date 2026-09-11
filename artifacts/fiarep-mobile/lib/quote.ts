import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import type { Project, Room } from './store';
import { lineTotal, UNIT_LABEL } from './catalog';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (x: number) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function photoDataURI(uri: string): Promise<string | null> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
    return `data:image/jpeg;base64,${b64}`;
  } catch { return null; }
}

export async function quoteHTML(project: Project, rooms: Room[], unitLabel?: string): Promise<string> {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let grand = 0;
  const byCat: Record<string, number> = {};

  const roomBlocks = (await Promise.all(rooms.map(async r => {
    const rows = r.lines.map(l => {
      const t = lineTotal(l);
      grand += t;
      byCat[l.category] = (byCat[l.category] || 0) + t;
      return `<tr>
        <td>${esc(l.category)}</td>
        <td>${esc(l.description || '—')}</td>
        <td class="r">${l.quantity} ${esc(UNIT_LABEL[l.unit])}</td>
        <td class="r">${money(l.unitPrice)}</td>
        <td class="r">${money(t)}</td>
      </tr>`;
    }).join('');
    const rTotal = r.lines.reduce((s, l) => s + lineTotal(l), 0);
    const table = `<h3>${esc(r.name)}</h3>
      <table>
        <thead><tr><th>Trade</th><th>Item</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="rt"><td colspan="4">Room total</td><td class="r">${money(rTotal)}</td></tr></tfoot>
      </table>`;
    const photoUris = (r.photos ?? []);
    const datas = (await Promise.all(photoUris.map(photoDataURI))).filter(Boolean) as string[];
    const photoHtml = datas.length ? `<div class="photos">` + datas.map(d => `<img src="${d}" />`).join('') + `</div>` : '';
    const viol = (r as any).scan?.violations;
    let violHtml = '';
    if (viol) {
      const clsBlock = (label: string, arr: any[]) => {
        const items = (arr ?? []).filter((v: any) => v && (v.title || v.desc));
        if (!items.length) return '';
        const li = items.map((v: any) => `<li><strong>${esc(v.title)}</strong>${v.desc ? ' — ' + esc(v.desc) : ''}</li>`).join('');
        return `<div class="vcls"><div class="vh">Class ${label}</div><ul>${li}</ul></div>`;
      };
      const body = clsBlock('A', viol.A) + clsBlock('B', viol.B) + clsBlock('C', viol.C);
      if (body) violHtml = `<div class="viol"><div class="viol-h">Violations</div>${body}</div>`;
    }
    return table + violHtml + photoHtml;
  }))).join('');

  const catRows = Object.keys(byCat).map(c =>
    `<tr><td>${esc(c)}</td><td class="r">${money(byCat[c])}</td></tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <style>
    .viol { margin: 6px 0 10px; }
    .viol-h { font-weight: 700; font-size: 13px; margin-bottom: 3px; }
    .vcls { margin-bottom: 4px; }
    .vh { font-weight: 600; font-size: 12px; }
    .viol ul { margin: 2px 0 4px 18px; }
    .viol li { font-size: 12px; margin-bottom: 2px; }

    * { font-family: -apple-system, Helvetica, Arial, sans-serif; }
    body { color: #1a1a1a; padding: 40px; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    h3 { font-size: 15px; margin: 20px 0 6px; color: #185FA5; }
    .sub { color: #666; font-size: 14px; margin: 0 0 20px; }
    .meta { display: flex; justify-content: space-between; font-size: 13px; color: #444; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: #888; border-bottom: 1.5px solid #185FA5; padding: 6px 5px; }
    td { padding: 6px 5px; font-size: 13px; border-bottom: 1px solid #eee; }
    .r { text-align: right; }
    .rt td { font-weight: 600; border-top: 1px solid #185FA5; border-bottom: none; }
    .summary { width: 55%; margin-left: auto; margin-top: 20px; }
    .summary td { font-size: 14px; }
    .grand { font-size: 20px; font-weight: 600; color: #185FA5; border-top: 2px solid #185FA5; }
    .photos { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 16px; }
    .photos img { width: 160px; height: 120px; object-fit: cover; border-radius: 6px; }
    .foot { margin-top: 32px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
  </style></head><body>
    <h1>Estimate</h1>
    <p class="sub">${esc(project.name)}${unitLabel ? ' \u2014 ' + esc(unitLabel) : ''}</p>
    <div class="meta">
      <div>${project.client ? 'Prepared for: <strong>' + esc(project.client) + '</strong>' : ''}</div>
      <div>Date: ${date}</div>
    </div>
    ${roomBlocks}
    <table class="summary">
      <thead><tr><th>Trade summary</th><th class="r">Amount</th></tr></thead>
      <tbody>${catRows}</tbody>
      <tfoot><tr class="grand"><td>Total estimate</td><td class="r">${money(grand)}</td></tr></tfoot>
    </table>
    <p class="foot">Estimate only. Final pricing subject to site conditions and measurement verification.
    ${rooms.length} room${rooms.length === 1 ? '' : 's'}.</p>
  </body></html>`;
}

export async function exportQuote(project: Project, rooms: Room[], unitLabel?: string): Promise<void> {
  const html = await quoteHTML(project, rooms, unitLabel);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share estimate', UTI: 'com.adobe.pdf' });
  }
}
