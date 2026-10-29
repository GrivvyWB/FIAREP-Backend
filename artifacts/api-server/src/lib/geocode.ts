// Addresses anywhere: New York City, the rest of the United States, and other countries.
//
//  - New York City: the City's own geocoder (NYC Planning Labs GeoSearch). It carries
//    the tax lot (BBL / BIN) the City data tools need.
//  - The rest of the United States: the US Census Bureau geocoder (free, no key,
//    every state, DC and Puerto Rico).
//  - Everywhere else (Canada, Europe, Dubai, ...): Photon, the free OpenStreetMap
//    geocoder by Komoot (photon.komoot.io), which supports search-as-you-type.
//
// No key and no bill for any of them. Each answer is kept for an hour so the same
// address is not asked twice.
import { stateCode, US_STATES } from "./jurisdiction";
import { countrySwitches } from "./countrySwitches";

const NYC_SEARCH = process.env["FIAREP_GEOSEARCH_URL"] || "https://geosearch.planninglabs.nyc/v2/search";
const NYC_AUTOCOMPLETE = NYC_SEARCH.replace(/\/v2\/.*$/, "/v2/autocomplete");
const NYC_REVERSE = NYC_SEARCH.replace(/\/v2\/.*$/, "/v2/reverse");
const CENSUS_ONELINE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const PHOTON = process.env["FIAREP_PHOTON_URL"] || "https://photon.komoot.io";
const UA = "FIAREP/1.0 (fiarep.com address lookup)";

export type Place = {
  address: string;      // street line: "1500 Market St"
  borough: string;      // NYC only
  city: string;
  state: string;        // two letters in the US; the region as named elsewhere ("Dubai", "Ontario")
  postalCode: string;
  country: string;      // "United States", "Canada", "United Arab Emirates"
  countryCode: string;  // "US", "CA", "AE"
  label: string;        // one line for display
  latitude: number | null;
  longitude: number | null;
  source: "nyc" | "census" | "osm";
};

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return value;
}

async function getJson(url: string, ms = 8_000): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`Address service returned HTTP ${r.status}`);
  return r.json();
}

const s = (v: unknown) => String(v ?? "").trim();
const NYC_WORDS = /\b(new york|nyc|manhattan|brooklyn|queens|bronx|staten island)\b|,\s*ny\b/i;
const NYC_ZIP = /\b1(0[0-4]\d\d|1[0-6]\d\d)\b/;
// Countries other than the US, by the names people type. Anything else after the last comma is looked at too.
const OTHER_COUNTRY = /\b(canada|mexico|uk|united kingdom|england|scotland|wales|ireland|france|germany|spain|italy|portugal|netherlands|belgium|switzerland|austria|sweden|norway|denmark|finland|poland|greece|turkey|uae|u\.a\.e\.|united arab emirates|dubai|abu dhabi|sharjah|saudi arabia|qatar|kuwait|bahrain|oman|egypt|israel|india|pakistan|bangladesh|china|japan|korea|philippines|singapore|australia|new zealand|brazil|argentina|colombia|chile|peru|dominican republic|haiti|nigeria|ghana|kenya|south africa|ontario|quebec|british columbia|alberta|toronto|montreal|vancouver|london|paris|berlin|madrid|rome)\b/i;

// US cities people type without the state ("1500 Market St Philadelphia").
const US_CITY = /\b(philadelphia|pittsburgh|los angeles|san francisco|san diego|san jose|oakland|sacramento|chicago|houston|dallas|austin|san antonio|fort worth|phoenix|las vegas|denver|seattle|portland|boston|baltimore|washington dc|atlanta|miami|orlando|tampa|jacksonville|detroit|cleveland|columbus|cincinnati|indianapolis|milwaukee|minneapolis|st\.? louis|kansas city|nashville|memphis|charlotte|raleigh|richmond|new orleans|newark|jersey city|paterson|elizabeth|hoboken|yonkers|mount vernon|new rochelle|white plains|buffalo|rochester|syracuse|albany|hartford|stamford|bridgeport|new haven|norwalk|providence|honolulu|anchorage)\b/i;

/** Where the typed address says it is: "nyc", "us" (another state), "intl", or "" (not said). */
export function regionOf(q: string): "nyc" | "us" | "intl" | "" {
  const t = q.trim();
  // Look for the country after the street ("..., Toronto, Canada"), so a street named for
  // a place (New England Thruway, Paris Ave) is not read as a country.
  // With no comma, only a place named at the very end counts ("... Road Dubai").
  if (t.includes(",") ? OTHER_COUNTRY.test(t.slice(t.indexOf(",") + 1)) : new RegExp(`${OTHER_COUNTRY.source}\\s*$`, "i").test(t)) return "intl";
  if (NYC_WORDS.test(t) || NYC_ZIP.test(t)) return "nyc";
  if (US_CITY.test(t.includes(",") ? t.slice(t.indexOf(",") + 1) : t)) return "us";
  const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of parts.slice(1)) {
    const first = p.split(/\s+/)[0] || "";
    if (/^\d{5}(-\d{4})?$/.test(p)) return "us";
    if (stateCode(p.replace(/\s+\d{5}(-\d{4})?$/, "")) || (first.length === 2 && US_STATES[first.toUpperCase()])) return "us";
    if (/\b(usa|united states|u\.s\.a?\.?)\b/i.test(p)) return "us";
  }
  return "";
}

function nycPlace(p: Record<string, unknown>, coords?: number[]): Place {
  const borough = s(p["borough"]);
  return {
    address: [s(p["housenumber"]), s(p["street"])].filter(Boolean).join(" ") || s(p["name"]),
    borough, city: borough || "New York", state: "NY", postalCode: s(p["postalcode"]),
    country: "United States", countryCode: "US",
    label: s(p["label"]).replace(/, USA$/, "") || `${s(p["housenumber"])} ${s(p["street"])}, ${borough}, NY`,
    latitude: Number.isFinite(coords?.[1]) ? Number(coords![1]) : null,
    longitude: Number.isFinite(coords?.[0]) ? Number(coords![0]) : null,
    source: "nyc",
  };
}

async function nycSuggest(q: string): Promise<Place[]> {
  const url = new URL(NYC_AUTOCOMPLETE); url.searchParams.set("text", q);
  const data = (await getJson(url.toString(), 6_000)) as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }> };
  return (data.features || []).filter((f) => f.properties?.["housenumber"] && f.properties?.["street"]).slice(0, 8)
    .map((f) => nycPlace(f.properties!, f.geometry?.coordinates));
}

async function censusSearch(q: string): Promise<Place[]> {
  const url = new URL(CENSUS_ONELINE);
  url.searchParams.set("address", q); url.searchParams.set("benchmark", "Public_AR_Current"); url.searchParams.set("format", "json");
  const data = (await getJson(url.toString())) as { result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x?: number; y?: number }; addressComponents?: Record<string, unknown> }> } };
  return (data.result?.addressMatches || []).slice(0, 8).map((m) => {
    const c = m.addressComponents || {};
    const street = [c["preDirection"], c["preType"], c["streetName"], c["suffixType"], c["postDirection"]].map(s).filter(Boolean).join(" ");
    const number = s(c["fromAddress"]);
    const city = s(c["city"]); const state = s(c["state"]).toUpperCase(); const zip = s(c["zip"]);
    return {
      address: [number, street].filter(Boolean).join(" ") || s(m.matchedAddress).split(",")[0]!.trim(),
      borough: "", city, state, postalCode: zip, country: "United States", countryCode: "US",
      label: s(m.matchedAddress) || [number, street, city, state].filter(Boolean).join(", "),
      latitude: Number.isFinite(m.coordinates?.y) ? Number(m.coordinates!.y) : null,
      longitude: Number.isFinite(m.coordinates?.x) ? Number(m.coordinates!.x) : null,
      source: "census" as const,
    };
  });
}

function osmPlace(p: Record<string, unknown>, coords?: number[]): Place {
  const cc = s(p["countrycode"]).toUpperCase();
  const street = [s(p["housenumber"]), s(p["street"])].filter(Boolean).join(" ");
  const address = street || s(p["name"]);
  const city = s(p["city"]) || s(p["town"]) || s(p["village"]) || s(p["district"]) || s(p["county"]);
  const region = s(p["state"]);
  const state = cc === "US" ? (stateCode(region) || region) : region;
  const country = s(p["country"]);
  return {
    address, borough: "", city, state, postalCode: s(p["postcode"]), country, countryCode: cc,
    label: [address, city, state !== city ? state : "", s(p["postcode"]), cc === "US" ? "" : country].filter(Boolean).join(", "),
    latitude: Number.isFinite(coords?.[1]) ? Number(coords![1]) : null,
    longitude: Number.isFinite(coords?.[0]) ? Number(coords![0]) : null,
    source: "osm",
  };
}

async function osmSearch(q: string, onlyUs = false): Promise<Place[]> {
  const url = new URL(`${PHOTON}/api/`); url.searchParams.set("q", q); url.searchParams.set("limit", "10");
  const data = (await getJson(url.toString())) as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }> };
  return (data.features || [])
    .filter((f) => f.properties && (f.properties["street"] || f.properties["name"]))
    .filter((f) => !onlyUs || s(f.properties!["countrycode"]).toUpperCase() === "US")
    .slice(0, 8).map((f) => osmPlace(f.properties!, f.geometry?.coordinates));
}

const settle = async (p: Promise<Place[]>) => { try { return await p; } catch { return [] as Place[]; } };

function merge(lists: Place[][]): Place[] {
  const seen = new Set<string>(); const out: Place[] = [];
  for (const list of lists) for (const p of list) {
    const k = p.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!k || seen.has(k)) continue; seen.add(k); out.push(p);
  }
  return out.slice(0, 10);
}

/** Address suggestions while somebody types, for any country. */
export async function suggestAddresses(q: string): Promise<Place[]> {
  // Only countries switched on in Platform Control → Countries.
  const on = await countrySwitches().catch(() => ({ US: true } as Record<string, boolean>));
  return (await suggestAll(q)).filter((p) => on[(p.countryCode || "US").toUpperCase()] === true);
}
function suggestAll(q: string): Promise<Place[]> {
  const text = q.trim().slice(0, 200);
  if (text.length < 3) return Promise.resolve([]);
  return cached(`suggest:${text.toLowerCase()}`, async () => {
    const region = regionOf(text);
    if (region === "intl") return merge([await settle(osmSearch(text))]);
    if (region === "us") { const [c, o] = await Promise.all([settle(censusSearch(text)), settle(osmSearch(text, true))]); return merge([c, o]); }
    const [n, c, o] = await Promise.all([settle(nycSuggest(text)), settle(censusSearch(text)), settle(osmSearch(text))]);
    return region === "nyc" ? merge([n, c]) : merge([n, c, o]);
  });
}

/** The best single match for an address, anywhere (null when nothing matches). */
export async function geocodePlace(address: string): Promise<Place | null> {
  const p = await geocodeAny(address);
  if (!p) return null;
  const on = await countrySwitches().catch(() => ({ US: true } as Record<string, boolean>));
  return on[(p.countryCode || "US").toUpperCase()] === true ? p : null;
}
function geocodeAny(address: string): Promise<Place | null> {
  const text = address.trim().slice(0, 200);
  if (text.length < 3) return Promise.resolve(null);
  return cached(`one:${text.toLowerCase()}`, async () => {
    const region = regionOf(text);
    if (region !== "intl" && region !== "us") {
      const url = new URL(NYC_SEARCH); url.searchParams.set("text", region === "nyc" ? text : `${text}, New York, NY`); url.searchParams.set("size", "5");
      try {
        const d = (await getJson(url.toString(), 6_000)) as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }> };
        const f = d.features?.find((x) => x.properties?.["housenumber"] && x.properties?.["street"] && x.properties?.["borough"]);
        if (f) return nycPlace(f.properties!, f.geometry?.coordinates);
      } catch { /* next service */ }
      if (region === "nyc") return null;
    }
    if (region !== "intl") { const c = await settle(censusSearch(text)); if (c[0]) return c[0]; }
    const o = await settle(osmSearch(text, region === "us"));
    return o[0] || null;
  });
}

/** Coordinates for an address anywhere. */
export async function geocodePoint(address: string): Promise<{ latitude: number; longitude: number } | null> {
  const p = await geocodePlace(address).catch(() => null);
  return p && p.latitude != null && p.longitude != null ? { latitude: p.latitude, longitude: p.longitude } : null;
}

/** The nearest street address for a GPS point, anywhere: the City's map in NYC, OpenStreetMap elsewhere. */
export function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return Promise.resolve(null);
  return cached(`rev:${latitude.toFixed(5)},${longitude.toFixed(5)}`, async () => {
    try {
      const url = new URL(NYC_REVERSE);
      url.searchParams.set("point.lat", String(latitude)); url.searchParams.set("point.lon", String(longitude)); url.searchParams.set("size", "1");
      const r = (await getJson(url.toString(), 6_000)) as { features?: Array<{ properties?: Record<string, unknown> }> };
      const p = r.features?.[0]?.properties;
      // Outside the five boroughs the City's geocoder still answers with a coarse place; only a precise layer is an address.
      if (p && ["address", "venue", "street"].includes(s(p["layer"])) && s(p["label"])) return s(p["label"]).replace(/, New York, NY, USA$/, ", NY");
    } catch { /* next service */ }
    try {
      const url = new URL(`${PHOTON}/reverse`); url.searchParams.set("lat", String(latitude)); url.searchParams.set("lon", String(longitude)); url.searchParams.set("limit", "1");
      const r = (await getJson(url.toString())) as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }> };
      const f = r.features?.[0];
      if (f?.properties) { const p = osmPlace(f.properties, f.geometry?.coordinates); return p.label || null; }
    } catch { /* nothing */ }
    return null;
  });
}
