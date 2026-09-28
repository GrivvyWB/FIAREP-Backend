// Change work orders. CPMs and workers write them in the app; here the CPM
// Supervisor / management review them (approve → Procurement for cost, or
// decline with a reason), Procurement approves the cost, and everyone sees
// where each one stands. Nobody creates a change order on the website.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEntityRecordsQueryKey,
  useListEntityRecords,
  useUpdateEntityRecord,
} from "@workspace/api-client-react";
import { Check, FileCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";
import { FieldEvidenceDisplay } from "@/components/field-evidence-display";
import { isSupervisor } from "@/lib/access-policy";

type Row = { id: string; version: number; development?: string | null; createdAt: string; state?: Record<string, any> };

const STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Awaiting review", cls: "bg-amber-100 text-amber-800" },
  mgmt_approved: { label: "Approved — with Procurement for cost", cls: "bg-blue-100 text-blue-800" },
  cost_approved: { label: "Cost approved", cls: "bg-emerald-100 text-emerald-800" },
  declined: { label: "Declined", cls: "bg-red-100 text-red-800" },
};
const money = (n: unknown) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ChangeOrders() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { staff } = useAuth();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const query = useListEntityRecords("change-orders", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("change-orders"), refetchInterval: 30_000, staleTime: 10_000, refetchOnMount: "always" },
  });
  const update = useUpdateEntityRecord();
  const rows = ((query.data || []) as Row[]).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const status = (r: Row) => String(r.state?.status || "submitted");
  // Reviewers: CPM Supervisor, other supervisors, management, administrators.
  const canReview = !!staff && (staff.role === "management" || staff.role === "administrator" || isSupervisor(staff));
  const isProcurement = staff?.role === "procurement";

  async function setStatus(row: Row, next: string, extra: Record<string, unknown> = {}) {
    await update.mutateAsync({
      entity: "change-orders",
      id: row.id,
      data: { id: row.id, state: { ...(row.state || {}), status: next, respondedByName: staff?.name || "", respondedAt: new Date().toISOString(), ...extra }, version: row.version },
    });
    await invalidateOperationalQueries(queryClient, "change-orders", row.id);
  }
  async function approve(row: Row) {
    try {
      const worker = row.state?.isWorkerCO === true;
      await setStatus(row, worker ? "cost_approved" : "mgmt_approved");
      toast({ title: worker ? "Approved" : "Approved — sent to Procurement for cost approval" });
    } catch (error: any) { toast({ variant: "destructive", title: "Could not approve", description: error?.message || "Try again." }); }
  }
  async function approveCost(row: Row) {
    try { await setStatus(row, "cost_approved"); toast({ title: "Cost approved" }); }
    catch (error: any) { toast({ variant: "destructive", title: "Could not approve cost", description: error?.message || "Try again." }); }
  }
  async function decline(row: Row) {
    try {
      await setStatus(row, "declined", { reason: (reasons[row.id] || "").trim() });
      setReasons((m) => ({ ...m, [row.id]: "" }));
      toast({ title: "Declined" });
    } catch (error: any) { toast({ variant: "destructive", title: "Could not decline", description: error?.message || "Try again." }); }
  }

  const pending = rows.filter((r) => (isProcurement ? status(r) === "mgmt_approved" : status(r) === "submitted"));
  const rest = rows.filter((r) => !pending.includes(r));

  const Item = ({ row, actions }: { row: Row; actions?: boolean }) => {
    const s = row.state || {};
    const st = STATUS[status(row)] || { label: status(row), cls: "bg-muted text-foreground" };
    return (
      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{String(s.reportRef || s.title || "Change work order")}{row.development ? ` · ${row.development}` : ""}</p>
            <p className="text-sm text-muted-foreground">By {String(s.createdByName || "—")}{s.createdByRole ? ` (${s.createdByRole})` : ""}{s.targetName ? ` · for ${s.targetName}${s.targetPosition ? ` (${s.targetPosition})` : ""}` : ""} · {new Date(String(s.createdAt || row.createdAt)).toLocaleString()}</p>
          </div>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span>
        </div>
        {!!s.description && <p className="text-sm">{String(s.description)}</p>}
        {!s.isWorkerCO && <p className="text-sm font-semibold">Cost: {money(s.cost)}</p>}
        {!!s.reason && status(row) === "declined" && <p className="text-sm text-red-700">Reason: {String(s.reason)}</p>}
        {!!s.respondedByName && status(row) !== "submitted" && <p className="text-xs text-muted-foreground">{st.label} by {String(s.respondedByName)}{s.respondedAt ? ` · ${new Date(String(s.respondedAt)).toLocaleString()}` : ""}</p>}
        <FieldEvidenceDisplay state={s} photosLabel="Photos" />
        {actions && canReview && status(row) === "submitted" && (
          <div className="space-y-2 border-t pt-3">
            <Textarea value={reasons[row.id] || ""} onChange={(e) => setReasons((m) => ({ ...m, [row.id]: e.target.value }))} placeholder="Decline reason (optional)" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => approve(row)} disabled={update.isPending}><Check className="mr-1 h-4 w-4" />{s.isWorkerCO ? "Approve" : "Approve & send to Procurement"}</Button>
              <Button variant="outline" className="border-red-300 text-red-700" onClick={() => decline(row)} disabled={update.isPending}><X className="mr-1 h-4 w-4" />Decline</Button>
            </div>
          </div>
        )}
        {actions && isProcurement && status(row) === "mgmt_approved" && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button onClick={() => approveCost(row)} disabled={update.isPending}><Check className="mr-1 h-4 w-4" />Approve cost {money(s.cost)}</Button>
            <Button variant="outline" className="border-red-300 text-red-700" onClick={() => decline(row)} disabled={update.isPending}><X className="mr-1 h-4 w-4" />Decline</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><FileCog className="h-6 w-6" />Change Orders</h1>
        <p className="text-sm text-muted-foreground">Change work orders written by CPMs and workers in the app. {canReview ? "Approve to send the cost to Procurement, or decline with a reason." : isProcurement ? "Approve the cost once management has approved the work." : "Track where each one stands."}</p>
      </div>
      {(canReview || isProcurement) && (
        <Card>
          <CardHeader><CardTitle>{isProcurement ? "Awaiting cost approval" : "Awaiting your review"} ({pending.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!query.isLoading && !pending.length && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
            {pending.map((row) => <Item key={row.id} row={row} actions />)}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{canReview || isProcurement ? "All change orders" : "Change orders"} ({(canReview || isProcurement ? rest : rows).length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!(canReview || isProcurement ? rest : rows).length && <p className="text-sm text-muted-foreground">None yet.</p>}
          {(canReview || isProcurement ? rest : rows).map((row) => <Item key={row.id} row={row} />)}
        </CardContent>
      </Card>
    </div>
  );
}
