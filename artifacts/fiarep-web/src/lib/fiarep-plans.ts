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
  ["Simple cure — Class A, smoke / CO detector, minor electrical, HPD certification of correction", "$400 per violation", "Certificate of correction, proof of fix, administrative non-compliance."],
  ["Standard DOB / HPD violation removal", "$1,500 flat · $1,000 each from the 3rd on the same building", "Records research, post-approval permits, inspections with city officials, certifying compliance."],
  ["Complex DOB cure — PE / RA sign-off, DOB NOW filings", "$2,500 + engineer at cost", "Unpermitted structural or mechanical work, multi-trade coordination, engineer letters (typically $500 – $2,000+)."],
  ["Stop Work / Vacate Order removal", "$3,000", "Emergency filings, examiner negotiations, rescinding the order. More if plans must be filed."],
  ["OATH / ECB hearing appearance", "$600 per hearing · $250 to admit and cure", "Appearance and mitigation argument; case preparation included."],
  ["Motion to vacate a default judgment", "$350 within 60 days · $850 special motion", "Gets a defaulted summons back in front of a hearing officer."],
  ["Permit filings", "Alt-3 $750 · Alt-2 $1,200 · Alt-1 $2,250", "DOB filing fees are separate. Open-permit closures $750 per permit."],
  ["Hourly — research, zoning, multi-agency", "$175 per hour", "Extensive records research, complex zoning questions, multi-agency coordination."],
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
  "OATH hearings at $400 instead of $600; everything else 20% off the rates below",
  "Pilot: first 60 days at half price, no contract",
];

