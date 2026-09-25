// Per-trade x per-material access for the Measurement tab.
//
// The control panel stores one boolean per (trade, material) as a flat key in
// organization.features.modules, e.g. "meas.painter.paint" = true. These are
// opt-in (OFF unless explicitly true), so a trade sees a material only when its
// specific switch is on — no master switch turns everything on at once.

import type { MaterialKind } from './measurements';

export type TradeKey =
  | 'inspector' | 'cpm' | 'carpenter' | 'painter' | 'plumber'
  | 'electrician' | 'elevator' | 'mason' | 'roofer' | 'heating' | 'general';

export const MEASUREMENT_TRADES: { key: TradeKey; label: string }[] = [
  { key: 'inspector', label: 'Inspector' },
  { key: 'cpm', label: 'CPM / Scope' },
  { key: 'carpenter', label: 'Carpenter' },
  { key: 'painter', label: 'Painter' },
  { key: 'plumber', label: 'Plumber' },
  { key: 'electrician', label: 'Electrician' },
  { key: 'elevator', label: 'Elevator Service' },
  { key: 'mason', label: 'Mason / Concrete' },
  { key: 'roofer', label: 'Roofer' },
  { key: 'heating', label: 'Heating' },
  { key: 'general', label: 'General Construction' },
];

export const MEASUREMENT_MATERIALS: { key: MaterialKind; label: string }[] = [
  { key: 'concrete', label: 'Concrete' },
  { key: 'sheetrock', label: 'Sheetrock' },
  { key: 'plywood', label: 'Plyboard' },
  { key: 'floor-tile', label: 'Floor tile' },
  { key: 'wall-tile', label: 'Wall tile' },
  { key: 'wood-floor', label: 'Wood floor' },
  { key: 'paint', label: 'Paint' },
  { key: 'window', label: 'Window' },
  { key: 'door', label: 'Door' },
  { key: 'room', label: 'Room' },
];

export const measurementKey = (trade: string, material: string): string => `meas.${trade}.${material}`;

/** Map a staff position string to a trade key (null if it isn't a measurement trade). */
export function tradeKeyForPosition(position: string): TradeKey | null {
  const p = (position || '').trim().toLowerCase();
  if (!p) return null;
  if (p.includes('inspector')) return 'inspector';
  if (p === 'cpm' || p.includes('scope')) return 'cpm';
  if (p.includes('carpenter') || p.includes('carpentry')) return 'carpenter';
  if (p.includes('paint')) return 'painter';
  if (p.includes('plumb')) return 'plumber';
  if (p.includes('electric')) return 'electrician';
  if (p.includes('elevator')) return 'elevator';
  if (p.includes('mason') || p.includes('brick') || p.includes('concrete')) return 'mason';
  if (p.includes('roof')) return 'roofer';
  if (p.includes('heat')) return 'heating';
  if (p.includes('general') || p.includes('construction')) return 'general';
  return null;
}

/** Materials this position is allowed to measure, per the control-panel matrix. */
export function allowedMaterialsForTrade(
  position: string,
  modules: Record<string, boolean> | null | undefined,
): MaterialKind[] {
  const trade = tradeKeyForPosition(position);
  if (!trade || !modules) return [];
  return MEASUREMENT_MATERIALS
    .filter((m) => modules[measurementKey(trade, m.key)] === true)
    .map((m) => m.key);
}

export function hasAnyMeasurementAccess(
  position: string,
  modules: Record<string, boolean> | null | undefined,
): boolean {
  return allowedMaterialsForTrade(position, modules).length > 0;
}
