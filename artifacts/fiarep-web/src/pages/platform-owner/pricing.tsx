import { useState } from "react";
import { Input } from "@/components/ui/input";
import { BANDS, CURRENT_VS_PROPOSED, EXAMPLES, SETUP_FEE, SOURCES, ladderFees } from "@/lib/pricing-ladder";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500";
const td = "px-3 py-2 align-top";

/** Platform Control → Pricing ladder: the recommended per-unit bands from 2 to
 * 300,000 units, a calculator, worked examples, what is live today vs the
 * recommendation, and the sources. Display only — live prices stay in
 * fiarep-plans.ts until changed there. */
export default function OwnerPricing() {
  const [units, setUnits] = useState(147);
  const f = ladderFees(Math.max(0, Math.round(units || 0)));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">Pricing ladder — 2 to 300,000 units</h1>
        <p className="text-sm text-slate-500">Recommended bands. Per unit means per dwelling unit per month; the monthly fee is the greater of units × rate and the band minimum. The prices clients see on the site are still the ones in the plan file until you change them.</p>
      </div>

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm font-medium text-slate-900">Units
            <Input type="number" inputMode="numeric" min={1} max={300000} value={units} onChange={(e) => setUnits(Number(e.target.value))} className="mt-1 w-40 bg-white" />
          </label>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Band</p><p className="text-lg font-semibold text-slate-950">{f.band.label}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Platform</p><p className="text-lg font-semibold text-slate-950">{money(f.platform)}<span className="text-sm font-normal text-slate-500">/mo · {money(f.platform * 12)}/yr</span></p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">FIAREP plan</p><p className="text-lg font-semibold text-slate-950">{f.plan == null ? "per-building task orders" : <>{money(f.plan)}<span className="text-sm font-normal text-slate-500">/mo · {money(f.plan * 12)}/yr</span></>}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">AEP fee exposure</p><p className="text-lg font-semibold text-rose-700">{money(f.aepExposure)}</p></div>
        </div>
        <p className="mt-2 text-xs text-slate-600">AEP exposure = units × $1,000, HPD's cap ($500 per unit every six months once a building is not discharged within four months). That is what a client avoids by curing fast — the full-service pitch.</p>
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[840px] text-sm">
          <thead><tr className="bg-slate-50"><th className={th}>Band</th><th className={`${th} text-right`}>Platform $/unit</th><th className={`${th} text-right`}>Platform min</th><th className={`${th} text-right`}>FIAREP plan $/unit</th><th className={`${th} text-right`}>Plan min</th><th className={th}>Notes</th></tr></thead>
          <tbody>
            {BANDS.map((b) => (
              <tr key={b.label} className={`border-t border-slate-100 ${b.label === f.band.label ? "bg-amber-50" : ""}`}>
                <td className={`${td} font-semibold text-slate-900`}>{b.label}</td>
                <td className={`${td} text-right`}>{money(b.platformRate)}</td>
                <td className={`${td} text-right`}>{money(b.platformMin)}/mo</td>
                <td className={`${td} text-right`}>{b.planRate == null ? "—" : money(b.planRate)}</td>
                <td className={`${td} text-right`}>{b.planMin == null ? "—" : `${money(b.planMin)}/mo`}</td>
                <td className={`${td} text-slate-600`}>{b.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-slate-500">One-time setup {money(SETUP_FEE)} on the platform, waived on any annual contract of 1,000+ units. HPD cure $600 per apartment ($400 on plan or platform); DOB $1,500 first two, $1,000 after, 20% off on plan — unchanged.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <p className="px-3 pt-3 text-sm font-semibold text-slate-900">Examples</p>
        <table className="w-full min-w-[840px] text-sm">
          <thead><tr className="bg-slate-50"><th className={th}>Client</th><th className={`${th} text-right`}>Units</th><th className={th}>Band</th><th className={`${th} text-right`}>Platform /mo</th><th className={`${th} text-right`}>FIAREP plan /mo</th><th className={`${th} text-right`}>AEP exposure</th><th className={th}>Note</th></tr></thead>
          <tbody>
            {EXAMPLES.map((e) => { const x = ladderFees(e.units); return (
              <tr key={e.name} className="border-t border-slate-100">
                <td className={`${td} font-medium text-slate-900`}>{e.name}</td>
                <td className={`${td} text-right`}>{e.units.toLocaleString()}</td>
                <td className={td}>{x.band.label}</td>
                <td className={`${td} text-right`}>{money(x.platform)}</td>
                <td className={`${td} text-right`}>{x.plan == null ? "task orders" : money(x.plan)}</td>
                <td className={`${td} text-right text-rose-700`}>{money(x.aepExposure)}</td>
                <td className={`${td} text-slate-600`}>{e.note}</td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <p className="px-3 pt-3 text-sm font-semibold text-slate-900">In the code today vs. recommended</p>
        <table className="w-full min-w-[840px] text-sm">
          <thead><tr className="bg-slate-50"><th className={th}>Plan</th><th className={th}>Today</th><th className={th}>Recommended</th><th className={th}>Change</th></tr></thead>
          <tbody>
            {CURRENT_VS_PROPOSED.map((r) => (
              <tr key={r.plan} className="border-t border-slate-100"><td className={`${td} font-medium text-slate-900`}>{r.plan}</td><td className={`${td} text-slate-700`}>{r.today}</td><td className={`${td} text-slate-700`}>{r.proposed}</td><td className={`${td} text-slate-600`}>{r.change}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <p className="font-semibold text-slate-900">Where the numbers come from</p>
        <ul className="mt-2 space-y-1">
          {SOURCES.map((s) => <li key={s.what + s.url} className="text-slate-700"><span className="font-medium">{s.what}:</span> {s.figure} — <a href={s.url} target="_blank" rel="noreferrer" className="text-[#185FA5] underline">{new URL(s.url).hostname}</a></li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Software-only buyers pay $1–$5 per unit, so the platform must sit inside that range. The full-service plan is a retainer priced against AEP and violation exposure, not against software.</p>
      </div>
    </div>
  );
}
