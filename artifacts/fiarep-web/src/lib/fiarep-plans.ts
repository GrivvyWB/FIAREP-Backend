// FIAREP plans and per-job rates — shown on the Join page and written into contracts.
export const PLAN = {
  fiarep: { name: "The FIAREP plan", perUnit: 20, minimum: 1000, pilotDays: 60 },
  platform: { name: "Platform only", perUnit: 4, minimum: 400, setup: 1500 },
  agencyMinUnits: 2500,
  // Housing authorities / agencies: flat monthly fee, defaulted from units × rate.
  agencySmall: { perUnit: 15, minimum: 5000 },   // under 2,500 units
  agencyMajor: { perUnit: 10, minimum: 25000 },  // 2,500 units and up
} as const;

export const FEES = [
  ["HPD cure — every open violation in one apartment certified together (Class A / B / C, smoke / CO detectors, minor electrical)", "$600 per apartment · $400 on the FIAREP plan or the platform", "Certificate of correction for the whole apartment, proof of fix, dismissal request. Public areas count as one apartment."],
  ["Standard DOB / HPD violation removal", "$1,500 flat · $1,000 each from the 3rd on the same building", "Records research, post-approval permits, inspections with city officials, certifying compliance."],
  ["Complex DOB cure — PE / RA sign-off, DOB NOW filings", "$2,500 + engineer at cost", "Unpermitted structural or mechanical work, multi-trade coordination, engineer letters (typically $500 – $2,000+)."],
  ["Stop Work / Vacate Order removal", "$3,000", "Emergency filings, examiner negotiations, rescinding the order. More if plans must be filed."],
  ["OATH / ECB hearing appearance", "$600 per hearing · $250 to admit and cure", "Appearance and mitigation argument; case preparation included."],
  ["Motion to vacate a default judgment", "$350 within 60 days · $850 special motion", "Gets a defaulted summons back in front of a hearing officer."],
  ["Permit filings", "Alt-3 $750 · Alt-2 $1,200 · Alt-1 $2,250", "DOB filing fees are separate. Open-permit closures $750 per permit."],
  ["Portfolio inspection — every building a client owns or manages", "$750 per property · credited to the plan", "Required before any plan starts: walk-through of common areas, exterior, basement and mechanical rooms; violation audit against HPD / DOB records (what is really open, what is duplicated, what is written for the wrong place); photographs; executive summary and risk-exposure report; the priced scope that goes into the contract. On a plan the $750 per property is credited against the monthly fee, starting with the first month and carrying forward until used up — e.g. $250 for the first month on the $1,000 plan. Standalone for owners not on a plan. Apartment inspections are not a separate charge — they are part of the $600 / $400 cure."],
];

export const PLATFORM_INCLUDES = [
  "App and website for all of your staff — complaints, violations, projects, scopes, time clock, scores, reports",
  "Resident app: file complaints, check status, push notifications at every step",
  "HPD / DOB lookup, translator, vendor portal, Community Coordinators, Company Forms — the modules you switch on",
  "Resident code setup and staff onboarding",
];

export const RETAINER_INCLUDES = [
  "The FIAREP platform — app and website — for all of your staff and residents",
  "24 / 7 complaint monitoring through the platform and app — every complaint tracked and the resident told at each step",
  "HPD / DOB monitoring of every address in the development",
  "1 simple cure per 10 units each month (a 100-unit development: 10 cures a month)",
  "HPD cures and OATH hearings at $400 instead of $600; everything else 20% off the rates below",
  "Pilot: first 60 days at half price, no contract",
];


// FIAREP expediter fee — violations only, no repairs. HPD: per apartment /
// location cited, every violation in it certified together — $600 with no
// plan, $400 on the FIAREP plan. DOB: $1,500 for the first two violations on a
// building, $1,000 each after; plan members 20% off the DOB part.
export const EXPEDITER = { perApartment: 600, perApartmentPlan: 400, dobFirstTwo: 1500, dobAfter: 1000, planDiscount: 0.2 } as const;
export function expediterFee(apartments: number, dob: number) {
  const apts = Math.max(0, apartments);
  const hpd = apts * EXPEDITER.perApartment;
  const dobFee = Math.min(Math.max(0, dob), 2) * EXPEDITER.dobFirstTwo + Math.max(dob - 2, 0) * EXPEDITER.dobAfter;
  const total = hpd + dobFee;
  const planHpd = apts * EXPEDITER.perApartmentPlan;
  const planDob = Math.round(dobFee * (1 - EXPEDITER.planDiscount));
  // Platform-only clients: the $400 cure, DOB at full rate.
  return { hpd, dob: dobFee, total, plan: planHpd + planDob, planHpd, planDob, platform: planHpd + dobFee };
}
