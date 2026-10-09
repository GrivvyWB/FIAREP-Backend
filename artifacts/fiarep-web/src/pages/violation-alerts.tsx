import { useEffect, useState } from "react";
import { BellRing, Building2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

type Alert = { id: string; watchId: string; kind: string; date: string; address: string; borough: string; title: string; detail: string; foundAt: string };
type Watch = { id: string; address: string; borough: string; bbl: string; bin: string; lastCheckedAt: string | null };
const KIND_STYLE: Record<string, string> = { "HPD complaint": "bg-rose-600 text-white", "HPD violation": "bg-rose-100 text-rose-800", "DOB violation": "bg-amber-100 text-amber-900", "OATH / ECB summons": "bg-amber-500 text-slate-950", "311 call": "bg-sky-100 text-sky-900" };
const recent = (iso: string) => Date.now() - new Date(iso).getTime() < 48 * 3600 * 1000;

/** Client website → Violation Alerts (opt-in per organization). What the
 * City has recorded on the client's buildings since FIAREP started watching
 * them: 311 → HPD complaints, HPD violations, DOB violations, OATH / ECB
 * summonses and other 311 calls, checked every 30 minutes. Read-only; FIAREP
 * handles the work. */
export default function ViolationAlerts() {
  const [data, setData] = useState<{ buildings: Watch[]; alerts: Alert[] } | null>(null);
  const [error, setError] = useState("");
  const [building, setBuilding] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const r = await customFetch<{ buildings: Watch[]; alerts: Alert[] }>("/api/v1/violation-alerts", { responseType: "json" } as never); if (alive) { setData(r); setError(""); } }
      catch (err: any) { if (alive) setError(err?.data?.error || err?.message || "Could not load alerts"); }
    };
    void load(); const t = setInterval(() => void load(), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const alerts = (data?.alerts || []).filter((a) => !building || a.watchId === building);
  const fresh = alerts.filter((a) => recent(a.foundAt)).length;
  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-950"><BellRing className={`h-6 w-6 ${fresh ? "animate-pulse text-rose-600" : "text-slate-400"}`} />Violation alerts{fresh ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-sm font-bold text-white animate-pulse">{fresh} new</span> : null}</h1>
          <p className="text-sm text-slate-500">What the City has recorded on your buildings — 311 complaints to HPD (same day), HPD violations (about a day after the inspection), DOB violations and OATH / ECB summonses (about two days), and other 311 calls. FIAREP checks every 30 minutes and handles the work.</p>
        </div>
        {data && data.buildings.length > 1 && (
          <select value={building} onChange={(e) => setBuilding(e.target.value)} className="h-10 rounded-md border border-slate-300 px-2 text-sm text-slate-900">
            <option value="">All buildings ({data.buildings.length})</option>
            {data.buildings.map((b) => <option key={b.id} value={b.id}>{b.address}, {b.borough}</option>)}
          </select>
        )}
      </div>
      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
      {!data && !error && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading…</p>}
      {data && data.buildings.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No buildings are being watched for your organization yet. FIAREP adds them.</p>}
      {data && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className={`flex flex-wrap items-start gap-3 rounded-xl border p-3 shadow-sm ${recent(a.foundAt) ? "border-rose-400 bg-rose-50" : "border-slate-200 bg-white"}`}>
              {recent(a.foundAt) && <span className="mt-1.5 h-3 w-3 shrink-0 animate-pulse rounded-full bg-rose-600" aria-label="new" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[a.kind] || "bg-slate-100 text-slate-700"}`}>{a.kind}</span>
                  <span className="text-xs text-slate-500">{a.date}</span>
                  <span className="flex items-center gap-1 font-semibold text-slate-950"><Building2 className="h-4 w-4 text-slate-400" />{a.address}, {a.borough}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-600">{a.detail}</p>
              </div>
            </div>
          ))}
          {data.buildings.length > 0 && alerts.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Nothing new on your buildings.</p>}
        </div>
      )}
      {data && data.buildings.length > 0 && (
        <p className="text-xs text-slate-400">Watched: {data.buildings.map((b) => `${b.address}, ${b.borough}`).join(" · ")}. Source: NYC Open Data (HPD, DOB, OATH, 311).</p>
      )}
    </div>
  );
}
