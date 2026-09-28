// Supervisor Inspector: inspections logged by inspectors, awaiting approval.
// Approve & route to an Inspector, send an approved violation to a CPM
// Supervisor (scope), and clear finished ones for staff. Same job as the app's
// "Inspection Approvals" tile — supervisors act on the website.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEntityRecordsQueryKey,
  getListStaffQueryKey,
  useListEntityRecords,
  useListStaff,
  usePerformEntityAction,
} from "@workspace/api-client-react";
import { ClipboardCheck, Send, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";
import { FieldEvidenceDisplay } from "@/components/field-evidence-display";
import { isCpmSupervisorTitle } from "@/lib/titles";

type Row = { id: string; development?: string | null; createdAt: string; state?: Record<string, any> };

const classColor = (c: string) => (c === "C" ? "text-red-700" : c === "B" ? "text-amber-700" : "text-emerald-700");
const sameDev = (a?: string | null, b?: string | null) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export default function InspectionApprovals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { staff: me } = useAuth();
  const [picking, setPicking] = useState<{ row: Row; kind: "handoff" } | null>(null);
  const [choice, setChoice] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const query = useListEntityRecords("building-violations", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("building-violations"), refetchInterval: 30_000, staleTime: 10_000, refetchOnMount: "always" },
  });
  const { data: people = [] } = useListStaff({ status: "approved" }, {
    query: { queryKey: getListStaffQueryKey({ status: "approved" }), refetchOnMount: "always" },
  });
  const action = usePerformEntityAction();
  const rows = (query.data || []) as Row[];
  const status = (r: Row) => String(r.state?.status || "submitted").toLowerCase();
  const awaiting = rows.filter((r) => ["submitted", "logged"].includes(status(r)));
  const active = rows.filter((r) => ["approved", "routed", "cpm_review", "cpm_scope_assigned", "done", "denied"].includes(status(r)));

  // CPM Supervisors covering this development (office-based ones cover all).
  const options = useMemo(() => {
    if (!picking) return [];
    const dev = picking.row.development || picking.row.state?.development;
    return (people as any[]).filter((p) => isCpmSupervisorTitle(p.position) && p.id !== me?.id &&
      (!dev || !(p.developments || []).length || (p.developments || []).some((d: string) => sameDev(d, dev))));
  }, [picking, people, me?.id]);

  async function run(row: Row, name: string, data: Record<string, unknown> = {}) {
    await action.mutateAsync({ entity: "building-violations", id: row.id, action: name, data });
    await invalidateOperationalQueries(queryClient, "building-violations", row.id);
  }

  async function confirmPick() {
    if (!picking || !choice) return;
    const person = options.find((p) => p.id === choice);
    try {
      // A logged inspection is approved, then sent to the CPM Supervisor to be scoped.
      if (["submitted", "logged"].includes(status(picking.row))) await run(picking.row, "approve");
      await run(picking.row, "handoff-cpm-supervisor", { receiverSupervisorId: choice });
      toast({ title: "Approved & sent to CPM Supervisor", description: `${person?.name || ""} will assign a CPM to write the scope.` });
      setPicking(null); setChoice("");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Could not send", description: error?.message || "Try again." });
    }
  }

  async function deny(row: Row) {
    const reason = (reasons[row.id] || "").trim();
    if (reason.length < 3) { toast({ variant: "destructive", title: "Give the inspector a reason", description: "Say what is not correct so they can fix it." }); return; }
    try {
      await run(row, "deny", { reason });
      setReasons((m) => ({ ...m, [row.id]: "" }));
      toast({ title: "Denied — sent back to the inspector" });
    } catch (error: any) { toast({ variant: "destructive", title: "Could not deny", description: error?.message || "Try again." }); }
  }

  async function approveOnly(row: Row) {
    try { await run(row, "approve"); toast({ title: "Approved" }); }
    catch (error: any) { toast({ variant: "destructive", title: "Could not approve", description: error?.message || "Try again." }); }
  }

  async function clearForStaff(row: Row) {
    if (!window.confirm(`Clear ${row.state?.violationNo || "this violation"} for staff? It stays in reporting.`)) return;
    try { await run(row, "clear"); toast({ title: "Cleared for staff" }); }
    catch (error: any) { toast({ variant: "destructive", title: "Could not clear", description: error?.message || "Try again." }); }
  }

  const Head = ({ row }: { row: Row }) => {
    const s = row.state || {};
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-primary">{String(s.violationNo || "(no number)")}</p>
          <p className="text-sm">{String(s.building || s.address || "")}{s.unit ? ` · Unit ${s.unit}` : ""}{row.development ? ` · ${row.development}` : ""}</p>
          {!!s.code && <p className="text-xs text-muted-foreground">Code {String(s.code)}{s.codeDesc ? ` · ${s.codeDesc}` : ""}</p>}
          {!!s.notes && <p className="mt-1 text-sm">{String(s.notes)}</p>}
          <p className="text-xs text-muted-foreground">Logged by {String(s.loggedBy || s.inspectorName || "inspector")} · {new Date(String(s.loggedAt || row.createdAt)).toLocaleString()}</p>
        </div>
        {!!s.hazardClass && <span className={`text-sm font-bold ${classColor(String(s.hazardClass))}`}>Class {String(s.hazardClass)}{s.hazardClass === "C" ? " · priority" : ""}</span>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ClipboardCheck className="h-6 w-6" />Inspection Approvals</h1>
        <p className="text-sm text-muted-foreground">Inspections logged by inspectors, awaiting your approval. Approve and send to a CPM Supervisor to be scoped, or deny with a reason so the inspector can correct it.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Awaiting approval ({awaiting.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!query.isLoading && !awaiting.length && <p className="text-sm text-muted-foreground">Nothing awaiting approval.</p>}
          {awaiting.map((row) => (
            <div key={row.id} className="rounded-xl border p-4 space-y-3">
              <Head row={row} />
              <FieldEvidenceDisplay state={row.state || {}} photosLabel="Inspector photos" />
              <div className="space-y-2 border-t pt-3">
                <Textarea value={reasons[row.id] || ""} onChange={(e) => setReasons((m) => ({ ...m, [row.id]: e.target.value }))} placeholder="Deny reason — what is not correct (sent to the inspector)" />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => { setPicking({ row, kind: "handoff" }); setChoice(""); }} disabled={action.isPending}><Send className="mr-2 h-4 w-4" />Approve & send to CPM Supervisor</Button>
                  <Button variant="outline" onClick={() => approveOnly(row)} disabled={action.isPending}>Approve only</Button>
                  <Button variant="outline" className="border-red-300 text-red-700" onClick={() => deny(row)} disabled={action.isPending}><X className="mr-2 h-4 w-4" />Deny</Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Approved, routed & completed ({active.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!active.length && <p className="text-sm text-muted-foreground">Nothing routed yet.</p>}
          {active.map((row) => {
            const s = row.state || {};
            const st = status(row);
            return (
              <div key={row.id} className="rounded-xl border p-4 space-y-2">
                <Head row={row} />
                <p className="text-sm">
                  <span className={`font-semibold ${st === "done" ? "text-emerald-700" : st === "denied" ? "text-red-700" : "text-amber-700"}`}>{st === "done" ? "Completed" : st === "denied" ? "Denied — back with the inspector" : st === "cpm_review" ? "With CPM Supervisor" : st === "cpm_scope_assigned" ? "CPM writing the scope" : st === "routed" ? "Routed" : "Approved"}</span>
                  {s.cpmSupervisorName ? ` · ${s.cpmSupervisorName}` : ""}{s.assignedTo ? ` · Assigned to ${s.assignedTo}` : ""}{s.completionNote ? ` · Note: ${s.completionNote}` : ""}{st === "denied" && s.denyReason ? ` · Reason: ${s.denyReason}` : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  {st === "approved" && <Button size="sm" onClick={() => { setPicking({ row, kind: "handoff" }); setChoice(""); }} disabled={action.isPending}>Send to CPM Supervisor</Button>}
                  {st === "done" && !s.clearedByMgmt && <Button size="sm" variant="ghost" onClick={() => clearForStaff(row)} disabled={action.isPending}>Clear for staff</Button>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {picking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setPicking(null)}>
          <div className="w-full max-w-md rounded-xl bg-background p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold">Send to CPM Supervisor · {String(picking.row.state?.violationNo || "")}</p>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Choose a person…</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.position}</option>)}
            </select>
            {!options.length && <p className="text-sm text-muted-foreground">No CPM Supervisor covers this development yet.</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPicking(null)}>Cancel</Button>
              <Button onClick={confirmPick} disabled={!choice || action.isPending}>{action.isPending ? "Sending…" : "Send"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
