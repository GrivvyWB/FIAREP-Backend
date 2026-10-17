// Site Check-Ins: for each member, the building they tapped in the app next to
// where their phone actually was at that moment, and every time they left the
// building, where they stopped and when they came back.
import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ChevronDown, Loader2, MapPin, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

/** Only the client whose building it is can delete a check-in - never the member who made it. */
function useCanDelete() {
  const { staff } = useAuth();
  return (r: Row) => !!staff && (staff.role === "administrator" || staff.role === "management")
    && (r.recordTenant || "") === (staff.tenantId || "default") && r.staffId !== staff.id;
}
async function deleteCheckin(id: string): Promise<boolean> {
  if (!window.confirm("Delete this check-in for good? It is removed from the record and the archive.")) return false;
  try { await customFetch(`/api/v1/site-checkins/${encodeURIComponent(id)}`, { method: "DELETE", responseType: "json" } as never); return true; }
  catch (e: any) { window.alert(e?.data?.error || "Could not delete."); return false; }
}
import { Input } from "@/components/ui/input";

type Ev = { type: "left" | "stop" | "back"; at: string; until?: string | null; address?: string };
type Row = {
  id: string; staffName: string; position: string; staffTenant: string;
  building: { address: string }; phone: { address: string; latitude: number; longitude: number; accuracyM: number | null };
  distanceM: number | null; atBuilding: boolean | null; checkedInAt: string; checkedOutAt: string; events: Ev[];
  checkoutPhone?: { address?: string } | null;
  visits?: Visit[];
  outOfNetwork?: boolean; requestedBy?: string; staffId?: string; recordTenant?: string;
};
type Visit = { id: string; unit: string; outcome: "access" | "refused"; at: string; photoUrl?: string; address?: string; distanceM: number | null; atBuilding: boolean | null; doorNumber: string | null; doorMatches: boolean | null };
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
  const [visitsOpen, setVisitsOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "archive">("live");
  const canDelete = useCanDelete();

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
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "live" ? "default" : "outline"} onClick={() => setTab("live")}>Check-ins</Button>
        <Button size="sm" variant={tab === "archive" ? "default" : "outline"} onClick={() => setTab("archive")}>Archive</Button>
      </div>
      {tab === "archive" ? <CheckinArchive /> : <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></label>
        <label className="text-xs text-muted-foreground">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></label>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a member or a building" className="h-9 flex-1 min-w-48" />
      </div>
      {rows && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{shown.length} check-in{shown.length === 1 ? "" : "s"}{flagged > 0 && <span className="ml-2 font-semibold text-red-700">· {flagged} not at the building they tapped</span>}</p>
        {shown.length > 0 && <Button size="sm" variant="outline" onClick={() => printCheckins(shown, `Site Check-Ins ${from} to ${to}`)}><Printer className="mr-1 h-4 w-4" />Print these</Button>}</div>}
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
                  <p className="text-sm">Tapped: <b>{r.building.address}</b>{r.outOfNetwork && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Out of network complaint{r.requestedBy ? ` · asked by ${r.requestedBy}` : ""}</span>}</p>
                  <p className="text-sm"><MapPin className="mr-1 inline h-3.5 w-3.5" />Phone was at: <b>{r.phone.address}</b></p>
                  {r.atBuilding === true && <p className="text-sm font-semibold text-emerald-700">✓ At the building</p>}
                  {r.atBuilding === false && <p className="text-sm font-semibold text-red-700">⚠ Not at the building — {far(r.distanceM)} away</p>}
                  {r.atBuilding == null && <p className="text-xs text-muted-foreground">The building's location could not be found on the map.</p>}
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="font-semibold">{new Date(r.checkedInAt).toLocaleDateString()}</p>
                  <p>{time(r.checkedInAt)}–{r.checkedOutAt ? time(r.checkedOutAt) : "still in"}</p>
                  <p className="text-xs text-muted-foreground">{away === 0 ? "never left" : `left ${away}×`}</p>
                  {(r.visits?.length || 0) > 0 && <p className="text-xs text-muted-foreground">{r.visits!.length} apartment{r.visits!.length === 1 ? "" : "s"} · {r.visits!.filter((v) => v.outcome === "refused").length} refused</p>}
                  <ChevronDown className={`ml-auto mt-1 h-4 w-4 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </button>
              {isOpen && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Button size="sm" onClick={() => printCheckins([r], `${r.building.address} · ${new Date(r.checkedInAt).toLocaleDateString()}`)}><Printer className="mr-1 h-4 w-4" />Print</Button>
                  {canDelete(r) && <Button size="sm" variant="outline" className="text-red-700" onClick={() => void deleteCheckin(r.id).then((ok) => { if (ok) setRows((x) => (x || []).filter((y) => y.id !== r.id)); })}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>}
                </div>
              )}
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
                  {(r.visits?.length || 0) > 0 && (
                    <li className="pt-2">
                      {/* Apartment visits sit in their own drop-down. */}
                      <button type="button" onClick={() => setVisitsOpen(visitsOpen === r.id ? null : r.id)} className="flex items-center gap-1 font-semibold text-[#185FA5]">
                        <ChevronDown className={`h-4 w-4 transition-transform ${visitsOpen === r.id ? "rotate-180" : ""}`} />
                        Apartment visits ({r.visits!.length}) · {r.visits!.filter((v) => v.outcome === "access").length} access gained, {r.visits!.filter((v) => v.outcome === "refused").length} refused
                      </button>
                      {visitsOpen === r.id && (
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          {r.visits!.map((v) => (
                            <div key={v.id} className="rounded-md border border-slate-200 p-2">
                              <p className={`font-semibold ${v.outcome === "access" ? "text-emerald-700" : "text-red-700"}`}>{time(v.at)} · Apt {v.unit} — {v.outcome === "access" ? "Access gained" : "Tenant refused access"}</p>
                              <p className="text-xs text-muted-foreground">
                                {v.atBuilding === true ? "✓ At the building" : v.atBuilding === false ? `⚠ ${far(v.distanceM)} from the building` : "Location recorded"}
                                {v.doorNumber ? (v.doorMatches ? ` · Door shows ${v.doorNumber} ✓` : ` · ⚠ Door shows ${v.doorNumber}`) : " · Door number not visible in the photo"}
                              </p>
                              {v.photoUrl && <img src={v.photoUrl} alt={`Door of apartment ${v.unit}`} className="mt-1 w-full rounded border border-slate-200" />}
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  )}
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
      </>}
    </div>
  );
}

// ── Archive: every closed check-in, by building, ready to print (e.g. for court) ──
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const stamp = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function printCheckins(list: Row[], title: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  const one = (r: Row) => `
    <section>
      <h2>${esc(r.building.address)}${r.outOfNetwork ? ' <span class="tag">Out of network complaint</span>' : ""}</h2>
      ${r.outOfNetwork && r.requestedBy ? `<p>Asked by: <b>${esc(r.requestedBy)}</b></p>` : ""}
      <table>
        <tr><th>Member</th><td>${esc(r.staffName)} · ${esc(r.position)}</td></tr>
        <tr><th>Checked in</th><td>${esc(stamp(r.checkedInAt))} — phone at ${esc(r.phone.address)}${r.phone.accuracyM ? ` (±${Math.round(r.phone.accuracyM)} m)` : ""}</td></tr>
        <tr><th>At the building</th><td>${r.atBuilding === true ? "Yes" : r.atBuilding === false ? `No — ${esc(far(r.distanceM))} away` : "Building location not found on the map"}</td></tr>
        <tr><th>Checked out</th><td>${esc(stamp(r.checkedOutAt))}${r.checkoutPhone?.address ? ` — phone at ${esc(r.checkoutPhone.address)}` : ""}</td></tr>
      </table>
      ${r.events.length ? `<h3>Movements</h3><ul>${r.events.map((e) => `<li>${e.type === "left" ? `${esc(stamp(e.at))} left the building${e.address ? ` — at ${esc(e.address)}` : ""}` : e.type === "stop" ? `${esc(stamp(e.at))}–${esc(time(e.until))} at ${esc(e.address || "a stop")} (${minutes(e.at, e.until)} min)` : `${esc(stamp(e.at))} back at the building`}</li>`).join("")}</ul>` : ""}
      ${(r.visits?.length || 0) ? `<h3>Apartment visits</h3>${r.visits!.map((v) => `
        <div class="visit"><p><b>${esc(stamp(v.at))} · Apt ${esc(v.unit)} — ${v.outcome === "access" ? "Access gained" : "Tenant refused access"}</b><br/>
        ${v.atBuilding === true ? "At the building" : v.atBuilding === false ? `${esc(far(v.distanceM))} from the building` : "Location recorded"}${v.address ? ` · phone at ${esc(v.address)}` : ""}${v.doorNumber ? ` · door shows ${esc(v.doorNumber)}${v.doorMatches ? " (matches)" : " (does not match)"}` : ""}</p>
        ${v.photoUrl ? `<img src="${esc(v.photoUrl)}"/>` : ""}</div>`).join("")}` : ""}
    </section>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:32px;color:#0f172a}h1{font-size:20px;margin:0}h2{font-size:16px;margin:24px 0 6px}h3{font-size:13px;margin:12px 0 4px}p{font-size:12px;margin:2px 0}.sub{color:#64748b;font-size:12px;margin-bottom:12px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #e2e8f0;padding:5px 7px;text-align:left;vertical-align:top}th{width:22%;background:#f8fafc}ul{font-size:12px;margin:0;padding-left:18px}.visit{border:1px solid #e2e8f0;border-radius:6px;padding:6px;margin:6px 0;page-break-inside:avoid}.visit img{max-width:260px;margin-top:4px;border:1px solid #e2e8f0}.tag{font-size:11px;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px}section{page-break-inside:avoid;border-top:2px solid #0f172a;padding-top:4px}</style></head><body><h1>FIAREP · Site Check-In record</h1><p class="sub">${esc(title)} · Printed ${esc(new Date().toLocaleString())} · Times are recorded by the FIAREP server; locations come from the member's phone.</p>${list.map(one).join("")}<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script></body></html>`);
  w.document.close();
}

export function CheckinArchive() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [openBldg, setOpenBldg] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const canDelete = useCanDelete();
  useEffect(() => {
    customFetch<Row[]>("/api/v1/site-checkins?archive=1", { responseType: "json" } as never).then(setRows).catch(() => setRows([]));
  }, []);
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const m = new Map<string, Row[]>();
    for (const r of rows || []) {
      if (t && !r.building.address.toLowerCase().includes(t) && !r.staffName.toLowerCase().includes(t)) continue;
      m.set(r.building.address, [...(m.get(r.building.address) || []), r]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, q]);
  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a building or a member" className="h-9" />
      {rows === null && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {rows && groups.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing in the archive yet. A check-in lands here once the member checks out.</p>}
      {groups.map(([address, list]) => (
        <div key={address} className="rounded-lg border border-slate-200 bg-white">
          <button type="button" onClick={() => setOpenBldg(openBldg === address ? null : address)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
            <span className="font-semibold">{address}{list.some((r) => r.outOfNetwork) && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Out of network</span>}</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">{list.length} visit{list.length === 1 ? "" : "s"}<ChevronDown className={`h-4 w-4 transition-transform ${openBldg === address ? "rotate-180" : ""}`} /></span>
          </button>
          {openBldg === address && (
            <div className="space-y-2 border-t border-slate-100 px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => printCheckins(list, address)}><Printer className="mr-1 h-4 w-4" />Print all for this building</Button>
              {list.map((r) => (
                <div key={r.id} className="rounded-md border border-slate-200">
                  <button type="button" onClick={() => setOpenRow(openRow === r.id ? null : r.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm">
                    <span><b>{new Date(r.checkedInAt).toLocaleDateString()}</b> · {time(r.checkedInAt)}–{time(r.checkedOutAt)} · {r.staffName}{r.atBuilding === false && <span className="ml-1 font-semibold text-red-700">· not at the building</span>}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${openRow === r.id ? "rotate-180" : ""}`} />
                  </button>
                  {openRow === r.id && (
                    <div className="space-y-1 border-t border-slate-100 px-3 py-2 text-sm">
                      {r.outOfNetwork && <p className="font-semibold text-amber-800">Out of network complaint{r.requestedBy ? ` · asked by ${r.requestedBy}` : ""}</p>}
                      <p>Phone at check-in: <b>{r.phone.address}</b>{r.atBuilding === true ? " · ✓ at the building" : r.atBuilding === false ? ` · ⚠ ${far(r.distanceM)} away` : ""}</p>
                      <p>Movements: {r.events.length === 0 ? "never left" : `${r.events.filter((e) => e.type === "left").length} time(s) left`}</p>
                      <p>Apartment visits: {r.visits?.length || 0}{(r.visits?.length || 0) > 0 ? ` · ${r.visits!.filter((v) => v.outcome === "refused").length} refused` : ""}</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => printCheckins([r], `${address} · ${new Date(r.checkedInAt).toLocaleDateString()}`)}><Printer className="mr-1 h-4 w-4" />Print</Button>
                        {canDelete(r) && <Button size="sm" variant="outline" className="text-red-700" onClick={() => void deleteCheckin(r.id).then((ok) => { if (ok) setRows((x) => (x || []).filter((y) => y.id !== r.id)); })}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
