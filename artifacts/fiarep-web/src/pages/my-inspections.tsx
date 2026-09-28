// The inspector's own record: every inspection they logged, read-only, with the
// full reading and where it went afterwards. Their proof of the work.
import {
  getListEntityRecordsQueryKey,
  useListEntityRecords,
} from "@workspace/api-client-react";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { FieldEvidenceDisplay } from "@/components/field-evidence-display";

type Row = { id: string; development?: string | null; createdAt: string; createdBy?: string | null; state?: Record<string, any> };

const STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Logged — awaiting supervisor review", cls: "bg-amber-100 text-amber-800" },
  logged: { label: "Logged — awaiting supervisor review", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved by supervisor", cls: "bg-blue-100 text-blue-800" },
  denied: { label: "Denied by supervisor", cls: "bg-red-100 text-red-800" },
  routed: { label: "Routed to staff", cls: "bg-blue-100 text-blue-800" },
  cpm_review: { label: "With CPM Supervisor", cls: "bg-blue-100 text-blue-800" },
  cpm_scope_assigned: { label: "CPM writing the scope", cls: "bg-blue-100 text-blue-800" },
  done: { label: "Work completed", cls: "bg-emerald-100 text-emerald-800" },
  work_approved: { label: "Work approved", cls: "bg-emerald-100 text-emerald-800" },
};
const classColor = (c: string) => (c === "C" ? "text-red-700" : c === "B" ? "text-amber-700" : "text-emerald-700");
const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : "");

export default function MyInspections() {
  const { staff } = useAuth();
  const query = useListEntityRecords("building-violations", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("building-violations"), staleTime: 15_000, refetchOnMount: "always" },
  });
  const mine = ((query.data || []) as Row[])
    .filter((r) => r.createdBy === staff?.id || String(r.state?.loggedBy || "").trim().toLowerCase() === String(staff?.name || "").trim().toLowerCase())
    .sort((a, b) => String(b.state?.loggedAt || b.createdAt).localeCompare(String(a.state?.loggedAt || a.createdAt)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ClipboardList className="h-6 w-6" />My Inspections</h1>
        <p className="text-sm text-muted-foreground">Your record of every inspection you logged, with the full reading and what happened to it. Read-only — it stays here as proof of your work.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Logged by you ({mine.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!query.isLoading && !mine.length && <p className="text-sm text-muted-foreground">No inspections logged yet.</p>}
          {mine.map((row) => {
            const s = row.state || {};
            const st = STATUS[String(s.status || "submitted")] || { label: String(s.status), cls: "bg-muted text-foreground" };
            return (
              <div key={row.id} className="rounded-xl border p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-primary">{String(s.violationNo || "(no number)")} · Code {String(s.code || "")}</p>
                    <p className="text-sm">{String(s.building || s.address || "")}{row.development ? ` · ${row.development}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{String(s.codeDesc || "")}</p>
                  </div>
                  <div className="text-right">
                    {!!s.hazardClass && <p className={`text-sm font-bold ${classColor(String(s.hazardClass))}`}>Class {String(s.hazardClass)}</p>}
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  </div>
                </div>
                {!!s.notes && <p className="text-sm">Notes: {String(s.notes)}</p>}
                <FieldEvidenceDisplay state={s} photosLabel="Your photos" />
                <div className="text-xs text-muted-foreground space-y-0.5 border-t pt-2">
                  <p>Logged by {String(s.loggedBy || staff?.name || "you")} · {when(s.loggedAt || row.createdAt)}</p>
                  {!!s.approvedBy && <p>Approved by {String(s.approvedBy)} · {when(s.approvedAt)}</p>}
                  {s.status === "denied" && <p className="text-red-700">Denied by {String(s.deniedByName || "supervisor")} · {when(s.deniedAt)}{s.denyReason ? ` · Reason: ${s.denyReason}` : ""}</p>}
                  {!!s.cpmSupervisorName && <p>Sent to CPM Supervisor {String(s.cpmSupervisorName)} · {when(s.handoffAt)}</p>}
                  {!!s.assignedCpmStaffName && <p>CPM {String(s.assignedCpmStaffName)} writing the scope · {when(s.assignedCpmAt)}</p>}
                  {!!s.assignedTo && <p>Routed to {String(s.assignedTo)} · {when(s.routedAt)}</p>}
                  {!!(s.completedBy || s.completionNote) && <p>Completed by {String(s.completedBy || s.assignedTo || "")} · {when(s.completedAt)}{s.completionNote ? ` · ${s.completionNote}` : ""}</p>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
