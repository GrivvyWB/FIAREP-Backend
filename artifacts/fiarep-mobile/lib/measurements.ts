// Material take-off calculators for the Measurement tab.
//
// Pure functions with no I/O so they can be unit-tested and reused by both the
// manual-entry UI and (later) the AR/LiDAR capture, which simply supplies the
// same Length / Width / Thickness numbers instead of the user typing them.

export type MaterialKind = 'concrete' | 'sheetrock' | 'window';

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  concrete: 'Concrete',
  sheetrock: 'Sheetrock (drywall)',
  window: 'Window opening',
};

/** Standard 4 ft x 8 ft drywall sheet = 32 sq ft. */
export const SHEETROCK_SHEET_SQFT = 32;

const round = (value: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
};

/**
 * Concrete volume in cubic yards.
 * Cubic Yards = (Length ft x Width ft x Thickness in) / 324
 * (324 = 12 in/ft x 27 cu ft/cu yd)
 */
export function concreteCubicYards(lengthFt: number, widthFt: number, thicknessIn: number): number {
  if (![lengthFt, widthFt, thicknessIn].every((n) => Number.isFinite(n) && n > 0)) return 0;
  return round((lengthFt * widthFt * thicknessIn) / 324, 2);
}

/** Concrete volume from a known slab area (sq ft) + thickness (in). */
export function concreteCubicYardsFromArea(areaSqFt: number, thicknessIn: number): number {
  if (![areaSqFt, thicknessIn].every((n) => Number.isFinite(n) && n > 0)) return 0;
  return round((areaSqFt * (thicknessIn / 12)) / 27, 2);
}

/** What you'd actually order: round the raw cubic yards up to the next 0.5 yd. */
export function concreteOrderCubicYards(rawCubicYards: number): number {
  if (!(rawCubicYards > 0)) return 0;
  return Math.ceil(rawCubicYards * 2) / 2;
}

/** Number of 4x8 (32 sq ft) sheets needed to cover an area, rounded up. */
export function sheetrockSheets(areaSqFt: number, sheetSqFt = SHEETROCK_SHEET_SQFT): number {
  if (!(areaSqFt > 0) || !(sheetSqFt > 0)) return 0;
  return Math.ceil(areaSqFt / sheetSqFt);
}

/** Window / opening area in square feet from feet dimensions. */
export function windowAreaSqFt(widthFt: number, heightFt: number): number {
  if (![widthFt, heightFt].every((n) => Number.isFinite(n) && n > 0)) return 0;
  return round(widthFt * heightFt, 2);
}

/** Convert inches to feet (AR often returns inches). */
export const inToFt = (inches: number): number => (Number.isFinite(inches) ? inches / 12 : 0);
export const areaSqFtFromFt = (lengthFt: number, widthFt: number): number =>
  round((lengthFt || 0) * (widthFt || 0), 2);

export interface MeasurementInput {
  material: MaterialKind;
  lengthFt?: number;
  widthFt?: number;
  thicknessIn?: number; // concrete only
}

export interface MeasurementResult {
  material: MaterialKind;
  areaSqFt?: number;
  cubicYards?: number;
  orderCubicYards?: number;
  sheets?: number;
  summary: string;
}

/** One entry point the UI (manual or AR) calls with the captured dimensions. */
export function computeMeasurement(input: MeasurementInput): MeasurementResult {
  const L = input.lengthFt ?? 0;
  const W = input.widthFt ?? 0;
  const T = input.thicknessIn ?? 0;
  const area = areaSqFtFromFt(L, W);
  switch (input.material) {
    case 'concrete': {
      const cy = concreteCubicYards(L, W, T);
      const order = concreteOrderCubicYards(cy);
      return {
        material: 'concrete',
        areaSqFt: area,
        cubicYards: cy,
        orderCubicYards: order,
        summary: cy
          ? `${area} sq ft x ${T}" = ${cy} cu yd (order ~${order} cu yd)`
          : 'Enter length, width, and thickness.',
      };
    }
    case 'sheetrock': {
      const sheets = sheetrockSheets(area);
      return {
        material: 'sheetrock',
        areaSqFt: area,
        sheets,
        summary: sheets ? `${area} sq ft = ${sheets} sheet(s) of 4x8` : 'Enter width and height.',
      };
    }
    case 'window': {
      const a = windowAreaSqFt(L, W);
      return {
        material: 'window',
        areaSqFt: a,
        summary: a ? `${a} sq ft opening` : 'Enter width and height.',
      };
    }
  }
}
