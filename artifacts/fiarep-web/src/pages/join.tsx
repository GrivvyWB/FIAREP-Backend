import { useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { JoinPricing } from "@/components/join-pricing";
import { ArrowLeft, Building2, CheckCircle2, Phone, Plus, ShieldCheck, Trash2, Zap } from "lucide-react";

/**
 * Join FIAREP — for management companies, owners and agencies. Opened from
 * the 24/7 badge at the bottom of the site. Two windows: what FIAREP does,
 * and the pilot sign-up (company, portfolio, developments, units, contacts).
 */

const SERVICES = [
  { key: "violations", icon: ShieldCheck, title: "Violation removal", body: "DOB, HPD, ECB / OATH. We inspect the condition, get it corrected, file the Certificate of Correction and the proof, and push it through until the violation is cleared and the penalty is waived or reduced." },
  { key: "complaints", icon: Phone, title: "Complaint calls, 24 / 7", body: "Residents reach a live line any hour. Every call becomes a tracked complaint — received, opened, assigned, on the way, done — and the resident is told at each step." },
  { key: "expediting", icon: Zap, title: "Expediting — whatever is needed", body: "Permits, filings, inspections, sign-offs, agency appointments. If the job is waiting on paper, we move the paper." },
  { key: "pest", icon: Building2, title: "Vermin / pest compliance", body: "Treatment requests, licensed extermination, multi-visit treatment logs and tenant acknowledgments that stand up to an HPD or NYCHA inspection." },
  { key: "lead", icon: ShieldCheck, title: "Lead paint compliance", body: "Disclosure, XRF and dust-wipe tracking, EPA RRP contractors, daily work logs, clearance exams and violation closure — with children under 6 flagged." },
  { key: "platform", icon: CheckCircle2, title: "The FIAREP platform", body: "Management, supervisors, workers, inspectors, residents and vendors on one app and website — complaints, violations, projects, scopes, time clock, scores and reports." },
];

type Dev = { name: string; address: string; units: string };
const emptyDev = (): Dev => ({ name: "", address: "", units: "" });

export default function JoinFiarep() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [portfolioSize, setPortfolioSize] = useState("");
  const [devs, setDevs] = useState<Dev[]>([emptyDev()]);
  const [wanted, setWanted] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string>("");

  const setDev = (i: number, patch: Partial<Dev>) => setDevs((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const totalUnits = devs.reduce((n, d) => n + (parseInt(d.units, 10) || 0), 0);

  async function submit() {
    if (!company.trim() || !contactName.trim() || (!phone.trim() && !email.trim())) {
      toast({ variant: "destructive", title: "Company, your name, and a phone or email are required" });
      return;
    }
    setBusy(true);
    try {
      const r = await customFetch<{ ok: boolean; id: string }>("/api/v1/public/join-requests", {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({
          company, contactName, phone, email, address, portfolioSize, notes,
          developments: devs.filter((d) => d.name.trim() || d.address.trim()),
          services: SERVICES.filter((s) => wanted[s.key]).map((s) => s.title),
        }),
      } as never);
      setSent(r.id);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not send", description: err?.data?.error || err?.message || "Try again." });
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <button type="button" onClick={() => setLocation("/")} className="mb-6 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to FIAREP.com
        </button>

        {/* ── Hero ── */}
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <img src="/platform-media/fiarep-247-logo.png" alt="24/7 FIAREP Management Service / Expediting" className="h-40 w-auto rounded-xl bg-white p-2 shadow-lg sm:h-52" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">24 / 7 · Management Service · Expediting</p>
            <h1 className="mt-1 text-3xl font-bold sm:text-5xl">Join FIAREP</h1>
            <p className="mt-3 max-w-xl text-lg text-slate-300">We take the violations off your buildings, answer your residents' complaint calls around the clock, and expedite whatever the job is waiting on. Pilot it on one development or your whole portfolio.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button className="bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={() => document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" })}>Start a pilot</Button>
              <Button variant="outline" className="border-slate-700 text-slate-200 hover:bg-slate-800" asChild><a href="mailto:fiarep@outlook.com?subject=Join%20FIAREP">Email FIAREP</a></Button>
            </div>
          </div>
        </div>

        {/* ── Window 1: what we do ── */}
        <section className="mt-12">
          <h2 className="text-2xl font-semibold text-white">What FIAREP does for you</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((s) => (
              <div key={s.key} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <s.icon className="h-6 w-6 text-amber-400" />
                <h3 className="mt-3 font-semibold text-white">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <JoinPricing />

        {/* ── Window 3: pilot sign-up ── */}
        <section id="signup" className="mt-12 rounded-2xl border border-amber-500/30 bg-slate-900/80 p-6 shadow-xl">
          <h2 className="text-2xl font-semibold text-white">Start a pilot</h2>
          <p className="mt-1 text-sm text-slate-400">Tell us about your portfolio and which developments you want to start with. We call you back the same business day.</p>

          {sent ? (
            <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-5">
              <p className="flex items-center gap-2 text-lg font-semibold text-emerald-300"><CheckCircle2 className="h-5 w-5" /> Received — thank you.</p>
              <p className="mt-1 text-sm text-emerald-200/80">FIAREP has your request (ref {sent.slice(0, 8).toUpperCase()}). We'll reach you at {phone || email}.</p>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company / agency *"><Input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. ABC Inc." /></Field>
                <Field label="Your name *"><Input className={inputCls} value={contactName} onChange={(e) => setContactName(e.target.value)} /></Field>
                <Field label="Phone *"><Input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
                <Field label="Email"><Input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Office address" wide><Input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
                <Field label="Portfolio size (developments / buildings you manage in total)"><Input className={inputCls} value={portfolioSize} onChange={(e) => setPortfolioSize(e.target.value)} placeholder="e.g. 12 developments, 2,400 units" /></Field>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-white">Developments to pilot</p>
                  <p className="text-xs text-slate-400">{devs.length} development{devs.length === 1 ? "" : "s"}{totalUnits ? ` · ${totalUnits.toLocaleString()} units` : ""}</p>
                </div>
                <div className="mt-2 space-y-2">
                  {devs.map((d, i) => (
                    <div key={i} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-[1fr_1.4fr_110px_40px]">
                      <Input className={inputCls} value={d.name} onChange={(e) => setDev(i, { name: e.target.value })} placeholder="Development name" />
                      <Input className={inputCls} value={d.address} onChange={(e) => setDev(i, { address: e.target.value })} placeholder="Address" />
                      <Input className={inputCls} inputMode="numeric" value={d.units} onChange={(e) => setDev(i, { units: e.target.value.replace(/\D/g, "") })} placeholder="Units" />
                      <Button type="button" variant="ghost" size="icon" className="text-slate-400 hover:text-red-400" disabled={devs.length === 1} onClick={() => setDevs((rows) => rows.filter((_, idx) => idx !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2 border-slate-700 text-slate-200 hover:bg-slate-800" onClick={() => setDevs((rows) => [...rows, emptyDev()])}><Plus className="mr-1 h-4 w-4" /> Add a development</Button>
              </div>

              <div>
                <p className="font-semibold text-white">What do you want FIAREP to handle?</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {SERVICES.map((s) => (
                    <label key={s.key} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-amber-500" checked={!!wanted[s.key]} onChange={(e) => setWanted((w) => ({ ...w, [s.key]: e.target.checked }))} />
                      {s.title}
                    </label>
                  ))}
                </div>
              </div>

              <Field label="Anything else (open violations, deadlines, current vendors…)"><Textarea className={`${inputCls} min-h-[90px]`} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

              <div className="flex flex-wrap items-center gap-3">
                <Button className="bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={busy} onClick={() => void submit()}>{busy ? "Sending…" : "Send my pilot request"}</Button>
                <p className="text-xs text-slate-500">Goes straight to FIAREP. No account needed.</p>
              </div>
            </div>
          )}
        </section>

        <p className="mt-10 text-center text-xs text-slate-500">FIAREP · 24/7 Management Service / Expediting · fiarep@outlook.com</p>
      </div>
    </div>
  );
}

const inputCls = "border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500";
function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  );
}
