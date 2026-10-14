import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BANDS, EXAMPLES, SETUP_FEE, SOURCES, LABOR_SHARE, LOADED_HOURLY, MATERIALS_HANDLING, PLAN_MIN_UNITS, bandHours, bandLabel, ladderFees, type Band } from "@/lib/pricing-ladder";
import { usePricing, savePricing } from "@/lib/pricing-overrides";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500";
const td = "px-3 py-2 align-top";

/** Platform Control → Pricing ladder: the recommended per-unit bands from 2 to
 * 300,000 units, a calculator, worked examples, what is live today vs the
 * and the sources. The bands are live and owner-editable. */
export default function OwnerPricing() {
  const [units, setUnits] = useState(147);
  // Live bands come from the server (owner-set); edits here are saved back and the Join page and plan contracts follow.
  const pricing = usePricing();
  const [draft, setDraft] = useState<Band[] | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const bands = draft ?? pricing.bands;
  const f = ladderFees(Math.max(0, Math.round(units || 0)), bands);
  // Every part of a band is the owner's to change: its range, prices, labor pool and note.
  const patch = (i: number, p: Partial<Band>) => {
    setDraft(bands.map((b, j) => { if (j !== i) return b; const nb = { ...b, ...p }; return { ...nb, label: bandLabel(nb.from, nb.to) }; }));
    setSaving("idle");
  };
  const toNum = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round((Number(v) || 0) * 100) / 100));
  const edit = (i: number, field: "platformRate" | "platformMin" | "planRate" | "planMin" | "hoursPerUnit", v: string) => patch(i, { [field]: toNum(v) } as Partial<Band>);
  const editRange = (i: number, field: "from" | "to", v: string) => patch(i, { [field]: Math.max(0, Math.round(Number(v) || 0)) } as Partial<Band>);
  const badRange = bands.some((b) => b.to < b.from);
  const save = async () => { setSaving("saving"); try { await savePricing({ bands: bands.map((b) => ({ ...b, v: 2 })) }); setDraft(null); setSaving("saved"); } catch { setSaving("error"); } };
  const resetBook = async () => { setSaving("saving"); try { await savePricing({ bands: null }); setDraft(null); setSaving("saved"); } catch { setSaving("error"); } };
  const shape = (bs: Band[]) => JSON.stringify(bs.map((b) => [b.from, b.to, b.platformRate, b.platformMin, b.planRate, b.planMin, b.hoursPerUnit ?? null, b.note]));
  const isDefault = shape(bands) === shape(BANDS);
  const cell = "w-24 rounded-md border px-2 py-1 text-right text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">Pricing ladder — 2 to 300,000 units</h1>
        <p className="text-sm text-slate-500">Per unit means per dwelling unit per month; the monthly fee is the greater of units × rate and the band minimum. These are the live numbers: the plan cards on the Join page and plan contracts read them. The FIAREP plan is sold at every size from {PLAN_MIN_UNITS} units. No prices are filled in for you: a box left blank shows no price anywhere until you type one. Type the rates and minimums you want and save.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {saving === "saved" && <span className="text-xs text-emerald-700">Saved</span>}
        {saving === "error" && <span className="text-xs text-red-700">Could not save</span>}
        {badRange && <span className="text-xs text-red-700">A band ends below where it starts — fix it to save</span>}
        {draft && <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => { setDraft(null); setSaving("idle"); }}>Undo</Button>}
        {!isDefault && !draft && <Button size="sm" variant="outline" onClick={() => void resetBook()}>Back to the recommended bands</Button>}
        <Button size="sm" className="bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={!draft || badRange || saving === "saving"} onClick={() => void save()}>{saving === "saving" ? "Saving…" : "Save bands"}</Button>
      </div>

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm font-medium text-slate-900">Units
            <Input type="number" inputMode="numeric" min={1} max={300000} value={units} onChange={(e) => setUnits(Number(e.target.value))} className="mt-1 w-40 bg-white" />
          </label>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Band</p><p className="text-lg font-semibold text-slate-950">{f.band.label}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Platform</p><p className="text-lg font-semibold text-slate-950">{f.platform == null ? "no platform rate set for this band yet" : <>{money(f.platform)}<span className="text-sm font-normal text-slate-500">/mo · {money(f.platform * 12)}/yr</span></>}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">FIAREP plan</p><p className="text-lg font-semibold text-slate-950">{f.plan == null ? (f.band.planRate == null && f.band.to < 50000 ? "no plan rate set for this band yet" : "per-building task orders") : <>{money(f.plan)}<span className="text-sm font-normal text-slate-500">/mo · {money(f.plan * 12)}/yr</span></>}</p></div>
        </div>
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1040px] text-sm">
          <thead><tr className="bg-slate-50"><th className={th}>Band (units)</th><th className={`${th} text-right`}>Platform $/unit</th><th className={`${th} text-right`}>Platform min</th><th className={`${th} text-right`}>FIAREP plan $/unit</th><th className={`${th} text-right`}>Plan min</th><th className={`${th} text-right`}>Labor pool</th><th className={th}>Notes</th></tr></thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i} className={`border-t border-slate-100 ${b === f.band ? "bg-amber-50" : ""}`}>
                <td className={`${td} whitespace-nowrap`}><input type="number" inputMode="numeric" min={0} value={b.from} onChange={(e) => editRange(i, "from", e.target.value)} className={`w-20 rounded-md border px-2 py-1 text-right text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none ${b.from !== BANDS[i]?.from ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} aria-label={`Band ${i + 1} from`} /><span className="px-1 text-slate-500">–</span><input type="number" inputMode="numeric" min={0} value={b.to} onChange={(e) => editRange(i, "to", e.target.value)} className={`w-24 rounded-md border px-2 py-1 text-right text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none ${b.to < b.from ? "border-red-400 bg-red-50" : b.to !== BANDS[i]?.to ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} aria-label={`Band ${i + 1} to`} /></td>
                <td className={`${td} text-right`}><input type="number" inputMode="decimal" min={0} value={b.platformRate ?? ""} placeholder="—" onChange={(e) => edit(i, "platformRate", e.target.value)} className={`${cell} ${b.platformRate !== BANDS[i]?.platformRate ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} aria-label={`Platform rate ${b.label}`} /></td>
                <td className={`${td} text-right`}><input type="number" inputMode="numeric" min={0} value={b.platformMin ?? ""} placeholder="—" onChange={(e) => edit(i, "platformMin", e.target.value)} className={`${cell} ${b.platformMin !== BANDS[i]?.platformMin ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} aria-label={`Platform minimum ${b.label}`} />{b.platformMin != null && <span className="text-xs text-slate-500">/mo</span>}</td>
                <td className={`${td} text-right`}><input type="number" inputMode="decimal" min={0} value={b.planRate ?? ""} placeholder="—" onChange={(e) => edit(i, "planRate", e.target.value)} className={`${cell} ${b.planRate !== BANDS[i]?.planRate ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} aria-label={`Plan rate ${b.label}`} /></td>
                <td className={`${td} text-right`}><input type="number" inputMode="numeric" min={0} value={b.planMin ?? ""} placeholder="—" onChange={(e) => edit(i, "planMin", e.target.value)} className={`${cell} ${b.planMin !== BANDS[i]?.planMin ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} aria-label={`Plan minimum ${b.label}`} />{b.planMin != null && <span className="text-xs text-slate-500">/mo</span>}</td>
                <td className={`${td} text-right whitespace-nowrap`}><input type="number" inputMode="decimal" min={0} value={b.hoursPerUnit ?? ""} placeholder={b.planRate != null ? String(bandHours({ ...b, hoursPerUnit: null })) : "—"} onChange={(e) => edit(i, "hoursPerUnit", e.target.value)} className={`w-20 ${cell.replace("w-24 ", "")} ${b.hoursPerUnit != null ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} aria-label={`Labor pool ${b.label}`} /><span className="text-xs text-slate-500"> h/unit/yr</span></td>
                <td className={td}><textarea rows={2} value={b.note} onChange={(e) => patch(i, { note: e.target.value })} className={`w-full min-w-[220px] rounded-md border px-2 py-1 text-sm text-slate-700 focus:border-amber-500 focus:outline-none ${b.note !== (BANDS[i]?.note ?? "") ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} aria-label={`Note ${b.label}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-slate-500">One-time setup {money(SETUP_FEE)} on the platform, waived on any annual contract of 1,000+ units. HPD cure $600 per apartment ($400 on plan or platform); DOB $1,500 first two, $1,000 after — no plan discount. Plan labor: {Math.round(LABOR_SHARE * 100)}% of the fee at {money(LOADED_HOURLY)}/hour loaded = the included hours per unit per year shown; appliances, parts, materials and delivery at cost + {Math.round(MATERIALS_HANDLING * 100)}%.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <p className="px-3 pt-3 text-sm font-semibold text-slate-900">Examples</p>
        <table className="w-full min-w-[840px] text-sm">
          <thead><tr className="bg-slate-50"><th className={th}>Client</th><th className={`${th} text-right`}>Units</th><th className={th}>Band</th><th className={`${th} text-right`}>Platform /mo</th><th className={`${th} text-right`}>FIAREP plan /mo</th><th className={th}>Note</th></tr></thead>
          <tbody>
            {EXAMPLES.map((e) => { const x = ladderFees(e.units, bands); return (
              <tr key={e.name} className="border-t border-slate-100">
                <td className={`${td} font-medium text-slate-900`}>{e.name}</td>
                <td className={`${td} text-right`}>{e.units.toLocaleString()}</td>
                <td className={td}>{x.band.label}</td>
                <td className={`${td} text-right`}>{x.platform == null ? "—" : money(x.platform)}</td>
                <td className={`${td} text-right`}>{x.plan == null ? (x.band.from >= 50000 ? "task orders" : "—") : money(x.plan)}</td>
                <td className={`${td} text-slate-600`}>{e.note}</td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>


      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <p className="font-semibold text-slate-900">Where the numbers come from</p>
        <ul className="mt-2 space-y-1">
          {SOURCES.map((s) => <li key={s.what + s.url} className="text-slate-700"><span className="font-medium">{s.what}:</span> {s.figure} — <a href={s.url} target="_blank" rel="noreferrer" className="text-[#185FA5] underline">{new URL(s.url).hostname}</a></li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Software-only buyers pay $1–$5 per unit, so the platform must sit inside that range. The full-service plan is a retainer priced against the violation work, not against software.</p>
      </div>
    </div>
  );
}
