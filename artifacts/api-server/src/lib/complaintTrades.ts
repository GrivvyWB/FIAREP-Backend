// Pure keyword → trade matching for resident complaints (no database access,
// so domain.ts can use it for visibility). See complaintRouting.ts.
/** Trade (crew title) → words/phrases in a complaint that call for it. */
export const TRADE_KEYWORDS: Record<string, string[]> = {
  Plumber: [
    "water", "leak", "leaks", "leaking", "leaky", "drip", "dripping", "pipe", "pipes",
    "toilet", "sink", "faucet", "drain", "drains", "clog", "clogged", "sewer", "sewage",
    "flood", "flooding", "flooded", "shower", "tub", "bathtub", "valve", "overflow",
    "overflowing", "backup", "backed up", "gas", "gas smell", "gas odor", "water pressure",
    "no hot water", "hot water", "cold water", "mold", "mildew", "wet", "trap", "bidet",
  ],
  Electrician: [
    "power", "no power", "electric", "electrical", "electricity", "outlet", "outlets",
    "socket", "light", "lights", "lighting", "bulb", "switch", "breaker", "fuse",
    "wiring", "wire", "wires", "spark", "sparks", "sparking", "shock", "intercom",
    "doorbell", "buzzer", "smoke detector", "carbon monoxide", "co detector", "fixture",
    "ceiling fan", "exhaust fan", "blackout", "short circuit",
  ],
  Carpenter: [
    "door", "doors", "lock", "locks", "cabinet", "cabinets", "closet", "window", "windows",
    "floor", "floors", "flooring", "baseboard", "hinge", "hinges", "knob", "drawer",
    "drawers", "countertop", "counter", "frame", "molding", "shelf", "shelves",
    "window guard", "sash", "threshold", "saddle",
  ],
  "Heating Service": [
    "heat", "heating", "no heat", "radiator", "radiators", "boiler", "thermostat",
    "steam", "cold apartment", "freezing", "hot water",
  ],
  Painter: [
    "paint", "painting", "peeling", "plaster", "wall", "walls", "ceiling", "stain",
    "stains", "mold", "mildew", "chipped", "crack in wall", "hole in wall",
  ],
  Bricklayer: [
    "brick", "bricks", "mortar", "masonry", "facade", "tile", "tiles", "concrete",
    "sidewalk", "stoop", "step", "steps", "crack", "cracks", "cracked",
  ],
  "Elevator Service": ["elevator", "elevators", "lift"],
  Roofer: ["roof", "roofing", "skylight", "gutter", "gutters"],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TRADE_PATTERNS = Object.entries(TRADE_KEYWORDS).map(([trade, words]) => ({
  trade,
  pattern: new RegExp(`\\b(?:${words.map((word) => escapeRegExp(word).replace(/ /g, "\\s+")).join("|")})\\b`, "i"),
}));

/** Trades a complaint's words point to (may be several, may be none). */
export function tradesForComplaintText(...texts: Array<string | null | undefined>): string[] {
  const text = texts.filter(Boolean).join(" \n ");
  if (!text.trim()) return [];
  return TRADE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ trade }) => trade);
}

/** Words a complaint record carries: the resident's description, location and any AI trade/condition. */
export function complaintTexts(state: Record<string, unknown>): string[] {
  const assessment = state["assessment"] && typeof state["assessment"] === "object"
    ? state["assessment"] as Record<string, unknown> : {};
  return [
    state["description"], state["issue"], state["location"], state["category"],
    assessment["trade"], assessment["condition"],
  ].map((value) => (typeof value === "string" ? value : ""));
}

export function tradesForComplaint(state: Record<string, unknown>): string[] {
  return tradesForComplaintText(...complaintTexts(state));
}

