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

/**
 * Everything else the CPM filled in with the scope: the Nature of Work & Cost
 * Estimate, the Elevator Services survey, and the attached scope file.
 */
export function CpmPackage({ state }: { state: Record<string, any> }) {
  const est = state.cpmEstimate as { categories?: Array<{ title: string; location?: string; description?: string; cost?: string }>; totals?: Record<string, string> } | undefined;
  const elev = state.cpmElevator as { header?: Record<string, string>; items?: Array<{ section: string; label: string; condition?: string; cost?: string; note?: string }> } | undefined;
  const file = state.scopeFileRemote as { objectPath?: string; name?: string } | undefined;
  if (!est?.categories?.length && !elev?.items?.length && !file?.objectPath && !state.scopeFileName) return null;
  async function openFile() {
    if (!file?.objectPath) return;
    const { requestFileDownloadUrl } = await import("@workspace/api-client-react");
    const res = await requestFileDownloadUrl({ objectPath: file.objectPath });
    window.open(res.downloadUrl, "_blank", "noopener");
  }
  return (
    <div className="space-y-3">
      {!!est?.categories?.length && (
        <div className="overflow-hidden rounded-md border">
          <div className="bg-muted/60 px-3 py-1.5 text-sm font-semibold">Nature of Work &amp; Cost Estimate</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-3 py-1">Nature of work</th><th className="px-3 py-1">Location</th><th className="px-3 py-1">Description</th><th className="px-3 py-1 text-right">Cost</th></tr></thead>
            <tbody>{est.categories.map((c, i) => (
              <tr key={i} className="border-t"><td className="px-3 py-1 font-medium">{c.title}</td><td className="px-3 py-1">{c.location}</td><td className="px-3 py-1">{c.description}</td><td className="px-3 py-1 text-right">{c.cost}</td></tr>
            ))}</tbody>
          </table>
          {!!est.totals && (est.totals.total || est.totals.costEstimate) && (
            <div className="border-t px-3 py-1.5 text-right text-sm">
              {est.totals.costEstimate ? <>Cost estimate {est.totals.costEstimate} · </> : null}
              {est.totals.contingency ? <>Contingency {est.totals.contingency} · </> : null}
              <span className="font-semibold">Total {est.totals.total || est.totals.costEstimate}</span>
            </div>
          )}
        </div>
      )}
      {!!elev?.items?.length && (
        <div className="overflow-hidden rounded-md border">
          <div className="bg-muted/60 px-3 py-1.5 text-sm font-semibold">Elevator Services{elev.header?.elevatorId ? ` · ${elev.header.elevatorId}` : ""}{elev.header?.location ? ` · ${elev.header.location}` : ""}</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-3 py-1">Component</th><th className="px-3 py-1">Condition</th><th className="px-3 py-1">Note</th><th className="px-3 py-1 text-right">Cost</th></tr></thead>
            <tbody>{elev.items.map((it, i) => (
              <tr key={i} className="border-t"><td className="px-3 py-1"><span className="font-medium">{it.label}</span><span className="block text-xs text-muted-foreground">{it.section}</span></td><td className="px-3 py-1">{it.condition}</td><td className="px-3 py-1">{it.note}</td><td className="px-3 py-1 text-right">{it.cost}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {file?.objectPath ? (
        <button type="button" onClick={() => { void openFile(); }} className="text-sm font-semibold text-primary underline">
          Open attached scope file: {file.name || state.scopeFileName || "file"}
        </button>
      ) : state.scopeFileName ? (
        <p className="text-sm text-muted-foreground">Attached file: {state.scopeFileName} (sent before files uploaded — ask the CPM to resend)</p>
      ) : null}
    </div>
  );
}
