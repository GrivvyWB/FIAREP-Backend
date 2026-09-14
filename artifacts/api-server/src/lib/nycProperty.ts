type JsonRecord = Record<string, unknown>;

const GEOSEARCH_URL = "https://geosearch.planninglabs.nyc/v2/search";
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

function socrataUrl(dataset: string, where: string, order: string, limit: number): string {
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

async function geocodeNycAddress(address: string) {
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
  if (/^\d{8}$/.test(raw)) {
    const month = raw.slice(0, 2);
    const day = raw.slice(2, 4);
    const year = raw.slice(4);
    return `${year}-${month}-${day}`;
  }
  return raw;
}

export async function lookupNycPropertyData(address: string, limit: number) {
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
    retrievedAt: new Date().toISOString(),
  };
}