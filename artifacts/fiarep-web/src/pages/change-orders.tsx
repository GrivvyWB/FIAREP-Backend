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
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
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
        {s.isVendorCO === true && <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Vendor change work order · {String(s.vendor || "")}</span>}
        {!!s.description && <p className="text-sm"><span className="font-semibold">What changed: </span>{String(s.description)}</p>}
        {!!s.vendorReason && <p className="text-sm"><span className="font-semibold">Why: </span>{String(s.vendorReason)}</p>}
        {!!s.measurements && <p className="text-sm"><span className="font-semibold">Measurements: </span>{String(s.measurements)}</p>}
        {!!s.notes && <p className="text-sm"><span className="font-semibold">Notes: </span>{String(s.notes)}</p>}
        {!s.isWorkerCO && <p className="text-sm font-semibold">Cost: {money(s.cost)}{s.isVendorCO === true && !Number(s.cost) ? " (vendor gave no cost)" : ""}</p>}
        {s.isVendorCO === true && s.verification && typeof s.verification === "object" && (() => {
          const v = s.verification as { needsReview?: boolean; summary?: string; checkedAt?: string; content?: { observation?: string; skipped?: string } };
          return v.needsReview ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="co-verify-warning">
              <p className="font-semibold">⚠ Please verify the photo location before approving</p>
              <p className="mt-1">{v.summary}</p>
              {!!v.content?.observation && <p className="mt-1 text-amber-800">Photo review: {v.content.observation}</p>}
              <p className="mt-1 text-xs text-amber-700">This check is only visible to the supervisors handling the job. A quick call to the vendor usually clears it up.</p>
            </div>
          ) : (
            <p className="text-xs text-emerald-700">✓ {v.summary}{v.content?.skipped ? ` (${v.content.skipped})` : ""}</p>
          );
        })()}
        {Array.isArray(s.photos) && s.photos.some((p: unknown) => typeof p === "string" && p.startsWith("data:image")) && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(s.photos as string[]).map((p, i) => ({ p, i })).filter(({ p }) => typeof p === "string" && p.startsWith("data:image")).map(({ p, i }) => {
              const stamp = (Array.isArray(s.photoStamps) ? s.photoStamps[i] : null) as { capturedAt?: string; lat?: number; lng?: number; accuracy?: number } | null;
              const check = (s.verification as any)?.location?.photos?.[i] as { distanceMeters?: number | null; ok?: boolean } | undefined;
              return (
                <div key={i} className="space-y-1">
                  <button type="button" onClick={() => setViewPhoto(p)} className="block w-full"><img src={p} alt={`Photo ${i + 1}`} className="h-32 w-full rounded-lg border bg-muted object-cover" /></button>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    {stamp?.capturedAt ? new Date(stamp.capturedAt).toLocaleString() : "No time stamp"}
                    {typeof stamp?.lat === "number" && typeof stamp?.lng === "number"
                      ? <> · <a className="underline" href={`https://maps.google.com/?q=${stamp.lat},${stamp.lng}`} target="_blank" rel="noreferrer">{stamp.lat.toFixed(5)}, {stamp.lng.toFixed(5)}</a>{typeof stamp.accuracy === "number" ? ` (±${Math.round(stamp.accuracy)} m)` : ""}</>
                      : " · No location"}
                    {check && typeof check.distanceMeters === "number" ? <span className={check.ok ? " text-emerald-700" : " font-semibold text-amber-700"}> · {check.distanceMeters < 1000 ? `${check.distanceMeters} m` : `${(check.distanceMeters / 1000).toFixed(1)} km`} from the job</span> : null}
                  </p>
                </div>
              );
            })}
          </div>
        )}
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
        <p className="text-sm text-muted-foreground">Change work orders written by CPMs and workers in the app, and by awarded vendors on site. {canReview ? "Approve to send the cost to Procurement, or decline with a reason." : isProcurement ? "Approve the cost once management has approved the work." : "Track where each one stands."}</p>
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
      {viewPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setViewPhoto(null)}>
          <img src={viewPhoto} alt="Change work order photo" className="max-h-full max-w-full rounded-lg object-contain" />
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-black" onClick={() => setViewPhoto(null)} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
      )}
    </div>
  );
}
