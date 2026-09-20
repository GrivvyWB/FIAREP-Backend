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
  const allowed = staff?.role === "management" && staff?.position === "CPM Supervisor";
  const { data, isLoading } = useListEntityRecords("procurement", { status: "submitted" }, {
    query: {
      queryKey: getListEntityRecordsQueryKey("procurement", { status: "submitted" }),
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
  const { data: approvedStaff = [] } = useListStaff({ status: "approved" }, {
    query: { queryKey: getListStaffQueryKey({ status: "approved" }), refetchOnMount: "always" },
  });
  const trades = ["Inspector", "CPM", "Plumber", "Carpenter", "Electrician", "Elevator Service"] as const;
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
  const rows = (data || []).filter((r) => (r.state as any)?.status === "submitted");
  async function decide(id: string, name: "approve" | "reject") {
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
      return <Card key={row.id}><CardHeader><CardTitle>{state.address || "Scope"}</CardTitle></CardHeader><CardContent className="space-y-3">
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
        <Textarea placeholder="Optional review note" value={notes[row.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))} />
         <div className="flex flex-wrap gap-2"><Button onClick={() => decide(row.id, "approve")} disabled={action.isPending}>Approve for Procurement</Button><Button variant="outline" onClick={() => decide(row.id, "reject")} disabled={action.isPending}>Return to CPM</Button><Button variant="secondary" onClick={() => { setHandoffRow(row); setHandoffTrade("Plumber"); setHandoffSupervisor(""); }} disabled={action.isPending}>Hand off in-house</Button></div>
      </CardContent></Card>;
    })}
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