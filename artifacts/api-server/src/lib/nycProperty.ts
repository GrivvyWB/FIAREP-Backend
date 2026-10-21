type JsonRecord = Record<string, unknown>;

const GEOSEARCH_URL = process.env["FIAREP_GEOSEARCH_URL"] || "https://geosearch.planninglabs.nyc/v2/search"; // override: tests
const SOCRATA_BASE = "https://data.cityofnewyork.us/resource";
const HPD_VIOLATIONS = "wvxf-dwi5";
const DOB_VIOLATIONS = "3h2n-5cm9";
const HPD_COMPLAINTS = "ygpa-z7cr";
const NYCHA_RESIDENTIAL_ADDRESSES = "3ub5-4ph8";

function text(value: unknown): string | null {
  if (value == null) return null;
  const result = String(value).trim();
  return result || null;
}

async function fetchJson(url: string): Promise<unknown> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "FIAREP/1.0 property lookup" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) return response.json();
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`NYC service returned HTTP ${lastStatus}`);
}

export function socrataUrl(dataset: string, where: string, order: string, limit: number): string {
  const params = new URLSearchParams({
    "$where": where,
    "$order": order,
    "$limit": String(limit),
  });
  return `${SOCRATA_BASE}/${dataset}.json?${params}`;
}

function safeIdentifier(value: string | null): string | null {
  return value && /^\d+$/.test(value) ? value : null;
}

function escapeSoql(value: string): string {
  return value.replaceAll("'", "''").toUpperCase();
}

export async function geocodeNycAddress(address: string) {
  const geoUrl = new URL(GEOSEARCH_URL);
  geoUrl.searchParams.set("text", `${address.trim()}, New York, NY`);
  geoUrl.searchParams.set("size", "5");
  const geocoded = (await fetchJson(geoUrl.toString())) as {
    features?: Array<{
      geometry?: { coordinates?: number[] };
      properties?: JsonRecord & { addendum?: { pad?: JsonRecord } };
    }>;
  };
  return geocoded.features?.find((candidate) => {
    const props = candidate.properties;
    return props?.housenumber && props?.street && props?.borough;
  }) ?? null;
}

/** Building coordinates for an NYC address (null when it can't be matched). */
export async function geocodeNycPoint(address: string): Promise<{ latitude: number; longitude: number } | null> {
  if (!address.trim()) return null;
  try {
    const feature = await geocodeNycAddress(address);
    const [longitude, latitude] = feature?.geometry?.coordinates || [];
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude: Number(latitude), longitude: Number(longitude) }
      : null;
  } catch {
    return null;
  }
}

/** Distance in meters between two GPS points. */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

function developmentName(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/(^|[\s(/–—-])([a-z])/g, (_match, boundary: string, letter: string) =>
      `${boundary}${letter.toLocaleUpperCase("en-US")}`,
    );
}

export async function lookupNychaResidentialAddress(address: string) {
  const feature = await geocodeNycAddress(address);
  if (!feature?.properties) return null;
  const props = feature.properties;
  const pad = props.addendum?.pad || {};
  const bin = safeIdentifier(text(pad["bin"]));
  const houseNumber = text(props["housenumber"]) || "";
  const street = text(props["street"]) || "";
  const where = bin
    ? `bin=${bin}`
    : `upper(house)='${escapeSoql(houseNumber)}' AND upper(street)='${escapeSoql(street)}'`;
  const rows = (await fetchJson(
    socrataUrl(NYCHA_RESIDENTIAL_ADDRESSES, where, "development ASC", 5),
  )) as JsonRecord[];
  const row = Array.isArray(rows) ? rows[0] : undefined;
  const officialDevelopment = text(row?.["development"]);
  if (!row || !officialDevelopment) return null;
  return {
    development: developmentName(officialDevelopment),
    address: text(row["address"]),
    city: text(row["city"]),
    state: text(row["state"]),
    zip: text(row["zip_code"]),
    bin: text(row["bin"]),
  };
}

function normalizeDobDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  // DOB sends YYYYMMDD (e.g. 20000825); older rows may be MMDDYYYY.
  if (/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  if (/^\d{8}$/.test(raw)) {
    const month = raw.slice(0, 2);
    const day = raw.slice(2, 4);
    const year = raw.slice(4);
    return `${year}-${month}-${day}`;
  }
  return raw;
}

export async function lookupNycPropertyData(address: string, limit: number, opts: { openTotals?: boolean } = {}) {
  const feature = await geocodeNycAddress(address);
  if (!feature?.properties) return null;

  const props = feature.properties;
  const pad = props.addendum?.pad || {};
  const bin = safeIdentifier(text(pad["bin"]));
  const bbl = safeIdentifier(text(pad["bbl"]));
  const houseNumber = text(props["housenumber"]) || "";
  const street = text(props["street"]) || "";
  const borough = text(props["borough"]) || "";
  const block = bbl?.slice(1, 6) || null;
  const lot = bbl?.slice(6, 10) || null;
  const coordinates = feature.geometry?.coordinates || [];

  let where: string;
  if (bin) {
    where = `bin='${bin}'`;
  } else if (bbl) {
    where = `bbl='${bbl}'`;
  } else {
    where = `upper(housenumber)='${escapeSoql(houseNumber)}' AND upper(streetname)='${escapeSoql(street)}'`;
  }
  const complaintWhere = bin
    ? `bin='${bin}'`
    : bbl
      ? `bbl='${bbl}'`
      : `upper(house_number)='${escapeSoql(houseNumber)}' AND upper(street_name)='${escapeSoql(street)}'`;
  const dobWhere = bin
    ? `bin='${bin}'`
    : `upper(house_number)='${escapeSoql(houseNumber)}' AND upper(street)='${escapeSoql(street)}'`;

  const warnings: string[] = [];
  const settled = await Promise.allSettled([
    fetchJson(socrataUrl(HPD_VIOLATIONS, where, "inspectiondate DESC", limit)),
    fetchJson(socrataUrl(DOB_VIOLATIONS, dobWhere, "issue_date DESC", limit)),
    fetchJson(socrataUrl(HPD_COMPLAINTS, complaintWhere, "received_date DESC", limit)),
  ]);
  if (settled.every((result) => result.status === "rejected")) {
    throw new Error("NYC violation services are temporarily unavailable");
  }
  // Every open item, not only the newest `limit` rows (older ones can still be open).
  let openTotals: { hpdByClass: Record<string, number>; hpd: number; dob: number; openComplaints: number; complaintsLastYear: number } | null = null;
  if (opts.openTotals) {
    const counted = (dataset: string, w: string, group?: string) => {
      const params = new URLSearchParams({ "$select": group ? `${group},count(*)` : "count(*)", "$where": w });
      if (group) params.set("$group", group);
      return fetchJson(`${SOCRATA_BASE}/${dataset}.json?${params}`) as Promise<Array<Record<string, string>>>;
    };
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const [byClass, dobOpen, compOpen, compYear] = await Promise.allSettled([
      counted(HPD_VIOLATIONS, `${where} AND violationstatus='Open'`, "class"),
      counted(DOB_VIOLATIONS, `${dobWhere} AND disposition_date IS NULL`),
      counted(HPD_COMPLAINTS, `${complaintWhere} AND complaint_status='OPEN'`),
      counted(HPD_COMPLAINTS, `${complaintWhere} AND received_date >= '${yearAgo}'`),
    ]);
    const n = (r: PromiseSettledResult<Array<Record<string, string>>>) => (r.status === "fulfilled" ? Number(r.value?.[0]?.["count"] ?? 0) : null);
    const hpdByClass: Record<string, number> = {};
    if (byClass.status === "fulfilled") for (const row of byClass.value) hpdByClass[row["class"] || "?"] = Number(row["count"] ?? 0);
    if ([byClass, dobOpen, compOpen, compYear].some((r) => r.status === "rejected")) warnings.push("Some open counts could not be loaded.");
    openTotals = { hpdByClass, hpd: Object.values(hpdByClass).reduce((a, b) => a + b, 0), dob: n(dobOpen) ?? 0, openComplaints: n(compOpen) ?? 0, complaintsLastYear: n(compYear) ?? 0 };
  }
  const names = ["HPD violations", "DOB violations", "HPD complaints"];
  settled.forEach((result, index) => {
    if (result.status === "rejected") warnings.push(`${names[index]} could not be loaded.`);
  });
  const rows = settled.map((result) =>
    result.status === "fulfilled" && Array.isArray(result.value) ? (result.value as JsonRecord[]) : [],
  );

  const hpdViolations = rows[0].map((row) => ({
    id: text(row["violationid"]) || "unknown",
    source: "HPD" as const,
    class: text(row["class"]),
    status: text(row["violationstatus"]) || text(row["currentstatus"]) || "Unknown",
    description: text(row["novdescription"]) || "Housing maintenance code violation",
    inspectionDate: text(row["inspectiondate"]),
    apartment: text(row["apartment"]),
    story: text(row["story"]),
    orderNumber: text(row["ordernumber"]),
  }));
  const dobViolations = rows[1].map((row) => {
    const dispositionDate = normalizeDobDate(row["disposition_date"]);
    return {
      id: text(row["isn_dob_bis_viol"]) || text(row["violation_number"]) || "unknown",
      source: "DOB" as const,
      number: text(row["violation_number"]),
      type: text(row["violation_type"]),
      category: text(row["violation_category"]),
      status: dispositionDate ? "Resolved" : "Open",
      description: text(row["description"]) || "Department of Buildings violation",
      issueDate: normalizeDobDate(row["issue_date"]),
      dispositionDate,
      dispositionComments: text(row["disposition_comments"]),
      ecbNumber: text(row["ecb_number"]),
    };
  });
  const hpdComplaints = rows[2].map((row) => ({
    id: text(row["problem_id"]) || text(row["complaint_id"]) || "unknown",
    source: "HPD" as const,
    status: text(row["problem_status"]) || text(row["complaint_status"]) || "Unknown",
    description:
      text(row["status_description"]) ||
      [text(row["major_category"]), text(row["minor_category"])].filter(Boolean).join(" — ") ||
      "HPD complaint",
    receivedDate: text(row["received_date"]),
    apartment: text(row["apartment"]),
    majorCategory: text(row["major_category"]),
    minorCategory: text(row["minor_category"]),
  }));

  return {
    property: {
      query: address.trim(),
      formattedAddress: text(props["label"]) || `${houseNumber} ${street}, ${borough}, NY`,
      houseNumber,
      street,
      borough,
      zip: text(props["postalcode"]),
      bin,
      bbl,
      block,
      lot,
      latitude: typeof coordinates[1] === "number" ? coordinates[1] : null,
      longitude: typeof coordinates[0] === "number" ? coordinates[0] : null,
    },
    summary: {
      hpdViolations: hpdViolations.length,
      openHpdViolations: hpdViolations.filter((item) => !/close|resolved/i.test(item.status)).length,
      dobViolations: dobViolations.length,
      openDobViolations: dobViolations.filter((item) => item.status === "Open").length,
      hpdComplaints: hpdComplaints.length,
    },
    hpdViolations,
    dobViolations,
    hpdComplaints,
    warnings,
    openTotals,
    retrievedAt: new Date().toISOString(),
  };
}
/** Nearest address for a point — NYC Planning Labs GeoSearch reverse lookup
 * (NYC only). Outside the city, or if the service is down, null. */
export async function reverseGeocodeNyc(latitude: number, longitude: number): Promise<string | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  try {
    const url = new URL(GEOSEARCH_URL.replace(/\/v2\/.*$/, "/v2/reverse"));
    url.searchParams.set("point.lat", String(latitude));
    url.searchParams.set("point.lon", String(longitude));
    url.searchParams.set("size", "1");
    const r = (await fetchJson(url.toString())) as { features?: Array<{ properties?: JsonRecord }> };
    const p = r.features?.[0]?.properties;
    // This is NYC's own geocoder. For a point outside the five boroughs it
    // still answers, with the coarsest match it has - a punch in Connecticut
    // came back as "United States". Only a real place is an address, so take
    // the precise layers and otherwise say nothing and let the caller fall
    // back to the device's own lookup.
    const layer = typeof p?.["layer"] === "string" ? p["layer"] : "";
    if (!["address", "venue", "street"].includes(layer)) return null;
    const label = typeof p?.["label"] === "string" ? p["label"] : "";
    return label ? label.replace(/, New York, NY, USA$/, ", NY") : null;
  } catch { return null; }
}
