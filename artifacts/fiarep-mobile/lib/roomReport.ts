type Wall = { x1: number; y1: number; x2: number; y2: number };

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Build an SVG floor plan from walls2d, scaled to fit a fixed box.
function scanSVG(walls: Wall[], size = 320): string {
  if (!walls || walls.length === 0) return '';
  const xs = walls.flatMap(w => [w.x1, w.x2]);
  const ys = walls.flatMap(w => [w.y1, w.y2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
  const pad = 16;
  const scale = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
  const drawW = w * scale + pad * 2, drawH = h * scale + pad * 2;
  const tx = (x: number) => pad + (x - minX) * scale;
  const ty = (y: number) => pad + (y - minY) * scale;
  const lines = walls.map(wl =>
    `<line x1="${tx(wl.x1).toFixed(1)}" y1="${ty(wl.y1).toFixed(1)}" x2="${tx(wl.x2).toFixed(1)}" y2="${ty(wl.y2).toFixed(1)}" stroke="#185FA5" stroke-width="2.5" stroke-linecap="round"/>`
  ).join('');
  return `<svg width="${drawW.toFixed(0)}" height="${drawH.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" style="border:1px solid #ddd;background:#fafafa">${lines}</svg>`;
}

export function buildRoomHTML(opts: {
  name: string; unit?: string; scanInfo?: string;
  walls?: Wall[]; photosB64: string[]; photoGeoLabels?: string[];
  violations?: { A: any[]; B: any[]; C: any[] };
  measuredAreas?: any[];
}): string {
  const { name, unit, scanInfo, walls, photosB64, violations, measuredAreas } = opts;
  const svg = walls && walls.length ? scanSVG(walls) : '';
  const info = scanInfo ? `<div class="info">${esc(scanInfo).replace(/\n/g, '<br>')}</div>` : '';
  const measuredBlock = (() => {
    const arr = (measuredAreas ?? []).filter((m: any) => m && (m.areaSqFt || m.widthFt));
    if (!arr.length) return '';
    const rows = arr.map((m: any) =>
      `<li><b>${esc(m.label || 'Measured area')}</b> \u2014 ${esc(m.widthFt)} \u00d7 ${esc(m.heightFt)} ft, ${esc(m.areaSqFt)} sq ft</li>`).join('');
    return `<h2>Measured Areas</h2><ul>${rows}</ul>`;
  })();

  const violBlock = (() => {
    if (!violations) return '';
    const cls = (label: string, arr: any[]) => {
      const items = (arr ?? []).filter((v: any) => v.title || v.desc);
      if (!items.length) return '';
      const rows = items.map((v: any) =>
        `<li><b>${esc(v.title)}</b>${v.desc ? ' \u2014 ' + esc(v.desc) : ''}</li>`).join('');
      return `<div class="vclass"><div class="vhead">Class ${label}</div><ul>${rows}</ul></div>`;
    };
    const body = cls('A', violations.A) + cls('B', violations.B) + cls('C', violations.C);
    return body ? `<h2>Violations</h2>${body}` : '';
  })();

  const photos = photosB64.filter(Boolean).map(b =>
    `<img src="${b}" style="width:47%;margin:1%;border:1px solid #ccc;border-radius:4px"/>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    .unit { color: #666; font-size: 13px; margin-bottom: 12px; }
    h2 { font-size: 14px; color: #185FA5; border-bottom: 2px solid #185FA5; padding-bottom: 3px; margin: 18px 0 8px; }
    .info { font-size: 13px; line-height: 1.5; margin-bottom: 10px; }
    .photos { display: flex; flex-wrap: wrap; }
    .vclass { margin-bottom: 8px; }
    .vhead { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
    ul { margin: 2px 0 6px 18px; } li { margin-bottom: 3px; font-size: 12px; }
  </style></head><body>
    <h1>${esc(name)}</h1>
    ${unit ? `<div class="unit">Unit: ${esc(unit)}</div>` : ''}
    ${info ? `<h2>Measurements</h2>${info}` : ''}
    ${svg ? `<h2>Floor Plan</h2>${svg}` : ''}
    ${measuredBlock}
    ${violBlock}
    ${photos ? `<h2>Photos</h2><div class="photos">${photos}</div>` : ''}
  </body></html>`;
}
