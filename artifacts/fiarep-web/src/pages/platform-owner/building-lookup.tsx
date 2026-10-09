import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { DofLookupPanel, type DofLookup } from "@/components/dof-lookup";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { BRAND } from "@/lib/contract";
import { buildDismissalHtml, dismissalFee, type DismissalInput } from "@/lib/dismissal";

type Contact = { id: string; type: string; description: string; title: string; name: string; organization: string; address: string };
type ContactInfo = { registrationId: string | null; registeredAt: string | null; registrationEnds: string | null; contacts: Contact[] };
const TYPE_LABEL: Record<string, string> = {
  IndividualOwner: "Individual owner", CorporateOwner: "Corporate owner", HeadOfficer: "Head officer", Officer: "Officer", Shareholder: "Shareholder",
  Agent: "Managing agent", SiteManager: "Site manager", JointOwner: "Joint owner", Lessee: "Lessee",
};
const typeLabel = (t: string) => TYPE_LABEL[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2") || "Other contact";
type AepLines = { units: number | string; buildingId: string; aepStart: string | null; round: string; violationsAtStart: number; status: string; dischargeDate: string | null };
type HpdViolation = { id: string; class: string; apartment: string; story: string; inspected: string; issued: string; description: string; status: string; statusDate: string; correctBy: string; order: string; type: string; place: string; flags: string[] };
type DupGroup = { key: string; type: string; place: string; count: number; a: number; b: number; c: number; exact: number; ids: string[] };
type DobViolation = { id: string; number: string; type: string; code: string; issued: string; description: string; category: string; dispositionDate: string; dispositionComments: string };
type ViolationLog = { hpd: HpdViolation[]; dob: DobViolation[]; duplicates: DupGroup[]; jobs: number; flagged: number; building: { floors: number; units: number }; retrievedAt: string };
type PortfolioRow = { registrationId: string; buildingId: string; address: string; borough: string; zip: string; bbl: string; bin: string; hpdA: number; hpdB: number; hpdC: number; via: string[]; aep: AepLines | null };

/** Platform Control → Building lookup: the same Department of Finance / OATH /
 * HPD / DOB lookup clients use on the join page, for FIAREP's own use, plus the
 * owners, officers and agents on the building's HPD registration. Opened from
 * the AEP registry with ?address=…, it runs the lookup on arrival. No submit
 * form — this is FIAREP looking, not a client asking. */
export default function OwnerBuildingLookup() {
  const { toast } = useToast();
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
  const [bin, setBin] = useState("");
  // Violation log — every open HPD violation as HPD wrote it, every active DOB violation
  const [log, setLog] = useState<ViolationLog | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logClass, setLogClass] = useState<"" | "A" | "B" | "C">("");
  const [logQuery, setLogQuery] = useState("");
  const [dupKey, setDupKey] = useState("");        // duplicates drop-down: show one group
  const [onlyFlagged, setOnlyFlagged] = useState(false); // possible wrong location
  useEffect(() => {
    setLog(null); setLogClass(""); setLogQuery(""); setDupKey(""); setOnlyFlagged(false);
    if (!bbl) return;
    let alive = true;
    setLogLoading(true);
    customFetch<ViolationLog>(`/api/v1/platform/aep/violations/${bbl}?bin=${encodeURIComponent(bin)}`, { responseType: "json" } as never)
      .then((r) => { if (alive) setLog(r); })
      .catch(() => { if (alive) setLog({ hpd: [], dob: [], retrievedAt: new Date().toISOString() }); })
      .finally(() => { if (alive) setLogLoading(false); });
    return () => { alive = false; };
  }, [bbl, bin]);
  const q = logQuery.trim().toLowerCase();
  const dupGroup = dupKey ? log?.duplicates.find((g) => g.key === dupKey) : undefined;
  const hpdShown = (log?.hpd || []).filter((v) => (!logClass || v.class === logClass) && (!dupGroup || dupGroup.ids.includes(v.id)) && (!onlyFlagged || v.flags.length > 0) && (!q || v.description.toLowerCase().includes(q) || v.apartment.toLowerCase().includes(q) || v.story.toLowerCase().includes(q) || v.place.toLowerCase().includes(q)));
  const dobShown = (log?.dob || []).filter((v) => !q || v.description.toLowerCase().includes(q) || v.type.toLowerCase().includes(q) || v.number.toLowerCase().includes(q));
  const classCount = (c: string) => (log?.hpd || []).filter((v) => v.class === c).length;
  // Dismissal request packet for the flagged violations
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissPick, setDismissPick] = useState<Record<string, boolean>>({});
  const [dismissReason, setDismissReason] = useState<Record<string, string>>({});
  const [requestor, setRequestor] = useState({ name: "", role: "Owner" as "Owner" | "Managing Agent", organization: "", address: "", phone: "", email: "" });
  const [rep, setRep] = useState({ name: "", phone: "", email: BRAND.email });
  const [mailTo, setMailTo] = useState(BRAND.email);
  const [sending, setSending] = useState(false);
  const flaggedRows = (log?.hpd || []).filter((v) => v.flags.length > 0);
  function openDismissal() {
    const pick: Record<string, boolean> = {}; const why: Record<string, string> = {};
    for (const v of flaggedRows) { pick[v.id] = true; why[v.id] = dismissReason[v.id] || v.flags.join("; "); }
    setDismissPick(pick); setDismissReason(why);
    // Prefill the requestor from the HPD registration: managing agent first, then the owner.
    const agent = info?.contacts.find((c) => c.type === "Agent"); const own = info?.contacts.find((c) => c.type === "CorporateOwner" || c.type === "IndividualOwner" || c.type === "HeadOfficer");
    const c = agent || own;
    if (c && !requestor.name && !requestor.organization) setRequestor((r) => ({ ...r, name: c.name || c.organization, organization: c.name ? c.organization : "", address: c.address, role: agent ? "Managing Agent" : "Owner" }));
    setDismissOpen(true);
  }
  const lookupAddress = (document.querySelector('input[placeholder*="Ralph"]') as HTMLInputElement | null)?.value || "";
  function dismissalInput(): DismissalInput {
    const chosen = flaggedRows.filter((v) => dismissPick[v.id]);
    const parts = (aep ? initialAddress : lookupAddress).split(",").map((x) => x.trim());
    return {
      address: parts[0] || initialAddress, borough: (parts[1] || "").replace(/\s*\d{5}$/, "") || "", zip: (parts[1] || "").match(/\d{5}$/)?.[0] || "", bbl, units: Number(aep?.units) || log?.building.units || 0,
      openViolations: log?.hpd.length || 0, inAep: aep?.status === "AEP Active", registrationId: info?.registrationId || "",
      requestor, representative: rep, date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      violations: chosen.map((v) => ({ id: v.id, class: v.class, apartment: v.apartment, story: v.story, issued: v.issued, description: v.description, reason: dismissReason[v.id] || v.flags.join("; ") })),
    };
  }
  const dismissReady = flaggedRows.some((v) => dismissPick[v.id]) && requestor.name.trim();
  function openPacket(print: boolean) {
    const w = window.open("", "_blank");
    if (!w) { toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups for this site to open the packet." }); return; }
    w.document.write(buildDismissalHtml(dismissalInput())); w.document.close();
    if (print) { w.focus(); setTimeout(() => w.print(), 400); }
  }
  async function emailPacket() {
    const input = dismissalInput();
    setSending(true);
    try {
      const out = await customFetch<{ ok: boolean; emailed: boolean }>("/api/v1/platform/aep/dismissal/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: mailTo.trim(), subject: `HPD Dismissal Request — ${input.address}, ${input.borough} (${input.violations.length} violations)`, html: buildDismissalHtml(input), address: `${input.address}, ${input.borough}`, bbl, violationIds: input.violations.map((v) => v.id) }), responseType: "json" } as never);
      if (out.emailed) toast({ title: `Sent to ${mailTo.trim()}`, description: "A copy is in the FIAREP Outlook sent folder." });
      else toast({ variant: "destructive", title: "Email did not send", description: "Outlook is not connected or rejected the message. Print to PDF and attach it instead." });
    } catch (err: any) { toast({ variant: "destructive", title: "Could not send", description: err?.data?.error || err?.message }); }
    finally { setSending(false); }
  }
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
        <DofLookupPanel onResult={(_t, r: DofLookup | null) => { setBbl(r?.property.bbl && /^\d{10}$/.test(r.property.bbl) ? r.property.bbl : ""); setBin(r?.property.bin || ""); }} canSubmit={false} persistKey="fiarep_owner_building_lookup" initialAddress={initialAddress} />
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
      {bbl && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Violation log — what the inspector wrote</h2>
              <p className="text-xs text-slate-500">Every open HPD violation on this lot, word for word from HPD's Notice of Violation, and every active DOB violation on the building.{log ? ` Retrieved ${new Date(log.retrievedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
                {(["", "A", "B", "C"] as const).map((c) => (
                  <button key={c || "all"} type="button" onClick={() => setLogClass(c)} className={`rounded-md px-3 py-1 ${logClass === c ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{c ? `Class ${c} (${classCount(c)})` : `All (${log?.hpd.length ?? 0})`}</button>
                ))}
              </div>
              <input value={logQuery} onChange={(e) => setLogQuery(e.target.value)} placeholder="Search the text, apartment or floor" className="h-9 w-72 rounded-md border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400" />
            </div>
          </div>
          {log && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
              <span className="text-slate-700"><span className="font-semibold text-slate-950">{log.hpd.length.toLocaleString()}</span> open HPD violations = <span className="font-semibold text-slate-950">{log.jobs.toLocaleString()}</span> repair jobs</span>
              <span className="text-slate-300">|</span>
              <select value={dupKey} onChange={(e) => { setDupKey(e.target.value); if (e.target.value) setOnlyFlagged(false); }} className="h-9 max-w-xl rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900">
                <option value="">Duplicates — same job cited more than once ({log.duplicates.length} groups, {log.duplicates.reduce((n, g) => n + g.count, 0)} violations)</option>
                {log.duplicates.map((g) => (
                  <option key={g.key} value={g.key}>×{g.count} · {g.type} · {g.place} · {[g.c ? `${g.c} C` : "", g.b ? `${g.b} B` : "", g.a ? `${g.a} A` : ""].filter(Boolean).join(", ")}{g.exact > 1 ? ` · ${g.exact} word-for-word` : ""}</option>
                ))}
              </select>
              <button type="button" onClick={() => { setOnlyFlagged((v) => !v); setDupKey(""); }} className={`h-9 rounded-md border px-3 text-sm font-semibold ${onlyFlagged ? "border-rose-600 bg-rose-600 text-white" : "border-rose-300 bg-white text-rose-700 hover:bg-rose-50"}`}>Possible wrong location ({log.flagged})</button>
              {(dupGroup || onlyFlagged) && <button type="button" onClick={() => { setDupKey(""); setOnlyFlagged(false); }} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700">Show all</button>}
              {log.flagged > 0 && <Button size="sm" className="h-9 bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={openDismissal}>Prepare dismissal request ({log.flagged})</Button>}
              <p className="basis-full text-xs text-slate-600">
                {dupGroup ? `One repair in ${dupGroup.place} clears all ${dupGroup.count} of these ${dupGroup.type.toLowerCase()} violations.` : onlyFlagged ? `Violations whose NOV text, apartment / story fields and the building (${log.building.floors || "?"} floors, ${log.building.units || "?"} units per PLUTO) do not agree — candidates to challenge or have re-inspected before paying to cure.` : "Jobs = one kind of violation in one place (FIAREP's grouping). Pick a duplicate group to see every violation one repair would clear; the wrong-location button shows the ones worth challenging."}
              </p>
            </div>
          )}
          {log && dismissOpen && (
            <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-base font-semibold text-slate-950">Dismissal request — violations written incorrectly</p>
                  <p className="text-xs text-slate-600">HPD has no separate "issued in error" form; the route is the Dismissal Request (Form DR-1) — HPD inspects and a violation whose condition is not at the location cited is dismissed. This builds the cover letter with the written reason for each violation and the DR-1 entries, ready to print to PDF or email. Fee: {(() => { const f = dismissalFee(Number(aep?.units) || log.building.units || 0, log.hpd.length, aep?.status === "AEP Active"); return `$${f.fee.toLocaleString()} — ${f.basis}`; })()}.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setDismissOpen(false)}>Close</Button>
              </div>
              <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-2 py-1.5">Include</th><th className="px-2 py-1.5">Violation</th><th className="px-2 py-1.5">Notice as written</th><th className="px-2 py-1.5">Reason it should be dismissed (edit)</th></tr></thead>
                  <tbody>
                    {flaggedRows.map((v) => (
                      <tr key={v.id} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-1.5"><input type="checkbox" checked={!!dismissPick[v.id]} onChange={(e) => setDismissPick((m) => ({ ...m, [v.id]: e.target.checked }))} /></td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-slate-800">#{v.id} · Class {v.class}<span className="block text-xs text-slate-500">{[v.apartment ? `Apt ${v.apartment}` : "", v.story ? `Story ${v.story}` : ""].filter(Boolean).join(", ") || "no location"} · {v.issued}</span></td>
                        <td className="px-2 py-1.5 text-xs text-slate-700">{v.description}</td>
                        <td className="px-2 py-1.5"><textarea value={dismissReason[v.id] || ""} onChange={(e) => setDismissReason((m) => ({ ...m, [v.id]: e.target.value }))} rows={2} className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-900" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-900">Requestor (signs the DR-1)</p>
                  <p className="text-xs text-slate-500">Filled from the HPD registration when there is one. Must be the registered owner or managing agent.</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input value={requestor.name} onChange={(e) => setRequestor({ ...requestor, name: e.target.value })} placeholder="Name" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                    <select value={requestor.role} onChange={(e) => setRequestor({ ...requestor, role: e.target.value as "Owner" | "Managing Agent" })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"><option>Owner</option><option>Managing Agent</option></select>
                    <input value={requestor.organization} onChange={(e) => setRequestor({ ...requestor, organization: e.target.value })} placeholder="Organization / LLC" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                    <input value={requestor.phone} onChange={(e) => setRequestor({ ...requestor, phone: e.target.value })} placeholder="Phone" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                    <input value={requestor.address} onChange={(e) => setRequestor({ ...requestor, address: e.target.value })} placeholder="Mailing address" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" />
                    <input value={requestor.email} onChange={(e) => setRequestor({ ...requestor, email: e.target.value })} placeholder="Email (on the form)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" />
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-900">{BRAND.name} — authorized representative / inspection contact</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input value={rep.name} onChange={(e) => setRep({ ...rep, name: e.target.value })} placeholder="Your name" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                    <input value={rep.phone} onChange={(e) => setRep({ ...rep, phone: e.target.value })} placeholder="Phone" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                    <input value={rep.email} onChange={(e) => setRep({ ...rep, email: e.target.value })} placeholder="Email" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900">Send the packet</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="Email to" className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                    <Button size="sm" onClick={() => void emailPacket()} disabled={!dismissReady || sending}>{sending ? "Sending…" : "Email"}</Button>
                    <Button size="sm" variant="outline" onClick={() => openPacket(true)} disabled={!dismissReady}>Print / save as PDF</Button>
                    <Button size="sm" variant="outline" onClick={() => openPacket(false)} disabled={!dismissReady}>Preview</Button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">HPD does not take dismissal requests by email — email the packet to yourself or the owner to sign, then mail or hand-deliver the official DR-1 with the fee. Official form: <a className="underline" href="https://www.nyc.gov/assets/hpd/downloads/pdfs/services/dismissal-request-form.pdf" target="_blank" rel="noreferrer">nyc.gov/hpd — Dismissal Request Form</a>.</p>
                </div>
              </div>
            </div>
          )}
          {logLoading && <p className="mt-3 text-sm text-slate-500">Reading the violations…</p>}
          {log && (
            <>
              <div className="mt-3 max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">Class</th><th className="px-3 py-2">Apt / floor</th><th className="px-3 py-2">Issued</th><th className="px-3 py-2">Violation as written</th><th className="px-3 py-2">Job</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Correct by</th></tr></thead>
                  <tbody>
                    {hpdShown.map((v) => (
                      <tr key={v.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${v.class === "C" ? "bg-rose-100 text-rose-700" : v.class === "B" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{v.class}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-800">{v.apartment || "—"}{v.story ? <span className="block text-xs text-slate-500">{v.story}</span> : null}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-700">{v.issued || "—"}<span className="block text-xs text-slate-500">#{v.id}</span></td>
                        <td className="px-3 py-2 text-slate-800">{v.description}{v.flags.length > 0 && <span className="mt-1 block text-xs font-semibold text-rose-700">⚠ {v.flags.join(" · ")}</span>}</td>
                        <td className="px-3 py-2 text-xs text-slate-700">{v.type}<span className="block text-slate-500">{v.place}</span></td>
                        <td className="px-3 py-2 text-slate-700">{v.status}<span className="block text-xs text-slate-500">{v.statusDate}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-700">{v.correctBy || "—"}</td>
                      </tr>
                    ))}
                    {hpdShown.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">{log.hpd.length === 0 ? "No open HPD violations on this lot." : "Nothing matches."}</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-slate-500">{hpdShown.length.toLocaleString()} of {log.hpd.length.toLocaleString()} open HPD violations shown. Source: NYC Open Data, HPD Housing Maintenance Code Violations (wvxf-dwi5).</p>

              <h3 className="mt-5 text-base font-semibold text-slate-950">DOB — active violations ({dobShown.length}{dobShown.length !== log.dob.length ? ` of ${log.dob.length}` : ""})</h3>
              {!bin && <p className="text-sm text-slate-500">No BIN on this lookup, so DOB violations could not be pulled.</p>}
              {bin && (
                <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">Issued</th><th className="px-3 py-2">Number</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Violation as written</th><th className="px-3 py-2">Disposition</th></tr></thead>
                    <tbody>
                      {dobShown.map((v) => (
                        <tr key={v.id} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700">{v.issued || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-700">{v.number}</td>
                          <td className="px-3 py-2 text-slate-800">{v.type || v.code}</td>
                          <td className="px-3 py-2 text-slate-800">{v.description || "—"}</td>
                          <td className="px-3 py-2 text-slate-700">{v.dispositionComments || "—"}{v.dispositionDate ? <span className="block text-xs text-slate-500">{v.dispositionDate}</span> : null}</td>
                        </tr>
                      ))}
                      {dobShown.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">{log.dob.length === 0 ? "No active DOB violations on this building." : "Nothing matches."}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">Source: NYC Open Data, DOB Violations (3h2n-5cm9), category "ACTIVE".</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
