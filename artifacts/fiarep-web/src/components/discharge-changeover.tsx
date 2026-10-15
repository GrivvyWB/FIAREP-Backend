import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { bandFor, type Band } from "@/lib/pricing-ladder";

/** Platform Control → Pricing ladder: the City Violation Discharge Program
 * changeover, one row per client. Units (licensed, or the registered
 * buildings when none are set) pick the band; on the changeover date the
 * client is on that band's maintenance price automatically — nothing is
 * switched off. */
type Row = { id: string; name: string; status: string; units: number | null; unitsFrom: "licensed" | "buildings" | null; start: string | null; changeover: string | null; tier: "program" | "maintenance" | "none"; today: string };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const usDate = (d: string) => { const [y, m, day] = d.split("-"); return `${m}/${day}/${y}`; };
function plusFourMonths(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1 + 4, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day!, last));
  return t.toISOString().slice(0, 10);
}

export function DischargeChangeover({ bands }: { bands: Band[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<string, { start: string; changeover: string }>>({});
  const [state, setState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const load = () => customFetch<Row[]>("/api/v1/platform/discharge-program", { responseType: "json" } as never).then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, []);

  const value = (r: Row) => draft[r.id] ?? { start: r.start ?? "", changeover: r.changeover ?? "" };
  const setStart = (r: Row, start: string) => {
    const v = value(r);
    // The changeover follows the start (+ 4 months) until it is set to something else.
    const auto = !v.changeover || (v.start && v.changeover === plusFourMonths(v.start));
    setDraft({ ...draft, [r.id]: { start, changeover: auto && start ? plusFourMonths(start) : v.changeover } });
  };
  // Shut off for non-payment (suspends the client: signed out, no sign-in) or turn back on.
  const setService = async (r: Row, on: boolean) => {
    if (!on && !window.confirm(`Shut off ${r.name}? Everyone at ${r.name} is signed out and can't sign in until you turn it back on. Nothing is deleted.`)) return;
    try {
      await customFetch(`/api/v1/platform/discharge-program/${encodeURIComponent(r.id)}/service`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }), responseType: "json" } as never);
      void load();
    } catch { setState((s) => ({ ...s, [r.id]: "error" })); }
  };
  const save = async (r: Row) => {
    const v = value(r);
    setState({ ...state, [r.id]: "saving" });
    try {
      await customFetch(`/api/v1/platform/discharge-program/${encodeURIComponent(r.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: v.start || null, changeover: v.changeover || null }), responseType: "json" } as never);
      const next = { ...draft }; delete next[r.id]; setDraft(next);
      setState((s) => ({ ...s, [r.id]: "saved" }));
      void load();
    } catch { setState((s) => ({ ...s, [r.id]: "error" })); }
  };

  const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 align-middle";
  const dateCls = "rounded-md border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none";
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <p className="px-3 pt-3 text-sm font-semibold text-slate-900">City Violation Discharge Program — changeover</p>
      <p className="px-3 text-xs text-slate-500">Units come from the client's licensed units on the platform (or its registered buildings when none are set), so the band is picked for you. The changeover date fills in as the start + 4 months; change it to any date. On that date the client moves to the band's maintenance price on its own — nothing is switched off.</p>
      <table className="mt-2 w-full min-w-[980px] text-sm">
        <thead><tr className="bg-slate-50"><th className={th}>Client</th><th className={`${th} text-right`}>Units</th><th className={th}>Band</th><th className={th}>Program start</th><th className={th}>Changeover date</th><th className={th}>Now on</th><th className={th}>After changeover</th><th className={th}>Service</th><th className={th}></th></tr></thead>
        <tbody>
          {rows === null && <tr><td className={`${td} text-slate-500`} colSpan={9}>Loading…</td></tr>}
          {rows?.length === 0 && <tr><td className={`${td} text-slate-500`} colSpan={9}>No clients yet.</td></tr>}
          {rows?.map((r) => {
            const v = value(r);
            const band = r.units != null ? bandFor(r.units, bands) : null;
            const tier = !v.start && !v.changeover ? "none" : v.changeover && r.today >= v.changeover ? "maintenance" : "program";
            const maint = band && band.maintRate != null && r.units != null ? Math.max(r.units * band.maintRate, band.maintMin ?? 0) : null;
            const dirty = !!draft[r.id];
            return (
              <tr key={r.id} className="border-t border-slate-100">
                <td className={td}><span className="font-semibold text-slate-900">{r.name}</span> <span className="text-xs text-slate-500">· {r.id}</span></td>
                <td className={`${td} text-right`}>{r.units != null ? r.units.toLocaleString() : "—"}{r.unitsFrom === "buildings" && <span className="block text-[10px] text-slate-400">registered buildings</span>}</td>
                <td className={td}>{band ? band.label : "—"}</td>
                <td className={td}><input type="date" value={v.start} onChange={(e) => setStart(r, e.target.value)} className={dateCls} aria-label={`Program start ${r.name}`} /></td>
                <td className={td}><input type="date" value={v.changeover} onChange={(e) => setDraft({ ...draft, [r.id]: { ...v, changeover: e.target.value } })} className={dateCls} aria-label={`Changeover date ${r.name}`} /></td>
                <td className={td}>{tier === "none" ? <span className="text-slate-400">—</span> : tier === "maintenance"
                  ? <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Maintenance since {usDate(v.changeover)}</span>
                  : <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Discharge Program</span>}</td>
                <td className={td}>{maint != null ? <>Maintenance — {money(maint)}/mo</> : "Maintenance — rate not set yet"}</td>
                <td className={`${td} whitespace-nowrap`}>{r.id === "default" ? <span className="text-xs text-slate-400">FIAREP — always on</span> : (() => { const on = r.status !== "suspended"; return (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                    <button type="button" role="switch" aria-checked={on} aria-label={`Service for ${r.name}`} onClick={() => void setService(r, !on)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-red-500"}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${on ? "left-[18px]" : "left-0.5"}`} />
                    </button>
                    {on ? "On" : <span className="font-semibold text-red-700">Shut off — no payment</span>}
                  </label>); })()}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {state[r.id] === "saved" && !dirty && <span className="mr-2 text-xs text-emerald-700">Saved</span>}
                  {state[r.id] === "error" && <span className="mr-2 text-xs text-red-700">Could not save</span>}
                  <Button size="sm" className="bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={!dirty || state[r.id] === "saving"} onClick={() => void save(r)}>{state[r.id] === "saving" ? "Saving…" : "Save"}</Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
