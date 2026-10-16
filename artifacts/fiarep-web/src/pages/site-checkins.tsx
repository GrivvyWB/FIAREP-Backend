// Site Check-Ins: for each member, the building they tapped in the app next to
// where their phone actually was at that moment, and every time they left the
// building, where they stopped and when they came back.
import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ChevronDown, Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";

type Ev = { type: "left" | "stop" | "back"; at: string; until?: string | null; address?: string };
type Row = {
  id: string; staffName: string; position: string; staffTenant: string;
  building: { address: string }; phone: { address: string; latitude: number; longitude: number; accuracyM: number | null };
  distanceM: number | null; atBuilding: boolean | null; checkedInAt: string; checkedOutAt: string; events: Ev[];
  checkoutPhone?: { address?: string } | null;
};
type VendorRow = { id: string; vendorName: string; address: string; trackingId: string; walkthroughAt: string; capturedAt: string; distanceMeters: number | null; onSite: boolean | null; minutesFromSchedule: number | null; accuracy: number | null };
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
const far = (m: number | null) => (m == null ? "" : m < 1000 ? `${m} m` : `${(m / 1609).toFixed(1)} mi`);
const today = () => new Date().toLocaleDateString("en-CA");
const minutes = (a: string, b?: string | null) => (b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : 0);

export default function SiteCheckins() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);

  useEffect(() => {
    setRows(null); setError("");
    customFetch<Row[]>(`/api/v1/site-checkins?from=${from}&to=${to}`, { responseType: "json" } as never)
      .then(setRows).catch((e: any) => { setError(e?.data?.error || e?.message || "Could not load check-ins."); setRows([]); });
    customFetch<VendorRow[]>(`/api/v1/site-checkins/vendors?from=${from}&to=${to}`, { responseType: "json" } as never)
      .then(setVendors).catch(() => setVendors([]));
  }, [from, to]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => !t || r.staffName.toLowerCase().includes(t) || r.building.address.toLowerCase().includes(t));
  }, [rows, q]);
  const flagged = shown.filter((r) => r.atBuilding === false).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Site Check-Ins</h1>
        <p className="text-sm text-muted-foreground">The building each member tapped in the app, where their phone actually was, and every time they left and came back.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></label>
        <label className="text-xs text-muted-foreground">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></label>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a member or a building" className="h-9 flex-1 min-w-48" />
      </div>
      {rows && <p className="text-sm">{shown.length} check-in{shown.length === 1 ? "" : "s"}{flagged > 0 && <span className="ml-2 font-semibold text-red-700">· {flagged} not at the building they tapped</span>}</p>}
      {rows === null && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {rows && shown.length === 0 && !error && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No check-ins for these dates.</p>}
      <div className="space-y-2">
        {shown.map((r) => {
          const away = r.events.filter((e) => e.type === "left").length;
          const isOpen = open === r.id;
          return (
            <div key={r.id} className={`rounded-lg border bg-white p-4 ${r.atBuilding === false ? "border-red-300" : "border-slate-200"}`}>
              <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full items-start justify-between gap-3 text-left">
                <div className="min-w-0">
                  <p className="font-semibold">{r.staffName} <span className="text-xs font-normal text-muted-foreground">{r.position}{r.staffTenant === "default" ? " · FIAREP" : ""}</span></p>
                  <p className="text-sm">Tapped: <b>{r.building.address}</b></p>
                  <p className="text-sm"><MapPin className="mr-1 inline h-3.5 w-3.5" />Phone was at: <b>{r.phone.address}</b></p>
                  {r.atBuilding === true && <p className="text-sm font-semibold text-emerald-700">✓ At the building</p>}
                  {r.atBuilding === false && <p className="text-sm font-semibold text-red-700">⚠ Not at the building — {far(r.distanceM)} away</p>}
                  {r.atBuilding == null && <p className="text-xs text-muted-foreground">The building's location could not be found on the map.</p>}
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="font-semibold">{new Date(r.checkedInAt).toLocaleDateString()}</p>
                  <p>{time(r.checkedInAt)}–{r.checkedOutAt ? time(r.checkedOutAt) : "still in"}</p>
                  <p className="text-xs text-muted-foreground">{away === 0 ? "never left" : `left ${away}×`}</p>
                  <ChevronDown className={`ml-auto mt-1 h-4 w-4 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </button>
              {isOpen && (
                <ol className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
                  <li>🟢 {time(r.checkedInAt)} checked in — phone at {r.phone.address}{r.phone.accuracyM ? ` (±${Math.round(r.phone.accuracyM)} m)` : ""}</li>
                  {r.events.map((e, i) => (
                    <li key={i}>
                      {e.type === "left" && <>🚶 {time(e.at)} left the building{e.address ? ` — at ${e.address}` : ""}</>}
                      {e.type === "stop" && <>📍 {time(e.at)}–{time(e.until)} at <b>{e.address || "a stop"}</b> ({minutes(e.at, e.until)} min)</>}
                      {e.type === "back" && <>🏢 {time(e.at)} back at the building</>}
                    </li>
                  ))}
                  {r.checkedOutAt && <li>🔴 {time(r.checkedOutAt)} checked out{r.checkoutPhone?.address ? ` — phone at ${r.checkoutPhone.address}` : ""}</li>}
                </ol>
              )}
            </div>
          );
        })}
      </div>

      {/* Vendors are located once: when they check in for a scheduled walk-through. */}
      {vendors.length > 0 && (
        <div className="space-y-2 pt-4">
          <h2 className="text-lg font-bold">Vendor walk-throughs</h2>
          {vendors.map((v) => (
            <div key={v.id} className={`rounded-lg border bg-white p-4 text-sm ${v.onSite === false ? "border-red-300" : "border-slate-200"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{v.vendorName} <span className="text-xs font-normal text-muted-foreground">{v.trackingId}</span></p>
                  <p>Walk-through at: <b>{v.address}</b></p>
                  {v.onSite === true && <p className="font-semibold text-emerald-700">✓ At the building{v.distanceMeters != null ? ` (${far(v.distanceMeters)})` : ""}</p>}
                  {v.onSite === false && <p className="font-semibold text-red-700">⚠ Not at the building — {far(v.distanceMeters)} away</p>}
                  {v.onSite == null && <p className="text-xs text-muted-foreground">Location recorded; the building could not be found on the map.</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold">{new Date(v.capturedAt).toLocaleDateString()} · {time(v.capturedAt)}</p>
                  {v.walkthroughAt && <p className="text-xs text-muted-foreground">Scheduled {v.walkthroughAt}</p>}
                  {v.minutesFromSchedule != null && <p className="text-xs text-muted-foreground">{v.minutesFromSchedule > 0 ? `${v.minutesFromSchedule} min late` : `${Math.abs(v.minutesFromSchedule)} min early`}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
