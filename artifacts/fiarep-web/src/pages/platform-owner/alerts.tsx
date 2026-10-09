import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type Alert = { id: string; watchId: string; kind: string; key: string; date: string; address: string; borough: string; company: string; bbl: string; bin: string; title: string; detail: string; seen: boolean; foundAt: string };
type Watch = { id: string; address: string; borough: string; company: string; organizationId: string; bbl: string; bin: string; addedBy: string; addedAt: string; lastCheckedAt: string | null; lastError: string | null };
type Org = { id: string; name: string; features?: { modules?: Record<string, unknown> } | null };
const KIND_STYLE: Record<string, string> = { "HPD complaint": "bg-rose-600 text-white", "HPD violation": "bg-rose-100 text-rose-800", "DOB violation": "bg-amber-100 text-amber-900", "OATH / ECB summons": "bg-amber-500 text-slate-950", "311 call": "bg-sky-100 text-sky-900" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

/** Platform Control → Alerts: new complaints, violations and summonses on
 * every watched client building, pulled from NYC Open Data every 30 minutes.
 * Unseen alerts are red; the nav badge blinks until they are marked seen. */
export default function OwnerAlerts() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [watch, setWatch] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<"unseen" | "all">("unseen");
  const [add, setAdd] = useState({ address: "", borough: "", company: "", bbl: "", bin: "", organizationId: "" });
  const [orgs, setOrgs] = useState<Org[]>([]);

  async function load() {
    try {
      const [a, w, o] = await Promise.all([
        customFetch<Alert[]>("/api/v1/platform/alerts", { responseType: "json" } as never),
        customFetch<Watch[]>("/api/v1/platform/watch", { responseType: "json" } as never),
        customFetch<Org[]>("/api/v1/platform/organizations", { responseType: "json" } as never).catch(() => [] as Org[]),
      ]);
      setAlerts(a); setWatch(w); setOrgs(o.filter((x) => x.id !== "default"));
    } catch (err: any) { toast({ variant: "destructive", title: "Could not load alerts", description: err?.data?.error || err?.message }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkNow() {
    setChecking(true);
    try { const r = await customFetch<{ checked: number; added: number; errors: number }>("/api/v1/platform/alerts/check", { method: "POST", responseType: "json" } as never); toast({ title: `Checked ${r.checked} building${r.checked === 1 ? "" : "s"}`, description: `${r.added} new alert${r.added === 1 ? "" : "s"}${r.errors ? ` · ${r.errors} could not be checked` : ""}` }); await load(); }
    catch (err: any) { toast({ variant: "destructive", title: "Check failed", description: err?.data?.error || err?.message }); }
    finally { setChecking(false); }
  }
  async function seen(a: Alert) {
    setAlerts((rows) => rows.map((r) => (r.id === a.id ? { ...r, seen: true } : r)));
    try { await customFetch(`/api/v1/platform/alerts/${encodeURIComponent(a.id)}/seen`, { method: "POST", responseType: "json" } as never); } catch { /* reload will correct */ }
  }
  async function seenAll() {
    try { await customFetch("/api/v1/platform/alerts/seen-all", { method: "POST", responseType: "json" } as never); await load(); } catch (err: any) { toast({ variant: "destructive", title: "Could not mark seen", description: err?.data?.error || err?.message }); }
  }
  async function addWatch() {
    try {
      await customFetch("/api/v1/platform/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(add), responseType: "json" } as never);
      setAdd({ address: "", borough: "", company: "", bbl: "", bin: "", organizationId: "" }); toast({ title: "Watching", description: `${add.address} — checking the last two weeks now.` }); setTimeout(() => void load(), 4000); await load();
    } catch (err: any) { toast({ variant: "destructive", title: "Could not add", description: err?.data?.error || err?.message }); }
  }
  async function assign(w: Watch, organizationId: string) {
    const org = orgs.find((o) => o.id === organizationId);
    setWatch((rows) => rows.map((r) => (r.id === w.id ? { ...r, organizationId, company: org ? org.name : r.company } : r)));
    try { await customFetch(`/api/v1/platform/watch/${encodeURIComponent(w.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, company: org ? org.name : w.company }), responseType: "json" } as never); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not assign", description: err?.data?.error || err?.message }); await load(); }
  }
  const alertsOn = (o: Org | undefined) => !!o && o.features?.modules?.["violation-alerts"] === true;
  async function removeWatch(w: Watch) {
    if (!window.confirm(`Stop watching ${w.address}? Its alerts are removed too.`)) return;
    try { await customFetch(`/api/v1/platform/watch/${encodeURIComponent(w.id)}`, { method: "DELETE", responseType: "json" } as never); await load(); } catch (err: any) { toast({ variant: "destructive", title: "Could not remove", description: err?.data?.error || err?.message }); }
  }
  const open = (a: { address: string; borough: string }) => setLocation(`/platform-owner/building-lookup?address=${encodeURIComponent(`${a.address}, ${a.borough}`.trim())}`);

  const unseen = alerts.filter((a) => !a.seen);
  const shown = filter === "unseen" ? unseen : alerts;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Alerts — new on client buildings</h1>
          <p className="text-sm text-slate-500">Every watched building is checked against NYC Open Data every 30 minutes: HPD complaints (311 → HPD, same day), HPD violations (about a day after the inspection), DOB violations and OATH / ECB summonses (weekdays, about two days behind), and 311 calls to DOB, DEP, FDNY, DSNY, DOHMH.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
            <button type="button" onClick={() => setFilter("unseen")} className={`rounded-md px-3 py-1 ${filter === "unseen" ? "bg-rose-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>New ({unseen.length})</button>
            <button type="button" onClick={() => setFilter("all")} className={`rounded-md px-3 py-1 ${filter === "all" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>All ({alerts.length})</button>
          </div>
          <Button size="sm" variant="outline" onClick={() => void checkNow()} disabled={checking}>{checking ? "Checking…" : "Check now"}</Button>
          {unseen.length > 0 && <Button size="sm" variant="outline" onClick={() => void seenAll()}>Mark all seen</Button>}
        </div>
      </div>

      {loading && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading…</p>}
      {!loading && (
        <div className="space-y-2">
          {shown.map((a) => (
            <div key={a.id} className={`flex flex-wrap items-start gap-3 rounded-xl border p-3 shadow-sm ${a.seen ? "border-slate-200 bg-white" : "border-rose-400 bg-rose-50"}`}>
              {!a.seen && <span className="mt-1.5 h-3 w-3 shrink-0 animate-pulse rounded-full bg-rose-600" aria-label="new" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[a.kind] || "bg-slate-100 text-slate-700"}`}>{a.kind}</span>
                  <span className="text-xs text-slate-500">{a.date}</span>
                  <button type="button" onClick={() => open(a)} className="font-semibold text-slate-950 underline-offset-2 hover:underline">{a.address}, {a.borough}</button>
                  {a.company && <span className="text-xs text-slate-500">· {a.company}</span>}
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-600">{a.detail}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => open(a)}>Open building</Button>
                {!a.seen && <Button size="sm" onClick={() => void seen(a)}>Seen</Button>}
              </div>
            </div>
          ))}
          {shown.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">{filter === "unseen" ? "Nothing new on any watched building." : "No alerts yet."}</p>}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Watched buildings ({watch.length})</h2>
        <p className="text-xs text-slate-500">Client buildings FIAREP is responsible for. Add one here or with "Watch this building" on Building lookup. Assign each building to its client organization; the client sees those alerts on their own website only when Violation Alerts is switched on for them under Modules.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-6">
          <input value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} placeholder="Address" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" />
          <input value={add.borough} onChange={(e) => setAdd({ ...add, borough: e.target.value })} placeholder="Borough" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <input value={add.bbl} onChange={(e) => setAdd({ ...add, bbl: e.target.value })} placeholder="BBL (10 digits)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <input value={add.bin} onChange={(e) => setAdd({ ...add, bin: e.target.value })} placeholder="BIN" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <div className="flex gap-2"><select value={add.organizationId} onChange={(e) => { const o = orgs.find((x) => x.id === e.target.value); setAdd({ ...add, organizationId: e.target.value, company: o ? o.name : add.company }); }} className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"><option value="">Client organization…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select><Button size="sm" onClick={() => void addWatch()} disabled={!add.address.trim() || !/^\d{10}$/.test(add.bbl.trim())}>Watch</Button></div>
        </div>
        {watch.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Building</th><th className="py-1 pr-3">Client</th><th className="py-1 pr-3">BBL · BIN</th><th className="py-1 pr-3">Last checked</th><th className="py-1"></th></tr></thead>
            <tbody>
              {watch.map((w) => (
                <tr key={w.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3"><button type="button" onClick={() => open(w)} className="font-medium text-slate-900 hover:underline">{w.address}, {w.borough}</button></td>
                  <td className="py-1.5 pr-3 text-slate-700">
                    <select value={w.organizationId} onChange={(e) => void assign(w, e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm"><option value="">— FIAREP only —</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                    {w.organizationId && <span className={`block text-xs ${alertsOn(orgs.find((o) => o.id === w.organizationId)) ? "text-emerald-700" : "text-amber-700"}`}>{alertsOn(orgs.find((o) => o.id === w.organizationId)) ? "Client sees alerts (switch is ON)" : "Client cannot see yet — switch Violation Alerts ON under Modules"}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-slate-500">{w.bbl} · {w.bin || "—"}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-500">{when(w.lastCheckedAt)}{w.lastError ? <span className="block text-rose-600">{w.lastError}</span> : null}</td>
                  <td className="py-1.5 text-right"><Button size="sm" variant="outline" className="text-rose-700" onClick={() => void removeWatch(w)}>Stop watching</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
