// Where a building is, and what the platform can do there.
//
// FIAREP started in New York City, where the City publishes HPD and DOB
// violations, OATH summonses and 311 calls, and the platform reads them
// directly. A client in Philadelphia, Hartford or Chicago registers and works
// their buildings exactly the same way - jobs, photographs, the time clock,
// quotes, forms, scores - but there is no HPD there to read, so those tools
// say so rather than pretending.
//
// Each city is plugged in here as its feed is built. Adding one is a row in
// CITY_DATA plus its reader; nothing else in the platform has to change.

export type Jurisdiction = {
  id: string;        // "nyc", "us"
  label: string;     // what to call the place
  state: string;     // two letters, "" when unknown
  cityData: boolean; // are City violations and alerts readable here
};

const NYC_CITIES = new Set([
  "new york", "new york city", "nyc", "manhattan", "brooklyn", "queens",
  "bronx", "the bronx", "staten island",
]);

const clean = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => clean(v).toLowerCase();

/** Every US state, DC and the territories, by their two-letter code. */
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", VI: "U.S. Virgin Islands", GU: "Guam", AS: "American Samoa", MP: "Northern Mariana Islands",
};
const STATE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase().replace(/[^a-z ]/g, ""), code]),
);
STATE_BY_NAME["washington dc"] = "DC"; STATE_BY_NAME["virgin islands"] = "VI";

/** Two-letter US state, from whatever was typed ("pa", "P.A.", "Pennsylvania"). "" when it is not a US state. */
export function stateCode(value: unknown): string {
  const v = lower(value).replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  if (v.length === 2) return US_STATES[v.toUpperCase()] ? v.toUpperCase() : "";
  return STATE_BY_NAME[v] || "";
}

/** True for the United States, said any common way (or not said at all). */
export function isUsCountry(country: unknown): boolean {
  const c = lower(country).replace(/[^a-z]/g, "");
  return !c || ["us", "usa", "unitedstates", "unitedstatesofamerica", "america"].includes(c);
}

/** The region as stored: the two-letter state in the US, the region as named elsewhere ("Dubai", "Ontario"). */
export function regionValue(state: unknown, country: unknown): string {
  return isUsCountry(country) ? stateCode(state) : clean(state).slice(0, 80);
}

/** Cities whose own violation data FIAREP reads. New York City today. */
const CITY_DATA: Array<{ id: string; label: string; state: string; match: (city: string) => boolean }> = [
  { id: "nyc", label: "New York City", state: "NY", match: (city) => NYC_CITIES.has(city) },
];

/**
 * What FIAREP can do at this address. A row with no state at all is New York
 * City: every building registered before the platform went multi-state is
 * there, and the NYC lookups are what they were registered for.
 */
export function jurisdictionFor(city: unknown, state: unknown, country?: unknown): Jurisdiction {
  if (!isUsCountry(country)) {
    const label = [clean(city), clean(state), clean(country)].filter(Boolean).join(", ");
    return { id: "intl", label: label || "this address", state: clean(state), cityData: false };
  }
  const st = stateCode(state);
  const ct = lower(city);
  if (!st && !ct) return { id: "nyc", label: "New York City", state: "NY", cityData: true };
  for (const entry of CITY_DATA) {
    if (entry.state === st && entry.match(ct)) return { id: entry.id, label: entry.label, state: entry.state, cityData: true };
  }
  const label = [clean(city), st].filter(Boolean).join(", ");
  return { id: "us", label: label || "this address", state: st, cityData: false };
}

/** True when the City's own records can be read for this address. */
export const hasCityData = (city: unknown, state: unknown, country?: unknown): boolean => jurisdictionFor(city, state, country).cityData;

/** What to tell somebody standing in front of an NYC-only tool. */
export function cityDataNote(city: unknown, state: unknown, country?: unknown): string {
  const j = jurisdictionFor(city, state, country);
  if (j.cityData) return "";
  return `HPD / DOB records and the 30-minute watch are New York City only. ${j.label} publishes its own, and FIAREP reads a city's records as each one is added. Everything else — jobs, photographs, the time clock, quotes, forms and scores — works here now.`;
}

/** The address as stored, so two "100 Main Street" in different cities are two buildings. */
export function normalizeAddress(displayAddress: string, city?: unknown, state?: unknown, country?: unknown): string {
  const base = displayAddress.toLowerCase().replace(/\s+/g, " ").trim();
  if (!isUsCountry(country)) return [base, lower(city), lower(state), lower(country)].filter(Boolean).join(", ");
  const st = stateCode(state);
  // New York keeps the plain form it has always had, so nothing already
  // registered moves or collides with itself.
  if (!st || st === "NY") return base;
  const ct = lower(city);
  return [base, ct, st.toLowerCase()].filter(Boolean).join(", ");
}
