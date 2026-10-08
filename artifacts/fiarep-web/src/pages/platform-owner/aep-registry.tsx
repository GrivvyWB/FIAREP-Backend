import { useEffect, useMemo, useState } from "react";
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
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
type Contact = { id: string; type: string; description: string; title: string; name: string; organization: string; address: string };
const TYPE_LABEL: Record<string, string> = {
  IndividualOwner: "Individual owner", CorporateOwner: "Corporate owner", HeadOfficer: "Head officer", Officer: "Officer", Shareholder: "Shareholder",
  Agent: "Managing agent", SiteManager: "Site manager", JointOwner: "Joint owner", Lessee: "Lessee",
};
const typeLabel = (t: string) => TYPE_LABEL[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2") || "Other contact";

/** Platform Control → AEP registry: buildings in HPD's Alternative Enforcement
 * Program right now, with the owners, agents and officers on their HPD
 * registration. FIAREP's prospect list. */
export default function OwnerAepRegistry() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AepBuilding[]>([]);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [borough, setBorough] = useState("");
  // Active = in AEP now · Discharged = came out · Likely next = meets HPD's selection criteria today
  const [mode, setMode] = useState<"active" | "discharged" | "likely">("active");
  const [likely, setLikely] = useState<{ rows: Candidate[]; since: string; cachedAt: string } | null>(null);
  const [likelyLoading, setLikelyLoading] = useState(false);
  async function loadLikely() {
    setMode("likely"); setSelected(null);
    if (likely) return;
    setLikelyLoading(true);
    try { setLikely(await customFetch<{ rows: Candidate[]; since: string; cachedAt: string }>("/api/v1/platform/aep/likely", { responseType: "json" } as never)); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not work out the likely list", description: err?.data?.error || err?.message }); }
    finally { setLikelyLoading(false); }
  }
  const [selected, setSelected] = useState<AepBuilding | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await customFetch<{ rows: AepBuilding[]; cachedAt: string | null }>("/api/v1/platform/aep/buildings", { responseType: "json" } as never);
        setRows(r.rows); setCachedAt(r.cachedAt);
      } catch (err: any) { toast({ variant: "destructive", title: "Could not load AEP buildings", description: err?.data?.error || err?.message }); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(b: AepBuilding) {
    setSelected(b); setContacts([]);
    if (!b.registrationId) return;
    setDetailLoading(true);
    try { setContacts(await customFetch<Contact[]>(`/api/v1/platform/aep/contacts/${encodeURIComponent(b.registrationId)}`, { responseType: "json" } as never)); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not load contacts", description: err?.data?.error || err?.message }); }
    finally { setDetailLoading(false); }
  }

  const boroughs = useMemo(() => [...new Set(rows.map((r) => r.borough).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const want = mode === "discharged" ? "AEP Discharged" : "AEP Active";
    return rows.filter((b) => b.status === want && (!borough || b.borough === borough) && (!q || b.address.toLowerCase().includes(q) || b.buildingId.includes(q) || b.zip.includes(q) || b.bbl.includes(q)));
  }, [rows, search, borough, mode]);
  const likelyRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (likely?.rows || []).filter((b) => (!borough || b.borough === borough) && (!q || b.address.toLowerCase().includes(q) || b.bbl.includes(q)));
  }, [likely, search, borough]);
  const activeCount = rows.filter((b) => b.status === "AEP Active").length;
  const dischargedCount = rows.length - activeCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">FIAREP — AEP Owner Registry</h1>
          <p className="text-sm text-slate-500">Buildings in HPD's Alternative Enforcement Program, their registered HPD contacts, and the buildings on track for the next round.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
            <button type="button" onClick={() => { setMode("active"); setSelected(null); }} className={`rounded-md px-3 py-1 ${mode === "active" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Active ({activeCount.toLocaleString()})</button>
            <button type="button" onClick={() => { setMode("discharged"); setSelected(null); }} className={`rounded-md px-3 py-1 ${mode === "discharged" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Discharged ({dischargedCount.toLocaleString()})</button>
            <button type="button" onClick={() => void loadLikely()} className={`rounded-md px-3 py-1 ${mode === "likely" ? "bg-amber-500 text-slate-950" : "text-amber-700 hover:bg-amber-50"}`}>Likely next AEP{likely ? ` (${likely.rows.length.toLocaleString()})` : ""}</button>
          </div>
          <Input className="w-72" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address, zip, BBL or HPD building ID" />
          <select value={borough} onChange={(e) => setBorough(e.target.value)} className="h-10 rounded-md border border-slate-300 px-2 text-sm text-slate-900">
            <option value="">All boroughs</option>
            {boroughs.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {loading && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading official NYC records…</p>}
      {!loading && mode !== "likely" && (
        <p className="text-sm text-slate-600">{filtered.length.toLocaleString()} {mode === "discharged" ? "discharged" : "active"} AEP building{filtered.length === 1 ? "" : "s"}{(mode === "discharged" ? dischargedCount : activeCount) !== filtered.length ? ` of ${(mode === "discharged" ? dischargedCount : activeCount).toLocaleString()}` : ""}{cachedAt ? ` · records as of ${new Date(cachedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</p>
      )}

      {selected && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{selected.address}, {selected.borough} {selected.zip}</h2>
              <p className="text-sm text-slate-600">{selected.units} units · BBL {selected.bbl || "—"} · BIN {selected.bin || "—"} · HPD building ID {selected.buildingId}</p>
              <p className="text-sm text-slate-600">In AEP since {selected.aepStart || "—"} ({selected.round}) · {selected.violationsAtStart.toLocaleString()} Class B / C violations at entry</p>
              <p className="text-xs text-slate-500">Registration {selected.registrationId || "not found"}{selected.registeredAt ? ` · registered ${selected.registeredAt}` : ""}{selected.registrationEnds ? ` · valid to ${selected.registrationEnds}` : ""}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSelected(null)}>Close</Button>
          </div>
          {detailLoading && <p className="mt-3 text-sm text-slate-500">Loading contacts…</p>}
          {!selected.registrationId && <p className="mt-3 text-sm text-slate-600">No matching HPD registration found. Verify the address and HPD building ID with the official records.</p>}
          {contacts.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Contact type</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Organization</th><th className="py-1">Business address</th></tr></thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-t border-amber-200 align-top">
                    <td className="py-1.5 pr-3 font-medium text-slate-900">{typeLabel(c.type)}{c.title ? <span className="block text-xs font-normal text-slate-500">{c.title}</span> : null}</td>
                    <td className="py-1.5 pr-3 text-slate-800">{c.name || "—"}</td>
                    <td className="py-1.5 pr-3 text-slate-800">{c.organization || "—"}</td>
                    <td className="py-1.5 text-slate-700">{c.address || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!detailLoading && selected.registrationId && contacts.length === 0 && <p className="mt-3 text-sm text-slate-600">No contacts were returned for this registration.</p>}
        </section>
      )}

      {mode === "likely" && (
        <section className="space-y-3">
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-950">Buildings that meet HPD's AEP selection criteria today — not yet in the program</p>
            <p className="mt-1">HPD picks 250 buildings every January 31. Criteria I: 15+ units with 3 or more open Class B / C violations per unit issued in the past five years and $2,500+ in HPD emergency-repair charges; 3–15 units with 5+ per unit and $5,000+ in charges. Criteria II (fills the round): 6+ units with 4+ per unit. Ranked by repair charges, as HPD ranks them.{likely ? ` Violations issued since ${likely.since}; computed ${new Date(likely.cachedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : ""}</p>
          </div>
          {likelyLoading && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Working through the City's open violations, unit counts and repair charges — this takes a minute the first time…</p>}
          {likely && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <p className="px-3 pt-3 text-sm text-slate-600">{likelyRows.length.toLocaleString()} building{likelyRows.length === 1 ? "" : "s"}{likely.rows.length !== likelyRows.length ? ` of ${likely.rows.length.toLocaleString()}` : ""}</p>
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">#</th><th className="px-3 py-2">Address</th><th className="px-3 py-2">Borough</th><th className="px-3 py-2 text-right">Units</th><th className="px-3 py-2 text-right">Open B / C (5 yrs)</th><th className="px-3 py-2 text-right">Per unit</th><th className="px-3 py-2 text-right">HPD repair charges (5 yrs)</th><th className="px-3 py-2">Criteria</th></tr></thead>
                <tbody>
                  {likelyRows.map((b, i) => (
                    <tr key={b.bbl} className={`border-t border-slate-100 ${i < 250 ? "" : "text-slate-500"}`}>
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{b.address}<span className="block text-xs font-normal text-slate-500">BBL {b.bbl}</span></td>
                      <td className="px-3 py-2">{b.borough || "—"}</td>
                      <td className="px-3 py-2 text-right">{b.units}</td>
                      <td className="px-3 py-2 text-right">{b.openBC.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-semibold">{b.ratio}</td>
                      <td className="px-3 py-2 text-right">{money(b.erpCharges)}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.criteria === "I" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>Criteria {b.criteria}</span></td>
                    </tr>
                  ))}
                  {likelyRows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No buildings match.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && mode !== "likely" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">Address</th><th className="px-3 py-2">Borough</th><th className="px-3 py-2 text-right">Units</th><th className="px-3 py-2">In AEP since</th>{mode === "discharged" && <th className="px-3 py-2">Discharged</th>}<th className="px-3 py-2 text-right">B / C at entry</th><th className="px-3 py-2">Registration</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.buildingId} className={`border-t border-slate-100 ${selected?.buildingId === b.buildingId ? "bg-amber-50" : "hover:bg-slate-50"}`}>
                  <td className="px-3 py-2 font-medium text-slate-900">{b.address}<span className="block text-xs font-normal text-slate-500">{b.zip} · BBL {b.bbl || "—"}</span></td>
                  <td className="px-3 py-2 text-slate-700">{b.borough || "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{b.units || "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{b.aepStart || "—"}<span className="block text-xs text-slate-500">{b.round}</span></td>{mode === "discharged" && <td className="px-3 py-2 text-slate-700">{b.dischargeDate || "—"}</td>}
                  <td className="px-3 py-2 text-right text-slate-700">{b.violationsAtStart.toLocaleString()}</td>
                  <td className="px-3 py-2 text-slate-700">{b.registrationId ? <span>{b.registeredAt || "on file"}</span> : <span className="text-rose-600">none</span>}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => void open(b)}>View contacts</Button></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No buildings match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400">Source: NYC HPD and NYC Open Data. Contact information reflects published registration records, not a guarantee of current ownership or legal title.</p>
    </div>
  );
}
