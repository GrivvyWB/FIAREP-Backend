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
  
    // added by Tim's list
    "pipe burst", "burst pipe", "busted pipe", "leaking pipe", "water leak", "ceiling leak", "toilet clogged", "toilet overflowing", "toilet won't flush", "toilet wont flush", "won't flush", "flush", "clogged drain", "drain backing up", "sink clogged", "bathtub drain clogged", "sewer backup", "sewage smell", "low water pressure", "no water", "water heater", "water heater not working", "water heater leaking", "faucet leaking", "faucet broken", "shower leaking", "shower won't drain", "water running", "water running continuously", "frozen pipe", "frozen pipes", "water line", "broken water line", "bathtub damaged", "mold in bathroom", "bathroom water damage", "toilet loose", "kitchen leak", "kitchen flooding", "garbage disposal", "disposal", "appliance water leak", "water damage", "water stained",
  ],
  Electrician: [
    "power", "no power", "electric", "electrical", "electricity", "outlet", "outlets",
    "socket", "light", "lights", "lighting", "bulb", "switch", "breaker", "fuse",
    "wiring", "wire", "wires", "spark", "sparks", "sparking", "shock", "intercom",
    "doorbell", "buzzer", "smoke detector", "carbon monoxide", "co detector", "fixture",
    "ceiling fan", "exhaust fan", "blackout", "short circuit",
  
    // added by Tim's list
    "power out", "lights out", "no electricity", "electrical outage", "outage", "outlet not working", "socket not working", "electrical socket broken", "breaker keeps tripping", "tripping", "fuse blown", "blown fuse", "flickering", "lights flickering", "switch not working", "ceiling fan not working", "burning smell", "electrical burning smell", "sparking outlet", "power surge", "surge", "exposed wiring", "faulty wiring", "panel", "electrical panel", "panel problem", "circuit", "circuit overload", "light fixture", "light fixture broken", "broken fixture",
  ],
  Carpenter: [
    "door", "doors", "lock", "locks", "cabinet", "cabinets", "closet", "window", "windows",
    "floor", "floors", "flooring", "baseboard", "hinge", "hinges", "knob", "drawer",
    "drawers", "countertop", "counter", "frame", "molding", "shelf", "shelves",
    "window guard", "sash", "threshold", "saddle",
  
    // added by Tim's list
    "broken door", "door won't close", "door wont close", "door stuck", "door frame", "damaged door frame", "broken lock", "window won't open", "window wont open", "broken window", "trim", "damaged trim", "railing", "loose railing", "stair", "stairs", "staircase", "staircase repair", "damaged cabinets", "cabinet door broken", "cabinet damaged", "floorboard", "floorboards", "damaged floorboards", "wood rot", "rot", "deck", "deck repair", "porch", "porch repair", "framing", "framing damage", "broken shelves", "vanity", "vanity damaged", "countertop damaged",
  ],
  "Heating Service": [
    "heat", "heating", "no heat", "radiator", "radiators", "boiler", "thermostat",
    "steam", "cold apartment", "freezing", "hot water",
  
    // added by Tim's list
    "heat not working", "heater", "heater broken", "furnace", "furnace not working", "boiler not working", "radiator cold", "thermostat not working", "hvac", "hvac not working", "ac", "a/c", "ac not cooling", "air conditioner", "air conditioning", "air conditioner broken", "airflow", "no airflow", "loud furnace noise", "heating system", "heating system failure", "heat pump", "thermostat replacement", "ventilation", "ventilation problem", "uneven heating", "emergency heating repair",
  ],
  Painter: [
    "paint", "painting", "peeling", "plaster", "wall", "walls", "ceiling", "stain",
    "stains", "mold", "mildew", "chipped", "crack in wall", "hole in wall",
  
    // added by Tim's list
    "wall damaged", "drywall", "drywall hole", "drywall crack", "ceiling crack", "peeling paint", "paint damage", "water stained wall", "water stained ceiling", "repaint", "repaint room", "mold on wall", "wallpaper", "wallpaper removal", "wall repair", "ceiling repair", "water damage", "mold problem",
  ],
  Bricklayer: [
    "brick", "bricks", "mortar", "masonry", "facade", "tile", "tiles", "concrete",
    "sidewalk", "stoop", "step", "steps", "crack", "cracks", "cracked",
  
    // added by Tim's list
    "broken bricks", "cracked bricks", "damaged masonry", "foundation", "cracked foundation", "foundation repair", "retaining wall", "retaining wall damage", "chimney", "chimney damaged", "chimney leaning", "loose bricks", "brick wall repair", "stone wall", "stone wall repair", "cracked concrete", "paver", "pavers", "paver repair", "sidewalk crack", "masonry restoration", "bathroom tile broken", "cracked tile", "loose tile", "shower tile repair", "structural damage",
  ],
  "Elevator Service": ["elevator", "elevators", "lift"],
  Roofer: ["roof", "roofing", "skylight", "gutter", "gutters",
    // added by Tim's list
    "roof leak", "leaking roof", "shingle", "shingles", "missing shingles", "roof damage", "storm damage", "storm damage roof", "attic", "water entering attic", "roof replacement", "roof replacement needed", "flashing", "flashing damage", "gutter leaking", "gutter clogged", "gutter detached", "skylight leaking", "roof inspection", "roof inspection needed",
  ],
  "General Construction": [
    // added by Tim's list
    "renovation", "bathroom renovation needed", "structural damage", "building repair",
  ],
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

