import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, FileText, Trash2, X } from "lucide-react";
import { EXPEDITER, expediterFee } from "@/lib/fiarep-plans";

type WorkRequest = {
  id: string; createdAt: string; status: string; company: string; contact: string; email: string; phone: string;
  address: string; borough: string; block: string; lot: string; bbl: string; bin: string; units: number; apartments?: number;
  hpdA: number; hpdB: number; hpdC: number; dob: number; dofOwed: number; notes: string;
  hpdTypes?: Array<{ type: string; count: number; a: number; b: number; c: number; jobs: number }>; dobTypes?: Array<{ type: string; count: number }>;
  quotedExpediter?: number; quotedRepairs?: number; quotedTotal?: number; quotedAt?: string; contractNumber?: string; decidedAt?: string; decidedBy?: string; message?: string;
};
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** Platform Control → Job requests: buildings submitted from the Join page
 * with their open-violation counts. Accept starts the violation work under
 * the client's plan; "Build contract" carries the building into the price
 * book for the repair quote. */
export default function OwnerWorkRequests() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [rows, setRows] = useState<WorkRequest[]>([]);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<"new" | "accepted" | "quoted" | "declined" | "all">("new");
  const [message, setMessage] = useState<Record<string, string>>({});
  // Expediter fee per request: computed from the counts that came over; FIAREP can adjust apartments / DOB here.
  const [adj, setAdj] = useState<Record<string, { apartments: number; dob: number }>>({});
  const feeFor = (r: WorkRequest) => { const a = adj[r.id] || { apartments: r.apartments || 0, dob: r.dob || 0 }; return { ...a, ...expediterFee(a.apartments, a.dob) }; };
  // Quick pricing for a building that didn't come through the site.
  const [quick, setQuick] = useState({ apartments: 0, dob: 0 });
  const quickFee = expediterFee(quick.apartments, quick.dob);

  async function reload() {
    try { setRows(await customFetch<WorkRequest[]>("/api/v1/platform/work-requests", { responseType: "json" } as never)); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not load job requests", description: err?.data?.error || err?.message }); }
  }
  useEffect(() => { void reload(); }, []);

  async function decide(r: WorkRequest, decision: "accept" | "decline") {
    if (decision === "decline" && !window.confirm(`Decline ${r.address}?`)) return;
    setBusy(r.id);
    try {
      const out = await customFetch<{ status: string; emailed: boolean }>(`/api/v1/platform/work-requests/${encodeURIComponent(r.id)}/${decision}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message[r.id] || "" }), responseType: "json" } as never);
      toast({ title: `${r.address} ${out.status}`, description: out.emailed ? `Emailed ${r.email}.` : r.email ? "Email did not send — call them." : "No email on the request — call them." });
      await reload();
    } catch (err: any) { toast({ variant: "destructive", title: "Could not update", description: err?.data?.error || err?.message }); }
    finally { setBusy(""); }
  }
  async function remove(r: WorkRequest) {
    if (!window.confirm(`Permanently delete ${r.address} (${r.company})? This removes the request and any contract sent for it. It cannot be undone.`)) return;
    setBusy(r.id);
    try { await customFetch(`/api/v1/platform/work-requests/${encodeURIComponent(r.id)}`, { method: "DELETE", responseType: "json" } as never); toast({ title: `Deleted ${r.address}` }); await reload(); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not delete", description: err?.data?.error || err?.message }); }
    finally { setBusy(""); }
  }
  function buildContract(r: WorkRequest) {
    const q = new URLSearchParams({ request: r.id, company: r.company, contact: r.contact, email: r.email, phone: r.phone, building: r.address, units: String(r.units || 0), dob: String(r.dob || 0) });
    setLocation(`/platform-owner/repair-prices?${q.toString()}`);
  }

  const shown = rows.filter((r) => filter === "all" || (r.status || "new") === filter);
  const count = (s: string) => rows.filter((r) => (r.status || "new") === s).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Job requests</h1>
          <p className="text-sm text-slate-500">Buildings clients submitted from fiarep.com/join with their open-violation counts. Accept to start the violation work; build the contract for the repair quote.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {(["new", "accepted", "quoted", "declined", "all"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-md px-3 py-1 capitalize ${filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{f}{f !== "all" ? ` (${count(f)})` : ""}</button>
          ))}
        </div>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-950">Expediter fee — violations only</h2>
            <p className="text-xs text-slate-500">${EXPEDITER.perApartment} per apartment / location with HPD violations (all certified together), ${EXPEDITER.perApartmentPlan} on the FIAREP plan or the platform · DOB ${EXPEDITER.dobFirstTwo.toLocaleString()} each for the first two, ${EXPEDITER.dobAfter.toLocaleString()} each after, plan members {EXPEDITER.planDiscount * 100}% off. No repairs in this number.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="text-slate-700">Apartments cited<input type="number" inputMode="numeric" min={0} value={quick.apartments || ""} placeholder="0" onChange={(e) => setQuick({ ...quick, apartments: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="mt-1 block w-24 rounded-md border border-slate-300 px-2 py-1 text-right font-semibold text-slate-900 focus:border-amber-500 focus:outline-none" /></label>
            <label className="text-slate-700">DOB violations<input type="number" inputMode="numeric" min={0} value={quick.dob || ""} placeholder="0" onChange={(e) => setQuick({ ...quick, dob: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="mt-1 block w-24 rounded-md border border-slate-300 px-2 py-1 text-right font-semibold text-slate-900 focus:border-amber-500 focus:outline-none" /></label>
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-right">
              <p className="text-xs uppercase tracking-wide text-amber-700">FIAREP makes</p>
              <p className="text-xl font-bold text-slate-950">{money(quickFee.total)}</p>
              <p className="text-xs text-slate-600">HPD {money(quickFee.hpd)} · DOB {money(quickFee.dob)} · plan member {money(quickFee.plan)}</p>
            </div>
          </div>
        </div>
      </section>
      {shown.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No {filter === "all" ? "" : filter} job requests.</p>}
      {shown.map((r) => (
        <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-950">{r.address}</p>
              <p className="text-sm text-slate-600">{r.borough} · Block {r.block || "—"} · Lot {r.lot || "—"}{r.bbl ? ` · BBL ${r.bbl}` : ""}{r.bin ? ` · BIN ${r.bin}` : ""}{r.units ? ` · ${r.units} units` : ""}</p>
              <p className="text-sm text-slate-600">{r.company} — {r.contact}{r.phone ? ` · ${r.phone}` : ""}{r.email ? ` · ${r.email}` : ""}</p>
              <p className="mt-1 text-xs text-slate-400">Received {when(r.createdAt)}{r.decidedAt ? ` · ${r.status === "quoted" ? "accepted" : r.status} ${when(r.decidedAt)} by ${r.decidedBy}` : ""}{r.quotedAt ? ` · quoted ${money(r.quotedTotal || 0)} ${when(r.quotedAt)} (${r.contractNumber})` : ""}</p>
              {(r.quotedExpediter || r.quotedRepairs) ? <p className="text-xs text-slate-500">Client saw on the site: expediting {money(r.quotedExpediter || 0)} · repairs est. {money(r.quotedRepairs || 0)}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => buildContract(r)}><FileText className="mr-1 h-4 w-4" />Build contract</Button>
              {r.status !== "accepted" && r.status !== "quoted" && <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r, "accept")}><Check className="mr-1 h-4 w-4" />Accept</Button>}
              {r.status !== "declined" && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void decide(r, "decline")}><X className="mr-1 h-4 w-4" />Decline</Button>}
              <Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-600" disabled={busy === r.id} onClick={() => void remove(r)} title="Permanently delete"><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
            </div>
          </div>
          {(() => { const f = feeFor(r); return (
          <div className="mt-3 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {([["HPD Class A", r.hpdA], ["HPD Class B", r.hpdB], ["HPD Class C", r.hpdC]] as const).map(([label, n]) => (
              <div key={label} className="rounded-lg border border-slate-200 px-3 py-2"><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className="text-xl font-bold text-slate-900">{n || 0}</p></div>
            ))}
            <label className="rounded-lg border border-slate-200 px-3 py-2"><span className="text-xs uppercase tracking-wide text-slate-400">Apts cited</span><input type="number" inputMode="numeric" min={0} value={f.apartments || ""} placeholder="0" onChange={(e) => setAdj({ ...adj, [r.id]: { apartments: Math.max(0, Math.round(Number(e.target.value) || 0)), dob: f.dob === undefined ? 0 : (adj[r.id]?.dob ?? r.dob ?? 0) } })} className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-0.5 text-xl font-bold text-slate-900 focus:border-amber-500 focus:outline-none" /></label>
            <label className="rounded-lg border border-slate-200 px-3 py-2"><span className="text-xs uppercase tracking-wide text-slate-400">DOB</span><input type="number" inputMode="numeric" min={0} value={(adj[r.id]?.dob ?? r.dob) || ""} placeholder="0" onChange={(e) => setAdj({ ...adj, [r.id]: { apartments: adj[r.id]?.apartments ?? r.apartments ?? 0, dob: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-0.5 text-xl font-bold text-slate-900 focus:border-amber-500 focus:outline-none" /></label>
            <div className="rounded-lg border border-slate-200 px-3 py-2"><p className="text-xs uppercase tracking-wide text-slate-400">Owed to the City</p><p className="text-xl font-bold text-slate-900">{money(r.dofOwed || 0)}</p></div>
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"><p className="text-xs uppercase tracking-wide text-amber-700">Expediter fee</p><p className="text-xl font-bold text-slate-950">{money(f.total)}</p><p className="text-[11px] text-slate-600">HPD {money(f.hpd)} · DOB {money(f.dob)} · plan {money(f.plan)}</p></div>
          </div>
          ); })()}
          {(r.hpdTypes?.length || r.dobTypes?.length) ? (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {r.hpdTypes?.map((t) => <span key={t.type} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">{t.type} <b>{t.count}</b>{t.c ? <span className="text-rose-600"> · C {t.c}</span> : null}</span>)}
              {r.dobTypes?.map((t) => <span key={t.type} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">DOB · {t.type} <b>{t.count}</b></span>)}
            </div>
          ) : null}
          {r.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.notes}</p>}
          {(r.status || "new") === "new" && (
            <textarea value={message[r.id] || ""} onChange={(e) => setMessage({ ...message, [r.id]: e.target.value })} placeholder="Note to the client with the decision (optional)" rows={2} className="mt-3 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-amber-500 focus:outline-none" />
          )}
          {r.message && r.status !== "new" && <p className="mt-2 text-sm text-slate-500">Sent: {r.message}</p>}
        </div>
      ))}
    </div>
  );
}
