import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { useLocation } from "wouter";

// Smart Repair on the website: the photo and repair directions members saved on
// their phones (kept on the account when Platform Control → Modules → "Smart Repair
// on all their phones" is on). The office sees everyone's; others see their own.
type Ticket = { issueFound?: string; location?: string; exactArea?: string; repairRequired?: string; tools?: string[]; supplies?: string[]; fixtures?: string[]; steps?: string[]; trade?: string; priority?: string; estimatedTime?: string; status?: string };
type Item = { id: string; by: string; updatedAt: string; photoUrl: string | null; afterUrl: string | null;
  data: { at?: string; address?: string; apt?: string; room?: string; note?: string; jobId?: string | null; ticket?: Ticket; check?: { compliant?: boolean; summary?: string } | null; signOff?: { status?: string; name?: string } } };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const list = (label: string, v?: string[]) => (v && v.length ? <p className="text-sm"><span className="font-semibold">{label}:</span> {v.join(", ")}</p> : null);

export default function SmartRepairs() {
  const [data, setData] = useState<{ on: boolean; items: Item[] } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { customFetch<{ on: boolean; items: Item[] }>("/api/v1/smart-repairs/all", { responseType: "json" } as never).then(setData).catch((e: any) => setError(e?.data?.error || e?.message || "Could not load")); }, []);
  const [, setLocation] = useLocation();
  // Not switched on for this company: the page isn't there.
  useEffect(() => { if (data && !data.on) setLocation("/dashboard"); }, [data, setLocation]);
  const items = (data?.items || []).filter((it) => !q.trim() || `${it.data.address} ${it.data.apt} ${it.data.ticket?.issueFound} ${it.by}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-950"><Wrench className="h-6 w-6 text-[#185FA5]" />Smart Repair</h1>
          <p className="text-sm text-slate-500">Photos and repair directions saved on members' phones.</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address, apartment, issue, member" className="h-9 w-72 rounded-md border border-slate-300 px-3 text-sm" />
      </div>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {data?.on && !items.length && <p className="text-sm text-slate-500">No Smart Repairs yet.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => {
          const t = it.data.ticket || {};
          return (
            <div key={it.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex gap-3 p-3">
                {it.photoUrl ? <a href={it.photoUrl} target="_blank" rel="noopener"><img src={it.photoUrl} alt="" className="h-24 w-24 rounded-md object-cover" /></a> : <div className="h-24 w-24 rounded-md bg-slate-100" />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-950">{t.issueFound || "Repair"}</p>
                  <p className="text-sm text-slate-600">{[it.data.address, it.data.apt ? `Apt ${it.data.apt}` : "", it.data.room].filter(Boolean).join(" · ")}</p>
                  <p className="text-xs text-slate-500">{when(it.data.at)}{it.by ? ` · ${it.by}` : ""}</p>
                  {it.data.check && !it.data.check.compliant && it.data.check.summary && <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"><b>Why it wasn't cleared:</b> {it.data.check.summary}</p>}
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-semibold">
                    {t.priority && <span className={`rounded-full px-2 py-0.5 ${t.priority === "High" ? "bg-rose-100 text-rose-800" : t.priority === "Medium" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{t.priority}</span>}
                    {t.trade && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{t.trade}</span>}
                    {it.data.jobId && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">Work order created</span>}
                    {it.data.check?.compliant && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Repair verified</span>}
                    {it.data.check && !it.data.check.compliant && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Not cleared</span>}
                    {it.data.signOff?.status === "signed" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Resident signed</span>}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(open === it.id ? null : it.id)} className="w-full border-t border-slate-200 px-3 py-2 text-left text-sm font-medium text-[#185FA5]">{open === it.id ? "Hide directions" : "Show directions"}</button>
              {open === it.id && (
                <div className="space-y-2 border-t border-slate-200 p-3">
                  {t.repairRequired && <p className="text-sm"><span className="font-semibold">Repair:</span> {t.repairRequired}</p>}
                  {(t.exactArea || t.location) && <p className="text-sm"><span className="font-semibold">Where:</span> {[t.location, t.exactArea].filter(Boolean).join(" — ")}</p>}
                  {t.estimatedTime && <p className="text-sm"><span className="font-semibold">Time:</span> {t.estimatedTime}</p>}
                  {list("Tools", t.tools)}{list("Supplies", t.supplies)}{list("Fixtures", t.fixtures)}
                  {t.steps?.length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{t.steps.map((st, i) => <li key={i}>{st}</li>)}</ol> : null}
                  {it.data.note && <p className="text-sm text-slate-600">Note: {it.data.note}</p>}
                  {it.afterUrl && <div><p className="text-sm font-semibold">After the repair</p><a href={it.afterUrl} target="_blank" rel="noopener"><img src={it.afterUrl} alt="" className="mt-1 h-32 rounded-md object-cover" /></a></div>}
                  {it.data.check?.summary && <p className="text-sm text-slate-600">{it.data.check.summary}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
