import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Droplets, RefreshCw } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

// Mold Compliance (CV-MOLD-001): per building — original mold violations, Mold
// Removed, active remaining, % completed / % remaining, Inspection Recommended
// at 60% or less, and certification deadlines (Class B past its date risks Class C).
type Building = {
  bbl: string; address: string; original: number; active: number; removed: number; percentRemaining: number; percentCompleted: number; inspectionRecommended: boolean;
  awaiting: Array<{ id: string; apartment: string; class: string; description: string; certifyBy: string | null; source: string }>;
  removedList: Array<{ id: string; apartment: string; removedAt: string | null; removedBy: string | null; removedHow: string | null }>;
  deadlines: Array<{ id: string; apartment: string; class: string; certifyBy: string; daysLeft: number; overdue: boolean; escalationRisk: boolean }>;
};
type Data = { buildings: Building[]; threshold: number; lastSync: string | null };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US") : "");
const usDate = (d: string) => { const [y, m, dd] = d.split("-"); return `${m}/${dd}/${y}`; };

export default function MoldCompliance() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState({ address: "", apartment: "", class: "B", description: "" });
  const load = async () => {
    try { setData(await customFetch<Data>("/api/v1/mold/buildings", { responseType: "json" } as never)); setError(""); }
    catch (e: any) { setError(e?.data?.error || e?.message || "Could not load"); }
  };
  useEffect(() => { void load(); }, []);
  const refresh = async () => {
    setBusy(true);
    try { await customFetch("/api/v1/mold/sync", { method: "POST", responseType: "json" } as never); await load(); }
    catch (e: any) { setError(e?.data?.error || "HPD could not be reached"); }
    finally { setBusy(false); }
  };
  const addCase = async () => {
    setBusy(true);
    try { await customFetch("/api/v1/mold/cases", { method: "POST", responseType: "json", headers: { "Content-Type": "application/json" }, body: JSON.stringify(add) } as never); setAdd({ address: "", apartment: "", class: "B", description: "" }); await load(); }
    catch (e: any) { setError(e?.data?.error || "Could not add"); }
    finally { setBusy(false); }
  };
  const all = data?.buildings ?? [];
  const tot = all.reduce((a, b) => ({ original: a.original + b.original, active: a.active + b.active, removed: a.removed + b.removed, deadlines: a.deadlines + b.deadlines.length }), { original: 0, active: 0, removed: 0, deadlines: 0 });
  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-950"><Droplets className="h-6 w-6 text-sky-700" />Mold Compliance</h1>
          <p className="text-sm text-slate-500">Every apartment with an active mold violation — from HPD's open violations on your buildings, plus any added by hand. An apartment leaves the list when it's marked Mold Removed (after photo + resident sign-off) or HPD closes the violation. Inspection is recommended at {data?.threshold ?? 60}% remaining or less.{data?.lastSync ? ` Last HPD check ${new Date(data.lastSync).toLocaleString("en-US")}.` : ""}</p>
        </div>
        <Button onClick={() => void refresh()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />Check HPD now</Button>
      </div>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Active mold violations", tot.active], ["Mold Removed", tot.removed], ["% completed", tot.original ? `${Math.round((tot.removed / tot.original) * 1000) / 10}%` : "—"], ["Near / past deadline", tot.deadlines]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</p><p className="mt-1 text-2xl font-bold text-slate-950">{v}</p></div>
        ))}
      </div>
      {data && !all.length && <p className="text-sm text-slate-500">No mold violations on record for your buildings.</p>}
      {all.map((b) => (
        <div key={b.bbl} className="rounded-xl border border-slate-200 bg-white">
          <button type="button" onClick={() => setOpen(open === b.bbl ? null : b.bbl)} className="flex w-full flex-wrap items-center gap-4 p-4 text-left">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-950">{b.address}</p>
              <p className="text-sm text-slate-500">Original {b.original} · Removed {b.removed} · Active {b.active}</p>
            </div>
            <div className="w-56">
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-600" style={{ width: `${b.percentCompleted}%` }} /></div>
              <p className="mt-1 text-xs text-slate-600">{b.percentCompleted}% completed · {b.percentRemaining}% remaining</p>
            </div>
            {b.inspectionRecommended
              ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white"><CheckCircle2 className="h-3.5 w-3.5" />Inspection Recommended</span>
              : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Remediation in progress</span>}
            {b.deadlines.some((d) => d.escalationRisk) && <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white"><AlertTriangle className="h-3.5 w-3.5" />Class C risk</span>}
          </button>
          {open === b.bbl && (
            <div className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-3">
              {b.inspectionRecommended && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 md:col-span-3">
                  <b>Inspection Recommended.</b> Original mold violations: {b.original} · Resolved: {b.removed} · Active remaining: {b.active} · Mold exposure level: {b.percentRemaining}%. Schedule an inspection — mold conditions have been reduced to the target threshold and may be ready for verification. You can keep remediating and schedule it any time.
                </div>
              )}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Awaiting remediation ({b.awaiting.length})</h3>
                <ul className="space-y-1 text-sm">{b.awaiting.map((c) => <li key={c.id}><b>Apt {c.apartment}</b>{c.class ? ` · Class ${c.class}` : ""}{c.certifyBy ? ` · certify by ${usDate(c.certifyBy)}` : ""}{c.source === "manual" ? " · added by hand" : ""}</li>)}</ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Mold Removed ({b.removedList.length})</h3>
                <ul className="space-y-1 text-sm">{b.removedList.map((c) => <li key={c.id}><b>Apt {c.apartment}</b> · {c.removedHow === "Closed by HPD" ? "closed by HPD" : `by ${c.removedBy}`} · {when(c.removedAt)}</li>)}</ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Certification deadlines</h3>
                {!b.deadlines.length && <p className="text-sm text-slate-500">None in the next 14 days.</p>}
                <ul className="space-y-1 text-sm">{b.deadlines.map((d) => (
                  <li key={d.id} className={d.overdue ? "text-rose-700" : "text-amber-800"}><b>Apt {d.apartment}</b>{d.class ? ` · Class ${d.class}` : ""} · {usDate(d.certifyBy)} · {d.overdue ? `${-d.daysLeft} days past` : `${d.daysLeft} days left`}{d.escalationRisk ? " — risk of Class C on reinspection" : ""}</li>
                ))}</ul>
              </div>
            </div>
          )}
        </div>
      ))}
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Add a mold condition by hand</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_auto_2fr_auto]">
          <input className="h-9 rounded-md border border-slate-300 px-2 text-sm" placeholder="Building address" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} />
          <input className="h-9 rounded-md border border-slate-300 px-2 text-sm" placeholder="Apartment" value={add.apartment} onChange={(e) => setAdd({ ...add, apartment: e.target.value })} />
          <select className="h-9 rounded-md border border-slate-300 px-2 text-sm" value={add.class} onChange={(e) => setAdd({ ...add, class: e.target.value })}><option value="A">Class A</option><option value="B">Class B</option><option value="C">Class C</option></select>
          <input className="h-9 rounded-md border border-slate-300 px-2 text-sm" placeholder="Where / what (e.g. bathroom ceiling)" value={add.description} onChange={(e) => setAdd({ ...add, description: e.target.value })} />
          <Button onClick={() => void addCase()} disabled={busy || !add.address.trim() || !add.apartment.trim()}>Add</Button>
        </div>
      </details>
    </div>
  );
}
