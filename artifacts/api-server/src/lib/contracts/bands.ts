// The owner's pricing ladder on the server (Platform Control → Pricing ladder), the same
// merge the web app does in pricing-overrides.ts bands(). contract.ts reads bands();
// call setBands() with the saved bands right before building a contract.
import { BANDS, bandLabel, type Band } from "./ladder";

let current: Band[] = BANDS;
export function mergeBands(saved: Band[] | null | undefined): Band[] {
  if (!saved || !Array.isArray(saved)) return BANDS;
  if (saved.length && saved.every((x) => x && x.v === 2)) return saved.map((s) => ({ ...s, label: bandLabel(s.from, s.to), note: s.note ?? "", hoursPerUnit: s.hoursPerUnit ?? null }));
  return BANDS.map((b) => {
    const s = saved.find((x) => x && x.from === b.from && x.to === b.to);
    return s ? { ...b, platformRate: s.platformRate, platformMin: s.platformMin, planRate: s.planRate, planMin: s.planMin, maintRate: s.maintRate ?? null, maintMin: s.maintMin ?? null } : b;
  });
}
export function setBands(saved: Band[] | null | undefined) { current = mergeBands(saved); return current; }
export const bands = () => current;
