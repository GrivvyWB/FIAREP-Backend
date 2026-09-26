// The CPM's CSI Scope of Work (division → section code → lines). Staff see the
// CPM's prices; vendors see the same lines without prices.

type Line = { description: string; quantity?: string; unit?: string; unitCost?: string };
type Scope = {
  header?: Record<string, string>;
  divisions?: Array<{ title: string; sections: Array<{ code: string; lines: Line[] }> }>;
  total?: number;
};

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ViolationCode({ state }: { state: Record<string, any> }) {
  if (!state.violationCode) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold">Violation code:</span> {state.violationCode}
      {state.hazardClass ? ` · Class ${state.hazardClass}` : ""}
      {state.violationCodeDesc ? ` — ${state.violationCodeDesc}` : ""}
    </p>
  );
}

export function ScopeLines({ scope, showPrices }: { scope?: Scope | null; showPrices: boolean }) {
  if (!scope?.divisions?.length) return null;
  const h = scope.header || {};
  return (
    <div className="space-y-3 text-sm">
      {(h.projectName || h.numDUs || h.projectManager) && (
        <p className="text-muted-foreground">
          {[h.projectName, h.numDUs ? `${h.numDUs} D.U.` : "", h.projectManager ? `CPM ${h.projectManager}` : "", h.date].filter(Boolean).join(" · ")}
        </p>
      )}
      {scope.divisions.map((d, di) => (
        <div key={di} className="space-y-2">
          <p className="font-semibold">{d.title}</p>
          {d.sections.map((sec, si) => (
            <div key={si} className="rounded-md border">
              <p className="border-b bg-muted/50 px-3 py-1.5 font-medium">{sec.code}</p>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-1 font-medium">Description</th>
                    <th className="px-3 py-1 font-medium">Qty</th>
                    <th className="px-3 py-1 font-medium">Unit</th>
                    {showPrices && <th className="px-3 py-1 text-right font-medium">Unit cost</th>}
                    {showPrices && <th className="px-3 py-1 text-right font-medium">Amount</th>}
                  </tr>
                </thead>
                <tbody>
                  {sec.lines.map((l, li) => (
                    <tr key={li} className="border-t align-top">
                      <td className="px-3 py-1.5">{l.description}</td>
                      <td className="px-3 py-1.5">{l.quantity || ""}</td>
                      <td className="px-3 py-1.5">{l.unit || ""}</td>
                      {showPrices && <td className="px-3 py-1.5 text-right">{l.unitCost ? money(num(l.unitCost)) : ""}</td>}
                      {showPrices && <td className="px-3 py-1.5 text-right">{l.unitCost ? money(num(l.quantity || "1") * num(l.unitCost)) : ""}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
      {showPrices && typeof scope.total === "number" && (
        <p className="text-right font-semibold">CPM estimate: {money(scope.total)}</p>
      )}
    </div>
  );
}
