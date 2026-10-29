// Statewide property records for every state that publishes them free (Platform Control
// → City Records → type a state). Each state is one entry in STATE_CATALOG: where its
// official statewide parcel service is and which of its fields hold the address, owner,
// value, units, use and year built. One reader serves them all, so adding a state is a
// line in the list. A state that only publishes county by county is listed with a note
// and no service, and the page says so instead of switching on.

export type FieldMap = {
  /** One field with the whole street line ("1500 MARKET ST"), or [house number field, street name field]. */
  addr: string | [string, string];
  /** House number field is a number, not text. */
  numNumeric?: boolean;
  city?: string;
  /** The city field holds more than the city ("SIDNEY, MT 59270", "CITY OF MADISON"): match it loosely. */
  cityLike?: boolean;
  /** The service is slow with the city in the search: search the street, then keep that city's rows here. */
  cityAfter?: boolean;
  owner?: string;
  owner2?: string;
  value?: string;
  /** Value is two fields added together (land + building). */
  valueAdd?: [string, string];
  units?: string;
  use?: string;
  year?: string;
  id?: string;
  /** A field holding a link to the parcel's own page. */
  link?: string;
};

export type StateEntry = {
  state: string;            // two letters
  label: string;
  publisher: string;
  kind: "arcgis" | "socrata" | "none";
  url?: string;             // ArcGIS layer (…/FeatureServer/0) or Socrata resource (…/resource/xxxx-xxxx.json)
  f?: FieldMap;
  note?: string;            // shown on the page: what is (or isn't) there
};

export type GenericRecord = { address: string; owner: string; units: number | null; value: number | null; use: string; yearBuilt: string; id: string; link: string };

const s = (v: unknown) => (v == null ? "" : typeof v === "object" ? String((v as { url?: unknown }).url ?? "") : String(v).trim());
const n = (v: unknown) => { const x = Number(v); return v === null || v === "" || !Number.isFinite(x) ? null : x; };
const sq = (v: string) => v.replace(/'/g, "''");
const UA = { accept: "application/json", "user-agent": "FIAREP/1.0 (fiarep.com city records)" };

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`The state's records service returned HTTP ${r.status}`);
  return r.json();
}

function whereFor(e: StateEntry, num: string, word: string, city: string, upperFn: string): string {
  const f = e.f!;
  const addr = typeof f.addr === "string"
    ? `${upperFn}(${f.addr}) LIKE '${sq(num)} %${sq(word)}%'`
    : `${f.numNumeric ? `${f.addr[0]} = ${Number(num)}` : `${f.addr[0]} = '${sq(num)}'`} AND ${upperFn}(${f.addr[1]}) LIKE '%${sq(word)}%'`;
  if (!city || !f.city) return addr;
  return f.cityLike ? `${addr} AND ${upperFn}(${f.city}) LIKE '%${sq(city.toUpperCase())}%'` : `${addr} AND ${upperFn}(${f.city}) = '${sq(city.toUpperCase())}'`;
}

function toRecord(e: StateEntry, r: Record<string, unknown>): GenericRecord {
  const f = e.f!;
  const street = typeof f.addr === "string" ? s(r[f.addr]) : [s(r[f.addr[0]]), s(r[f.addr[1]])].filter(Boolean).join(" ");
  return {
    address: [street, f.city ? s(r[f.city]) : ""].filter(Boolean).join(", "),
    owner: [f.owner ? s(r[f.owner]) : "", f.owner2 ? s(r[f.owner2]) : ""].filter(Boolean).join(" & "),
    units: f.units ? n(r[f.units]) : null,
    value: f.valueAdd ? ((n(r[f.valueAdd[0]]) ?? 0) + (n(r[f.valueAdd[1]]) ?? 0)) || null : f.value ? n(r[f.value]) : null,
    use: f.use ? s(r[f.use]) : "",
    yearBuilt: f.year ? s(r[f.year]).replace(/\.0+$/, "") : "",
    id: f.id ? s(r[f.id]) : "",
    link: f.link ? s(r[f.link]) : "",
  };
}

async function query(e: StateEntry, where: string, count = 50): Promise<Array<Record<string, unknown>>> {
  if (e.kind === "socrata") {
    const d = await getJson(`${e.url}?$where=${encodeURIComponent(where)}&$limit=50`);
    return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
  }
  const d = (await getJson(`${e.url}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&resultRecordCount=${count}&f=json`)) as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } };
  if (d.error) throw new Error(d.error.message || "The state's records service refused the search");
  return (d.features || []).map((x) => x.attributes || {});
}

/** The state's records for a house number + street word, in that city when it can tell. */
export async function lookupStateRecords(e: StateEntry, num: string, word: string, city: string): Promise<GenericRecord[]> {
  if (e.kind === "none" || !e.url || !e.f) return [];
  const upperFn = e.kind === "socrata" ? "upper" : "UPPER";
  if (e.f.cityAfter && e.f.city) {
    const all = await query(e, whereFor(e, num, word, "", upperFn), 200);
    const c = city.toUpperCase();
    const mine = c ? all.filter((r) => s(r[e.f!.city!]).toUpperCase().includes(c)) : [];
    return (mine.length ? mine : all.slice(0, 50)).map((r) => toRecord(e, r));
  }
  let rows = await query(e, whereFor(e, num, word, city, upperFn));
  // The state may spell the town differently from the post office ("Stamford" vs a village name): try once without it.
  if (!rows.length && city && e.f.city) rows = await query(e, whereFor(e, num, word, "", upperFn));
  return rows.map((r) => toRecord(e, r));
}

// Every state. Each service below was found on the state's own GIS office or revenue
// department and checked with a live address search (October 2026). "none": the state
// only publishes county by county (or only shapes with no address), so the page says so.
const COUNTY = (label: string, extra = "") => `${label} has no free statewide property service; its records are published county by county.${extra ? " " + extra : ""}`;
export const STATE_CATALOG: StateEntry[] = [
  { state: "AL", label: "Alabama", publisher: "", kind: "none", note: COUNTY("Alabama") },
  { state: "AK", label: "Alaska", publisher: "", kind: "none", note: COUNTY("Alaska", "The state's parcel archive covers only six boroughs.") },
  { state: "AZ", label: "Arizona", publisher: "", kind: "none", note: COUNTY("Arizona") },
  { state: "AR", label: "Arkansas", publisher: "Arkansas GIS Office (GeoStor) — statewide parcels from county assessor (CAMA) data", kind: "arcgis",
    url: "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6",
    f: { addr: ["adrnum", "pstrnam"], numNumeric: true, city: "adrcity", owner: "ownername", value: "totalvalue", use: "parceltype", id: "parcelid" } },
  { state: "CA", label: "California", publisher: "", kind: "none", note: COUNTY("California") },
  { state: "CO", label: "Colorado", publisher: "Colorado Office of Information Technology — public parcels from the counties that share them", kind: "arcgis",
    url: "https://gis.colorado.gov/Public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/MapServer/0",
    f: { addr: "situsAdd", city: "sitAddCty", owner: "owner", owner2: "owner2", value: "apprValTot", use: "landUseDsc", id: "parcel_id" },
    note: "Only the counties that share their records are included." },
  { state: "DE", label: "Delaware", publisher: "", kind: "none", note: "Delaware's statewide parcel layer has shapes only (no address, owner or value); records are county by county." },
  { state: "FL", label: "Florida", publisher: "", kind: "none", note: "Florida's statewide tax roll is a file download only (the online layer has no street address); records are county by county." },
  { state: "GA", label: "Georgia", publisher: "", kind: "none", note: COUNTY("Georgia") },
  { state: "HI", label: "Hawaii", publisher: "", kind: "none", note: "Hawaii's statewide layer has parcel numbers only (no address, owner or value); records are county by county." },
  { state: "ID", label: "Idaho", publisher: "", kind: "none", note: COUNTY("Idaho", "The state's compiled layer is not public.") },
  { state: "IL", label: "Illinois", publisher: "", kind: "none", note: COUNTY("Illinois") },
  { state: "IN", label: "Indiana", publisher: "IndianaMap / Indiana Geographic Information Office — statewide parcels", kind: "arcgis",
    url: "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0",
    f: { addr: "prop_add", city: "prop_city", use: "dlgf_prop_class_code", id: "parcel_id" },
    note: "Indiana's statewide layer has the address and parcel number but no owner or value." },
  { state: "IA", label: "Iowa", publisher: "", kind: "none", note: COUNTY("Iowa") },
  { state: "KS", label: "Kansas", publisher: "", kind: "none", note: COUNTY("Kansas") },
  { state: "KY", label: "Kentucky", publisher: "", kind: "none", note: COUNTY("Kentucky", "The state hosts some county assessors' maps, one county at a time.") },
  { state: "LA", label: "Louisiana", publisher: "", kind: "none", note: "Louisiana has no free statewide property service; its records are published parish by parish." },
  { state: "ME", label: "Maine", publisher: "", kind: "none", note: COUNTY("Maine", "Towns publish their own; the state layer has no owner or value.") },
  { state: "MA", label: "Massachusetts", publisher: "MassGIS — property tax parcels for all 351 cities and towns", kind: "arcgis",
    url: "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0",
    f: { addr: "SITE_ADDR", city: "CITY", cityAfter: true, owner: "OWNER1", value: "TOTAL_VAL", units: "UNITS", use: "USE_CODE", year: "YEAR_BUILT", id: "LOC_ID" } },
  { state: "MI", label: "Michigan", publisher: "", kind: "none", note: COUNTY("Michigan") },
  { state: "MN", label: "Minnesota", publisher: "", kind: "none", note: COUNTY("Minnesota", "The public statewide layer covers only the counties that opt in.") },
  { state: "MS", label: "Mississippi", publisher: "", kind: "none", note: COUNTY("Mississippi", "The statewide file is a download only.") },
  { state: "MO", label: "Missouri", publisher: "", kind: "none", note: COUNTY("Missouri") },
  { state: "MT", label: "Montana", publisher: "Montana State Library — MSDI cadastral parcels, all 56 counties", kind: "arcgis",
    url: "https://gisservice.mt.gov/ArcGIS/rest/services/msdi_cadastral_map_v1/MapServer/1",
    f: { addr: "AddressLine1", city: "CityStateZip", cityLike: true, owner: "OwnerName", value: "TotalValue", use: "PropType", id: "PARCELID" } },
  { state: "NE", label: "Nebraska", publisher: "Nebraska Office of the CIO — statewide parcels", kind: "arcgis",
    url: "https://giscat.ne.gov/enterprise/rest/services/StatewideParcelsExternal/MapServer/0",
    f: { addr: "Situs_Address", city: "Ph_City", value: "Total_Assessed_Value", id: "Parcel_ID" },
    note: "Nebraska's statewide layer leaves out the owner's name." },
  { state: "NV", label: "Nevada", publisher: "", kind: "none", note: COUNTY("Nevada", "The state's parcel layer stopped updating in 2018.") },
  { state: "NH", label: "New Hampshire", publisher: "", kind: "none", note: COUNTY("New Hampshire", "The state's layer has no owner or value.") },
  { state: "NJ", label: "New Jersey", publisher: "NJ Office of GIS — MOD-IV tax parcels, every municipality", kind: "arcgis",
    url: "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0",
    f: { addr: "PROP_LOC", city: "MUN_NAME", cityLike: true, owner: "OWNER_NAME", value: "NET_VALUE", units: "DWELL", use: "PROP_CLASS", year: "YR_CONSTR", id: "GIS_PIN" },
    note: "Some owner names are withheld under New Jersey's Daniel's Law." },
  { state: "NM", label: "New Mexico", publisher: "", kind: "none", note: COUNTY("New Mexico") },
  { state: "NY", label: "New York", publisher: "NYS Office of Information Technology Services and Office of Real Property Tax Services — public tax parcels", kind: "arcgis",
    url: "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1",
    f: { addr: "PARCEL_ADDR", city: "CITYTOWN_NAME", owner: "PRIMARY_OWNER", value: "FULL_MARKET_VAL", use: "PROP_CLASS", year: "YR_BLT", id: "PRINT_KEY" },
    note: "Outside New York City; only the counties that share publicly (38 of them). New York City is always on." },
  { state: "NC", label: "North Carolina", publisher: "NC OneMap / NC Center for Geographic Information and Analysis — all 100 counties", kind: "arcgis",
    url: "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1",
    f: { addr: "siteadd", city: "scity", owner: "ownname", value: "parval", use: "parusedesc", year: "structyear", id: "parno" } },
  { state: "ND", label: "North Dakota", publisher: "", kind: "none", note: COUNTY("North Dakota") },
  { state: "OH", label: "Ohio", publisher: "", kind: "none", note: COUNTY("Ohio") },
  { state: "OK", label: "Oklahoma", publisher: "", kind: "none", note: COUNTY("Oklahoma") },
  { state: "OR", label: "Oregon", publisher: "", kind: "none", note: "Oregon's statewide tax lots have shapes only (no address, owner or value); records are county by county." },
  { state: "PA", label: "Pennsylvania", publisher: "", kind: "none", note: COUNTY("Pennsylvania") },
  { state: "RI", label: "Rhode Island", publisher: "", kind: "none", note: "Rhode Island has no free statewide property service; its records are published town by town." },
  { state: "SC", label: "South Carolina", publisher: "", kind: "none", note: COUNTY("South Carolina") },
  { state: "SD", label: "South Dakota", publisher: "", kind: "none", note: COUNTY("South Dakota") },
  { state: "TN", label: "Tennessee", publisher: "", kind: "none", note: "Tennessee's Comptroller publishes county records as downloads and a map viewer, not a searchable service." },
  { state: "TX", label: "Texas", publisher: "", kind: "none", note: "Texas's statewide parcel map (TxGIO StratMap) can't be searched by address; records are county by county (appraisal districts)." },
  { state: "UT", label: "Utah", publisher: "Utah Geospatial Resource Center — statewide parcels with county assessor data", kind: "arcgis",
    url: "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Utah_LIR/FeatureServer/0",
    f: { addr: "PARCEL_ADD", city: "PARCEL_CITY", value: "TOTAL_MKT_VALUE", units: "HOUSE_CNT", use: "PROP_CLASS", year: "BUILT_YR", id: "PARCEL_ID" },
    note: "Utah's statewide layer leaves out the owner's name." },
  { state: "VT", label: "Vermont", publisher: "Vermont Center for Geographic Information — parcels joined to every town's Grand List", kind: "arcgis",
    url: "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/ArcGIS/rest/services/VTPARCELS_Stacked_Polygons/FeatureServer/3",
    f: { addr: "E911ADDR", city: "TNAME", owner: "OWNER1", owner2: "OWNER2", value: "REAL_FLV", use: "CAT", id: "SPAN" } },
  { state: "VA", label: "Virginia", publisher: "", kind: "none", note: "Virginia's statewide parcel layer has shapes only (no address, owner or value); records are county by county." },
  { state: "WA", label: "Washington", publisher: "Washington Technology Solutions (WaTech) — current parcels from the counties", kind: "arcgis",
    url: "https://services.arcgis.com/jsIt88o09Q0r1j8h/ArcGIS/rest/services/Current_Parcels/FeatureServer/0",
    f: { addr: "SITUS_ADDRESS", valueAdd: ["VALUE_LAND", "VALUE_BLDG"], use: "LANDUSE_CD", id: "PARCEL_ID_NR", link: "DATA_LINK" },
    note: "Washington's statewide layer leaves out the owner's name; each row links to the county assessor's page." },
  { state: "WV", label: "West Virginia", publisher: "WV GIS Technical Center (WVU) — statewide parcels", kind: "arcgis",
    url: "https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/0",
    f: { addr: "FullPhysicalAddress", owner: "FullOwnerName", id: "GISPID" } },
  { state: "WI", label: "Wisconsin", publisher: "Wisconsin State Cartographer's Office / Department of Administration — statewide parcels, all 72 counties", kind: "arcgis",
    url: "https://services3.arcgis.com/n6uYoouQZW75n5WI/ArcGIS/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0",
    f: { addr: "SITEADRESS", city: "PLACENAME", cityLike: true, owner: "OWNERNME1", owner2: "OWNERNME2", value: "CNTASSDVALUE", use: "PROPCLASS", id: "PARCELID" } },
  { state: "WY", label: "Wyoming", publisher: "", kind: "none", note: COUNTY("Wyoming") },
  { state: "PR", label: "Puerto Rico", publisher: "", kind: "none", note: "Puerto Rico's property records (CRIM) are not published as a free searchable service." },
];
