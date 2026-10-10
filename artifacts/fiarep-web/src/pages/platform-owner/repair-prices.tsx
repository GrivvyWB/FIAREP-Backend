import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { EXPEDITER, expediterFee } from "@/lib/fiarep-plans";
import { PLAN_DISCOUNT, COST_KEY, TARGET_KEY, readCosts, readTarget } from "@/lib/profit-check";
import type { ContractKind } from "@/lib/contract";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ENGINEER, ENGINEER_PER_DOB, REPAIR_ITEMS, REPAIR_SQFT, TYPE_TO_ITEM, TYPE_QTY, repairPerJob, type PriceKey } from "@/lib/repair-prices";
import { usePricing, savePricing, defaultPrice } from "@/lib/pricing-overrides";
import { DofLookupPanel, type ViolationCounts } from "@/components/dof-lookup";
import { ContractBuilder } from "@/components/contract-builder";

type JobRequest = { id: string; address: string; company: string; contact: string; email: string; phone: string; units: number; apartments?: number; hpdA: number; hpdB: number; hpdC: number; dob: number; hpdTypes?: Array<{ type: string; count: number; jobs: number }> };
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
type Line = readonly [PriceKey, string, number, string, string, ...unknown[]];

/** Platform Control → Repair price book. FIAREP-only pricing sheet: type how
 * many of each item a building needs and read the total. Clients never see it. */
export default function OwnerRepairPrices() {
  const [counts, setCounts] = useState<Partial<Record<PriceKey, number>>>({});
  // Prices: the owner's numbers from the server (Platform Control → saved here), defaults from the book.
  const pricing = usePricing();
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const priceOf = (key: PriceKey): number => (edits[key] != null ? edits[key]! : pricing.priceOf(key));
  const editPrice = (key: PriceKey, v: string) => { setEdits((m) => ({ ...m, [key]: Math.max(0, Math.round((Number(v) || 0) * 100) / 100) })); setSaving("idle"); };
  const resetPrice = (key: PriceKey) => { setEdits((m) => ({ ...m, [key]: defaultPrice(key) })); setSaving("idle"); };
  const dirty = Object.keys(edits).filter((k) => edits[k] !== pricing.priceOf(k));
  const savePrices = async () => {
    setSaving("saving");
    try {
      const items: Record<string, number> = { ...pricing.items };
      for (const k of Object.keys(edits)) { if (edits[k] === defaultPrice(k)) delete items[k]; else items[k] = edits[k]!; }
      await savePricing({ items });
      setEdits({}); setSaving("saved");
    } catch { setSaving("error"); }
  };
  // Building lookup: pull a building's open violations and read what the repairs come to at these prices.
  const [lookup, setLookup] = useState<ViolationCounts | null>(null);
  const fillFromLookup = () => {
    if (!lookup) return;
    const next: Partial<Record<PriceKey, number>> = {};
    for (const t of lookup.hpdTypes || []) { const key = TYPE_TO_ITEM[t.type]; if (key) next[key] = (next[key] || 0) + (t.jobs || t.count) * (TYPE_QTY[key] ?? 1); }
    setCounts(next);
  };
  const [eng, setEng] = useState(0);
  const [dob, setDob] = useState(0);
  // Opened from Job requests → Build contract: the building's violations fill the scope and the expediter line.
  const [request, setRequest] = useState<JobRequest | null>(null);
  // Which contract the builder below is set to — plan contracts price expediting at the plan rates.
  const [contractKind, setContractKind] = useState<ContractKind>("work");
  const onPlan = contractKind === "fiarep" || contractKind === "agency-major" || contractKind === "agency-small";
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
        for (const t of r.hpdTypes || []) { const key = TYPE_TO_ITEM[t.type]; if (key) next[key] = (next[key] || 0) + (t.jobs || t.count) * (TYPE_QTY[key] ?? 1); }
        setCounts(next);
      } catch { /* request list unavailable */ }
    })();
  }, []);
  const expediter = request ? (() => { const f = expediterFee(request.apartments || 0, request.dob || 0); return { address: request.address, apartments: request.apartments || 0, hpdOpen: (request.hpdA || 0) + (request.hpdB || 0) + (request.hpdC || 0), dob: request.dob || 0, hpd: f.hpd, dobFee: f.dob, total: f.total }; })() : null;
  // The figure for the contract type selected below.
  const exShown = expediter ? (() => { const f = expediterFee(expediter.apartments, expediter.dob); return onPlan ? { hpd: f.planHpd, dobFee: f.planDob, total: f.plan, rate: EXPEDITER.perApartmentPlan } : contractKind === "platform" ? { hpd: f.planHpd, dobFee: f.dob, total: f.platform, rate: EXPEDITER.perApartmentPlan } : { hpd: f.hpd, dobFee: f.dob, total: f.total, rate: EXPEDITER.perApartment }; })() : null;
  const set = (key: PriceKey, n: number) => setCounts((c) => ({ ...c, [key]: Math.max(0, Math.round(n) || 0) }));

  const groups = useMemo(() => {
    const out: Array<{ name: string; note: string; lines: Line[] }> = [
      { name: "Common violation cures", note: "Priced per the unit the work is done in — per apartment visit, per window, per leak, per device, per square foot. Angi cost guides for New York, NY (2026) and HPD order averages; every line says which.", lines: REPAIR_ITEMS.map((i) => [i[0], i[1], priceOf(i[0]), i[3], i[4]] as const) },
    ];
    for (const cat of [...new Set(REPAIR_SQFT.map((i) => i[5]))]) out.push({ name: cat, note: "", lines: REPAIR_SQFT.filter((i) => i[5] === cat).map((i) => [i[0], i[1], priceOf(i[0]), i[3], i[4], i[5]] as const) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing.items, edits]);
  const subtotal = (lines: Line[]) => lines.reduce((n, [key, , price]) => n + (counts[key] || 0) * price, 0);
  const repairs = groups.reduce((n, g) => n + subtotal(g.lines), 0);
  const engineering = ENGINEER[eng]![1] > 0 ? ENGINEER[eng]![1] + dob * ENGINEER_PER_DOB : 0;
  const lines = groups.flatMap((g) => g.lines).filter(([key]) => (counts[key] || 0) > 0);
  // Profit check — FIAREP's own cost per line (never shown to clients), kept in this browser.
  const [costs, setCosts] = useState<Record<string, number>>(readCosts);
  const [target, setTarget] = useState<number>(readTarget);
  useEffect(() => { try { localStorage.setItem(COST_KEY, JSON.stringify(costs)); } catch { /* ignore */ } }, [costs]);
  useEffect(() => { try { localStorage.setItem(TARGET_KEY, String(target)); } catch { /* ignore */ } }, [target]);
  const costOf = (key: string, price: number) => (costs[key] != null ? costs[key]! : Math.round(price * 0.7));
  const profit = (() => {
    let sell = 0; let cost = 0;
    const rows = lines.map(([key, label, price, unit]) => {
      const qty = counts[key] || 0; const c = costOf(key, price);
      sell += qty * price; cost += qty * c;
      const m = price > 0 ? (price - c) / price : 0; const mPlan = price > 0 ? (price * (1 - PLAN_DISCOUNT) - c) / (price * (1 - PLAN_DISCOUNT)) : 0;
      return { key, label, unit, qty, price, cost: c, margin: m, marginPlan: mPlan, below: mPlan < target / 100 };
    });
    const sellPlan = sell * (1 - PLAN_DISCOUNT);
    return { rows, sell, cost, margin: sell > 0 ? (sell - cost) / sell : 0, sellPlan, marginPlan: sellPlan > 0 ? (sellPlan - cost) / sellPlan : 0 };
  })();
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 lg:flex-nowrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-950">FIAREP</h1>
          <p className="text-sm text-slate-500">Field Infrastructure, Asset, Reporting and Evaluation Performance</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-right shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-400">{expediter ? "Expediting + repairs + engineering" : "Repairs + engineering"}</p>
          <p className="text-2xl font-bold text-slate-950">{money(repairs + engineering + (exShown?.total || 0))}</p>
          <p className="text-xs text-slate-500">{exShown ? `expediting ${money(exShown.total)} · ` : ""}repairs {money(repairs)} · engineering {money(engineering)}</p>
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
              <p className="text-xs uppercase tracking-wide text-slate-400">Expediting · {onPlan ? "FIAREP plan rate" : contractKind === "platform" ? "platform rate" : "no plan"}</p>
              <p className="text-2xl font-bold text-amber-300">{money(exShown!.total)}</p>
              <p className="text-xs text-slate-400">{expediter.apartments} × {money(exShown!.rate)} = {money(exShown!.hpd)}{expediter.dob ? ` · DOB ${money(exShown!.dobFee)}` : ""} · {onPlan ? `no plan ${money(expediter.total)}` : `on the FIAREP plan ${money(expediterFee(expediter.apartments, expediter.dob).plan)}`}</p>
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

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Your prices</h2>
            <p className="text-xs text-slate-500">Every number below is yours to change — type a new price on any line and save. The saved price is what the price book, the contract, the job-request prefill and the public estimate all use{pricing.updatedAt ? ` · last saved ${new Date(pricing.updatedAt).toLocaleString()}${pricing.updatedBy ? ` by ${pricing.updatedBy}` : ""}` : ""}. Lines in amber are off the book figure; "book" puts the sourced number back.</p>
          </div>
          <div className="flex items-center gap-2">
            {saving === "saved" && <span className="text-xs text-emerald-700">Saved</span>}
            {saving === "error" && <span className="text-xs text-red-700">Could not save</span>}
            {dirty.length > 0 && <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => { setEdits({}); setSaving("idle"); }}>Undo</Button>}
            <Button size="sm" className="bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={dirty.length === 0 || saving === "saving"} onClick={() => void savePrices()}>{saving === "saving" ? "Saving…" : `Save prices${dirty.length ? ` (${dirty.length})` : ""}`}</Button>
          </div>
        </div>
      </section>

      <details className="group rounded-xl border border-slate-200 bg-white shadow-sm" open={!!lookup}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
          <span>
            <span className="font-semibold text-slate-950">Look up a building</span>
            <span className="block text-xs text-slate-500">Pull the open violations by type and read what the repairs come to at your prices, then fill the scope below.</span>
          </span>
          <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-slate-100 p-4">
          <DofLookupPanel onResult={() => undefined} onCounts={(c) => setLookup(c)} persistKey="fiarep_owner_pricebook_lookup" />
          {lookup && (lookup.hpdTypes?.length || lookup.dobTypes?.length) ? (
            <div className="mt-4 rounded-xl border border-slate-900 bg-slate-900 p-4 text-sm text-white">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-amber-300">What the open violations are</p>
                  {lookup.address && <p className="text-base font-semibold">{lookup.address}</p>}
                </div>
                <Button size="sm" className="bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={fillFromLookup}>Fill the scope from these violations</Button>
              </div>
              {lookup.hpdTypes && lookup.hpdTypes.length > 0 && (
                <table className="mt-3 w-full text-xs">
                  <thead><tr className="text-left uppercase tracking-wide text-slate-400"><th className="py-1">HPD type</th><th className="py-1 text-right">A</th><th className="py-1 text-right">B</th><th className="py-1 text-right">C</th><th className="py-1 text-right">Open</th><th className="py-1 text-right">Jobs</th><th className="py-1 text-right">Repair estimate</th></tr></thead>
                  <tbody>
                    {lookup.hpdTypes.map((t) => { const per = repairPerJob(t.type, priceOf); const key = TYPE_TO_ITEM[t.type]; return (
                      <tr key={t.type} className="border-t border-slate-800"><td className="py-0.5">{t.type}{key ? <span className="ml-1 text-slate-500">· {money(priceOf(key))} {TYPE_QTY[key] ? `× ${TYPE_QTY[key]} sq ft` : "each"}</span> : null}</td><td className="py-0.5 text-right text-slate-500">{t.a || ""}</td><td className="py-0.5 text-right text-slate-500">{t.b || ""}</td><td className="py-0.5 text-right text-slate-500">{t.c || ""}</td><td className="py-0.5 text-right font-semibold text-slate-100">{t.count}</td><td className="py-0.5 text-right text-slate-400">{t.jobs || t.count}</td><td className="py-0.5 text-right text-emerald-300">{per ? money((t.jobs || t.count) * per) : <span className="text-slate-600">after we look</span>}</td></tr>
                    ); })}
                    <tr className="border-t border-slate-700"><td className="py-1 font-semibold text-slate-100">HPD open</td><td className="py-1 text-right text-slate-400">{lookup.hpdA}</td><td className="py-1 text-right text-slate-400">{lookup.hpdB}</td><td className="py-1 text-right text-slate-400">{lookup.hpdC}</td><td className="py-1 text-right font-semibold text-amber-300">{lookup.hpdA + lookup.hpdB + lookup.hpdC}</td><td className="py-1 text-right text-slate-400">{lookup.hpdTypes.reduce((n, t) => n + (t.jobs || t.count), 0)}</td><td className="py-1 text-right font-semibold text-emerald-300">{money(lookup.hpdTypes.reduce((n, t) => n + (t.jobs || t.count) * repairPerJob(t.type, priceOf), 0))}</td></tr>
                  </tbody>
                </table>
              )}
              {lookup.dobTypes && lookup.dobTypes.length > 0 && (
                <table className="mt-3 w-full text-xs">
                  <thead><tr className="text-left uppercase tracking-wide text-slate-400"><th className="py-1">DOB type</th><th className="py-1 text-right">Active</th></tr></thead>
                  <tbody>{lookup.dobTypes.map((t) => <tr key={t.type} className="border-t border-slate-800"><td className="py-0.5">{t.type}</td><td className="py-0.5 text-right font-semibold text-slate-100">{t.count}</td></tr>)}</tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-slate-400">One job per apartment cited; square-foot lines start at a typical job size (lead and mold 100 sq ft, a plaster patch 20 sq ft, a floor 100 sq ft) and are re-measured on site. Types with no line are quoted after a look.</p>
            </div>
          ) : null}
        </div>
      </details>

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
                  <div key={key} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${n > 0 ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">{label}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span className="text-slate-400">$</span>
                        <input type="number" inputMode="decimal" min={0} step={1} value={price} onChange={(e) => editPrice(key, e.target.value)} className={`w-20 rounded-md border px-1.5 py-0.5 text-right text-xs font-semibold text-slate-900 focus:border-amber-500 focus:outline-none ${price !== defaultPrice(key) ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`} aria-label={`Price for ${label}`} />
                        <span>{unit}</span>
                        {price !== defaultPrice(key) && <button type="button" onClick={() => resetPrice(key)} className="text-amber-700 underline">book {money(defaultPrice(key))}</button>}
                        {note ? <span className="text-slate-400">· {note}</span> : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <input type="number" inputMode="numeric" min={0} step={1} value={n || ""} placeholder="0" aria-label={`Quantity of ${label}`} onChange={(e) => set(key, Number(e.target.value))} className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none" />
                      <span className={`w-24 text-right font-semibold ${n > 0 ? "text-amber-700" : "text-slate-300"}`}>{money(n * price)}</span>
                    </span>
                  </div>
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

      {lines.length > 0 && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Profit check — FIAREP only</h2>
              <p className="text-xs text-slate-600">Book prices are what the client pays. Type what each line costs you (crew hours × loaded rate + materials, or the sub's invoice); it starts at 70% of price, the industry cost-of-sales average (NAHB, remodelers 2024: cost of sales 70%, gross margin 30%, net 6%). Red = under your target after the {Math.round(PLAN_DISCOUNT * 100)}% plan discount. Nothing here goes on the contract.</p>
            </div>
            <label className="text-sm font-medium text-slate-900">Target gross margin
              <input type="number" min={0} max={90} value={target} onChange={(e) => setTarget(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} className="ml-2 w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right" />%
            </label>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1 pr-3">Line</th><th className="py-1 pr-3 text-right">Qty</th><th className="py-1 pr-3 text-right">Book price</th><th className="py-1 pr-3 text-right">Your cost</th><th className="py-1 pr-3 text-right">Margin</th><th className="py-1 text-right">On plan (−{Math.round(PLAN_DISCOUNT * 100)}%)</th></tr></thead>
            <tbody>
              {profit.rows.map((r) => (
                <tr key={r.key} className={`border-t border-emerald-200 ${r.below ? "bg-rose-50" : ""}`}>
                  <td className="py-1.5 pr-3 text-slate-900">{r.label}<span className="block text-xs text-slate-500">{r.unit}</span></td>
                  <td className="py-1.5 pr-3 text-right">{r.qty.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-right">{money(r.price)}</td>
                  <td className="py-1.5 pr-3 text-right"><input type="number" min={0} value={costs[r.key] ?? Math.round(r.price * 0.7)} onChange={(e) => setCosts((m) => ({ ...m, [r.key]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-right" aria-label={`Your cost for ${r.label}`} /></td>
                  <td className={`py-1.5 pr-3 text-right font-semibold ${r.margin < target / 100 ? "text-rose-700" : "text-emerald-700"}`}>{pct(r.margin)}</td>
                  <td className={`py-1.5 text-right font-semibold ${r.below ? "text-rose-700" : "text-emerald-700"}`}>{pct(r.marginPlan)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-emerald-300 font-semibold text-slate-950"><td className="py-2 pr-3">Repairs</td><td className="py-2 pr-3 text-right"></td><td className="py-2 pr-3 text-right">{money(profit.sell)}</td><td className="py-2 pr-3 text-right">{money(profit.cost)}</td><td className={`py-2 pr-3 text-right ${profit.margin < target / 100 ? "text-rose-700" : "text-emerald-700"}`}>{pct(profit.margin)} · {money(profit.sell - profit.cost)}</td><td className={`py-2 text-right ${profit.marginPlan < target / 100 ? "text-rose-700" : "text-emerald-700"}`}>{pct(profit.marginPlan)} · {money(profit.sellPlan - profit.cost)}</td></tr></tfoot>
          </table>
          <p className="mt-2 text-xs text-slate-600">Rule of thumb: price = cost × 1.5 for a 33% margin, × 1.67 for 40%. If a job's cost × 1.5 comes out above the book price, charge cost × 1.5 and say why. Subbed work: the sub's invoice + 20%. The expediting fee ($600 / $400 per apartment) is on top of all of this and is not in these margins.</p>
        </section>
      )}

      <ContractBuilder
        scope={lines.map(([key, label, price, unit]) => ({ label, qty: counts[key] || 0, unit, price }))}
        engineering={engineering > 0 ? { label: `${ENGINEER[eng]![0]}${dob > 0 ? ` + ${dob} DOB sign-off${dob === 1 ? "" : "s"}` : ""}`, amount: engineering } : null}
        expediter={expediter}
        onKindChange={setContractKind}
        onClearScope={() => { setCounts({}); setEng(0); setDob(0); }}
      />
    </div>
  );
}
