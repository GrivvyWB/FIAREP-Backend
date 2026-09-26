// The CPM's CSI "Scope of Work (Divisions)" (project-scopes record) carried on
// the procurement scope, so Procurement sees it with the CPM's prices and
// vendors get the same lines — section codes, descriptions, quantities, units —
// with the prices removed, to enter their own.

type Line = { description: string; quantity: string; unit: string; unitCost?: string };
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
        if (withPrices) {
          const unitCost = text(l?.unitCost);
          total += num(quantity || "1") * num(unitCost);
          lines.push({ description, quantity, unit, unitCost });
        } else {
          lines.push({ description, quantity, unit });
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
