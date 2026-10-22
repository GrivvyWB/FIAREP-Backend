import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { DoorOpen, MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DoorVideo } from "@/components/door-video";

export type Visit = {
  id: string; staffName: string; staffPosition?: string; at: string; address: string; facing?: string; floor?: string; unit?: string; door?: string;
  record?: string; outcome?: string; outcomeLabel: string; note?: string; latitude?: number | null; longitude?: number | null; accuracy?: number | null;
  video?: { contentType?: string; seconds?: number } | null; videoUrl: string | null; sentAt?: string | null;
};
export const OUTCOME_TONE: Record<string, string> = { access: "bg-emerald-100 text-emerald-800", no_access: "bg-rose-100 text-rose-800", not_home: "bg-slate-200 text-slate-700" };
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const place = (v: Visit) => [v.floor ? `Floor ${v.floor}` : "", v.unit ? `Apt ${v.unit}` : "", v.door, v.facing ? `facing ${v.facing}` : ""].filter(Boolean).join(" · ");

/** Door Visits: every visit a member recorded at a resident's door. Press one to open it full screen. */
export default function DoorVisits() {
  const search = useSearch();
  const wanted = useMemo(() => new URLSearchParams(search).get("id") || "", [search]);
  const [rows, setRows] = useState<Visit[] | null>(null);
  const [open, setOpen] = useState<Visit | null>(null);
  useEffect(() => { void customFetch<Visit[]>("/api/v1/door-visits", { responseType: "json" } as never).then(setRows).catch(() => setRows([])); }, []);
  // Opened from a notification (?id=…): that visit opens full screen.
  useEffect(() => { if (wanted && rows) setOpen(rows.find((r) => r.id === wanted) || null); }, [wanted, rows]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><DoorOpen className="h-6 w-6" /> Door Visits</h1>
        <p className="text-sm text-muted-foreground">Recorded at the door from the app: where, when, the direction the phone faced, the floor and door, the video, and whether the resident gave access. Press a visit to open it.</p>
      </div>
      {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-muted-foreground">No door visits yet.</p>}
      <div className="space-y-3">
        {rows?.map((v) => (
          <button key={v.id} type="button" onClick={() => setOpen(v)} className="block w-full rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/50">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{v.address || "Location not read"}</p>
                <p className="text-sm text-muted-foreground">{place(v)}</p>
                <p className="text-xs text-muted-foreground">{v.staffName}{v.staffPosition ? ` (${v.staffPosition})` : ""} · {when(v.at)}{v.videoUrl ? " · video" : ""}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${OUTCOME_TONE[v.outcome || ""] || "bg-amber-100 text-amber-800"}`}>{v.outcomeLabel}</span>
            </div>
          </button>
        ))}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-h-[96vh] w-[96vw] max-w-5xl overflow-y-auto">
          {open && (
            <>
              <DialogHeader><DialogTitle>{open.address || "Door visit"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${OUTCOME_TONE[open.outcome || ""] || "bg-amber-100 text-amber-800"}`}>{open.outcomeLabel}</span>
                {open.videoUrl ? <DoorVideo url={open.videoUrl} contentType={open.video?.contentType} className="max-h-[60vh] w-full" /> : <p className="text-sm text-muted-foreground">No video was recorded.</p>}
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">When (server time)</dt><dd className="font-semibold">{when(open.at)}</dd></div>
                  <div><dt className="text-muted-foreground">Member</dt><dd className="font-semibold">{open.staffName}{open.staffPosition ? ` (${open.staffPosition})` : ""}</dd></div>
                  <div><dt className="text-muted-foreground">Floor / apartment / door</dt><dd className="font-semibold">{[open.floor ? `Floor ${open.floor}` : "", open.unit ? `Apt ${open.unit}` : "", open.door].filter(Boolean).join(" · ") || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Phone facing</dt><dd className="font-semibold">{open.facing || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Where the phone was</dt><dd className="font-semibold">{open.latitude != null && open.longitude != null ? (
                    <a className="inline-flex items-center gap-1 text-[#185FA5] underline" href={`https://maps.google.com/?q=${open.latitude},${open.longitude}`} target="_blank" rel="noopener"><MapPin className="h-4 w-4" />{Number(open.latitude).toFixed(5)}, {Number(open.longitude).toFixed(5)}{open.accuracy ? ` (±${Math.round(open.accuracy)} m)` : ""}</a>
                  ) : "No GPS"}</dd></div>
                  <div><dt className="text-muted-foreground">Complaint / violation</dt><dd className="font-semibold">{open.record || "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Sent</dt><dd className="font-semibold">{open.sentAt ? when(open.sentAt) : "Not sent yet"}</dd></div>
                </dl>
                {open.note && <p className="rounded-md bg-muted p-3 text-sm">{open.note}</p>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
