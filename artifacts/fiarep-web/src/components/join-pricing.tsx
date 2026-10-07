import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

/** "What it costs" on the Join FIAREP page: expediter fee ranges, the full
 * cost picture for a typical 20-unit NYC building, how each agency works,
 * and a live estimator. Figures are typical NYC ranges, not a quote. */

const FEES = [
  ["Simple cure — Class A, smoke / CO detector, minor electrical, HPD certification of correction", "$400 per violation", "Certificate of correction, proof of fix, administrative non-compliance."],
  ["Standard DOB / HPD violation removal", "$1,500 flat · $1,000 each from the 3rd on the same building", "Records research, post-approval permits, inspections with city officials, certifying compliance."],
  ["Complex DOB cure — PE / RA sign-off, DOB NOW filings", "$2,500 + engineer at cost", "Unpermitted structural or mechanical work, multi-trade coordination, engineer letters (typically $500 – $2,000+)."],
  ["Stop Work / Vacate Order removal", "$3,000", "Emergency filings, examiner negotiations, rescinding the order. More if plans must be filed."],
  ["OATH / ECB hearing appearance", "$600 per hearing · $250 to admit and cure", "Appearance and mitigation argument; case preparation included."],
  ["Motion to vacate a default judgment", "$350 within 60 days · $850 special motion", "Gets a defaulted summons back in front of a hearing officer."],
  ["Permit filings", "Alt-3 $750 · Alt-2 $1,200 · Alt-1 $2,250", "DOB filing fees are separate. Open-permit closures $750 per permit."],
  ["Hourly — research, zoning, multi-agency", "$175 per hour", "Extensive records research, complex zoning questions, multi-agency coordination."],
];

const RETAINER_INCLUDES = [
  "The FIAREP platform — app and website — for all of your staff and residents",
  "24 / 7 complaint monitoring through the platform and app — every complaint tracked and the resident told at each step",
  "HPD / DOB monitoring of every address in the development",
  "1 simple cure per 10 units each month (a 100-unit development: 10 cures a month)",
  "OATH hearings at $400 instead of $600; everything else 20% off the rates below",
  "Pilot: first 60 days at half price, no contract",
];

const BUCKETS = [
  ["Expediter services", "$1,800 – $6,500", "Certificates of Correction (AEU-2), dismissal inspections, work permits, clearing HPD violations."],
  ["Architect / Engineer (PE)", "$2,500 – $7,500", "Needed when work was done without a permit — as-built plans, DOB NOW filings, structural sign-offs."],
  ["City civil fines & ECB penalties", "$1,500 – $12,000+", "DOB Class 1 default $12,500 (max $25,000); Class 2 default $6,250; HPD Class C up to $1,200 per day; lead paint $250 / day up to $10,000."],
  ["Contractor physical repairs", "$2,500 – $25,000+", "Correcting unpermitted plumbing / electrical, fire doors and egress to code, Class B/C lead or mold."],
];

const AGENCIES = [
  { name: "DOB — Department of Buildings", lines: ["Work Without a Permit: 21× the permit fee on multi-family buildings — minimum $6,000, maximum $15,000 (6×, $600 – $10,000 on 1–2 family homes).", "OATH penalties: Class 1 $2,500 standard / $12,500 default / $25,000 max; Class 2 $1,250 / $6,250 / $10,000; Class 3 $500. Re-inspection after a failure to correct: $225.", "We draft the Certificate of Correction, coordinate DOB inspection sign-offs and file DOB NOW."] },
  { name: "HPD — Housing Preservation & Development", lines: ["Class A $50 – $150 (+$25 / day) · Class B $75 – $500 (+$25 – $125 / day) · Class C over 5 units $150 – $1,200 (+$150 – $1,200 / day) · lead paint $250 / day up to $10,000 · heat / hot water $350 – $1,250 / day.", "Certification of correction is free; a dismissal request runs $250 – $1,000 by property type and count.", "We file the certification or Notice of Correction before the deadline — 24 hours for Class C, 30 days B, 90 days A — so court fines never start."] },
  { name: "OATH / ECB — hearings", lines: ["A missed summons defaults: Class 1 $12,500, up to $25,000 per summons, plus up to $1,000 per day uncorrected.", "We file motions to vacate default judgments and represent you at the hearing.", "$300 – $950 per hearing appearance."] },
];

const REPAIR = [["Minor", 1500], ["Medium", 5000], ["Major", 12000], ["Heavy", 25000]] as const;
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function JoinPricing() {
  const [dob, setDob] = useState(2);
  const [hpd, setHpd] = useState(4);
  const [fines, setFines] = useState(2500);
  const [repair, setRepair] = useState(1);
  const [plans, setPlans] = useState(true);
  const est = useMemo(() => {
    // FIAREP per-job rates: DOB $1,500 for the first two, $1,000 each after; HPD simple cure $400.
    const expediter = Math.min(dob, 2) * 1500 + Math.max(dob - 2, 0) * 1000 + hpd * 400;
    const engineering = plans ? 2500 + dob * 500 : 0;
    // What the City charges if the violations sit: DOB standard penalty, HPD Class B/C civil penalty.
    const penalties = fines + dob * 1250 + hpd * 300;
    const repairs = REPAIR[repair]![1];
    return { expediter, engineering, penalties, repairs, total: expediter + engineering + penalties + repairs };
  }, [dob, hpd, fines, repair, plans]);
  const max = Math.max(est.expediter, est.engineering, est.penalties, est.repairs, 1);
  const bars: Array<[string, number, string]> = [["Expediter", est.expediter, "bg-amber-400"], ["Engineering", est.engineering, "bg-sky-400"], ["Fines & penalties", est.penalties, "bg-rose-400"], ["Repairs", est.repairs, "bg-emerald-400"]];

  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold text-white">What it costs</h2>
      <p className="mt-1 text-sm text-slate-400">FIAREP rates, set against current New York City market rates and the official DOB / HPD penalty schedules (October 2026). Every pilot gets a written quote before any work starts.</p>

      <div className="mt-4 rounded-2xl border-2 border-amber-500/60 bg-gradient-to-br from-amber-500/15 to-slate-900/80 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">The FIAREP plan — best value</p>
            <h3 className="mt-1 text-2xl font-bold text-white">$20 per unit per month</h3>
            <p className="text-sm text-slate-300">Minimum $1,000 / month. A 20-unit building is $1,000; 100 units is $2,000; 500 units is $10,000.</p>
          </div>
          <Button className="bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={() => document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" })}>Start the 60-day pilot</Button>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {RETAINER_INCLUDES.map((line) => <li key={line} className="flex gap-2 text-sm text-slate-200"><span className="text-amber-400">✓</span>{line}</li>)}
        </ul>
        <p className="mt-3 text-xs text-slate-400">City penalties, DOB re-inspection fees ($225) and HPD dismissal requests ($250 – $1,000) pass through at cost on every plan.</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Housing authorities, agencies & large portfolios</p>
          <p className="mt-1 font-semibold text-white">2,500 units or more? The per-unit plan doesn't apply — you get a per-development quote.</p>
          <p className="text-sm text-slate-400">Platform license tiered by volume, services on a fixed rate card your procurement office can attach to a contract, and a 2–3 development pilot to start.</p>
        </div>
        <Button variant="outline" className="border-amber-500/60 text-amber-200 hover:bg-amber-500/10" asChild><a href="mailto:fiarep@outlook.com?subject=FIAREP%20per-development%20quote">Request a per-development quote</a></Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="font-semibold text-white">Per-job rates (no plan)</h3>
          <table className="mt-3 w-full table-fixed text-sm">
            <tbody>
              {FEES.map(([k, price, what]) => (
                <tr key={k} className="border-t border-slate-800 align-top">
                  <td className="py-2 pr-3"><p className="font-medium text-slate-100">{k}</p><p className="text-xs text-slate-400">{what}</p></td>
                  <td className="w-32 py-2 pl-3 text-right align-top font-semibold leading-snug text-amber-300 sm:w-44">{price.split(" · ").map((line) => <span key={line} className="block">{line}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">Flat per violation or task; hourly only for research-heavy work. Plan members pay 20% less.</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="font-semibold text-white">The whole picture — a 20-unit building</h3>
          <p className="text-xs text-slate-400">The expediter fee covers consulting, paperwork, tracking and city liaison. Three more buckets usually apply:</p>
          <table className="mt-3 w-full table-fixed text-sm">
            <tbody>
              {BUCKETS.map(([k, price, what]) => (
                <tr key={k} className="border-t border-slate-800 align-top">
                  <td className="py-2 pr-3"><p className="font-medium text-slate-100">{k}</p><p className="text-xs text-slate-400">{what}</p></td>
                  <td className="w-32 py-2 pl-3 text-right align-top font-semibold leading-snug text-amber-300 sm:w-44">{price.split(" · ").map((line) => <span key={line} className="block">{line}</span>)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-amber-500/40">
                <td className="py-2 pr-3 font-semibold text-white">Estimated total project cost</td>
                <td className="w-32 py-2 pl-3 text-right text-lg font-bold leading-snug text-amber-300 sm:w-44">$8,300 – $51,000+</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Varies with whether DOB plans are required and the severity of open ECB fines.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {AGENCIES.map((a) => (
          <div key={a.name} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="font-semibold text-white">{a.name}</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-400">{a.lines.map((l) => <li key={l}>• {l}</li>)}</ul>
          </div>
        ))}
      </div>

      {/* Estimator */}
      <div className="mt-4 rounded-2xl border border-amber-500/30 bg-slate-900/80 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Violation resolution estimator</h3>
            <p className="text-xs text-slate-400">Move the sliders to see a projected cost to clear DOB and HPD violations on one building.</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">Total estimated expense</p>
            <p className="text-3xl font-bold text-amber-300">{money(est.total)}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            <Slider label="DOB violations (Class 1 / 2)" value={dob} min={0} max={20} onChange={setDob} />
            <Slider label="HPD violations (Class B / C)" value={hpd} min={0} max={40} onChange={setHpd} />
            <Slider label="Existing civil fines" value={fines} min={0} max={30000} step={250} onChange={setFines} display={money(fines)} />
            <div>
              <p className="text-sm text-slate-300">Contractor work scale</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {REPAIR.map(([label, amount], i) => (
                  <button key={label} type="button" onClick={() => setRepair(i)} className={`rounded-lg border px-3 py-1.5 text-sm ${repair === i ? "border-amber-400 bg-amber-500/20 text-amber-200" : "border-slate-700 text-slate-300 hover:bg-slate-800"}`}>{label} ({money(amount)})</button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" className="h-4 w-4 accent-amber-500" checked={plans} onChange={(e) => setPlans(e.target.checked)} />
              Engineering drawings required (stamped architectural or structural plans)
            </label>
          </div>
          <div className="space-y-3">
            {bars.map(([label, amount, color]) => (
              <div key={label}>
                <div className="flex justify-between text-sm"><span className="text-slate-300">{label}</span><span className="font-semibold text-slate-100">{money(amount)}</span></div>
                <div className="mt-1 h-3 w-full rounded-full bg-slate-800"><div className={`h-3 rounded-full ${color}`} style={{ width: `${Math.max(2, (amount / max) * 100)}%` }} /></div>
              </div>
            ))}
            <p className="pt-2 text-xs text-slate-500">Expediter uses FIAREP's per-job rates above (plan members pay 20% less: {money(Math.round(est.expediter * 0.8))}). Fines & penalties are what the City charges if the violations sit — clearing them on time is how most of that goes away. Engineering and repairs are quoted after we look at the actual violations.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, display }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; display?: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="text-slate-300">{label}</span><span className="font-semibold text-slate-100">{display ?? value}</span></div>
      <input type="range" className="mt-1 w-full accent-amber-500" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
