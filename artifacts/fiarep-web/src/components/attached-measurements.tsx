// Measurements a CPM / inspector / worker attached to a complaint or inspection
// from the app's Saved Measurements (picture, size, result).
export function AttachedMeasurements({ list }: { list: unknown }) {
  if (!Array.isArray(list) || !list.length) return null;
  return (
    <div className="mt-2 space-y-2" data-testid="attached-measurements">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Measurements attached</p>
      {list.map((raw, i) => {
        const m = (raw || {}) as Record<string, unknown>;
        const size = m.lengthFt && m.widthFt ? `${m.lengthFt} × ${m.widthFt} ft` : "";
        const line = [m.material, size, m.areaSqFt ? `${m.areaSqFt} sq ft` : ""].filter(Boolean).join(" · ");
        return (
          <div key={i} className="flex gap-3 rounded-lg border border-border bg-muted/30 p-2">
            {typeof m.photoDataUrl === "string" && m.photoDataUrl && (
              <a href={m.photoDataUrl} target="_blank" rel="noreferrer">
                <img src={m.photoDataUrl} alt="Measurement" className="h-20 w-20 rounded-md border bg-muted object-cover" />
              </a>
            )}
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{m.audience === "all" && <span className="mr-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive-foreground">Emergency</span>}{line || "Measurement"}</p>
              {!!m.summary && <p className="text-muted-foreground">{String(m.summary)}</p>}
              {Array.isArray(m.items) && m.items.length > 0 && (
                <p className="text-muted-foreground">{(m.items as Array<{ qty?: number; name?: string }>).map((it) => `${it.qty}× ${it.name}`).join(", ")}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {[m.attachedBy || m.measuredBy, m.attachedAt ? new Date(String(m.attachedAt)).toLocaleString() : ""].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
