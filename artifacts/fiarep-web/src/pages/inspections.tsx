import {
  useGetEntityRecord,
  useListEntityRecords,
  usePerformEntityAction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Search, Building2, MapPin, RefreshCw } from "lucide-react";
import { useState } from "react";
import { FieldEvidenceDisplay } from "@/components/field-evidence-display";

type InspectionState = Record<string, unknown>;

function messageFor(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "Something went wrong. Please try again.";
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function Inspections() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("id"),
  );
  const { data: inspections, isLoading, isError, error, refetch } =
    useListEntityRecords("inspections", undefined, {
      query: { queryKey: ["/api/v1/inspections"], refetchInterval: 30000, staleTime: 10000 },
    });
  const detail = useGetEntityRecord("inspections", selectedId ?? "", {
    query: {
      queryKey: ["/api/v1/inspections", selectedId],
      enabled: Boolean(selectedId),
      refetchInterval: selectedId ? 30000 : false,
      staleTime: 10000,
    },
  });
  const action = usePerformEntityAction({
    mutation: {
      onSuccess: async (_, variables) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["/api/v1/inspections"] }),
          queryClient.invalidateQueries({
            queryKey: ["/api/v1/inspections", variables.id],
          }),
        ]);
      },
    },
  });

  const filtered = inspections?.filter((inspection) => {
    if (!search) return true;
    const state = inspection.state as InspectionState;
    const title = String(state.title ?? "").toLowerCase();
    const development = inspection.development?.toLowerCase() || "";
    const query = search.toLowerCase();
    return title.includes(query) || development.includes(query);
  });
  const selectedState = (detail.data?.state ?? {}) as InspectionState;
  // The server may expose additional workflow actions as part of an inspection
  // state. Only render the actions it explicitly offers.
  const availableActions = Array.isArray(selectedState.availableActions)
    ? selectedState.availableActions.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  const runAction = (workflowAction: string) => {
    if (!selectedId) return;
    action.mutate({ entity: "inspections", id: selectedId, action: workflowAction });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inspections</h1>
          <p className="text-muted-foreground text-sm">Manage field assessments and records.</p>
        </div>
        <Link href="/inspections/new">
          <Button className="font-semibold gap-2">
            <Plus className="w-4 h-4" /> New Inspection
          </Button>
        </Link>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border">
        <div className="p-4 border-b border-border flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search inspections..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading inspections...</div>
          ) : isError ? (
            <div className="p-8 text-center">
              <h3 className="font-semibold">Unable to load inspections</h3>
              <p className="text-sm text-destructive mt-1">{messageFor(error)}</p>
              <Button variant="outline" className="mt-4" onClick={() => refetch()}>Try again</Button>
            </div>
          ) : filtered?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Building2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-bold">No inspections found</h3>
              <p className="text-sm text-muted-foreground mt-1">Get started by creating a new inspection record.</p>
              <Link href="/inspections/new">
                <Button variant="outline" className="mt-4">Create Inspection</Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered?.map(insp => (
                <button
                  type="button"
                  key={insp.id}
                  onClick={() => setSelectedId(insp.id)}
                  className="w-full text-left flex items-center gap-4 p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors"
                >
                  <div className="w-12 h-12 rounded-[9px] bg-secondary text-secondary-foreground grid place-items-center shrink-0">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-[15px] truncate">{String((insp.state as InspectionState).title || "Untitled Inspection")}</h4>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 truncate">
                      <MapPin className="w-3 h-3" />
                      {insp.development || "No development specified"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-bold text-primary capitalize px-2 py-0.5 rounded-full bg-primary/10 inline-block mb-1">
                      {String((insp.state as InspectionState).status || "New")}
                    </div>
                    <div className="text-xs text-muted-foreground block">{new Date(insp.createdAt).toLocaleDateString()}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={Boolean(selectedId)} onOpenChange={open => !open && setSelectedId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{String(selectedState.title || "Inspection details")}</DialogTitle>
            <DialogDescription>
              {detail.isLoading ? "Loading the latest inspection record…" : "Full inspection record and management follow-through."}
            </DialogDescription>
          </DialogHeader>
          {detail.isError ? (
            <div className="text-sm text-destructive">{messageFor(detail.error)}</div>
          ) : detail.isLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Loading details…</div>
          ) : detail.data ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Development</span><p>{detail.data.development || "—"}</p></div>
                <div><span className="text-muted-foreground">Status</span><p className="capitalize">{displayValue(selectedState.status || "New")}</p></div>
                <div><span className="text-muted-foreground">Created</span><p>{new Date(detail.data.createdAt).toLocaleString()}</p></div>
                <div><span className="text-muted-foreground">Updated</span><p>{new Date(detail.data.updatedAt).toLocaleString()}</p></div>
              </div>
              <div className="border-t border-border pt-3 space-y-2">
                {Object.entries(selectedState).filter(([key]) => key !== "availableActions" && key !== "remoteFiles" && key !== "photoEvidence" && key !== "completionPhotoEvidence" && key !== "photos" && key !== "completionPhotos" && !key.includes("Geo") && !key.includes("At")).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground capitalize">{key.replace(/[A-Z]/g, letter => ` ${letter}`)}</span>
                    <span className="text-right break-all">{displayValue(value)}</span>
                  </div>
                ))}
              </div>
              <FieldEvidenceDisplay state={selectedState} />
              {action.isError && <p className="text-sm text-destructive">{messageFor(action.error)}</p>}
              {action.isSuccess && <p className="text-sm text-emerald-600">Workflow action completed.</p>}
            </div>
          ) : (
            <div className="py-6 text-sm text-muted-foreground">This inspection is no longer available.</div>
          )}
          <DialogFooter>
            {availableActions.map(workflowAction => (
              <Button key={workflowAction} onClick={() => runAction(workflowAction)} disabled={action.isPending} variant="outline">
                {action.isPending ? "Working…" : workflowAction.replaceAll("-", " ")}
              </Button>
            ))}
            <Button variant="outline" onClick={() => setSelectedId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}