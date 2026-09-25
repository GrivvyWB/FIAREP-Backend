import { useListEntityRecords, getListEntityRecordsQueryKey } from "@workspace/api-client-react";
import { Ruler, MapPin, UserRound, FolderOpen } from "lucide-react";

type Row = { id: string; development?: string | null; createdAt: string; state: Record<string, any> };

const MATERIAL_LABELS: Record<string, string> = {
  concrete: "Concrete", sheetrock: "Sheetrock", plywood: "Plyboard",
  "floor-tile": "Floor tile", "wall-tile": "Wall tile", "wood-floor": "Wood flooring",
  paint: "Paint", window: "Window", door: "Door", room: "Room",
};

function resultLine(state: Record<string, any>): string {
  if (typeof state.summary === "string" && state.summary) return state.summary;
  const parts: string[] = [];
  if (state.areaSqFt) parts.push(`${state.areaSqFt} sq ft`);
  if (state.cubicYards) parts.push(`${state.cubicYards} cu yd`);
  if (state.sheets) parts.push(`${state.sheets} sheets`);
  if (state.tiles) parts.push(`${state.tiles} tiles`);
  if (state.boxes) parts.push(`${state.boxes} boxes`);
  if (state.gallons) parts.push(`${state.gallons} gal`);
  if (state.doorSize) parts.push(state.doorSize);
  return parts.join(" · ") || "—";
}

export default function Measurements() {
  const { data = [], isLoading, isError } = useListEntityRecords("measurements", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("measurements"),
      staleTime: 15_000,
      refetchInterval: 20_000,
      refetchOnMount: "always",
    },
  });
  const rows = (data as Row[]).slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary"><Ruler className="h-3.5 w-3.5" /> Field take-offs</p>
        <h1 className="text-3xl font-bold tracking-tight">Measurements</h1>
        <p className="text-sm text-muted-foreground mt-1">Read-only view of measurements saved by field staff.</p>
      </div>

      {isLoading && <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />}
      {isError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-800">Measurements could not be loaded.</div>}

      {!isLoading && !isError && !rows.length && (
        <div className="p-12 text-center flex flex-col items-center">
          <FolderOpen className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-bold">No measurements yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Measurements saved in the field will appear here.</p>
        </div>
      )}

      {!!rows.length && (
        <div className="grid gap-3">
          {rows.map((row) => {
            const s = row.state || {};
            const material = String(s.material || "");
            return (
              <div key={row.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-[9px] bg-secondary text-secondary-foreground grid place-items-center shrink-0"><Ruler className="w-5 h-5" /></div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold">{MATERIAL_LABELS[material] || s.materialLabel || material || "Measurement"}</h4>
                    <p className="text-sm text-foreground mt-0.5">{resultLine(s)}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                      {(row.development || s.development) && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{row.development || s.development}</span>}
                      {s.by && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{s.by}{s.position ? ` · ${s.position}` : ""}</span>}
                      <span>{new Date(s.createdAt || row.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
