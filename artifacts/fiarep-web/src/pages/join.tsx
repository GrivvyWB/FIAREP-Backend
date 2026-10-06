import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * Join FIAREP — for management companies, owners and agencies that want the
 * service. Opened from the 24/7 badge on every public page. Sections are
 * filled in as the owner provides them.
 */
export default function JoinFiarep() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <button type="button" onClick={() => setLocation("/")} className="mb-6 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <img src="/platform-media/fiarep-247-logo.png" alt="24/7 FIAREP Management Service / Expediting" className="h-36 w-auto rounded-xl bg-white p-2 shadow-lg sm:h-44" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">24 / 7</p>
            <h1 className="mt-1 text-3xl font-bold sm:text-4xl">Join FIAREP</h1>
            <p className="mt-2 text-lg text-slate-300">Management Service / Expediting</p>
          </div>
        </div>

        {/* ── Sections: filled in as provided ── */}
        <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-xl font-semibold text-white">What you get</h2>
          <p className="mt-2 text-slate-400">Details coming soon.</p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-xl font-semibold text-white">How to join</h2>
          <p className="mt-2 text-slate-400">Details coming soon.</p>
        </section>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button className="bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={() => { window.location.href = "mailto:fiarep@outlook.com?subject=Join%20FIAREP"; }}>Contact FIAREP</Button>
          <Button variant="outline" className="border-slate-700 text-slate-200 hover:bg-slate-800" onClick={() => setLocation("/")}>Back to FIAREP.com</Button>
        </div>
      </div>
    </div>
  );
}
