// Material take-off calculators for the Measurement tab.
//
// Pure functions with no I/O so they can be unit-tested and reused by both the
// manual-entry UI and (later) the AR/LiDAR capture, which supplies the same
// Length / Width / Thickness numbers instead of the user typing them.

export type MaterialKind =
  | 'concrete'
  | 'sheetrock'
  | 'plywood'
  | 'window'
  | 'door'
  | 'room'
  | 'floor-tile'
  | 'wall-tile'
  | 'wood-floor'
  | 'paint';

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  concrete: 'Concrete',
  sheetrock: 'Sheetrock',
  plywood: 'Plyboard / plywood',
  window: 'Window opening',
  door: 'Door opening',
  room: 'Room area',
  'floor-tile': 'Floor tile',
  'wall-tile': 'Wall tile',
  'wood-floor': 'Wood / laminate flooring',
  paint: 'Paint',
};

/** Materials whose take-off is a coverage/count problem measured as area. */
export const AREA_MATERIALS: MaterialKind[] = [
  'sheetrock', 'plywood', 'window', 'door', 'room', 'floor-tile', 'wall-tile', 'wood-floor', 'paint',
];

export const SHEET_SQFT = 32;        // 4 ft x 8 ft sheet (sheetrock, plywood)
export const WASTE = 0.10;           // 10% overage for tile / flooring cuts
export const DEFAULT_TILE_IN = 12;   // 12" square tile default
export const DEFAULT_BOX_SQFT = 20;  // wood/laminate flooring box coverage
export const PAINT_COVERAGE_SQFT = 350; // sq ft per gallon per coat
export const DEFAULT_COATS = 2;

const round = (value: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
};
const pos = (n: number) => Number.isFinite(n) && n > 0;

export const areaSqFtFromFt = (lengthFt: number, widthFt: number): number =>
  pos(lengthFt) && pos(widthFt) ? round(lengthFt * widthFt, 2) : 0;

/**
 * Concrete volume in cubic yards.
 * Cubic Yards = (Length ft x Width ft x Thickness in) / 324  (324 = 12 x 27)
 */
export function concreteCubicYards(lengthFt: number, widthFt: number, thicknessIn: number): number {
  if (![lengthFt, widthFt, thicknessIn].every(pos)) return 0;
  return round((lengthFt * widthFt * thicknessIn) / 324, 2);
}
export function concreteCubicYardsFromArea(areaSqFt: number, thicknessIn: number): number {
  if (![areaSqFt, thicknessIn].every(pos)) return 0;
  return round((areaSqFt * (thicknessIn / 12)) / 27, 2);
}
/** What you'd order: round raw cubic yards up to the next 0.5 yd. */
export function concreteOrderCubicYards(rawCubicYards: number): number {
  return rawCubicYards > 0 ? Math.ceil(rawCubicYards * 2) / 2 : 0;
}

/** Sheets needed to cover an area (sheetrock, plywood), rounded up. */
export function sheetsNeeded(areaSqFt: number, sheetSqFt = SHEET_SQFT): number {
  return pos(areaSqFt) && pos(sheetSqFt) ? Math.ceil(areaSqFt / sheetSqFt) : 0;
}

/** Tiles needed for an area given tile size in inches, including waste. */
export function tilesNeeded(areaSqFt: number, tileWidthIn: number, tileHeightIn: number, waste = WASTE): number {
  if (![areaSqFt, tileWidthIn, tileHeightIn].every(pos)) return 0;
  const tileSqFt = (tileWidthIn / 12) * (tileHeightIn / 12);
  if (!pos(tileSqFt)) return 0;
  return Math.ceil((areaSqFt * (1 + waste)) / tileSqFt);
}

/** Boxes of wood/laminate flooring for an area, including waste. */
export function flooringBoxes(areaSqFt: number, boxSqFt = DEFAULT_BOX_SQFT, waste = WASTE): number {
  if (![areaSqFt, boxSqFt].every(pos)) return 0;
  return Math.ceil((areaSqFt * (1 + waste)) / boxSqFt);
}

/** Gallons of paint for an area, given coats and coverage per gallon. */
export function paintGallons(areaSqFt: number, coats = DEFAULT_COATS, coverageSqFt = PAINT_COVERAGE_SQFT): number {
  if (!pos(areaSqFt) || !pos(coats) || !pos(coverageSqFt)) return 0;
  return Math.ceil((areaSqFt * coats) / coverageSqFt);
}

/** Nearest standard door size for an opening (inches). */
export function nearestStandardDoor(widthIn: number, heightIn: number): string {
  if (![widthIn, heightIn].every(pos)) return '';
  const widths = [24, 28, 30, 32, 36];
  const heights = [80, 84];
  const w = widths.reduce((best, x) => (Math.abs(x - widthIn) < Math.abs(best - widthIn) ? x : best), widths[0]);
  const h = heights.reduce((best, x) => (Math.abs(x - heightIn) < Math.abs(best - heightIn) ? x : best), heights[0]);
  return `${w}" x ${h}"`;
}

export interface MeasurementInput {
  material: MaterialKind;
  lengthFt?: number;   // primary dim
  widthFt?: number;    // secondary dim
  thicknessIn?: number; // concrete
  tileWidthIn?: number; // tiles
  tileHeightIn?: number; // tiles
  boxSqFt?: number;    // wood flooring
  coats?: number;      // paint
  coverageSqFt?: number; // paint
}

export interface MeasurementResult {
  material: MaterialKind;
  areaSqFt: number;
  areaWithWasteSqFt?: number;
  cubicYards?: number;
  orderCubicYards?: number;
  sheets?: number;
  tiles?: number;
  boxes?: number;
  doorSize?: string;
  gallons?: number;
  summary: string;
}

/** Single entry point the UI (manual or AR) calls with captured dimensions. */
export function computeMeasurement(input: MeasurementInput): MeasurementResult {
  const L = input.lengthFt ?? 0;
  const W = input.widthFt ?? 0;
  const area = areaSqFtFromFt(L, W);
  const base: MeasurementResult = { material: input.material, areaSqFt: area, summary: '' };

  switch (input.material) {
    case 'concrete': {
      const cy = concreteCubicYards(L, W, input.thicknessIn ?? 0);
      const order = concreteOrderCubicYards(cy);
      return { ...base, cubicYards: cy, orderCubicYards: order,
        summary: cy ? `${area} sq ft x ${input.thicknessIn}" = ${cy} cu yd (order ~${order})` : 'Enter length, width, and thickness.' };
    }
    case 'sheetrock':
    case 'plywood': {
      const sheets = sheetsNeeded(area);
      return { ...base, sheets,
        summary: sheets ? `${area} sq ft = ${sheets} sheet(s) of 4x8` : 'Enter width and height.' };
    }
    case 'floor-tile':
    case 'wall-tile': {
      const tw = input.tileWidthIn ?? DEFAULT_TILE_IN;
      const th = input.tileHeightIn ?? DEFAULT_TILE_IN;
      const tiles = tilesNeeded(area, tw, th);
      return { ...base, tiles, areaWithWasteSqFt: round(area * (1 + WASTE), 2),
        summary: tiles ? `${area} sq ft -> ${tiles} tiles of ${tw}x${th}" (incl 10% waste)` : 'Enter the area and tile size.' };
    }
    case 'wood-floor': {
      const boxSqFt = input.boxSqFt ?? DEFAULT_BOX_SQFT;
      const boxes = flooringBoxes(area, boxSqFt);
      return { ...base, boxes, areaWithWasteSqFt: round(area * (1 + WASTE), 2),
        summary: boxes ? `${area} sq ft -> ${boxes} box(es) @ ${boxSqFt} sq ft (incl 10% waste)` : 'Enter the room dimensions.' };
    }
    case 'paint': {
      const coats = input.coats ?? DEFAULT_COATS;
      const cov = input.coverageSqFt ?? PAINT_COVERAGE_SQFT;
      const gallons = paintGallons(area, coats, cov);
      return { ...base, gallons,
        summary: gallons ? `${area} sq ft x ${coats} coat(s) = ${gallons} gallon(s)` : 'Enter the surface dimensions.' };
    }
    case 'door': {
      const doorSize = nearestStandardDoor(L * 12, W * 12);
      return { ...base, doorSize,
        summary: doorSize ? `${area} sq ft opening -> nearest standard door ${doorSize}` : 'Enter the opening width and height.' };
    }
    case 'window':
    case 'room':
    default:
      return { ...base, summary: area ? `${area} sq ft` : 'Enter width and height.' };
  }
}
