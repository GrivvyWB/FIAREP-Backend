// FIAREP pricing ladder, 2 to 300,000 units — the defaults. The owner edits
// the live bands in Platform Control → Pricing ladder (pricing-overrides.ts);
// the Join page plan cards and plan contracts read those.
// Anchors: software-only market $1–$5 per unit per month (AppFolio Core $1.40 /
// Plus $3 / Max $5, Yardi Breeze $1–$3, minimums $100–$400 — costbench.com);
// HPD AEP fee $500 per dwelling unit every six months, max $1,000 per unit
// (nyc.gov/hpd, Alternative Enforcement Program).
export type Band = { label: string; from: number; to: number; platformRate: number; platformMin: number; planRate: number | null; planMin: number | null; note: string };

export const BANDS: Band[] = [
  { label: "2–99", from: 2, to: 99, platformRate: 5, platformMin: 100, planRate: 20, planMin: 1000, note: "Small owners. Platform at the AppFolio Max price point. 2-families buy cures per apartment ($600) instead of the plan." },
  { label: "100–999", from: 100, to: 999, platformRate: 4, platformMin: 100, planRate: 15, planMin: 1000, note: "Mid-size managers." },
  { label: "1,000–9,999", from: 1000, to: 9999, platformRate: 3, platformMin: 100, planRate: 12, planMin: 12000, note: "Replaces 'agency small' ($15/unit, 2,500-unit minimum). Setup fee waived on annual." },
  { label: "10,000–49,999", from: 10000, to: 49999, platformRate: 2, platformMin: 100, planRate: 10, planMin: 25000, note: "'Agency major'. Annual contract." },
  { label: "50,000–300,000", from: 50000, to: 300000, platformRate: 1, platformMin: 50000, planRate: null, planMin: null, note: "NYCHA scale (~177,000 apartments). Sell the platform per unit; sell the work per building as task orders at $600 / $400 per apartment — not per unit." },
];
export const SETUP_FEE = 1500;          // one time, waived on any annual contract of 1,000+ units
export const AEP_FEE_MAX_PER_UNIT = 1000; // HPD: $500 per unit every six months, capped at $1,000 per unit

export function bandFor(units: number, bands: Band[] = BANDS): Band {
  return bands.find((b) => units >= b.from && units <= b.to) || (units < bands[0]!.from ? bands[0]! : bands[bands.length - 1]!);
}
export function ladderFees(units: number, bands: Band[] = BANDS): { band: Band; platform: number; plan: number | null; aepExposure: number } {
  const band = bandFor(units, bands);
  return {
    band,
    platform: Math.max(units * band.platformRate, band.platformMin),
    plan: band.planRate == null || band.planMin == null ? null : Math.max(units * band.planRate, band.planMin),
    aepExposure: units * AEP_FEE_MAX_PER_UNIT,
  };
}

export const EXAMPLES: { name: string; units: number; note: string }[] = [
  { name: "2-family", units: 2, note: "Would buy cures per apartment at $600 rather than a $1,000/mo plan" },
  { name: "1386 Ogden Avenue", units: 26, note: "Plan at the $1,000 minimum" },
  { name: "1555 Grand Concourse (in AEP)", units: 147, note: "In AEP since Feb 2026 — the fee exposure is what the owner avoids by curing fast" },
  { name: "Mid-size manager", units: 850, note: "" },
  { name: "Pistilli-size portfolio", units: 5000, note: "" },
  { name: "Large agency / REIT", units: 25000, note: "" },
  { name: "NYCHA", units: 177000, note: "Platform only per unit; violation work sold per building as task orders" },
];

export const CURRENT_VS_PROPOSED: { plan: string; today: string; proposed: string; change: string }[] = [
  { plan: "Platform (software)", today: "$4/unit, min $400/mo, $1,500 setup", proposed: "$5 → $4 → $3 → $2 → $1 by band, min $100/mo ($50,000 at 50k+), setup waived on 1,000+ annual", change: "Step down with volume; lower entry minimum so a 20-unit owner can start at $100" },
  { plan: "FIAREP plan (full service)", today: "$20/unit, min $1,000/mo, 60-day pilot", proposed: "$20 → $15 → $12 → $10 by band; minimums $1,000 / $1,000 / $12,000 / $25,000", change: "Step down with volume; keep the $1,000 floor and the pilot" },
  { plan: "Agency small", today: "$15/unit, min $5,000/mo, needs 2,500+ units", proposed: "Folded into the 1,000–9,999 band at $12/unit, min $12,000", change: "One ladder instead of a separate agency tier" },
  { plan: "Agency major", today: "$10/unit, min $25,000/mo", proposed: "Same, for 10,000–49,999 units", change: "Unchanged" },
  { plan: "50,000+ units (NYCHA)", today: "Agency major stretched to any size", proposed: "Platform $1/unit (min $50,000/mo, annual); violation work per building at $600 / $400 per apartment", change: "Per-unit service cannot be delivered on 177,000 apartments; agencies procure by task order" },
  { plan: "HPD cure / DOB expediting", today: "$600 per apartment ($400 on plan or platform); DOB $1,500 first two, $1,000 after, 20% off on plan", proposed: "Unchanged", change: "—" },
];

export const SOURCES: { what: string; figure: string; url: string }[] = [
  { what: "AppFolio Core / Plus / Max", figure: "$1.40 / $3 / $5 per unit per month; ~$280/month minimum", url: "https://costbench.com/compare/appfolio-vs-yardi/" },
  { what: "Yardi Breeze / Breeze Premier", figure: "$1 per unit ($100/mo min) / $1–$3 per unit ($400/mo min)", url: "https://costbench.com/compare/appfolio-vs-yardi/" },
  { what: "Buildium vs AppFolio", figure: "Buildium from ~$62/month flat vs AppFolio $1.40/unit", url: "https://costbench.com/compare/buildium-vs-appfolio/" },
  { what: "HPD AEP fee", figure: "$500 per dwelling unit every six months, max $1,000 per unit; $200 per complaint inspection; $100 per re-inspection", url: "https://www.nyc.gov/site/hpd/services-and-information/alternative-enforcement-program-aep.page" },
  { what: "HPD penalties and fees", figure: "Dismissal request fees $250–$1,000 per request", url: "https://www.nyc.gov/site/hpd/services-and-information/penalties-and-fees.page" },
];
