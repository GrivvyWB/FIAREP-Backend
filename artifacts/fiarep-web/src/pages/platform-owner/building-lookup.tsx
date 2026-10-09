import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { DofLookupPanel, type DofLookup } from "@/components/dof-lookup";

type Contact = { id: string; type: string; description: string; title: string; name: string; organization: string; address: string };
type ContactInfo = { registrationId: string | null; registeredAt: string | null; registrationEnds: string | null; contacts: Contact[] };
const TYPE_LABEL: Record<string, string> = {
  IndividualOwner: "Individual owner", CorporateOwner: "Corporate owner", HeadOfficer: "Head officer", Officer: "Officer", Shareholder: "Shareholder",
  Agent: "Managing agent", SiteManager: "Site manager", JointOwner: "Joint owner", Lessee: "Lessee",
};
const typeLabel = (t: string) => TYPE_LABEL[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2") || "Other contact";
type AepLines = { units: number | string; buildingId: string; aepStart: string | null; round: string; violationsAtStart: number; status: string; dischargeDate: string | null };
type PortfolioRow = { registrationId: string; buildingId: string; address: string; borough: string; zip: string; bbl: string; bin: string; hpdA: number; hpdB: number; hpdC: number; via: string[]; aep: AepLines | null };

/** Platform Control → Building lookup: the same Department of Finance / OATH /
 * HPD / DOB lookup clients use on the join page, for FIAREP's own use, plus the
 * owners, officers and agents on the building's HPD registration. Opened from
 * the AEP registry with ?address=…, it runs the lookup on arrival. No submit
 * form — this is FIAREP looking, not a client asking. */
export default function OwnerBuildingLookup() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const initialAddress = query.get("address") || "";
  // AEP record the registry sent along (only when opened from there)
  const aep = useMemo(() => {
    const g = (k: string) => query.get(k) || "";
    return g("buildingId") ? { units: g("units"), bbl: g("bbl"), bin: g("bin"), buildingId: g("buildingId"), aepStart: g("aepStart"), round: g("round"), violationsAtStart: Number(g("violationsAtStart")) || 0, status: g("status"), dischargeDate: g("dischargeDate") } : null;
  }, [query]);
  const [bbl, setBbl] = useState("");
  const [info, setInfo] = useState<ContactInfo | null>(null);
  const [loading, setLoading] = useState(false);
  // Other buildings whose HPD registration names the same owner / manager
  const [portfolio, setPortfolio] = useState<{ names: string[]; rows: PortfolioRow[] } | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  useEffect(() => {
    setPortfolio(null);
    if (!info?.registrationId) return;
    let alive = true;
    setPortfolioLoading(true);
    customFetch<{ names: string[]; rows: PortfolioRow[] }>(`/api/v1/platform/aep/portfolio/${encodeURIComponent(info.registrationId)}`, { responseType: "json" } as never)
      .then((r) => { if (alive) setPortfolio(r); })
      .catch(() => { if (alive) setPortfolio({ names: [], rows: [] }); })
      .finally(() => { if (alive) setPortfolioLoading(false); });
    return () => { alive = false; };
  }, [info?.registrationId]);
  function openPortfolio(r: PortfolioRow) {
    const p = new URLSearchParams({ address: `${r.address}, ${r.borough} ${r.zip}`.trim() });
    if (r.aep) { p.set("units", String(r.aep.units)); p.set("bbl", r.bbl); p.set("bin", r.bin); p.set("buildingId", r.aep.buildingId); p.set("aepStart", r.aep.aepStart || ""); p.set("round", r.aep.round); p.set("violationsAtStart", String(r.aep.violationsAtStart)); p.set("status", r.aep.status); p.set("dischargeDate", r.aep.dischargeDate || ""); }
    setLocation(`/platform-owner/building-lookup?${p.toString()}`);
  }
  useEffect(() => {
    if (!bbl) { setInfo(null); return; }
    let alive = true;
    setLoading(true);
    customFetch<ContactInfo>(`/api/v1/platform/aep/contacts-by-bbl/${bbl}`, { responseType: "json" } as never)
      .then((r) => { if (alive) setInfo(r); })
      .catch(() => { if (alive) setInfo({ registrationId: null, registeredAt: null, registrationEnds: null, contacts: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [bbl]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">Building lookup</h1>
        <p className="text-sm text-slate-500">What a building owes the City and what is open on it — OATH / ECB summonses, HPD emergency-repair charges, property tax, HPD / DOB violations by type, and who is on the HPD registration.</p>
      </div>
      <div className="rounded-2xl bg-slate-950 p-4 text-slate-100">
        <DofLookupPanel onResult={(_t, r: DofLookup | null) => setBbl(r?.property.bbl && /^\d{10}$/.test(r.property.bbl) ? r.property.bbl : "")} canSubmit={false} persistKey="fiarep_owner_building_lookup" initialAddress={initialAddress} />
      </div>
      {bbl && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">HPD registration — owners, officers and agents</h2>
          {aep && aep.bbl === bbl && (
            <>
              <p className="text-sm text-slate-600">{aep.units} units · BBL {aep.bbl} · BIN {aep.bin || "—"} · HPD building ID {aep.buildingId}</p>
              <p className="text-sm text-slate-600">{aep.status === "AEP Discharged" ? `In AEP ${aep.aepStart || "—"} to ${aep.dischargeDate || "—"}` : `In AEP since ${aep.aepStart || "—"}`} ({aep.round}) · {aep.violationsAtStart.toLocaleString()} Class B / C violations at entry</p>
            </>
          )}
          {loading && <p className="mt-1 text-sm text-slate-500">Loading contacts…</p>}
          {info && <p className="text-xs text-slate-500">Registration {info.registrationId || "not found"}{info.registeredAt ? ` · registered ${info.registeredAt}` : ""}{info.registrationEnds ? ` · valid to ${info.registrationEnds}` : ""}</p>}
          {info && !info.registrationId && <p className="mt-3 text-sm text-slate-600">No HPD registration on file for this building.</p>}
          {info && info.contacts.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Contact type</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Organization</th><th className="py-1">Business address</th></tr></thead>
              <tbody>
                {info.contacts.map((c) => (
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
          {info && info.registrationId && info.contacts.length === 0 && <p className="mt-3 text-sm text-slate-600">No contacts were returned for this registration.</p>}
          <p className="mt-2 text-xs text-slate-500">HPD's public registration file lists names, corporations and business addresses only; it does not include phone numbers.</p>
          {info?.registrationId && (
            <div className="mt-4 border-t border-amber-200 pt-3">
              <p className="text-sm font-semibold text-slate-900">Other buildings this owner / manager runs</p>
              {portfolioLoading && <p className="text-xs text-slate-500">Searching HPD registrations for the same names…</p>}
              {portfolio && portfolio.rows.length === 0 && !portfolioLoading && <p className="text-xs text-slate-500">No other registrations name these people or corporations.</p>}
              {portfolio && portfolio.rows.length > 0 && (
                <>
                  <p className="text-xs text-slate-500">{portfolio.rows.length} building{portfolio.rows.length === 1 ? "" : "s"} registered to {portfolio.names.join(", ")}. Pick one to open it here.</p>
                  <select defaultValue="" onChange={(e) => { const r = portfolio.rows[Number(e.target.value)]; if (r) openPortfolio(r); }} className="mt-2 h-10 w-full max-w-3xl rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900">
                    <option value="">Choose a building…</option>
                    {portfolio.rows.map((r, i) => (
                      <option key={r.registrationId} value={i}>{r.address}, {r.borough} {r.zip} · {r.hpdA + r.hpdB + r.hpdC} open HPD ({r.hpdB} B · {r.hpdC} C){r.aep?.status === "AEP Active" ? " · IN AEP" : ""} · {r.via[0] || ""}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
