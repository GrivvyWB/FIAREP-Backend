import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type AepBuilding = {
  buildingId: string; address: string; borough: string; zip: string; units: number; bbl: string; bin: string;
  aepStart: string | null; violationsAtStart: number; round: string; status: string; dischargeDate: string | null;
  registrationId: string | null; registeredAt: string | null; registrationEnds: string | null;
};
type Candidate = { bbl: string; address: string; borough: string; units: number; openBC: number; ratio: number; erpCharges: number; criteria: "I" | "II"; inAep: boolean };
type Mode = "active" | "discharged" | "likely";
type Saved = { id: string; name: string; mode: Mode; search: string; borough: string; count: number; rows: (AepBuilding | Candidate)[]; savedAt: string };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const MODE_LABEL: Record<Mode, string> = { active: "Active AEP", discharged: "Discharged", likely: "Likely next AEP" };
// View contacts opens the Building lookup page with the address already run:
// what the building owes, what is open, and who is on the HPD registration.
const lookupPath = (address: string) => `/platform-owner/building-lookup?address=${encodeURIComponent(address)}`;

/** Platform Control → AEP registry: buildings in HPD's Alternative Enforcement
 * Program (active and discharged), the buildings that meet HPD's criteria for
 * the next round, and the owners, agents and officers on each building's HPD
 * registration (via Building lookup). Any list on screen can be saved by name
 * and reopened from the drop-down without going back to NYC Open Data. */
export default function OwnerAepRegistry() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [rows, setRows] = useState<AepBuilding[]>([]);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [borough, setBorough] = useState("");
  // Active = in AEP now · Discharged = came out · Likely = meets HPD's selection criteria today
  const [mode, setMode] = useState<Mode>("active");
  const [likely, setLikely] = useState<{ rows: Candidate[]; since: string; cachedAt: string } | null>(null);
  const [likelyLoading, setLikelyLoading] = useState(false);
  // Saved searches (stored on the server, Platform Control only)
  const [saved, setSaved] = useState<Saved[]>([]);
  const [openSaved, setOpenSaved] = useState<Saved | null>(null);
  const [naming, setNaming] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await customFetch<{ rows: AepBuilding[]; cachedAt: string | null }>("/api/v1/platform/aep/buildings", { responseType: "json" } as never);
        setRows(r.rows); setCachedAt(r.cachedAt);
      } catch (err: any) { toast({ variant: "destructive", title: "Could not load AEP buildings", description: err?.data?.error || err?.message }); }
      finally { setLoading(false); }
      try { setSaved(await customFetch<Saved[]>("/api/v1/platform/aep/saved", { responseType: "json" } as never)); } catch { /* list stays empty */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadLikely() {
    setMode("likely"); setOpenSaved(null);
    if (likely) return;
    setLikelyLoading(true);
    try { setLikely(await customFetch<{ rows: Candidate[]; since: string; cachedAt: string }>("/api/v1/platform/aep/likely", { responseType: "json" } as never)); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not work out the likely list", description: err?.data?.error || err?.message }); }
    finally { setLikelyLoading(false); }
  }
  function switchMode(m: Mode) { setMode(m); setOpenSaved(null); }

  const openBuilding = (b: AepBuilding) => setLocation(lookupPath(`${b.address}, ${b.borough} ${b.zip}`.trim()));
  const openCandidate = (c: Candidate) => setLocation(lookupPath(`${c.address}, ${c.borough}`));

  const boroughs = useMemo(() => [...new Set(rows.map((r) => r.borough).filter(Boolean))].sort(), [rows]);
  const q = search.trim().toLowerCase();
  const viewMode: Mode = openSaved ? openSaved.mode : mode;
  const buildingRows = useMemo(() => {
    const source = openSaved ? (openSaved.rows as AepBuilding[]) : rows.filter((b) => b.status === (mode === "discharged" ? "AEP Discharged" : "AEP Active"));
    return source.filter((b) => (!borough || b.borough === borough) && (!q || b.address.toLowerCase().includes(q) || b.buildingId.includes(q) || b.zip.includes(q) || b.bbl.includes(q)));
  }, [rows, openSaved, mode, q, borough]);
  const likelyRows = useMemo(() => {
    const source = openSaved ? (openSaved.rows as Candidate[]) : likely?.rows || [];
    return source.filter((b) => (!borough || b.borough === borough) && (!q || b.address.toLowerCase().includes(q) || b.bbl.includes(q)));
  }, [likely, openSaved, q, borough]);
  const activeCount = rows.filter((b) => b.status === "AEP Active").length;
  const dischargedCount = rows.length - activeCount;
  const shownRows: (AepBuilding | Candidate)[] = viewMode === "likely" ? likelyRows : buildingRows;

  function startSave() {
    const scope = [search.trim(), borough].filter(Boolean).join(" · ") || "all";
    setSaveName(`${MODE_LABEL[viewMode]} — ${scope} — ${new Date().toLocaleDateString()}`);
    setNaming(true);
  }
  async function saveList() {
    const name = saveName.trim();
    if (!name || shownRows.length === 0) return;
    setSaving(true);
    try {
      const s = await customFetch<Saved>("/api/v1/platform/aep/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mode: viewMode, search: search.trim(), borough, rows: shownRows }), responseType: "json" } as never);
      setSaved((list) => [s, ...list]); setNaming(false);
      toast({ title: "Saved", description: `${name} · ${shownRows.length.toLocaleString()} buildings` });
    } catch (err: any) { toast({ variant: "destructive", title: "Could not save", description: err?.data?.error || err?.message }); }
    finally { setSaving(false); }
  }
  function openSavedSearch(id: string) {
    const s = saved.find((x) => x.id === id);
    if (!s) return;
    setOpenSaved(s); setSearch(""); setBorough("");
  }
  async function deleteSaved(s: Saved) {
    if (!window.confirm(`Delete the saved search "${s.name}"?`)) return;
    try {
      await customFetch(`/api/v1/platform/aep/saved/${encodeURIComponent(s.id)}`, { method: "DELETE", responseType: "json" } as never);
      setSaved((list) => list.filter((x) => x.id !== s.id)); setOpenSaved(null);
    } catch (err: any) { toast({ variant: "destructive", title: "Could not delete", description: err?.data?.error || err?.message }); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">FIAREP — AEP Owner Registry</h1>
          <p className="text-sm text-slate-500">Buildings in HPD's Alternative Enforcement Program, their registered HPD contacts, and the buildings on track for the next round.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
            <button type="button" onClick={() => switchMode("active")} className={`rounded-md px-3 py-1 ${!openSaved && mode === "active" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Active ({activeCount.toLocaleString()})</button>
            <button type="button" onClick={() => switchMode("discharged")} className={`rounded-md px-3 py-1 ${!openSaved && mode === "discharged" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Discharged ({dischargedCount.toLocaleString()})</button>
            <button type="button" onClick={() => void loadLikely()} className={`rounded-md px-3 py-1 ${!openSaved && mode === "likely" ? "bg-amber-500 text-slate-950" : "text-amber-700 hover:bg-amber-50"}`}>Likely next AEP{likely ? ` (${likely.rows.length.toLocaleString()})` : ""}</button>
          </div>
          <Input className="w-72" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address, zip, BBL or HPD building ID" />
          <select value={borough} onChange={(e) => setBorough(e.target.value)} className="h-10 rounded-md border border-slate-300 px-2 text-sm text-slate-900">
            <option value="">All boroughs</option>
            {boroughs.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {/* Save the list on screen · reopen a saved one */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
        {!naming ? (
          <Button size="sm" onClick={startSave} disabled={shownRows.length === 0}>Save this list</Button>
        ) : (
          <>
            <Input className="h-9 w-96" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveList(); }} placeholder="Name this search" autoFocus />
            <Button size="sm" onClick={() => void saveList()} disabled={saving || !saveName.trim()}>{saving ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="outline" onClick={() => setNaming(false)}>Cancel</Button>
          </>
        )}
        <span className="text-slate-500">{shownRows.length.toLocaleString()} building{shownRows.length === 1 ? "" : "s"} on screen</span>
        <span className="mx-1 text-slate-300">|</span>
        <select value={openSaved?.id || ""} onChange={(e) => { if (e.target.value) openSavedSearch(e.target.value); else { setOpenSaved(null); } }} className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900">
          <option value="">Saved searches{saved.length ? ` (${saved.length})` : " — none yet"}</option>
          {saved.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.count.toLocaleString()} · {when(s.savedAt)}</option>)}
        </select>
        {openSaved && (
          <>
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">Saved {MODE_LABEL[openSaved.mode]} · {when(openSaved.savedAt)}</span>
            <Button size="sm" variant="outline" onClick={() => { setOpenSaved(null); }}>Back to live</Button>
            <Button size="sm" variant="outline" className="text-rose-700" onClick={() => void deleteSaved(openSaved)}>Delete saved</Button>
          </>
        )}
      </div>

      {loading && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading official NYC records…</p>}
      {!loading && viewMode !== "likely" && !openSaved && (
        <p className="text-sm text-slate-600">{buildingRows.length.toLocaleString()} {mode === "discharged" ? "discharged" : "active"} AEP building{buildingRows.length === 1 ? "" : "s"}{(mode === "discharged" ? dischargedCount : activeCount) !== buildingRows.length ? ` of ${(mode === "discharged" ? dischargedCount : activeCount).toLocaleString()}` : ""}{cachedAt ? ` · records as of ${when(cachedAt)}` : ""}</p>
      )}


      {viewMode === "likely" && (
        <section className="space-y-3">
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-950">Buildings that meet HPD's AEP selection criteria today — not yet in the program</p>
            <p className="mt-1">HPD picks 250 buildings every January 31. Criteria I: 15+ units with 3 or more open Class B / C violations per unit issued in the past five years and $2,500+ in HPD emergency-repair charges; 3–15 units with 5+ per unit and $5,000+ in charges. Criteria II (fills the round): 6+ units with 4+ per unit. Ranked by repair charges, as HPD ranks them.{!openSaved && likely ? ` Violations issued since ${likely.since}; computed ${when(likely.cachedAt)}.` : ""}</p>
          </div>
          {likelyLoading && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Working through the City's open violations, unit counts and repair charges — this takes a minute the first time…</p>}
          {(openSaved || likely) && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <p className="px-3 pt-3 text-sm text-slate-600">{likelyRows.length.toLocaleString()} building{likelyRows.length === 1 ? "" : "s"}</p>
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">#</th><th className="px-3 py-2">Address</th><th className="px-3 py-2">Borough</th><th className="px-3 py-2 text-right">Units</th><th className="px-3 py-2 text-right">Open B / C (5 yrs)</th><th className="px-3 py-2 text-right">Per unit</th><th className="px-3 py-2 text-right">HPD repair charges (5 yrs)</th><th className="px-3 py-2">Criteria</th><th className="px-3 py-2"></th></tr></thead>
                <tbody>
                  {likelyRows.map((b, i) => (
                    <tr key={b.bbl} className={`border-t border-slate-100 hover:bg-slate-50 ${i < 250 ? "" : "text-slate-500"}`}>
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{b.address}<span className="block text-xs font-normal text-slate-500">BBL {b.bbl}</span></td>
                      <td className="px-3 py-2">{b.borough || "—"}</td>
                      <td className="px-3 py-2 text-right">{b.units}</td>
                      <td className="px-3 py-2 text-right">{b.openBC.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-semibold">{b.ratio}</td>
                      <td className="px-3 py-2 text-right">{money(b.erpCharges)}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.criteria === "I" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>Criteria {b.criteria}</span></td>
                      <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => openCandidate(b)}>View contacts</Button></td>
                    </tr>
                  ))}
                  {likelyRows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">No buildings match.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && viewMode !== "likely" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          {openSaved && <p className="px-3 pt-3 text-sm text-slate-600">{buildingRows.length.toLocaleString()} building{buildingRows.length === 1 ? "" : "s"}</p>}
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">Address</th><th className="px-3 py-2">Borough</th><th className="px-3 py-2 text-right">Units</th><th className="px-3 py-2">In AEP since</th>{viewMode === "discharged" && <th className="px-3 py-2">Discharged</th>}<th className="px-3 py-2 text-right">B / C at entry</th><th className="px-3 py-2">Registration</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {buildingRows.map((b) => (
                <tr key={b.buildingId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-900">{b.address}<span className="block text-xs font-normal text-slate-500">{b.zip} · BBL {b.bbl || "—"}</span></td>
                  <td className="px-3 py-2 text-slate-700">{b.borough || "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{b.units || "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{b.aepStart || "—"}<span className="block text-xs text-slate-500">{b.round}</span></td>{viewMode === "discharged" && <td className="px-3 py-2 text-slate-700">{b.dischargeDate || "—"}</td>}
                  <td className="px-3 py-2 text-right text-slate-700">{b.violationsAtStart.toLocaleString()}</td>
                  <td className="px-3 py-2 text-slate-700">{b.registrationId ? <span>{b.registeredAt || "on file"}</span> : <span className="text-rose-600">none</span>}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => openBuilding(b)}>View contacts</Button></td>
                </tr>
              ))}
              {buildingRows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No buildings match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400">Source: NYC HPD and NYC Open Data. Contact information reflects published registration records, not a guarantee of current ownership or legal title.</p>
    </div>
  );
}
