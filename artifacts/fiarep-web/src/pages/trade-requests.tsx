import { useMemo, useState } from "react";
import {
  getListEntityRecordsQueryKey,
  getListStaffQueryKey,
  useCreateEntityRecord,
  useDeleteEntityRecord,
  useGetDeletionPolicy,
  useListEntityRecords,
  useListStaff,
  usePerformEntityAction,
  type EntityRecord,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Send, Trash2, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";

const trades = ["Inspector", "CPM", "Plumber", "Carpenter", "Electrician", "Elevator Service", "Painter", "Heating Service", "Bricklayer"] as const;
const supervisorPositions: Record<(typeof trades)[number], readonly string[]> = {
  Inspector: ["Supervisor Inspector", "Inspector Supervisor", "Inspection Supervisor"],
  CPM: ["CPM Supervisor", "Supervisor CPM"],
  Plumber: ["Plumbing Supervisor", "Plumber Supervisor", "Supervisor Plumber"],
  Carpenter: ["Carpenter Supervisor", "Supervisor Carpenter"],
  Electrician: ["Electrical Supervisor", "Electric Supervisor", "Electrician Supervisor", "Supervisor Electrician"],
  "Elevator Service": ["Elevator Supervisor", "Elevator Service Supervisor", "Supervisor Elevator"],
  Painter: ["Painter Supervisor", "Painting Supervisor", "Supervisor Painter"],
  "Heating Service": ["Heating Service Supervisor", "Supervisor Heating Service", "Heat Plant Supervisor", "Heating Supervisor", "Boiler Supervisor"],
  Bricklayer: ["Bricklayer Supervisor", "Supervisor Bricklayer", "Mason Supervisor"],
};

type SourceEntity = "resident-reports" | "building-violations";

function statusLabel(value: unknown) {
  return String(value || "pending").replaceAll("_", " ");
}

function sourceLabel(record: EntityRecord) {
  const state = record.state || {};
  return String(
    state.title ||
    state.complaintNo ||
    state.violationNumber ||
    state.address ||
    `${record.entity} ${record.id.slice(0, 8)}`,
  );
}

export default function TradeRequests() {
  const { staff: actor } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: deletionPolicy } = useGetDeletionPolicy();
  const [open, setOpen] = useState(false);
  const [sourceEntity, setSourceEntity] = useState<SourceEntity>("resident-reports");
  const [sourceRecordId, setSourceRecordId] = useState("");
  const [requestedTrade, setRequestedTrade] = useState<(typeof trades)[number]>("Inspector");
  const [receiverSupervisorId, setReceiverSupervisorId] = useState("");
  const [note, setNote] = useState("");
  const [assigningRequest, setAssigningRequest] = useState<EntityRecord | null>(null);
  const [assignedStaffId, setAssignedStaffId] = useState("");

  const requestsQuery = useListEntityRecords("manpower-requests", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("manpower-requests"),
      refetchOnMount: "always",
      refetchInterval: 15_000,
    },
  });
  const reportsQuery = useListEntityRecords("resident-reports", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("resident-reports"), refetchOnMount: "always" },
  });
  const violationsQuery = useListEntityRecords("building-violations", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("building-violations"), refetchOnMount: "always" },
  });
  const procurementQuery = useListEntityRecords("procurement", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("procurement"), refetchOnMount: "always" },
  });
  const { data: staff = [] } = useListStaff({ status: "approved" }, {
    query: {
      queryKey: getListStaffQueryKey({ status: "approved" }),
      refetchOnMount: "always",
      refetchInterval: 15_000,
    },
  });
  const create = useCreateEntityRecord();
  const action = usePerformEntityAction();
  const deleteRequest = useDeleteEntityRecord();

  const sourceRecords = (
    sourceEntity === "resident-reports"
      ? reportsQuery.data || []
      : violationsQuery.data || []
  ).filter((record) => {
    const status = String(record.state?.status || "").toLowerCase();
    return sourceEntity === "resident-reports" ? status === "submitted" : status === "approved";
  });
  const sentSourceIds = useMemo(
    () => new Set((requestsQuery.data || []).map((request) =>
      String(request.state?.sourceRecordId || ""),
    ).filter(Boolean)),
    [requestsQuery.data],
  );
  const selectedSource = sourceRecords.find((record) => record.id === sourceRecordId);
  const procurementSources = useMemo(() => new Map(
    (procurementQuery.data || []).map((record) => [record.id, record]),
  ), [procurementQuery.data]);
  const selectedSourceSent = Boolean(selectedSource && sentSourceIds.has(selectedSource.id));
  const supervisors = useMemo(() => staff.filter((member) =>
    member.id !== actor?.id &&
    supervisorPositions[requestedTrade].includes(member.position) &&
    (!selectedSource?.development ||
      member.developments.length === 0 ||
      member.developments.includes(selectedSource.development)),
  ), [actor?.id, requestedTrade, selectedSource?.development, staff]);

  const availableStaff = useMemo(() => {
    if (!assigningRequest) return [];
    const trade = String(assigningRequest.state?.requestedTrade || "");
    const dev = String(assigningRequest.development || "").trim().toLowerCase();
    // Mirrors the server's manpower assign check: an operational (non-supervisor)
    // member of the requested trade who covers the site, matched case-insensitively.
    return staff.filter((member) =>
      member.position === trade &&
      ["worker", "inspector", "emergency"].includes(member.role) &&
      member.id !== actor?.id &&
      (!dev || member.developments.some((value) => (value || "").trim().toLowerCase() === dev)),
    );
  }, [actor?.id, assigningRequest, staff]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("manpower-requests") });
  }

  async function submitRequest() {
    if (!selectedSource || !receiverSupervisorId) return;
    try {
      await create.mutateAsync({
        entity: "manpower-requests",
        data: {
          id: crypto.randomUUID(),
          development: selectedSource.development || undefined,
          version: 1,
          state: {
            sourceEntity,
            sourceRecordId: selectedSource.id,
            requestedTrade,
            receiverSupervisorId,
            note,
          },
        },
      });
      await refresh();
      setOpen(false);
      setSourceRecordId("");
      setReceiverSupervisorId("");
      setNote("");
      toast({ title: "Trade request sent" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Request failed", description: error?.message || "The server rejected this request." });
    }
  }

  async function runAction(request: EntityRecord, actionName: "assign" | "dispatch", staffId?: string) {
    try {
      await action.mutateAsync({
        entity: "manpower-requests",
        id: request.id,
        action: actionName,
        data: staffId ? { assignedStaffId: staffId } : undefined,
      });
      await refresh();
      if (actionName === "dispatch") {
        const sourceEntity = String(request.state?.sourceEntity || "");
        if (sourceEntity) await invalidateOperationalQueries(
          queryClient,
          sourceEntity,
          String(request.state?.sourceRecordId || ""),
        );
      }
      setAssigningRequest(null);
      setAssignedStaffId("");
      toast({ title: actionName === "assign" ? "Employee assigned" : "Employee dispatched" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Action failed", description: error?.message || "The server rejected this action." });
    }
  }

  async function removeRequest(request: EntityRecord) {
    if (!window.confirm("Permanently delete this trade request? This cannot be undone.")) return;
    try {
      await deleteRequest.mutateAsync({
        entity: "manpower-requests",
        id: request.id,
        data: { version: request.version },
      });
      await refresh();
      toast({ title: "Trade request deleted" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error?.message || "The server rejected this deletion.",
      });
    }
  }

  const requests = [...(requestsQuery.data || [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trade-Supervisors:</h1>
          <p className="text-sm text-muted-foreground">Sending complaints or violations to trade supervision.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />New request</Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {requestsQuery.isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading trade requests...</div>
        ) : requests.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="font-medium">No trade requests found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {requests.map((request) => {
              const state = request.state || {};
              const status = String(state.status || "pending");
              const isReceiver = state.receiverSupervisorId === actor?.id;
              const source = String(state.sourceEntity || "");
              const procurementSource = source === "procurement" ? procurementSources.get(String(state.sourceRecordId || "")) : undefined;
              const sourceDescription = String(
                state.sourceAddress || state.address || state.scope ||
                procurementSource?.state?.address || procurementSource?.state?.scope || "",
              );
              const sourceTitle = String(
                state.sourceTitle || procurementSource?.state?.address || procurementSource?.state?.scope || "Work request",
              );
              return (
                <div key={request.id} className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                         <h3 className="font-semibold">{sourceTitle}</h3>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold capitalize text-primary">{statusLabel(status)}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {String(state.requestedTrade || "Trade")} · {request.development || "No development"}
                      </p>
                       <p className="mt-1 text-sm">
                        Sent by {String(state.requestedByName || "Management")} to {String(state.receiverSupervisorName || "Supervisor")}
                      </p>
                       <p className="mt-1 text-xs text-muted-foreground">
                         Source: {source || "trade request"}{sourceDescription ? ` · ${sourceDescription}` : ""}
                       </p>
                      {!!String(state.note || "") && <p className="mt-2 text-sm">{String(state.note)}</p>}
                      {!!String(state.assignedTo || "") && <p className="mt-2 text-sm font-medium">Assigned to {String(state.assignedTo)}</p>}
                    </div>
                    {(isReceiver || (deletionPolicy?.enabled && deletionPolicy.canDelete)) && (
                      <div className="flex gap-2">
                        {status === "pending" && (
                          <Button size="sm" variant="outline" onClick={() => setAssigningRequest(request)}>
                            <UserRoundCheck className="mr-1.5 h-4 w-4" />Assign
                          </Button>
                        )}
                        {status === "assigned" && (
                          <Button size="sm" onClick={() => runAction(request, "dispatch")} disabled={action.isPending}>
                            <Send className="mr-1.5 h-4 w-4" />Dispatch
                          </Button>
                        )}
                        {deletionPolicy?.enabled && deletionPolicy.canDelete && actor?.role === "administrator" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => removeRequest(request)}
                            disabled={deleteRequest.isPending}
                            data-testid={`button-delete-trade-request-${request.id}`}
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader><DialogTitle>New trade request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Record type</Label>
              <select value={sourceEntity} onChange={(event) => {
                setSourceEntity(event.target.value as SourceEntity);
                setSourceRecordId("");
                setReceiverSupervisorId("");
              }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="resident-reports">Complaint</option>
                <option value="building-violations">Violation</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Complaint or violation</Label>
              <select value={sourceRecordId} onChange={(event) => {
                setSourceRecordId(event.target.value);
                setReceiverSupervisorId("");
              }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select record</option>
                {sourceRecords.map((record) => {
                  const sent = sentSourceIds.has(record.id);
                  return (
                    <option key={record.id} value={record.id} disabled={sent}>
                      {sourceLabel(record)}{sent ? " · Sent" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Trade needed</Label>
              <select value={requestedTrade} onChange={(event) => setRequestedTrade(event.target.value as (typeof trades)[number])} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {trades.map((trade) => <option key={trade} value={trade}>{trade}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Receiving supervisor</Label>
              <select value={receiverSupervisorId} onChange={(event) => setReceiverSupervisorId(event.target.value)} disabled={!selectedSource} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60">
                <option value="">{supervisors.length ? "Select supervisor" : `No approved ${supervisorPositions[requestedTrade][0]} available`}</option>
                {supervisors.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.position}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submitRequest} disabled={!selectedSource || selectedSourceSent || !receiverSupervisorId || create.isPending}>
              {create.isPending ? "Sending..." : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(assigningRequest)} onOpenChange={(value) => {
        if (!value) {
          setAssigningRequest(null);
          setAssignedStaffId("");
        }
      }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>Assign available manpower</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Employee</Label>
            <select value={assignedStaffId} onChange={(event) => setAssignedStaffId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Select employee</option>
              {availableStaff.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.position}</option>)}
            </select>
            {!availableStaff.length && <p className="text-sm text-muted-foreground">This request will remain pending until manpower is available.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigningRequest(null)}>Cancel</Button>
            <Button onClick={() => assigningRequest && runAction(assigningRequest, "assign", assignedStaffId)} disabled={!assignedStaffId || action.isPending}>Assign employee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}