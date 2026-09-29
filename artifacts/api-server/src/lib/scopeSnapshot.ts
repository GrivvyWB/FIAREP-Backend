// The CPM's CSI "Scope of Work (Divisions)" (project-scopes record) carried on
// the procurement scope, so Procurement sees it with the CPM's prices and
// vendors get the same lines — section codes, descriptions, quantities, units —
// with the prices removed, to enter their own.

type Line = { description: string; quantity: string; unit: string; sqFt?: string; unitCost?: string };
type Section = { code: string; lines: Line[] };
type Division = { title: string; sections: Section[] };
export type ScopeSnapshot = {
  header: Record<string, string>;
  divisions: Division[];
  total?: number;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim());
const num = (value: unknown) => {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Used lines only; with or without the CPM's unit costs. */
export function snapshotScope(raw: unknown, withPrices: boolean): ScopeSnapshot | null {
  const scope = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  if (!scope || !Array.isArray(scope["divisions"])) return null;
  let total = 0;
  const divisions: Division[] = [];
  for (const d of scope["divisions"]) {
    const sections: Section[] = [];
    for (const s of Array.isArray(d?.sections) ? d.sections : []) {
      const lines: Line[] = [];
      for (const l of Array.isArray(s?.lines) ? s.lines : []) {
        const description = text(l?.description);
        if (!description) continue;
        const quantity = text(l?.quantity);
        const unit = text(l?.unit);
        const sqFt = text(l?.sqFt);
        if (withPrices) {
          const unitCost = text(l?.unitCost);
          total += num(quantity || "1") * num(unitCost);
          lines.push({ description, quantity, unit, sqFt, unitCost });
        } else {
          lines.push({ description, quantity, unit, sqFt });
        }
      }
      if (lines.length) sections.push({ code: text(s?.code), lines });
    }
    if (sections.length) divisions.push({ title: text(d?.title), sections });
  }
  if (!divisions.length) return null;
  const h = scope["header"] && typeof scope["header"] === "object" ? scope["header"] : {};
  const header: Record<string, string> = {};
  for (const key of ["projectName", "address", "numDUs", "projectManager", "date", "multiBuilding"]) {
    if (text(h[key])) header[key] = text(h[key]);
  }
  return withPrices ? { header, divisions, total: Math.round(total * 100) / 100 } : { header, divisions };
}

// Nature of Work & Cost Estimate categories (same list as the app).
const COST_TITLES: Record<string, string> = {
  generals: "GENERALS REQUIREMENTS", exterior: "BUILDING'S EXTERIOR", facades: "FACADES",
  "apt-reno": "APARTMENT RENOVATION", "public-reno": "PUBLIC PARTS RENOVATION",
  lead: "LEAD-BASED PAINT REMOVAL", mold: "MOLD ABATEMENT", windows: "WINDOWS",
  "roof-acm": "ROOF/ACM REMOVAL", "fire-escape": "FIRE ESCAPE",
  gutters: "GUTTERS & LEADERS, ROOF DRAINS", bulkhead: "ROOF BULKHEAD & SKYLIGHT",
  "bldg-entrance": "BUILDING ENTRANCE", intercom: "INTERCOM SYSTEM",
  "public-halls": "PUBLIC HALLS/APT. ENTRY DOORS", cellar: "STRUCTURAL PROBLEMS INTERIOR CELLAR",
  "cellar-basement": "CELLAR / BASEMENT", electrical: "ELECTRICAL SERVICE", gas: "GAS SYSTEM",
  boiler: "BOILER ROOM", heating: "HEATING", "hot-water": "HOT WATER HEATER",
  "pipe-insul": "PIPE INSULATION", "domestic-water": "DOMESTIC WATER",
  drainage: "DRAINAGE/WASTE SYSTEMS", pest: "PEST MANAGEMENT/EXTERMINATION",
};
const humanize = (id: string) => id.replace(/^[a-z]+-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Filled rows of the CPM's cost estimate, readable. */
export function snapshotEstimate(raw: unknown): Record<string, unknown> | null {
  const est = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  const rows = est && est["rows"] && typeof est["rows"] === "object" ? est["rows"] as Record<string, any> : null;
  if (!rows) return null;
  const categories = Object.entries(rows).map(([id, row]) => ({
    title: COST_TITLES[id] || humanize(id),
    location: text(row?.location), description: text(row?.description), cost: text(row?.cost),
  })).filter((c) => c.location || c.description || c.cost);
  if (!categories.length) return null;
  return { header: est!["header"] || {}, categories, totals: est!["totals"] || {} };
}

/** Components the CPM marked on the elevator survey, readable. */
export function snapshotElevator(raw: unknown): Record<string, unknown> | null {
  const elev = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  const items = elev && elev["items"] && typeof elev["items"] === "object" ? elev["items"] as Record<string, any> : null;
  if (!items) return null;
  const list = Object.entries(items).filter(([, it]) =>
    (it?.condition && it.condition !== "N/A") || text(it?.cost) || text(it?.note))
    .map(([id, it]) => ({ section: "", label: humanize(id), condition: text(it?.condition), cost: text(it?.cost), note: text(it?.note) }));
  return list.length ? { header: elev!["header"] || {}, items: list } : null;
}

/** Does the scope carry something priced / readable for the reviewer? */
export function hasScopePackage(state: Record<string, unknown>): boolean {
  return Boolean(state["cpmScope"] || state["cpmEstimate"] || state["cpmElevator"] || state["scopeFileRemote"]);
}
