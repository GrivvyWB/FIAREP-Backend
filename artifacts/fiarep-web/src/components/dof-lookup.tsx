import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

export type DofLookup = {
  property: { formattedAddress: string; borough: string; block: string | null; lot: string | null; bbl: string | null; bin: string | null };
  oath: { openBalance: number; openCount: number; penaltiesImposed: number; paid: number; byAgency: Array<{ agency: string; balance: number; count: number }>; items: Array<{ ticket: string; agency: string; violationDate: string | null; hearingDate: string | null; hearingStatus: string; complianceStatus: string; charge: string; penalty: number; paid: number; lateFees: number; balance: number }> };
  propertyTax: { year: string; taxClass: string; marketValue: number; assessedValue: number; taxableValue: number; taxRate: number | null; estimatedAnnualTax: number | null; owner: string; units: number; yearBuilt: string; dofLink: string } | null;
  violations: { hpdA: number; hpdB: number; hpdC: number; hpdOpen: number; dobActive: number; hpdTypes: Array<{ type: string; count: number; a: number; b: number; c: number; jobs: number }>; dobTypes: Array<{ type: string; count: number }> } | null;
  hpdCharges: { total: number; count: number; items: Array<{ omo: string; createdAt: string | null; workType: string; description: string; amount: number }> };
  warnings: string[];
  retrievedAt: string;
};
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Department of Finance window: type the building address, get the block &
 * lot and what the building owes the City right now — OATH / ECB summons
 * balances by agency and HPD emergency-repair charges. Check it any time. */
export type ViolationCounts = { hpdA: number; hpdB: number; hpdC: number; dob: number; hpdTypes?: Array<{ type: string; count: number; a: number; b: number; c: number; jobs: number }>; dobTypes?: Array<{ type: string; count: number }>; address?: string };
type JoinInfo = { id?: string; company?: string };
const readJoin = (): JoinInfo => { try { return JSON.parse(localStorage.getItem("fiarep_join") || "{}") as JoinInfo; } catch { return {}; } };
const SUBMIT_KEY = "fiarep_work_requests";

export function DofLookupPanel({ onResult, onCounts, canSubmit }: { onResult: (total: number, result: DofLookup | null) => void; onCounts?: (c: ViolationCounts) => void; canSubmit?: boolean }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DofLookup | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Open-violation counts: filled from HPD / DOB open data, the client corrects them.
  const [counts, setCountsState] = useState<ViolationCounts>({ hpdA: 0, hpdB: 0, hpdC: 0, dob: 0 });
  const setCounts = (c: ViolationCounts) => { setCountsState(c); onCounts?.(c); };
  // Submit the building to FIAREP as a job.
  const [contact, setContact] = useState(() => ({ company: readJoin().company || "", contact: "", email: "", phone: "", notes: "" }));
  const [submitted, setSubmitted] = useState<{ id: string; emailed: boolean } | null>(null);
  const [sending, setSending] = useState(false);

  async function lookUp() {
    const q = address.trim();
    if (!q) return;
    setBusy(true); setError("");
    try {
      const r = await customFetch<DofLookup>(`/api/v1/public/dof-charges?address=${encodeURIComponent(q)}`, { responseType: "json" } as never);
      setData(r); setShowAll(false); setSubmitted(null);
      onResult(r.oath.openBalance + r.hpdCharges.total, r);
      setCounts({ hpdA: r.violations?.hpdA || 0, hpdB: r.violations?.hpdB || 0, hpdC: r.violations?.hpdC || 0, dob: r.violations?.dobActive || 0, hpdTypes: r.violations?.hpdTypes || [], dobTypes: r.violations?.dobTypes || [], address: r.property.formattedAddress });
    } catch (err: any) {
      setData(null); setError(err?.data?.error || err?.message || "That address could not be matched to an NYC property.");
      onResult(0, null);
    } finally { setBusy(false); }
  }

  const total = data ? data.oath.openBalance + data.hpdCharges.total : 0;
  const field = "w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-sm font-semibold text-slate-100 focus:border-amber-400 focus:outline-none";
  const text = "min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none";
  const n = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  async function submit() {
    if (!data) return;
    setSending(true);
    try {
      const r = await customFetch<{ ok: boolean; id: string; emailed: boolean }>("/api/v1/public/work-requests", {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({
          joinId: readJoin().id || "", ...contact,
          address: data.property.formattedAddress, borough: data.property.borough, block: data.property.block, lot: data.property.lot, bbl: data.property.bbl, bin: data.property.bin,
          units: data.propertyTax?.units || 0, hpdA: counts.hpdA, hpdB: counts.hpdB, hpdC: counts.hpdC, dob: counts.dob, dofOwed: total,
          hpdTypes: counts.hpdTypes || [], dobTypes: counts.dobTypes || [],
        }),
      } as never);
      setSubmitted({ id: r.id, emailed: r.emailed });
      try { const prev = JSON.parse(localStorage.getItem(SUBMIT_KEY) || "[]") as unknown[]; localStorage.setItem(SUBMIT_KEY, JSON.stringify([...prev, { id: r.id, address: data.property.formattedAddress, at: new Date().toISOString() }])); } catch { /* storage unavailable */ }
    } catch (err: any) { setError(err?.data?.error || err?.message || "Could not submit — try again."); }
    finally { setSending(false); }
  }
  const canSend = canSubmit && data && contact.company.trim() && contact.contact.trim() && (contact.email.trim() || contact.phone.trim());
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
      <p className="font-semibold text-slate-200">Department of Finance — what the building owes now</p>
      <p className="text-xs text-slate-500">Type the development or building address. Pulls the block & lot, every OATH / ECB summons with a balance (DOB, FDNY, DSNY, DEP…), and HPD emergency-repair charges. Check it again any time to see what's new.</p>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void lookUp(); }}>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 262 Ralph Ave, Brooklyn" className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none" />
        <Button type="submit" className="bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={busy || !address.trim()}>{busy ? "Checking…" : "Look up"}</Button>
      </form>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {data && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-100">{data.property.formattedAddress}</p>
              <p className="text-xs text-slate-400">{data.property.borough} · Block {data.property.block || "—"} · Lot {data.property.lot || "—"}{data.property.bbl ? ` · BBL ${data.property.bbl}` : ""}{data.property.bin ? ` · BIN ${data.property.bin}` : ""}</p>
              <p className="text-sm font-semibold text-amber-300">{data.propertyTax?.units ? `${data.propertyTax.units} units` : "Units not on file"}{data.propertyTax?.yearBuilt ? <span className="font-normal text-slate-400"> · built {data.propertyTax.yearBuilt}</span> : null}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Owed to the City</p>
              <p className="text-2xl font-bold text-slate-200">{money(total)}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-800 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">OATH / ECB summons</p>
              <p className="text-lg font-semibold text-slate-200">{money(data.oath.openBalance)} <span className="text-xs font-normal text-slate-500">· {data.oath.openCount} open</span></p>
              {data.oath.byAgency.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
                  {data.oath.byAgency.map((a) => <li key={a.agency} className="flex justify-between"><span>{a.agency} ({a.count})</span><span>{money(a.balance)}</span></li>)}
                </ul>
              )}
              <p className="mt-1 text-[11px] text-slate-500">Imposed {money(data.oath.penaltiesImposed)} · paid {money(data.oath.paid)}</p>
            </div>
            <div className="rounded-lg border border-slate-800 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">HPD emergency-repair charges</p>
              <p className="text-lg font-semibold text-slate-200">{money(data.hpdCharges.total)} <span className="text-xs font-normal text-slate-500">· {data.hpdCharges.count} order{data.hpdCharges.count === 1 ? "" : "s"}</span></p>
              {data.hpdCharges.items.slice(0, 4).map((c) => <p key={c.omo} className="mt-0.5 truncate text-xs text-slate-400">{c.createdAt} · {c.workType} · {money(c.amount)}</p>)}
            </div>
          </div>
          {data.propertyTax && (
            <div className="rounded-lg border border-slate-800 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">Property tax (DOF) · tax class {data.propertyTax.taxClass} · {data.propertyTax.year} roll</p>
                <a href={data.propertyTax.dofLink} target="_blank" rel="noreferrer" className="text-xs text-amber-300 underline">Open on DOF — Property Tax Account for balance & bills</a>
              </div>
              <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
                <p>Market value<br /><span className="text-base font-semibold text-slate-200">{money(data.propertyTax.marketValue)}</span></p>
                <p>Assessed value<br /><span className="text-base font-semibold text-slate-200">{money(data.propertyTax.assessedValue)}</span></p>
                <p>Taxable value<br /><span className="text-base font-semibold text-slate-200">{money(data.propertyTax.taxableValue)}</span></p>
                <p>Est. annual tax{data.propertyTax.taxRate != null ? ` @ ${(data.propertyTax.taxRate * 100).toFixed(3)}%` : ""}<br /><span className="text-base font-semibold text-slate-200">{data.propertyTax.estimatedAnnualTax == null ? "—" : money(data.propertyTax.estimatedAnnualTax)}</span></p>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Owner of record {data.propertyTax.owner || "—"}. The amount owed is on the DOF account (link above) — it is not published on Open Data.</p>
            </div>
          )}
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-xs uppercase tracking-wide text-amber-300/90">Open violations on this building</p>
            <p className="text-xs text-slate-500">From HPD and DOB open data{data.violations ? ` — ${data.violations.hpdOpen} HPD open, ${data.violations.dobActive} DOB active` : ""}. Correct the counts if you know better; these go to FIAREP with the address.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {([["hpdA", "HPD Class A"], ["hpdB", "HPD Class B"], ["hpdC", "HPD Class C"], ["dob", "DOB"]] as const).map(([key, label]) => (
                <label key={key} className="rounded-md border border-slate-800 px-2 py-1.5 text-xs text-slate-400">{label}
                  <input type="number" inputMode="numeric" min={0} value={counts[key] || ""} placeholder="0" onChange={(e) => setCounts({ ...counts, [key]: n(e.target.value) })} className={`${field} mt-1 w-full text-lg`} aria-label={`${label} open violations`} />
                </label>
              ))}
            </div>
            {canSubmit && !submitted && (
              <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <p className="text-sm font-semibold text-slate-200">Submit this building to FIAREP</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} placeholder="Company" className={text} />
                  <input value={contact.contact} onChange={(e) => setContact({ ...contact, contact: e.target.value })} placeholder="Your name" className={text} />
                  <input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="Email" className={text} />
                  <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="Phone" className={text} />
                </div>
                <textarea value={contact.notes} onChange={(e) => setContact({ ...contact, notes: e.target.value })} placeholder="Anything we should know (optional)" rows={2} className={`${text} w-full`} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" className="bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={!canSend || sending}>{sending ? "Submitting…" : "Submit to FIAREP"}</Button>
                  <span className="text-xs text-slate-500">{counts.hpdA + counts.hpdB + counts.hpdC} HPD · {counts.dob} DOB violations go with the address. Repairs are quoted separately after we look.</span>
                </div>
              </form>
            )}
            {submitted && <p className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">Submitted. FIAREP has {data.property.formattedAddress} with {counts.hpdA + counts.hpdB + counts.hpdC} HPD and {counts.dob} DOB violations — we'll confirm by {contact.email ? "email" : "phone"} and send the repair quote after we look. Reference {submitted.id.slice(0, 8)}.</p>}
          </div>
          {data.oath.items.length > 0 && (
            <div>
              <button type="button" className="text-xs text-amber-300 underline" onClick={() => setShowAll((v) => !v)}>{showAll ? "Hide" : "Show"} the {data.oath.items.length} open summons</button>
              {showAll && (
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-900 text-left text-slate-400"><tr><th className="px-2 py-1">Ticket</th><th className="px-2 py-1">Agency</th><th className="px-2 py-1">Charge</th><th className="px-2 py-1">Status</th><th className="px-2 py-1 text-right">Balance</th></tr></thead>
                    <tbody>
                      {data.oath.items.map((i) => (
                        <tr key={i.ticket} className="border-t border-slate-800 text-slate-300">
                          <td className="px-2 py-1 font-mono">{i.ticket}</td><td className="px-2 py-1">{i.agency}</td><td className="px-2 py-1">{i.charge}</td><td className="px-2 py-1">{i.complianceStatus || i.hearingStatus}</td><td className="px-2 py-1 text-right font-semibold">{money(i.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {data.warnings.length > 0 && <p className="text-xs text-amber-500">{data.warnings.join(" · ")}</p>}
          <p className="text-[11px] text-slate-500">NYC Open Data (OATH case status, HPD charges, DOF assessment roll) · retrieved {new Date(data.retrievedAt).toLocaleString()}. Property tax and water balances are not in the total — open the DOF account for those.</p>
        </div>
      )}
    </div>
  );
}
