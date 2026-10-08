import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { expediterFee } from "@/lib/fiarep-plans";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ENGINEER, ENGINEER_PER_DOB, REPAIR_ITEMS, REPAIR_SQFT, type PriceKey } from "@/lib/repair-prices";
import { ContractBuilder } from "@/components/contract-builder";

// Violation type (from the City's notices) → price book item, one job per apartment cited.
const TYPE_TO_ITEM: Record<string, PriceKey> = {
  "Smoke detector": "smoke", "Carbon monoxide detector": "smoke", "Window guards": "guards",
  "Roaches": "exterm", "Mice / rats": "exterm", "Bed bugs": "exterm",
  "Lead paint": "lead", "Mold": "mold", "Heat / hot water": "heat",
  "Peeling paint / plaster": "plaster", "Ceiling / wall": "plaster", "Leak / plumbing": "leak", "Electrical": "elec",
  "Door / self-closing": "door", "Window": "window", "Floor": "hardwood",
};
type JobRequest = { id: string; address: string; company: string; contact: string; email: string; phone: string; units: number; apartments?: number; hpdA: number; hpdB: number; hpdC: number; dob: number; hpdTypes?: Array<{ type: string; count: number; jobs: number }> };
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
type Line = readonly [PriceKey, string, number, string, string, ...unknown[]];

/** Platform Control → Repair price book. FIAREP-only pricing sheet: type how
 * many of each item a building needs and read the total. Clients never see it. */
export default function OwnerRepairPrices() {
  const [counts, setCounts] = useState<Partial<Record<PriceKey, number>>>({});
  const [eng, setEng] = useState(0);
  const [dob, setDob] = useState(0);
  // Opened from Job requests → Build contract: the building's violations fill the scope and the expediter line.
  const [request, setRequest] = useState<JobRequest | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("request");
    if (!id) return;
    void (async () => {
      try {
        const rows = await customFetch<JobRequest[]>("/api/v1/platform/work-requests", { responseType: "json" } as never);
        const r = rows.find((x) => x.id === id);
        if (!r) return;
        setRequest(r);
        const next: Partial<Record<PriceKey, number>> = {};
        for (const t of r.hpdTypes || []) { const key = TYPE_TO_ITEM[t.type]; if (key) next[key] = (next[key] || 0) + (t.jobs || t.count); }
        setCounts(next);
      } catch { /* request list unavailable */ }
    })();
  }, []);
  const expediter = request ? (() => { const f = expediterFee(request.apartments || 0, request.dob || 0); return { address: request.address, apartments: request.apartments || 0, hpdOpen: (request.hpdA || 0) + (request.hpdB || 0) + (request.hpdC || 0), dob: request.dob || 0, hpd: f.hpd, dobFee: f.dob, total: f.total }; })() : null;
  const set = (key: PriceKey, n: number) => setCounts((c) => ({ ...c, [key]: Math.max(0, Math.round(n) || 0) }));

  const groups = useMemo(() => {
    const out: Array<{ name: string; note: string; lines: Line[] }> = [
      { name: "HPD repair orders", note: "What HPD paid its contractors per Emergency Repair / Open Market Order since Jan 2024 (NYC Open Data).", lines: [...REPAIR_ITEMS] },
    ];
    for (const cat of [...new Set(REPAIR_SQFT.map((i) => i[5]))]) out.push({ name: cat, note: "", lines: REPAIR_SQFT.filter((i) => i[5] === cat) });
    return out;
  }, []);
  const subtotal = (lines: Line[]) => lines.reduce((n, [key, , price]) => n + (counts[key] || 0) * price, 0);
  const repairs = groups.reduce((n, g) => n + subtotal(g.lines), 0);
  const engineering = ENGINEER[eng]![1] > 0 ? ENGINEER[eng]![1] + dob * ENGINEER_PER_DOB : 0;
  const lines = groups.flatMap((g) => g.lines).filter(([key]) => (counts[key] || 0) > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 lg:flex-nowrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-950">FIAREP</h1>
          <p className="text-sm text-slate-500">Field Infrastructure, Asset, Reporting and Evaluation Performance</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-right shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-400">{expediter ? "Expediting + repairs + engineering" : "Repairs + engineering"}</p>
          <p className="text-2xl font-bold text-slate-950">{money(repairs + engineering + (expediter?.total || 0))}</p>
          <p className="text-xs text-slate-500">{expediter ? `expediting ${money(expediter.total)} · ` : ""}repairs {money(repairs)} · engineering {money(engineering)}</p>
          {lines.length > 0 && <Button size="sm" variant="ghost" className="mt-1 text-slate-500" onClick={() => { setCounts({}); setEng(0); setDob(0); }}>Clear</Button>}
        </div>
      </div>

      {request && expediter && (
        <section className="rounded-xl border border-slate-900 bg-slate-900 p-4 text-sm text-white">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-amber-300">Job request · {request.company}</p>
              <p className="text-lg font-semibold">{request.address}</p>
              <p className="text-slate-300">{expediter.hpdOpen} HPD open ({request.hpdA} A · {request.hpdB} B · {request.hpdC} C) in {expediter.apartments} apartments · {expediter.dob} DOB · {request.units} units</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">Expediting</p>
              <p className="text-2xl font-bold text-amber-300">{money(expediter.total)}</p>
              <p className="text-xs text-slate-400">{expediter.apartments} × $600 = {money(expediter.hpd)}{expediter.dob ? ` · DOB ${money(expediter.dobFee)}` : ""} · on the FIAREP plan {money(expediterFee(request.apartments || 0, request.dob || 0).plan)}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">The violation types filled in the repair counts below, one job per apartment cited — check them, add what the City's notices don't show, then build the contract. The client approves expediting + repairs in one document.</p>
        </section>
      )}
      {lines.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-slate-900">On this estimate</p>
          <ul className="mt-1 grid gap-y-0.5 gap-x-8 sm:grid-cols-2">
            {lines.map(([key, label, price, unit]) => <li key={key} className="flex justify-between gap-3 text-slate-700"><span>{counts[key]} × {label} <span className="text-slate-400">({money(price)} {unit})</span></span><span className="font-semibold">{money((counts[key] || 0) * price)}</span></li>)}
          </ul>
        </section>
      )}

      {groups.map((g) => {
        const sub = subtotal(g.lines);
        return (
          <details key={g.name} className="group rounded-xl border border-slate-200 bg-white shadow-sm" open={sub > 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
              <span>
                <span className="font-semibold text-slate-950">{g.name}</span>
                <span className="ml-2 text-xs text-slate-400">{g.lines.length} items</span>
                {g.note && <span className="block text-xs text-slate-500">{g.note}</span>}
              </span>
              <span className="flex items-center gap-3">
                {sub > 0 && <span className="font-semibold text-amber-700">{money(sub)}</span>}
                <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="grid gap-1.5 border-t border-slate-100 p-4 sm:grid-cols-2">
              {g.lines.map(([key, label, price, unit, note]) => {
                const n = counts[key] || 0;
                return (
                  <label key={key} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${n > 0 ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">{label}</span>
                      <span className="block text-xs text-slate-500">{money(price)} {unit}{note ? ` · ${note}` : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <input type="number" inputMode="numeric" min={0} step={1} value={n || ""} placeholder="0" onChange={(e) => set(key, Number(e.target.value))} className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none" />
                      <span className={`w-24 text-right font-semibold ${n > 0 ? "text-amber-700" : "text-slate-300"}`}>{money(n * price)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </details>
        );
      })}

      <details className="group rounded-xl border border-slate-200 bg-white shadow-sm" open={eng > 0}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
          <span>
            <span className="font-semibold text-slate-950">Architect / engineer</span>
            <span className="block text-xs text-slate-500">Plus {money(ENGINEER_PER_DOB)} per DOB violation when any professional work is needed.</span>
          </span>
          <span className="flex items-center gap-3">
            {engineering > 0 && <span className="font-semibold text-amber-700">{money(engineering)}</span>}
            <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="border-t border-slate-100 p-4">
          <label className="mb-3 flex items-center gap-3 text-sm text-slate-700">DOB violations needing sign-off
            <input type="number" inputMode="numeric" min={0} value={dob || ""} placeholder="0" onChange={(e) => setDob(Math.max(0, Math.round(Number(e.target.value) || 0)))} className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none" />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {ENGINEER.map(([label, amount, what], i) => (
              <button key={label} type="button" onClick={() => setEng(i)} className={`rounded-lg border px-3 py-2 text-left text-sm ${eng === i ? "border-amber-400 bg-amber-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="flex items-baseline justify-between gap-2"><span className="font-medium text-slate-900">{label}</span><span className="font-semibold text-amber-700">{money(amount)}</span></span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">{what}</span>
              </button>
            ))}
          </div>
        </div>
      </details>
      <p className="text-xs text-slate-400">Sources and ranges behind every line: FIAREP_Repair_Prices_HPD.xlsx. City schedule figures are ceilings for tax-benefit purposes; real bids land above or below.</p>

      <ContractBuilder
        scope={lines.map(([key, label, price, unit]) => ({ label, qty: counts[key] || 0, unit, price }))}
        engineering={engineering > 0 ? { label: `${ENGINEER[eng]![0]}${dob > 0 ? ` + ${dob} DOB sign-off${dob === 1 ? "" : "s"}` : ""}`, amount: engineering } : null}
        expediter={expediter}
        onClearScope={() => { setCounts({}); setEng(0); setDob(0); }}
      />
    </div>
  );
}
