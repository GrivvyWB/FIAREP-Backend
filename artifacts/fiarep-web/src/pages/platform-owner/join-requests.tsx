import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, KeyRound, X } from "lucide-react";

type Dev = { name: string; address: string; units: string };
type JoinRequest = {
  id: string; createdAt: string; status: string; company: string; contactName: string; phone: string; email: string;
  address: string; portfolioSize: string; developments: Dev[]; services: string[]; notes: string; accessCode?: string; decidedAt?: string; decidedBy?: string;
};
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** Platform Control → Join requests: pilot sign-ups from the Join FIAREP page.
 * Approve makes the 3-character access code that unlocks the estimator and
 * emails it to the requester. */
export default function OwnerJoinRequests() {
  const { toast } = useToast();
  const [rows, setRows] = useState<JoinRequest[]>([]);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<"new" | "approved" | "declined" | "all">("new");

  async function reload() {
    try { setRows(await customFetch<JoinRequest[]>("/api/v1/platform/join-requests", { responseType: "json" } as never)); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not load join requests", description: err?.data?.error || err?.message }); }
  }
  useEffect(() => { void reload(); }, []);

  async function decide(r: JoinRequest, decision: "approve" | "decline") {
    if (decision === "decline" && !window.confirm(`Decline ${r.company}?`)) return;
    setBusy(r.id);
    try {
      const out = await customFetch<{ status: string; accessCode: string; emailed: boolean }>(`/api/v1/platform/join-requests/${encodeURIComponent(r.id)}/${decision}`, { method: "POST", responseType: "json" } as never);
      toast({ title: decision === "approve" ? `${r.company} approved — access code ${out.accessCode}` : `${r.company} declined`, description: decision === "approve" ? (out.emailed ? `Emailed to ${r.email}.` : "No email on the request — give them the code by phone.") : undefined });
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not update", description: err?.data?.error || err?.message });
    } finally { setBusy(""); }
  }

  const shown = rows.filter((r) => filter === "all" || (r.status || "new") === filter);
  const count = (s: string) => rows.filter((r) => (r.status || "new") === s).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Join requests</h1>
          <p className="text-sm text-slate-500">Pilot sign-ups from fiarep.com/join. Approving creates the access code that unlocks the estimator and emails it to them.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {(["new", "approved", "declined", "all"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-md px-3 py-1 capitalize ${filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{f}{f !== "all" ? ` (${count(f)})` : ""}</button>
          ))}
        </div>
      </div>
      {shown.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No {filter === "all" ? "" : filter} requests.</p>}
      {shown.map((r) => (
        <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-950">{r.company}</p>
              <p className="text-sm text-slate-600">{r.contactName} · {r.phone}{r.email ? ` · ${r.email}` : ""}</p>
              {r.address && <p className="text-sm text-slate-500">{r.address}</p>}
              <p className="mt-1 text-xs text-slate-400">Received {when(r.createdAt)}{r.decidedAt ? ` · ${r.status} ${when(r.decidedAt)} by ${r.decidedBy}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              {r.status === "approved" && r.accessCode && (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-mono text-lg font-bold text-emerald-800"><KeyRound className="h-4 w-4" />{r.accessCode}</span>
              )}
              {r.status !== "approved" && <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r, "approve")}><Check className="mr-1 h-4 w-4" />Approve</Button>}
              {r.status !== "declined" && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void decide(r, "decline")}><X className="mr-1 h-4 w-4" />Decline</Button>}
            </div>
          </div>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Portfolio</p>
              <p className="text-slate-700">{r.portfolioSize || "—"}</p>
              {r.developments?.length > 0 && (
                <table className="mt-1 w-full text-xs">
                  <thead><tr className="text-left text-slate-400"><th className="pr-2">Development</th><th className="pr-2">Address</th><th>Units</th></tr></thead>
                  <tbody>{r.developments.map((d, i) => <tr key={i} className="border-t border-slate-100"><td className="pr-2 py-1">{d.name}</td><td className="pr-2 py-1">{d.address}</td><td className="py-1">{d.units}</td></tr>)}</tbody>
                </table>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Wants</p>
              <p className="text-slate-700">{r.services?.length ? r.services.join(", ") : "—"}</p>
              {r.notes && <><p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</p><p className="whitespace-pre-wrap text-slate-700">{r.notes}</p></>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
