import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { DoorOpen } from "lucide-react";

type Visit = {
  id: string; staffName: string; staffPosition?: string; at: string; address: string; facing?: string; floor?: string; unit?: string; door?: string;
  record?: string; outcome?: string; outcomeLabel: string; note?: string; latitude?: number | null; longitude?: number | null; videoUrl: string | null; sentAt?: string | null;
};
const TONE: Record<string, string> = { access: "bg-emerald-100 text-emerald-800", no_access: "bg-rose-100 text-rose-800", not_home: "bg-slate-200 text-slate-700" };

/** Door Visits: every visit a member recorded at a resident's door — where, when, facing which way, floor and door, the video, access or not. */
export default function DoorVisits() {
  const [rows, setRows] = useState<Visit[] | null>(null);
  useEffect(() => { void customFetch<Visit[]>("/api/v1/door-visits", { responseType: "json" } as never).then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><DoorOpen className="h-6 w-6" /> Door Visits</h1>
        <p className="text-sm text-muted-foreground">Recorded at the door from the app: where, when, the direction the phone faced, the floor and door, the video, and whether the resident gave access.</p>
      </div>
      {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-muted-foreground">No door visits yet.</p>}
      <div className="space-y-3">
        {rows?.map((v) => (
          <div key={v.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{v.address || "Location not read"}</p>
                <p className="text-sm text-muted-foreground">{[v.floor ? `Floor ${v.floor}` : "", v.unit ? `Apt ${v.unit}` : "", v.door, v.facing ? `facing ${v.facing}` : ""].filter(Boolean).join(" · ")}</p>
                <p className="text-xs text-muted-foreground">{v.staffName}{v.staffPosition ? ` (${v.staffPosition})` : ""} · {new Date(v.at).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}{v.latitude != null && v.longitude != null ? ` · GPS ${Number(v.latitude).toFixed(5)}, ${Number(v.longitude).toFixed(5)}` : ""}{v.record ? ` · Record ${v.record}` : ""}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${TONE[v.outcome || ""] || "bg-amber-100 text-amber-800"}`}>{v.outcomeLabel}</span>
            </div>
            {v.note && <p className="mt-2 text-sm">{v.note}</p>}
            {v.videoUrl ? <video className="mt-3 max-h-80 w-full max-w-xl rounded-lg bg-black" src={v.videoUrl} controls preload="metadata" /> : <p className="mt-2 text-xs text-muted-foreground">No video.</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
