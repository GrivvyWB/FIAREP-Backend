import { useState } from "react";
import {
  getListEntityRecordsQueryKey,
  useDeleteEntityRecord,
  useGetDeletionPolicy,
  useListEntityRecords,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Database, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const MODULES = [
  ["projects", "Projects"],
  ["rooms", "Rooms"],
  ["checklists", "Checklists"],
  ["cost-estimates", "Cost Estimates"],
  ["roofplans", "Roof Plans & Scans"],
  ["project-scopes", "Project Scopes"],
  ["project-notes", "Project Notes"],
  ["project-reviews", "Project Reviews"],
  ["intakes", "Client Intakes"],
  ["inspections", "Inspections"],
  ["hud-inspections", "HUD Inspections"],
  ["elevators", "Elevators"],
  ["resident-reports", "Resident Reports"],
  ["violations", "Inspector Violations"],
  ["building-violations", "Building Violations"],
  ["priority-violations", "Priority Violations"],
  ["route-assignments", "Route Assignments"],
  ["manpower-requests", "Trade Requests"],
  ["procurement", "Procurement"],
  ["procurement-bids", "Procurement Bids"],
  ["vendor-contacts", "Vendor Contacts"],
  ["vendor-quotes", "Vendor Quotes"],
  ["change-orders", "Change Orders"],
  ["elevator-jobs", "Elevator Jobs"],
  ["emergency-units", "Emergency Units"],
  ["emergency-jobs", "Emergency Jobs"],
  ["leave-requests", "Leave Requests"],
  ["global-settings", "Global Settings"],
  ["hr-employee-records", "HR Employee Records"],
  ["hr-recruiting", "HR Recruiting"],
  ["hr-onboarding", "HR Onboarding"],
  ["hr-payroll-benefits", "HR Payroll & Benefits"],
  ["hr-attendance", "HR Attendance"],
  ["hr-relations", "HR Relations"],
  ["hr-performance", "HR Performance"],
  ["hr-discipline", "HR Discipline"],
  ["hr-investigations", "HR Investigations"],
  ["hr-training-compliance", "HR Training & Compliance"],
  ["hr-exits", "HR Exits"],
  ["hr-approvals", "HR Approvals"],
] as const;

function recordTitle(state: Record<string, unknown>, fallback: string) {
  for (const key of ["title", "name", "address", "projectName", "development", "trackingId", "code"]) {
    if (typeof state[key] === "string" && state[key]) return state[key] as string;
  }
  return fallback;
}

function recordSummary(state: Record<string, unknown>) {
  for (const key of ["description", "note", "notes", "status", "text", "scope"]) {
    if (typeof state[key] === "string" && state[key]) return state[key] as string;
  }
  return "Shared mobile record";
}

export default function SharedData() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [entity, setEntity] = useState<(typeof MODULES)[number][0]>("checklists");
  const [search, setSearch] = useState("");
  const { data: deletionPolicy } = useGetDeletionPolicy();
  const deleteRecord = useDeleteEntityRecord();
  const { data, isLoading, error } = useListEntityRecords(entity, undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey(entity),
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  const activeLabel = MODULES.find(([value]) => value === entity)?.[1] || entity;
  const records = (data || []).filter((record) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return JSON.stringify(record).toLowerCase().includes(query);
  });

  async function removeRecord(id: string, version: number) {
    if (!window.confirm(`Permanently delete this ${activeLabel.toLowerCase()} record? This cannot be undone.`)) return;
    try {
      await deleteRecord.mutateAsync({ entity, id, data: { version } });
      await queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey(entity) });
      toast({ title: "Record deleted" });
    } catch (deleteError: any) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: deleteError?.message || "The server rejected this deletion.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Shared Mobile Data</h1>
        <p className="text-sm text-muted-foreground">
          View detailed records created in the FIAREP mobile app.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {MODULES.map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={entity === value ? "default" : "outline"}
            onClick={() => setEntity(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="bg-card rounded-[14px] border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
          <h2 className="font-bold flex-1">{activeLabel}</h2>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${activeLabel.toLowerCase()}...`}
              className="pl-9"
            />
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground">Loading shared records...</div>
          ) : error ? (
            <div className="p-10 text-center text-destructive">
              This module is unavailable for your current role.
            </div>
          ) : records.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Database className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <h3 className="font-bold">No {activeLabel.toLowerCase()} found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Records synchronized from mobile will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {records.map((record) => {
                const state = (record.state || {}) as Record<string, unknown>;
                return (
                  <div key={record.id} className="p-4 rounded-xl border border-border">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-bold truncate">{recordTitle(state, record.id)}</h3>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {recordSummary(state)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(record.updatedAt).toLocaleDateString()}
                        </span>
                        {deletionPolicy?.enabled && deletionPolicy.canDelete && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => removeRecord(record.id, record.version)}
                            disabled={deleteRecord.isPending}
                            data-testid={`button-delete-${entity}-${record.id}`}
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3 text-xs">
                      {record.development && (
                        <span className="bg-secondary px-2 py-1 rounded-full">{record.development}</span>
                      )}
                      {record.projectId && (
                        <span className="bg-secondary px-2 py-1 rounded-full">Project {record.projectId}</span>
                      )}
                      {typeof state.status === "string" && (
                        <span className="bg-secondary px-2 py-1 rounded-full capitalize">{state.status}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}