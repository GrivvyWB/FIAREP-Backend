import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, FileText, X } from "lucide-react";

type WorkRequest = {
  id: string; createdAt: string; status: string; company: string; contact: string; email: string; phone: string;
  address: string; borough: string; block: string; lot: string; bbl: string; bin: string; units: number;
  hpdA: number; hpdB: number; hpdC: number; dob: number; dofOwed: number; notes: string; decidedAt?: string; decidedBy?: string; message?: string;
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
  const [filter, setFilter] = useState<"new" | "accepted" | "declined" | "all">("new");
  const [message, setMessage] = useState<Record<string, string>>({});

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
  function buildContract(r: WorkRequest) {
    const q = new URLSearchParams({ company: r.company, contact: r.contact, email: r.email, phone: r.phone, building: r.address, units: String(r.units || 0), dob: String(r.dob || 0) });
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
          {(["new", "accepted", "declined", "all"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-md px-3 py-1 capitalize ${filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{f}{f !== "all" ? ` (${count(f)})` : ""}</button>
          ))}
        </div>
      </div>
      {shown.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No {filter === "all" ? "" : filter} job requests.</p>}
      {shown.map((r) => (
        <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-950">{r.address}</p>
              <p className="text-sm text-slate-600">{r.borough} · Block {r.block || "—"} · Lot {r.lot || "—"}{r.bbl ? ` · BBL ${r.bbl}` : ""}{r.bin ? ` · BIN ${r.bin}` : ""}{r.units ? ` · ${r.units} units` : ""}</p>
              <p className="text-sm text-slate-600">{r.company} — {r.contact}{r.phone ? ` · ${r.phone}` : ""}{r.email ? ` · ${r.email}` : ""}</p>
              <p className="mt-1 text-xs text-slate-400">Received {when(r.createdAt)}{r.decidedAt ? ` · ${r.status} ${when(r.decidedAt)} by ${r.decidedBy}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => buildContract(r)}><FileText className="mr-1 h-4 w-4" />Build contract</Button>
              {r.status !== "accepted" && <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r, "accept")}><Check className="mr-1 h-4 w-4" />Accept</Button>}
              {r.status !== "declined" && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void decide(r, "decline")}><X className="mr-1 h-4 w-4" />Decline</Button>}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-5">
            {([["HPD Class A", r.hpdA], ["HPD Class B", r.hpdB], ["HPD Class C", r.hpdC], ["DOB", r.dob]] as const).map(([label, n]) => (
              <div key={label} className="rounded-lg border border-slate-200 px-3 py-2"><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className="text-xl font-bold text-slate-900">{n || 0}</p></div>
            ))}
            <div className="rounded-lg border border-slate-200 px-3 py-2"><p className="text-xs uppercase tracking-wide text-slate-400">Owed to the City</p><p className="text-xl font-bold text-slate-900">{money(r.dofOwed || 0)}</p></div>
          </div>
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
