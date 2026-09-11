export type Opening = { kind: 'window' | 'door' | 'opening'; widthFt: number; heightFt: number; areaSqFt: number };
export type RoomScan = {
  lengthFt: number; widthFt: number; heightFt: number;
  floorAreaSqFt: number; wallGrossSqFt: number;
  openings: Opening[]; openingAreaSqFt: number; wallNetSqFt: number;
  walls2d?: { x1:number; y1:number; x2:number; y2:number }[];
  confidence: 'high' | 'medium' | 'low'; capturedAt: string;
};
export type Rates = {
  waste: number; sheetCost: number; laborPerSqFt: number;
  paintPerSqFt: number; floorPerSqFt: number;
};
export const DEFAULT_RATES: Rates = {
  waste: 1.12, sheetCost: 16, laborPerSqFt: 2.1, paintPerSqFt: 0.85, floorPerSqFt: 5.5,
};
export type Takeoff = {
  wallNetSqFt: number; floorAreaSqFt: number; drywallAreaSqFt: number;
  sheets: number; sheetCost: number; laborCost: number;
  paintCost: number; floorCost: number; total: number;
};
export function computeTakeoff(scan: RoomScan, r: Rates = DEFAULT_RATES): Takeoff {
  const wallNet = Math.max(0, scan.wallNetSqFt);
  const floor = scan.floorAreaSqFt;
  const drywallArea = wallNet + floor; // walls + ceiling
  const sheets = Math.ceil((drywallArea * r.waste) / 32); // 4x8 = 32 sq ft
  const sheetCost = sheets * r.sheetCost;
  const laborCost = drywallArea * r.laborPerSqFt;
  const paintCost = drywallArea * r.paintPerSqFt;
  const floorCost = floor * r.floorPerSqFt;
  const total = sheetCost + laborCost + paintCost + floorCost;
  return { wallNetSqFt: wallNet, floorAreaSqFt: floor, drywallAreaSqFt: drywallArea,
    sheets, sheetCost, laborCost, paintCost, floorCost, total };
}
export function manualScan(lengthFt: number, widthFt: number, heightFt: number, openingAreaSqFt = 0): RoomScan {
  const perim = 2 * (lengthFt + widthFt);
  const wallGross = perim * heightFt;
  return {
    lengthFt, widthFt, heightFt,
    floorAreaSqFt: lengthFt * widthFt,
    wallGrossSqFt: wallGross,
    openings: [],
    openingAreaSqFt,
    wallNetSqFt: Math.max(0, wallGross - openingAreaSqFt),
    confidence: 'low',
    capturedAt: new Date().toISOString(),
  };
}

export function floorAreaFromWalls2d(
  walls?: { x1: number; y1: number; x2: number; y2: number }[]
): number | null {
  if (!walls || walls.length < 3) return null;
  type Seg = [[number, number], [number, number]];
  const segs: Seg[] = walls.map(w => [[w.x1, w.y1], [w.x2, w.y2]]);
  const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const used = new Array(segs.length).fill(false);
  const loop: number[][] = [segs[0][0], segs[0][1]];
  used[0] = true;
  let maxGap = 0;
  for (let k = 0; k < segs.length - 1; k++) {
    const tail = loop[loop.length - 1];
    let best = -1, bestD = Infinity, bestPt: number[] | null = null;
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      for (const pair of [[segs[i][0], segs[i][1]], [segs[i][1], segs[i][0]]]) {
        const dd = d(tail, pair[0]);
        if (dd < bestD) { bestD = dd; best = i; bestPt = pair[1]; }
      }
    }
    if (best < 0 || !bestPt) break;
    used[best] = true; loop.push(bestPt); maxGap = Math.max(maxGap, bestD);
  }
  if (maxGap > 2) return null;
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    area += loop[i][0] * loop[j][1] - loop[j][0] * loop[i][1];
  }
  return Math.abs(area) / 2;
}

// Cost to patch a single measured area (one surface: walls OR ceiling, not both).
export function patchCost(areaSqFt: number, r: Rates = DEFAULT_RATES) {
  const area = Math.max(0, areaSqFt);
  const sheets = Math.ceil((area * r.waste) / 32);
  const sheetCost = sheets * r.sheetCost;
  const laborCost = area * r.laborPerSqFt;
  const paintCost = area * r.paintPerSqFt;
  const total = sheetCost + laborCost + paintCost;
  return { areaSqFt: area, sheets, sheetCost, laborCost, paintCost, total };
}

export type MeasureCat = { id: string; label: string; method: 'sqft' | 'flat' | 'drywall'; rate: number; };

export const MEASURE_CATEGORIES: MeasureCat[] = [
  { id: 'wall', label: 'Wall / Drywall', method: 'drywall', rate: 0 },
  { id: 'sheetmetal', label: 'Sheet metal', method: 'sqft', rate: 8 },
  { id: 'cement', label: 'Cement', method: 'sqft', rate: 6 },
  { id: 'brick', label: 'Brick', method: 'sqft', rate: 15 },
  { id: 'concrete', label: 'Concrete', method: 'sqft', rate: 7 },
  { id: 'floor', label: 'Floor', method: 'sqft', rate: 5.5 },
  { id: 'floortiles', label: 'Floor tiles', method: 'sqft', rate: 12 },
  { id: 'roof', label: 'Roof', method: 'sqft', rate: 9 },
  { id: 'window', label: 'Window', method: 'flat', rate: 650 },
  { id: 'door', label: 'Door', method: 'flat', rate: 850 },
  { id: 'misc', label: 'Miscellaneous', method: 'sqft', rate: 10 },
  { id: 'other', label: 'Other', method: 'sqft', rate: 10 },
];

export function measureCatById(id: string): MeasureCat {
  return MEASURE_CATEGORIES.find(c => c.id === id) ?? MEASURE_CATEGORIES[0];
}

export function measuredCost(catId: string, areaSqFt: number, r: Rates = DEFAULT_RATES, rateOverride?: number) {
  const cat = measureCatById(catId);
  const area = Math.max(0, areaSqFt);
  if (cat.method === 'drywall') {
    const p = patchCost(area, r);
    return { method: 'drywall' as const, total: p.total, detail: p, rate: 0 };
  }
  const rate = (rateOverride != null && !isNaN(rateOverride)) ? rateOverride : cat.rate;
  if (cat.method === 'flat') return { method: 'flat' as const, total: rate, detail: null, rate };
  return { method: 'sqft' as const, total: area * rate, detail: null, rate };
}
