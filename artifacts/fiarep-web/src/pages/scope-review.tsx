import { isCpmSupervisorTitle } from "@/lib/titles";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getListEntityRecordsQueryKey, useListEntityRecords, usePerformEntityAction } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useListStaff, getListStaffQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";

export default function ScopeReview() {
  const { staff } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = staff?.role === "management" && isCpmSupervisorTitle(staff?.position);
  const { data, isLoading } = useListEntityRecords("procurement", { status: "submitted" }, {
    query: {
      queryKey: getListEntityRecordsQueryKey("procurement", { status: "submitted" }),
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  // Every scope routed to this supervisor, at any stage, to follow it through.
  const { data: allScopes = [] } = useListEntityRecords("procurement", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("procurement"),
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  const { data: inspectorViolations = [] } = useListEntityRecords("building-violations", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("building-violations"),
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  const action = usePerformEntityAction();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [handoffRow, setHandoffRow] = useState<any>(null);
  const [handoffTrade, setHandoffTrade] = useState("Plumber");
  const [handoffSupervisor, setHandoffSupervisor] = useState("");
  const [cpmAssignment, setCpmAssignment] = useState<Record<string, string>>({});
  const { data: approvedStaff = [] } = useListStaff({ status: "approved" }, {
    query: { queryKey: getListStaffQueryKey({ status: "approved" }), refetchOnMount: "always" },
  });
  const trades = ["Inspector", "CPM", "Plumber", "Carpenter", "Electrician", "Elevator Service", "Painter", "Heating Service", "Bricklayer"] as const;
  const supervisorPositions: Record<string, string[]> = {
    Inspector: ["Supervisor Inspector", "Inspector Supervisor", "Inspection Supervisor"],
    CPM: ["CPM Supervisor", "Supervisor CPM"],
    Plumber: ["Plumbing Supervisor", "Plumber Supervisor", "Supervisor Plumber"],
    Carpenter: ["Carpenter Supervisor", "Supervisor Carpenter"],
    Electrician: ["Electrical Supervisor", "Electric Supervisor", "Electrician Supervisor", "Supervisor Electrician"],
    "Elevator Service": ["Elevator Supervisor", "Elevator Service Supervisor", "Supervisor Elevator"],
  };
  const handoffDevelopment = handoffRow?.development || handoffRow?.state?.development || "";
  const eligibleSupervisors = useMemo(() => approvedStaff.filter((member) =>
    member.id !== staff?.id &&
    supervisorPositions[handoffTrade].includes(member.position) &&
    Boolean(handoffDevelopment) &&
    member.developments.includes(handoffDevelopment),
  ), [approvedStaff, handoffDevelopment, handoffTrade, staff?.id]);

  useEffect(() => {
    if (staff && !allowed) setLocation("/dashboard");
  }, [allowed, staff, setLocation]);
  if (!allowed) return null;
  const rows = (data || []).filter((r) => {
    const state = r.state as any;
    if (state?.status !== "submitted") return false;
    if (state?.sourceHandoff !== "supervisor-inspector-to-cpm-supervisor") return true;
    const source = inspectorViolations.find((violation) => violation.id === state.sourceRecordId);
    return (source?.state as any)?.status !== "cpm_scope_assigned";
  });
  const cpmReviewRows = (inspectorViolations || []).filter((r) => {
    const state = r.state as any;
    return state?.status === "cpm_review" && state?.cpmSupervisorId === staff?.id;
  });
  const eligibleCpms = (development?: string | null) => approvedStaff.filter((member) =>
    member.role === "inspector" &&
    member.position === "CPM" &&
    Boolean(development) &&
    member.developments.includes(development || ""),
  );
  async function assignToCpm(row: any) {
    const receiverId = cpmAssignment[row.id];
    if (!receiverId) return;
    try {
      await action.mutateAsync({
        entity: "building-violations",
        id: row.id,
        action: "assign-cpm",
        data: { cpmStaffId: receiverId },
      });
      await invalidateOperationalQueries(queryClient, "building-violations", row.id);
      setCpmAssignment((current) => ({ ...current, [row.id]: "" }));
      toast({ title: "Violation assigned to CPM" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to assign CPM", description: error?.message || "The server rejected this assignment." });
    }
  }
  async function decide(id: string, name: "approve" | "reject") {
    if (name === "reject" && !(notes[id] || "").trim()) {
      toast({ variant: "destructive", title: "Add a note", description: "Tell the CPM what to correct before returning the scope." });
      return;
    }
    try {
      await action.mutateAsync({ entity: "procurement", id, action: name, data: notes[id] ? { note: notes[id] } : {} });
      await invalidateOperationalQueries(queryClient, "procurement", id, ["procurement-bids"]);
      toast({
        title: name === "approve" ? "Scope approved" : "Scope returned",
        description: name === "approve" ? "The scope is ready for procurement." : "The scope was returned to CPM.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Unable to update scope",
        description: error?.message || "Please try again.",
      });
    }
  }
  async function handoffInHouse() {
    if (!handoffRow || !handoffTrade || !handoffSupervisor) return;
    try {
      await action.mutateAsync({
        entity: "procurement",
        id: handoffRow.id,
        action: "handoff-inhouse",
        data: { requestedTrade: handoffTrade, receiverSupervisorId: handoffSupervisor },
      });
      await invalidateOperationalQueries(queryClient, "procurement", handoffRow.id, ["manpower-requests"]);
      setHandoffRow(null);
      setHandoffSupervisor("");
      toast({ title: "Scope handed off in-house" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to hand off scope", description: error?.message || "Please try again." });
    }
  }
   return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Scope Review</h1><p className="text-muted-foreground">Submitted CPM scopes awaiting CPM Supervisor review.</p></div>
     {cpmReviewRows.length > 0 && <section className="space-y-3">
       <h2 className="text-lg font-semibold">Inspector violations awaiting CPM scope</h2>
       {cpmReviewRows.map((row) => {
         const state = row.state as any;
         const cpms = eligibleCpms(row.development);
         return <Card key={row.id} className="border-amber-200">
           <CardHeader><CardTitle>{state.address || "Inspector violation"}</CardTitle></CardHeader>
           <CardContent className="space-y-3">
             <p className="text-sm"><span className="font-medium">Violation number:</span> {state.violationNumber || state.violationNo || state.number || "Not provided"}</p>
             <p className="whitespace-pre-wrap text-sm"><span className="font-medium">Notes:</span> {state.notes || state.note || state.description || "No notes provided."}</p>
             <div className="flex flex-wrap items-center gap-2">
               <select className="h-9 rounded-md border px-2 text-sm" value={cpmAssignment[row.id] || ""} onChange={(event) => setCpmAssignment((current) => ({ ...current, [row.id]: event.target.value }))} disabled={!cpms.length}>
                 <option value="">{cpms.length ? "Select approved CPM" : "No eligible approved CPM"}</option>
                 {cpms.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.position}</option>)}
               </select>
               <Button onClick={() => assignToCpm(row)} disabled={!cpmAssignment[row.id] || action.isPending}>Assign to CPM</Button>
             </div>
             {!cpms.length && <p className="text-xs text-destructive">No approved CPM is assigned to this development.</p>}
           </CardContent>
         </Card>;
       })}
     </section>}
     {isLoading ? <p>Loading scopes...</p> : rows.length === 0 ? <p className="text-muted-foreground">No submitted scopes.</p> : rows.map((row) => {
      const state = row.state as any;
       const inspectorViolationSource =
         state.sourceEntity === "building-violations" ||
         state.sourceType === "inspector-violation" ||
         state.source === "inspector-violation";
       const sourceViolation = inspectorViolationSource
         ? inspectorViolations.find((violation) => violation.id === state.sourceRecordId)
         : undefined;
       const sourceState = sourceViolation?.state as any;
       const violationNumber = sourceState?.violationNumber || sourceState?.violationNo ||
         sourceState?.number || state.violationNumber || state.violationNo || state.sourceViolationNumber;
       const violationAddress = sourceState?.address || state.address || state.sourceAddress;
       const violationNotes = sourceState?.notes || sourceState?.note || sourceState?.description ||
         state.notes || state.note || state.sourceNotes || state.description;
      const reference = state.sourceRef || state.complaintNo || (violationNumber ? `Violation ${violationNumber}` : "");
      return <Card key={row.id}><CardHeader><CardTitle>{[reference, state.address].filter(Boolean).join(" · ") || "Scope"}</CardTitle></CardHeader><CardContent className="space-y-3">
         {state.sourceEntity === "resident-reports" && <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
           <div className="font-semibold">Scoped from resident complaint {state.complaintNo || ""}</div>
           <div className="mt-1">Submitted by {state.cpmName || state.requestedBy || "CPM"}{state.address ? ` · ${state.address}` : ""}</div>
         </div>}
         {inspectorViolationSource && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
           <div className="font-semibold">Submitted from Supervisor Inspector violation</div>
           <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
             <dt className="font-medium">Violation number</dt><dd>{violationNumber || "Not provided"}</dd>
             <dt className="font-medium">Address</dt><dd>{violationAddress || "Not provided"}</dd>
             <dt className="font-medium">Notes</dt><dd className="whitespace-pre-wrap">{violationNotes || "No notes provided."}</dd>
           </dl>
         </div>}
        <p>{state.scope || state.description || "No scope description."}</p>
        {state.scopeFileName && <p className="text-sm text-muted-foreground">Attachment: {state.scopeFileName}</p>}
        <Textarea placeholder="Review note (required to return to the CPM)" value={notes[row.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))} />
         {state.sourceHandoff === "supervisor-inspector-to-cpm-supervisor" ? (
           <div className="flex flex-wrap gap-2"><Button onClick={() => decide(row.id, "approve")} disabled={action.isPending}>Procure</Button><Button variant="outline" onClick={() => decide(row.id, "reject")} disabled={action.isPending}>Return to CPM</Button><Button variant="secondary" onClick={() => { setHandoffRow(row); setHandoffTrade("Plumber"); setHandoffSupervisor(""); }} disabled={action.isPending}>Hand off in-house</Button></div>
         ) : (
           <div className="flex flex-wrap gap-2"><Button onClick={() => decide(row.id, "approve")} disabled={action.isPending}>Approve for Procurement</Button><Button variant="outline" onClick={() => decide(row.id, "reject")} disabled={action.isPending}>Return to CPM</Button><Button variant="secondary" onClick={() => { setHandoffRow(row); setHandoffTrade("Plumber"); setHandoffSupervisor(""); }} disabled={action.isPending}>Hand off in-house</Button></div>
         )}
      </CardContent></Card>;
    })}
    {(() => {
      const followed = (allScopes as any[]).filter((row) => {
        const state = row.state || {};
        return state.handoffTargetId === staff?.id && !["submitted", "draft"].includes(String(state.status || ""));
      });
      if (!followed.length) return null;
      const label: Record<string, string> = {
        returned: "Returned to CPM for correction",
        approved: "With Procurement",
        bidding: "Released to vendors",
        awarded: "Awarded to vendor",
        closed: "Closed",
        in_house: "Handed off in-house",
        in_house_completed: "In-house work completed",
      };
      return <section className="space-y-2">
        <h2 className="text-lg font-semibold">Scopes you've reviewed</h2>
        {followed.map((row) => {
          const state = row.state || {};
          return <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <span className="font-medium">{[state.sourceRef || state.complaintNo || state.violationNo, state.address].filter(Boolean).join(" · ") || "Scope"}</span>
            <span className="text-muted-foreground">{label[String(state.status)] || String(state.status || "")}{state.trackingId ? ` · ${state.trackingId}` : ""}</span>
          </div>;
        })}
      </section>;
    })()}
    <Dialog open={Boolean(handoffRow)} onOpenChange={(open) => !open && setHandoffRow(null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Hand off in-house</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Select the requested trade and an approved receiving supervisor assigned to {handoffDevelopment || "this development"}.</p>
          <div className="space-y-2"><Label>Requested trade</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={handoffTrade} onChange={(event) => { setHandoffTrade(event.target.value); setHandoffSupervisor(""); }}><option value="">Select trade</option>{trades.map((trade) => <option key={trade}>{trade}</option>)}</select></div>
          <div className="space-y-2"><Label>Receiving supervisor</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={handoffSupervisor} onChange={(event) => setHandoffSupervisor(event.target.value)} disabled={!handoffDevelopment}><option value="">{eligibleSupervisors.length ? "Select supervisor" : "No eligible approved supervisor"}</option>{eligibleSupervisors.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.position}</option>)}</select></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setHandoffRow(null)}>Cancel</Button><Button onClick={handoffInHouse} disabled={!handoffSupervisor || !handoffDevelopment || action.isPending}>Hand off in-house</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}