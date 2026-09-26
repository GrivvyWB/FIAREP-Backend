// Job-title rules. Access in FIAREP follows the job title, so a new person —
// or a new title — works without a code change or an app build:
//   "<Trade> Supervisor" / "Supervisor <Trade>" supervises crew titled "<Trade>".
// Matching ignores case and extra spaces. KEEP THE THREE COPIES IDENTICAL:
//   api-server/src/lib/titles.ts, fiarep-web/src/lib/titles.ts, fiarep-mobile/lib/titles.ts

/** Spelling variants of a trade, as they appear inside a supervisor title. */
const TRADE_ALIASES: Record<string, string> = {
  plumber: "Plumber", plumbing: "Plumber",
  electrician: "Electrician", electric: "Electrician", electrical: "Electrician",
  elevator: "Elevator Service", "elevator service": "Elevator Service",
  heating: "Heating Service", "heating service": "Heating Service", "heat plant": "Heating Service", boiler: "Heating Service",
  bricklayer: "Bricklayer", "brick layer": "Bricklayer", mason: "Bricklayer", masonry: "Bricklayer",
  carpenter: "Carpenter", carpentry: "Carpenter",
  painter: "Painter", painting: "Painter",
  inspector: "Inspector", inspection: "Inspector",
  cpm: "CPM",
  roofer: "Roofer", roofing: "Roofer",
  "general construction": "General Construction",
  cctv: "CCTV Installation", "cctv installation": "CCTV Installation",
  maintenance: "Maintenance Worker", "maintenance worker": "Maintenance Worker",
  grounds: "Groundskeeper", groundskeeper: "Groundskeeper",
};

/** Trades whose supervisors work a base development (not office-based). */
const DEVELOPMENT_BASED_TRADES = new Set(["inspector", "maintenance worker", "groundskeeper"]);
/** Known office/craft trades: supervisors work from the office, no base development. */
const OFFICE_TRADES = new Set([
  "plumber", "electrician", "carpenter", "painter", "heating service", "bricklayer",
  "elevator service", "cpm", "roofer", "general construction", "cctv installation",
]);

export function normalizeTitle(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeTitle(a);
  return !!left && left === normalizeTitle(b);
}

export function isSupervisorTitle(position: string | null | undefined): boolean {
  return /\bsupervisor\b/.test(normalizeTitle(position));
}

/** The crew trade a supervisor title oversees, or null for non-supervisors. */
export function supervisedTradeForPosition(position: string | null | undefined): string | null {
  const title = normalizeTitle(position);
  if (!/\bsupervisor\b/.test(title)) return null;
  const core = title.replace(/\bsupervisor\b/g, " ").replace(/\s+/g, " ").trim();
  if (!core) return null;
  if (TRADE_ALIASES[core]) return TRADE_ALIASES[core]!;
  // A trade we haven't seen yet ("Glazier Supervisor") supervises "Glazier".
  return core.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** Is this person crew (not a supervisor) of the given trade? */
export function isCrewForTrade(position: string | null | undefined, trade: string | null | undefined): boolean {
  return !!trade && !isSupervisorTitle(position) && sameTitle(position, trade);
}

/** Does this supervisor title oversee the given trade? */
export function isSupervisorForTrade(position: string | null | undefined, trade: string | null | undefined): boolean {
  const supervised = supervisedTradeForPosition(position);
  return !!supervised && sameTitle(supervised, trade);
}

/**
 * Office-based trade supervisor (no base development). Known craft trades are
 * always office-based; a new, unknown trade is office-based when the account
 * has no developments of its own.
 */
export function isOfficeTradeSupervisorTitle(
  position: string | null | undefined,
  developments: readonly string[] | null | undefined = [],
): boolean {
  const trade = normalizeTitle(supervisedTradeForPosition(position));
  if (!trade || DEVELOPMENT_BASED_TRADES.has(trade)) return false;
  return OFFICE_TRADES.has(trade) || !(developments || []).length;
}

export function isCpmSupervisorTitle(position: string | null | undefined): boolean {
  return supervisedTradeForPosition(position) === "CPM";
}

export function isInspectionSupervisorTitle(position: string | null | undefined): boolean {
  return supervisedTradeForPosition(position) === "Inspector";
}
