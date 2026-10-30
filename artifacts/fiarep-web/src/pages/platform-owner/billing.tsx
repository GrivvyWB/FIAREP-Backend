// Platform Control → Billing: every client on monthly autopay, with its On/Off switch.
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { CreditCard, Loader2, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";

type Row = { id: string; company: string; contractNumber: string; card: string; monthly: number; nextChargeOn: string; on: boolean; paidTotal: number; last: { period: string; status: string; amount: number; error?: string } | null };
type Data = { ready: boolean; sandbox: boolean; clients: Row[] };

export default function OwnerBilling() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState("");
  const remove = async (r: Row) => {
    setBusy(r.id);
    try { setData(await customFetch<Data>(`/api/v1/platform/billing/${encodeURIComponent(r.id)}`, { method: "DELETE", responseType: "json" } as never)); } finally { setBusy(""); setConfirming(""); }
  };
  useEffect(() => { void customFetch<Data>("/api/v1/platform/billing", { responseType: "json" } as never).then(setData).catch(() => setData({ ready: false, sandbox: false, clients: [] })); }, []);
  const flip = async (r: Row, on: boolean) => {
    setBusy(r.id);
    try { setData(await customFetch<Data>(`/api/v1/platform/billing/${encodeURIComponent(r.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }), responseType: "json" } as never)); } finally { setBusy(""); }
  };
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
  const monthly = (data?.clients ?? []).filter((c) => c.on).reduce((n, c) => n + c.monthly, 0);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-950"><CreditCard className="h-6 w-6" />Billing</h1>
        <p className="text-sm text-slate-600">Clients on monthly autopay. Square charges each card on the same day every month and deposits the money in the bank account connected to your Square account. Off stops a client's monthly charge.</p>
      </div>
      {!data ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          {!data.ready && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Square isn't connected yet. Add <b>SQUARE_ACCESS_TOKEN</b>, <b>SQUARE_APPLICATION_ID</b> and <b>SQUARE_LOCATION_ID</b> in Replit Secrets (from developer.squareup.com → your app → Credentials and Locations), then Republish.</div>}
          {data.sandbox && <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">Test mode (SQUARE_ENV = sandbox): no real money moves.</div>}
          <div className="text-sm text-slate-700">{data.clients.filter((c) => c.on).length} on autopay · <b>{usd(monthly)}</b> a month</div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-slate-500"><th className="p-3">Client</th><th className="p-3">Card</th><th className="p-3 text-right">Monthly</th><th className="p-3">Next</th><th className="p-3">Last payment</th><th className="p-3 text-right">Paid to date</th><th className="p-3">Autopay</th><th className="p-3"></th></tr></thead>
              <tbody>
                {data.clients.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No clients on autopay yet. They set it up on the contract signing page after they sign.</td></tr>}
                {data.clients.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-3"><div className="font-medium text-slate-900">{r.company}</div><div className="text-xs text-slate-500">{r.contractNumber}</div></td>
                    <td className="p-3">{r.card}</td>
                    <td className="p-3 text-right">{usd(r.monthly)}</td>
                    <td className="p-3">{r.on ? r.nextChargeOn : "—"}</td>
                    <td className="p-3">{r.last ? <span className={r.last.status === "paid" ? "text-emerald-700" : "text-red-700"}>{r.last.period} · {r.last.status}{r.last.error ? ` (${r.last.error})` : ""}</span> : "—"}</td>
                    <td className="p-3 text-right">{usd(r.paidTotal)}</td>
                    <td className="p-3"><Switch checked={r.on} disabled={busy === r.id} onCheckedChange={(on) => void flip(r, on)} aria-label={`Autopay for ${r.company}`} /></td>
                    <td className="p-3 text-right">
                      {confirming === r.id ? (
                        <span className="inline-flex gap-1">
                          <button type="button" className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy === r.id} onClick={() => void remove(r)}>{busy === r.id ? "Deleting…" : "Delete"}</button>
                          <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => setConfirming("")}>Keep</button>
                        </span>
                      ) : (
                        <button type="button" className="text-slate-400 hover:text-red-600" aria-label={`Delete ${r.company} autopay`} onClick={() => setConfirming(r.id)}><Trash2 className="h-4 w-4" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
