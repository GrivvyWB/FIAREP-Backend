// Profit check for the FIAREP price book (Platform Control only). The book
// holds sell prices; FIAREP's own cost per line and the target margin live in
// this browser so a client never sees them.
export const PLAN_DISCOUNT = 0; // no plan discount on repairs — plan labor comes out of the included hours pool instead
export const COST_KEY = "fiarep_owner_costs";
export const TARGET_KEY = "fiarep_owner_target_margin";
export function readCosts(): Record<string, number> {
  try { const raw = localStorage.getItem(COST_KEY); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === "object" ? (v as Record<string, number>) : {}; } catch { return {}; }
}
export function readTarget(): number {
  try { const n = Number(localStorage.getItem(TARGET_KEY)); return n > 0 ? n : 35; } catch { return 35; }
}
