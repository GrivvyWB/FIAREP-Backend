import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

export type DofLookup = {
  property: { formattedAddress: string; borough: string; block: string | null; lot: string | null; bbl: string | null; bin: string | null };
  oath: { openBalance: number; openCount: number; penaltiesImposed: number; paid: number; byAgency: Array<{ agency: string; balance: number; count: number }>; items: Array<{ ticket: string; agency: string; violationDate: string | null; hearingDate: string | null; hearingStatus: string; complianceStatus: string; charge: string; penalty: number; paid: number; lateFees: number; balance: number }> };
  hpdCharges: { total: number; count: number; items: Array<{ omo: string; createdAt: string | null; workType: string; description: string; amount: number }> };
  warnings: string[];
  retrievedAt: string;
};
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Department of Finance window: type the building address, get the block &
 * lot and what the building owes the City right now — OATH / ECB summons
 * balances by agency and HPD emergency-repair charges. Check it any time. */
export function DofLookupPanel({ onResult }: { onResult: (total: number, result: DofLookup | null) => void }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DofLookup | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function lookUp() {
    const q = address.trim();
    if (!q) return;
    setBusy(true); setError("");
    try {
      const r = await customFetch<DofLookup>(`/api/v1/public/dof-charges?address=${encodeURIComponent(q)}`, { responseType: "json" } as never);
      setData(r); setShowAll(false);
      onResult(r.oath.openBalance + r.hpdCharges.total, r);
    } catch (err: any) {
      setData(null); setError(err?.data?.error || err?.message || "That address could not be matched to an NYC property.");
      onResult(0, null);
    } finally { setBusy(false); }
  }

  const total = data ? data.oath.openBalance + data.hpdCharges.total : 0;
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
          <p className="text-[11px] text-slate-500">NYC Open Data (OATH case status, HPD charges) · retrieved {new Date(data.retrievedAt).toLocaleString()}. DOF property tax and water charges are not included.</p>
        </div>
      )}
    </div>
  );
}
