import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListEntityRecordsQueryKey, useCreateEntityRecord, useListEntityRecords, usePerformEntityAction, useUpdateEntityRecord } from "@workspace/api-client-react";
import { CalendarDays, Check, Plane, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";

type Row = { id: string; version: number; development?: string | null; state?: Record<string, unknown>; createdAt: string };
type LeaveDraft = {
  employee: string;
  type: string;
  startAt: string;
  endAt: string;
  returnAt: string;
  amount: string;
  reason: string;
  reasonableAccommodation: string;
};

const emptyDraft = (employee = ""): LeaveDraft => ({
  employee,
  type: "Vacation",
  startAt: "",
  endAt: "",
  returnAt: "",
  amount: "full",
  reason: "",
  reasonableAccommodation: "",
});

function requestedDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate || startDate}T00:00:00`);
  const difference = end.getTime() - start.getTime();
  return Number.isFinite(difference) && difference >= 0
    ? Math.floor(difference / 86_400_000) + 1
    : 1;
}

export default function Leave() {
  const { staff } = useAuth();
  const initialParams = new URLSearchParams(window.location.search);
  const initialEmployee = initialParams.get("employee") || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useListEntityRecords("leave-requests", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("leave-requests"),
      refetchInterval: 30_000,
      staleTime: 10_000,
      refetchOnMount: "always",
    },
  });
  const action = usePerformEntityAction();
  const create = useCreateEntityRecord();
  const update = useUpdateEntityRecord();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(() => initialParams.get("new") === "1");
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState<LeaveDraft>(() => emptyDraft(initialEmployee));
  const [decisionTarget, setDecisionTarget] = useState<{ row: Row; name: "approve" | "deny" } | null>(null);
  const [authorizationCode, setAuthorizationCode] = useState("");
  const rows = (query.data || []) as Row[];
  const canDecide = staff?.role === "human_resources" ||
    staff?.role === "management";
  const canViewTeamLeave = canDecide && staff?.position !== "Borough Director";
  const teamView = canViewTeamLeave && new URLSearchParams(window.location.search).get("view") === "team";
  const ownRows = rows.filter((row) => {
    const state = row.state || {};
    return state.employeeStaffId === staff?.id ||
      (!state.employeeStaffId &&
        String(state.employee || "").trim().toLowerCase() ===
        String(staff?.name || "").trim().toLowerCase());
  });
  const visibleRows = teamView ? rows : ownRows;
  const filtered = visibleRows.filter((row) => {
    const s = row.state || {};
    return [row.id, row.development, s.employee, s.reason, s.status].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase());
  });
  const refresh = (id?: string) => invalidateOperationalQueries(queryClient, "leave-requests", id);
  const draftDays = draft.startAt
    ? requestedDays(draft.startAt.slice(0, 10), (draft.endAt || draft.startAt).slice(0, 10))
    : 0;
  const validDraftDuration = (draftDays >= 1 && draftDays <= 14) || (draftDays >= 30 && draftDays <= 365);
  const longLeave = draftDays >= 30;
  const save = async () => {
    try {
      if (!draft.employee.trim() || !draft.startAt || !draft.endAt || !draft.returnAt) {
        throw new Error("Complete all required leave request fields.");
      }
      if (!validDraftDuration) {
        throw new Error("Time off must be 1 to 14 days or 30 to 365 days.");
      }
      if (longLeave && !draft.reasonableAccommodation.trim()) {
        throw new Error("A reasonable accommodation is required for 30 to 365 days off.");
      }
      if (draft.endAt && new Date(draft.endAt) < new Date(draft.startAt)) {
        throw new Error("End date and time must follow the start date and time.");
      }
      if (draft.returnAt && new Date(draft.returnAt) < new Date(draft.endAt || draft.startAt)) {
        throw new Error("Return date and time must follow the end date and time.");
      }
      const hours = draft.amount === "full" ? undefined : Number(draft.amount);
      const startDate = draft.startAt.slice(0, 10);
      const endDate = (draft.endAt || draft.startAt).slice(0, 10);
      const state = {
        ...(editing?.state || {}),
        employee: draft.employee,
        type: draft.type,
        startAt: draft.startAt,
        endAt: draft.endAt || draft.startAt,
        returnAt: draft.returnAt,
        startDate,
        endDate,
        days: requestedDays(startDate, endDate),
        hours,
        reason: draft.reason,
        reasonableAccommodation: draft.reasonableAccommodation,
        title: `${draft.employee || "Staff"} leave`,
      };
      if (editing) await update.mutateAsync({ entity: "leave-requests", id: editing.id, data: { id: editing.id, version: editing.version, state } });
       else await create.mutateAsync({ entity: "leave-requests", data: { id: crypto.randomUUID(), state, version: 1, development: initialParams.get("development") || staff?.developments?.[0] } });
       await refresh(editing?.id); setOpen(false); toast({ title: editing ? "Leave request updated" : "Leave request submitted" });
    } catch (error: any) { toast({ variant: "destructive", title: "Unable to save leave request", description: error?.message || "Please try again." }); }
  };
  const decide = async (row: Row, name: "approve" | "deny", code?: string) => {
     try { await action.mutateAsync({ entity: "leave-requests", id: row.id, action: name, data: code ? { authorizationCode: code } : undefined }); await refresh(row.id); setDecisionTarget(null); setAuthorizationCode(""); toast({ title: `Leave request ${name}d` }); }
    catch (error: any) { toast({ variant: "destructive", title: "Workflow action failed", description: error?.message || "The server rejected this action." }); }
  };
  const requestDecision = (row: Row, name: "approve" | "deny") => {
    if (staff?.role === "human_resources") {
      setAuthorizationCode("");
      setDecisionTarget({ row, name });
      return;
    }
    void decide(row, name);
  };
  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold tracking-tight">{teamView ? "Pending Leave" : "Leave"}</h1><p className="text-sm text-muted-foreground">{teamView ? "Review staff leave requests and their current approval status." : "Enter and review your leave time."}</p></div>{!teamView && <Button onClick={() => { setEditing(null); setDraft(emptyDraft(staff?.name || "")); setOpen(true); }}>New leave request</Button>}</div>
    <div className="rounded-[14px] border border-border bg-card shadow-sm"><div className="border-b border-border p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search employee, reason, status…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div><div className="p-4">
      {query.isLoading && <div className="p-10 text-center text-muted-foreground">Loading leave requests…</div>}
      {query.isError && <div className="p-10 text-center text-destructive">Unable to load leave requests. <Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div>}
      {!query.isLoading && !query.isError && !filtered.length && <div className="p-12 text-center text-muted-foreground"><CalendarDays className="mx-auto mb-3 h-10 w-10 opacity-30" />{visibleRows.length ? "No requests match your search." : "No leave requests yet."}</div>}
      <div className="grid gap-3">{filtered.map((row) => { const s = row.state || {}; const status = String(s.status || "Pending"); const ownRequest = s.employeeStaffId === staff?.id || (!s.employeeStaffId && String(s.employee || "").trim().toLowerCase() === String(staff?.name || "").trim().toLowerCase()); const days = requestedDays(String(s.startAt || s.startDate || "").slice(0, 10), String(s.endAt || s.endDate || s.startAt || s.startDate || "").slice(0, 10)); const canDecideDuration = staff?.role === "human_resources" ? days >= 30 && days <= 365 : days >= 1 && days <= 14; return <div key={row.id} className="rounded-xl border border-border p-4"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary"><Plane className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h3 className="font-semibold">{String(s.employee || s.title || "Staff leave request")}</h3><p className="text-sm text-muted-foreground">{String(s.startAt || s.startDate || "—")} – {String(s.endAt || s.endDate || "—")} · Return {String(s.returnAt || "—")} · {row.development || "All developments"}</p>{Boolean(s.reason) && <p className="mt-1 text-sm">{String(s.reason)}</p>}{Boolean(s.reasonableAccommodation) && <p className="mt-1 text-sm">{String(s.reasonableAccommodation)}</p>}</div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{status}</span></div><div className="mt-3 flex justify-end gap-2">{status === "Pending" && teamView && canDecide && canDecideDuration && !ownRequest && <><Button size="sm" onClick={() => requestDecision(row, "approve")} disabled={action.isPending}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" onClick={() => requestDecision(row, "deny")} disabled={action.isPending}><X className="mr-1 h-3.5 w-3.5" />Deny</Button></>}{!teamView && ownRequest && status === "Pending" && <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setDraft({ employee: String(s.employee || ""), type: String(s.type || "Vacation"), startAt: String(s.startAt || `${s.startDate || ""}T09:00`), endAt: String(s.endAt || `${s.endDate || s.startDate || ""}T17:00`), returnAt: String(s.returnAt || ""), amount: Number(s.hours) > 0 ? String(s.hours) : "full", reason: String(s.reason || ""), reasonableAccommodation: String(s.reasonableAccommodation || "") }); setOpen(true); }}>Edit details</Button>}</div></div>; })}</div>
    </div></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Edit leave request" : "New leave request"}</DialogTitle></DialogHeader><div className="space-y-3"><label className="block space-y-1"><span className="text-sm font-medium">Employee</span><Input value={draft.employee} onChange={(e) => setDraft({ ...draft, employee: e.target.value })} /></label><label className="block space-y-1"><span className="text-sm font-medium">Leave type</span><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option>Vacation</option><option>Sick</option><option>Personal</option><option>Bereavement</option><option>Other</option></select></label><div className="grid gap-2 sm:grid-cols-3"><label className="block space-y-1"><span className="text-sm font-medium">Start date and time</span><Input type="datetime-local" value={draft.startAt} onChange={(e) => setDraft({ ...draft, startAt: e.target.value })} /></label><label className="block space-y-1"><span className="text-sm font-medium">End date and time</span><Input type="datetime-local" value={draft.endAt} onChange={(e) => setDraft({ ...draft, endAt: e.target.value })} /></label><label className="block space-y-1"><span className="text-sm font-medium">Return date and time</span><Input type="datetime-local" value={draft.returnAt} onChange={(e) => setDraft({ ...draft, returnAt: e.target.value })} /></label></div><label className="block space-y-1"><span className="text-sm font-medium">Amount of time</span><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })}><option value="full">Full day(s)</option>{[1, 2, 3, 4, 5, 6, 7].map((hour) => <option key={hour} value={hour}>{hour} hour{hour === 1 ? "" : "s"}</option>)}</select></label><label className="block space-y-1"><span className="text-sm font-medium">Reason (Optional)</span><Input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>{longLeave && <label className="block space-y-1"><span className="text-sm font-medium">Reasonable accommodation</span><Input value={draft.reasonableAccommodation} onChange={(e) => setDraft({ ...draft, reasonableAccommodation: e.target.value })} /></label>}<Button className="w-full" onClick={save} disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save request"}</Button></div></DialogContent></Dialog>
    <Dialog open={Boolean(decisionTarget)} onOpenChange={(value) => { if (!value) { setDecisionTarget(null); setAuthorizationCode(""); } }}><DialogContent><DialogHeader><DialogTitle>Enter HR access code</DialogTitle></DialogHeader><div className="space-y-3"><Input aria-label="HR access code" value={authorizationCode} maxLength={4} onChange={(event) => setAuthorizationCode(event.target.value.toUpperCase())} /><Button className="w-full" disabled={action.isPending || authorizationCode.length !== 4 || !decisionTarget} onClick={() => decisionTarget && decide(decisionTarget.row, decisionTarget.name, authorizationCode)}>{action.isPending ? "Confirming…" : "Confirm"}</Button></div></DialogContent></Dialog>
  </div>;
}
