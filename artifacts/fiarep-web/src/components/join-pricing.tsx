import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DofLookupPanel } from "@/components/dof-lookup";
import { FEES, PLATFORM_INCLUDES, RETAINER_INCLUDES, expediterFee } from "@/lib/fiarep-plans";
import { usePricing } from "@/lib/pricing-overrides";

/** "What it costs" on the Join FIAREP page: expediter fee ranges, the full
 * cost picture for a typical 20-unit NYC building, how each agency works,
 * and a live estimator. Figures are typical NYC ranges, not a quote. */

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

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function JoinPricing({ unlocked, pending, onUnlock }: { unlocked: boolean; pending: boolean; onUnlock: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  // The per-unit ladder as the owner has set it in Platform Control. The price book stays there — never on this page.
  const pricing = usePricing();
  const bands = pricing.bands;
  const small = bands[0]!;
  const planBands = bands.filter((b) => b.planRate != null);
  const [dob, setDob] = useState(8);
  // HPD violations by class: counts only — the City's money comes from the DOF lookup, not from these.
  const [hpdA, setHpdA] = useState(40);
  const [hpdB, setHpdB] = useState(60);
  const [hpdC, setHpdC] = useState(20);
  const hpd = hpdA + hpdB + hpdC;
  // Apartments / locations the HPD violations are in — the cure is priced per apartment, not per violation.
  const [hpdApts, setHpdApts] = useState(25);
  // What the building owes the City, from the Department of Finance lookup (or typed).
  const [dofOwed, setDofOwed] = useState(0);
  // Engineering and repairs are typed in — the price book lives in Platform Control, FIAREP only.
  const [customRepair, setCustomRepair] = useState(0);
  const [customEng, setCustomEng] = useState(0);
  const est = useMemo(() => {
    // FIAREP per-job rates (no plan): DOB $1,500 for the first two, $1,000 each after; HPD cure $600 per apartment cited.
    const expediter = expediterFee(hpdApts, dob).total;
    const engineering = customEng;
    // DOF: what the building owes the City right now — from the lookup, never estimated from counts.
    const penalties = dofOwed;
    const repairs = customRepair;
    // If HPD's Emergency Repair Program does the work instead: 2–3× contractor cost + 15% admin fee, 9% interest.
    const erp = Math.round(repairs * 2.5 * 1.15);
    // FIAREP total: what we quote. DOF penalties are the City's, shown for reference only.
    return { expediter, engineering, penalties, repairs, erp, total: expediter + engineering + repairs };
  }, [dob, hpdApts, dofOwed, customRepair, customEng]);
  const max = Math.max(est.expediter, est.engineering, est.penalties, est.repairs, 1);
  const bars: Array<[string, number, string]> = [["Expediter", est.expediter, "bg-amber-400"], ["Engineering", est.engineering, "bg-sky-400"], ["DOF owed", est.penalties, "bg-slate-500"], ["Repairs", est.repairs, "bg-emerald-400"]];

  // Prices only: the words stay readable, the numbers blur until approved.
  const hide = unlocked ? "" : "blur-sm select-none";

  // The blur band: FIAREP's prices and the estimator stay on the page but
  // can't be read until the pilot request is approved (or a code is typed).
  const LockBand = ({ title }: { title: string }) => (
    <div className="absolute inset-0 z-10 flex items-center justify-center">
      <div className="mx-4 w-full max-w-xl rounded-xl border border-amber-500/50 bg-slate-950/95 p-5 text-center shadow-2xl">
        <p className="text-lg font-bold text-white">🔒 {title}</p>
        <p className="mt-1 text-sm text-slate-300">{pending ? "Your pilot request is in. This unlocks the moment FIAREP approves it." : "Sign up for a pilot and get approved to see FIAREP's pricing."}</p>
        {!pending && <Button className="mt-3 bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={() => document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" })}>Sign up</Button>}
        <form className="mt-4 flex items-center justify-center gap-2" onSubmit={(e) => { e.preventDefault(); if (code.length === 3) void onUnlock(code); }}>
          <span className="text-xs text-slate-400">Have an access code?</span>
          <input maxLength={3} autoCapitalize="off" autoCorrect="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 3))} placeholder="e.g. k3L" className="w-32 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-center text-sm font-semibold text-slate-100 focus:border-amber-400 focus:outline-none" />
          <Button type="submit" size="sm" variant="outline" className="border-amber-500/60 text-amber-200 hover:bg-amber-500/10" disabled={code.length !== 3}>Unlock</Button>
        </form>
      </div>
    </div>
  );

  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold text-white">What it costs</h2>
      {!unlocked && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/50 bg-slate-950/90 px-4 py-3">
          <p className="text-sm text-slate-200">🔒 {pending ? "Your pilot request is in — prices and the estimator unlock the moment FIAREP approves it." : "Prices and the estimator unlock when you sign up for a pilot and get approved."}</p>
          {!pending && <Button size="sm" className="bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={() => document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" })}>Sign up</Button>}
          <form className="ml-auto flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (code.length === 3) void onUnlock(code); }}>
            <span className="text-xs text-slate-400">Have an access code?</span>
            <input maxLength={3} autoCapitalize="off" autoCorrect="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 3))} placeholder="e.g. k3L" className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-center text-sm font-semibold text-slate-100 focus:border-amber-400 focus:outline-none" />
            <Button type="submit" size="sm" variant="outline" className="border-amber-500/60 text-amber-200 hover:bg-amber-500/10" disabled={code.length !== 3}>Unlock</Button>
          </form>
        </div>
      )}
      <p className="mt-1 text-sm text-slate-400">FIAREP rates, set against current New York City market rates and the official DOB / HPD penalty schedules (October 2026). Every pilot gets a written quote before any work starts.</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <div className="rounded-2xl border-2 border-amber-500/60 bg-gradient-to-br from-amber-500/15 to-slate-900/80 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">The FIAREP plan — best value</p>
            <h3 className={`mt-1 text-2xl font-bold text-white ${hide}`}>{money(small.planRate!)} per unit per month</h3>
            <p className={`text-sm text-slate-300 ${hide}`}>Minimum {money(small.planMin!)} / month. The rate steps down as the portfolio grows:</p>
          </div>
          <Button className="bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={() => document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" })}>Start the 60-day pilot</Button>
        </div>
        <table className={`mt-3 w-full text-sm ${hide}`}>
          <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400"><th className="py-1">Units</th><th className="py-1 text-right">Per unit / month</th><th className="py-1 text-right">Minimum / month</th></tr></thead>
          <tbody>
            {planBands.map((b) => <tr key={b.label} className="border-t border-amber-500/20"><td className="py-1 text-slate-200">{b.label}</td><td className="py-1 text-right font-semibold text-white">{money(b.planRate!)}</td><td className="py-1 text-right text-slate-300">{money(b.planMin!)}</td></tr>)}
            {bands.filter((b) => b.planRate == null).map((b) => <tr key={b.label} className="border-t border-amber-500/20"><td className="py-1 text-slate-200">{b.label}</td><td colSpan={2} className="py-1 text-right text-slate-300">platform per unit · work by task order, per building</td></tr>)}
          </tbody>
        </table>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {RETAINER_INCLUDES.map((line) => <li key={line} className={`flex gap-2 text-sm text-slate-200 ${line.includes("$") ? hide : ""}`}><span className="text-amber-400">✓</span>{line}</li>)}
        </ul>
        <p className="mt-3 text-xs text-slate-400">City penalties, DOB re-inspection fees and HPD dismissal requests pass through at cost on every plan.</p>
      </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Platform only — software, no FIAREP labor</p>
          <h3 className={`mt-1 text-2xl font-bold text-white ${hide}`}>{money(small.platformRate)} per unit per month</h3>
          <p className={`text-sm text-slate-300 ${hide}`}>Minimum {money(small.platformMin)} / month. Setup and staff training $1,500 one time per organization.</p>
          <table className={`mt-3 w-full text-sm ${hide}`}>
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400"><th className="py-1">Units</th><th className="py-1 text-right">Per unit / month</th><th className="py-1 text-right">Minimum / month</th></tr></thead>
            <tbody>{bands.map((b) => <tr key={b.label} className="border-t border-slate-800"><td className="py-1 text-slate-200">{b.label}</td><td className="py-1 text-right font-semibold text-white">{money(b.platformRate)}</td><td className="py-1 text-right text-slate-300">{money(b.platformMin)}</td></tr>)}</tbody>
          </table>
          <ul className="mt-4 grid gap-2">
            {PLATFORM_INCLUDES.map((line) => <li key={line} className="flex gap-2 text-sm text-slate-200"><span className="text-slate-400">✓</span>{line}</li>)}
          </ul>
          <p className="mt-3 text-xs text-slate-400">HPD cures at $400 per apartment; violation removal, expediting and hearings any time at the per-job rates below. Upgrade to the FIAREP plan whenever you want us on it.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Housing authorities, agencies & large portfolios</p>
          <p className="mt-1 font-semibold text-white">Above 50,000 units the plan is priced per development, not per unit — you get a written quote.</p>
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
                  <td className={`w-32 py-2 pl-3 text-right align-top font-semibold leading-snug text-amber-300 sm:w-44 ${hide}`}>{price.split(" · ").map((line) => <span key={line} className="block">{line}</span>)}</td>
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
      <div className="relative mt-4 overflow-hidden rounded-2xl border border-amber-500/30 bg-slate-900/80 p-5">
        <div className={unlocked ? "" : "pointer-events-none select-none blur-md"} aria-hidden={!unlocked}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Violation resolution estimator</h3>
            <p className="text-xs text-slate-400">Move the sliders to see a projected cost to clear DOB and HPD violations on one building.</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">FIAREP total</p>
            <p className="text-3xl font-bold text-amber-300">{money(est.total)}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            <Slider label="DOB violations (Class 1 / 2)" value={dob} min={0} max={1000} onChange={setDob} />
            <Slider label="HPD Class A violations (non-hazardous)" value={hpdA} min={0} max={1000} onChange={setHpdA} />
            <Slider label="HPD Class B violations (hazardous)" value={hpdB} min={0} max={1000} onChange={setHpdB} />
            <Slider label="HPD Class C violations (immediately hazardous)" value={hpdC} min={0} max={1000} onChange={setHpdC} />
            <Slider label="Apartments / locations with HPD violations" value={hpdApts} min={0} max={500} onChange={setHpdApts} />
            <DofLookupPanel onResult={(total) => setDofOwed(total)} onCounts={(c) => { setHpdA(c.hpdA); setHpdB(c.hpdB); setHpdC(c.hpdC); setDob(c.dob); if (c.apartments) setHpdApts(c.apartments); }} canSubmit={unlocked} quoted={{ expediter: est.expediter, repairs: est.repairs }} />
          </div>
          <div className="space-y-3">
            {bars.map(([label, amount, color]) => (
              <div key={label} className={label === "DOF owed" ? "opacity-60" : ""}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-300">{label}{label === "DOF owed" && <span className="ml-2 text-xs text-slate-500">Department of Finance — not in FIAREP total</span>}</span>
                  {label === "Engineering" || label === "Repairs" || label === "DOF owed" ? (
                    <span className="flex items-center gap-1 font-semibold text-slate-100">
                      <span>$</span>
                      <input
                        type="number" inputMode="numeric" min={0} step={500}
                        value={amount}
                        onChange={(e) => { const n = Math.max(0, Math.round(Number(e.target.value) || 0)); if (label === "Engineering") setCustomEng(n); else if (label === "Repairs") setCustomRepair(n); else setDofOwed(n); }}
                        className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-sm font-semibold text-slate-100 focus:border-amber-400 focus:outline-none"
                        aria-label={`${label} amount`}
                      />
                    </span>
                  ) : <span className={`font-semibold ${label === "DOF owed" ? "text-slate-400" : "text-slate-100"}`}>{money(amount)}</span>}
                </div>
                <div className="mt-1 h-3 w-full rounded-full bg-slate-800"><div className={`h-3 rounded-full ${color}`} style={{ width: `${Math.max(2, (amount / max) * 100)}%` }} /></div>
              </div>
            ))}
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-sm">
              <p className="font-semibold text-rose-200">If HPD's Emergency Repair Program does this work instead: ~{money(est.erp)}</p>
              <p className="text-xs text-rose-200/80">HPD bills 2–3× contractor cost plus a 15% administrative fee, 9% interest, and a lien on the building. Owners of the 250 buildings in the 2026 Alternative Enforcement Program already owe $4.5M for emergency repairs.</p>
            </div>
            <p className="pt-2 text-xs text-slate-500">Expediter: $600 per apartment with HPD violations — all of them certified together — plus the DOB rate per violation (on the FIAREP plan: $400 per apartment and 20% off DOB, {money(expediterFee(hpdApts, dob).plan)}). DOF owed is what the building owes the City right now, from the Department of Finance lookup — grayed, not part of the FIAREP total; HPD Class A / B / C counts show what's open; the apartment count is what's billed. Engineering and repairs: type the quotes you have — we price the actual violations after we look at them.</p>
          </div>
        </div>
        </div>
        {!unlocked && <LockBand title="Violation resolution estimator" />}
      </div>
    </section>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, money: isMoney, muted }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; money?: boolean; muted?: boolean }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? Math.round(n) : min));
  return (
    <div className={muted ? "opacity-60" : ""}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-300">{label}{muted && <span className="ml-2 text-xs text-slate-500">not in FIAREP total</span>}</span>
        <span className="flex items-center gap-1 font-semibold text-slate-100">
          {isMoney && <span>$</span>}
          <input
            type="number" inputMode="numeric" min={min} max={max} step={step} value={value}
            onChange={(e) => onChange(clamp(Number(e.target.value)))}
            className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-sm font-semibold text-slate-100 focus:border-amber-400 focus:outline-none"
            aria-label={label}
          />
        </span>
      </div>
      <input type="range" className={`mt-1 w-full ${muted ? "accent-slate-500" : "accent-amber-500"}`} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="flex justify-between text-[10px] text-slate-500"><span>{isMoney ? money(min) : min}</span><span>{isMoney ? money(max) : max.toLocaleString()}</span></div>
    </div>
  );
}
