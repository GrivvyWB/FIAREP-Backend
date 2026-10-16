// Audit Log: who did what, and when — everything recorded for the organization,
// on the site and in the app. Administrators only (the server checks too).
import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Entry = { id: string; at: string; actorRole: string; actorName: string; action: string; detail: string; reportId?: string | null };

const CATEGORIES: { label: string; match: (a: string) => boolean }[] = [
  { label: "All activity", match: () => true },
  { label: "Hiring / Staff accounts", match: (a) => /staff account|staff code|bulk employees|^staff\.|^hr-/i.test(a) },
  { label: "Reports", match: (a) => /^report (created|submitted|resolved|status|deleted|sent)|^resident-report/i.test(a) },
  { label: "Report assignments", match: (a) => /report assigned|assigned to project|job sent to management|assignment/i.test(a) },
  { label: "Change orders", match: (a) => /change (order|work order)|^change-orders\./i.test(a) },
  { label: "Inspections", match: (a) => /inspection|repair complete/i.test(a) },
  { label: "Elevator", match: (a) => /elevator/i.test(a) },
  { label: "Projects", match: (a) => /project note|^projects\./i.test(a) },
];

// Actions are recorded as keys like "resident-reports.created": show them as words.
function actionLabel(a: string): string {
  if (!/^[a-z0-9-]+(\.[a-z0-9_-]+)+$/.test(a)) return a;
  const t = a.replace(/[._-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const when = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function AuditLog() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState(0);

  useEffect(() => {
    customFetch<Entry[]>("/api/v1/audit-log", { responseType: "json" } as never)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => { setRows([]); setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not load the audit log."); });
  }, []);

  const shown = useMemo(() => (rows || []).filter((e) => CATEGORIES[cat].match(e.action || "")), [rows, cat]);

  const exportCsv = () => {
    const csv = [["Time", "Role", "Name", "Action", "Detail"].map(cell).join(","), ...shown.map((e) => [e.at, e.actorRole, e.actorName, actionLabel(e.action), e.detail].map(cell).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "audit-log.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Who did what, and when.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select value={cat} onChange={(e) => setCat(Number(e.target.value))} className="h-9 min-w-56 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold">
          {CATEGORIES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-9" disabled={shown.length === 0} onClick={exportCsv}><Download className="mr-1 h-4 w-4" />Export CSV</Button>
        {rows && <span className="text-sm text-muted-foreground">{shown.length} entr{shown.length === 1 ? "y" : "ies"}</span>}
      </div>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {rows === null && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {rows && !error && shown.length === 0 && <p className="py-6 text-sm text-muted-foreground">No activity in this category.</p>}
      {shown.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {shown.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <p className="text-xs text-slate-400">{when(e.at)}</p>
              <p className="font-semibold text-[#185FA5]">{actionLabel(e.action)}</p>
              {e.detail ? <p className="text-sm text-slate-700">{e.detail}</p> : null}
              <p className="text-xs text-slate-500">{e.actorName ? `${e.actorName} · ` : ""}{e.actorRole || "unknown"}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
