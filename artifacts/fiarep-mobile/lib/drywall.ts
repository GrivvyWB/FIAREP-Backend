import type { RoomScan, Rates } from './takeoff';
import { computeTakeoff } from './takeoff';
import type { LineItem } from './catalog';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function drywallLinesFromScan(scan: RoomScan, rates: Rates): LineItem[] {
  const t = computeTakeoff(scan, rates);
  return [
    { id: uid(), category: 'Drywall', description: `Drywall sheets (4x8)`, quantity: t.sheets, unit: 'each', unitPrice: rates.sheetCost },
    { id: uid(), category: 'Drywall', description: `Hang + finish`, quantity: Math.round(t.drywallAreaSqFt), unit: 'sqft', unitPrice: rates.laborPerSqFt },
    { id: uid(), category: 'Drywall', description: `Paint`, quantity: Math.round(t.drywallAreaSqFt), unit: 'sqft', unitPrice: rates.paintPerSqFt },
    { id: uid(), category: 'Drywall', description: `Flooring`, quantity: Math.round(t.floorAreaSqFt), unit: 'sqft', unitPrice: rates.floorPerSqFt },
  ];
}
