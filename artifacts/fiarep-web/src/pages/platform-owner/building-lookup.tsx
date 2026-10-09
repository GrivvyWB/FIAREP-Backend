import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { DofLookupPanel, type DofLookup } from "@/components/dof-lookup";

type Contact = { id: string; type: string; description: string; title: string; name: string; organization: string; address: string };
type ContactInfo = { registrationId: string | null; registeredAt: string | null; registrationEnds: string | null; contacts: Contact[] };
const TYPE_LABEL: Record<string, string> = {
  IndividualOwner: "Individual owner", CorporateOwner: "Corporate owner", HeadOfficer: "Head officer", Officer: "Officer", Shareholder: "Shareholder",
  Agent: "Managing agent", SiteManager: "Site manager", JointOwner: "Joint owner", Lessee: "Lessee",
};
const typeLabel = (t: string) => TYPE_LABEL[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2") || "Other contact";

/** Platform Control → Building lookup: the same Department of Finance / OATH /
 * HPD / DOB lookup clients use on the join page, for FIAREP's own use, plus the
 * owners, officers and agents on the building's HPD registration. Opened from
 * the AEP registry with ?address=…, it runs the lookup on arrival. No submit
 * form — this is FIAREP looking, not a client asking. */
export default function OwnerBuildingLookup() {
  const initialAddress = useMemo(() => new URLSearchParams(window.location.search).get("address") || "", []);
  const [bbl, setBbl] = useState("");
  const [info, setInfo] = useState<ContactInfo | null>(null);
  const [loading, setLoading] = useState(false);
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
        </section>
      )}
    </div>
  );
}
