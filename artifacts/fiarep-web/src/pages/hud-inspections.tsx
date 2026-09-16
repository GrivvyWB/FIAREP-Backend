import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEntityRecordsQueryKey,
  useListEntityRecords,
  usePerformEntityAction,
} from "@workspace/api-client-react";
import { Check, ClipboardCheck, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";

type HudRow = {
  id: string;
  development?: string | null;
  state?: Record<string, unknown>;
};

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export default function HudInspections() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const query = useListEntityRecords("hud-inspections", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("hud-inspections"),
      refetchInterval: 30_000,
      staleTime: 10_000,
      refetchOnMount: "always",
    },
  });
  const action = usePerformEntityAction();
  const rows = (query.data || []) as HudRow[];

  async function decide(row: HudRow, name: "approve" | "deny" | "correction") {
    try {
      await action.mutateAsync({
        entity: "hud-inspections",
        id: row.id,
        action: name,
        data: notes[row.id]?.trim() ? { note: notes[row.id].trim() } : {},
      });
      await invalidateOperationalQueries(queryClient, "hud-inspections", row.id);
      setNotes((current) => ({ ...current, [row.id]: "" }));
      toast({
        title: name === "approve"
          ? "HUD inspection approved"
          : name === "deny"
            ? "HUD inspection denied"
            : "Correction requested",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Unable to update HUD inspection",
        description: error?.message || "Please try again.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HUD Inspections</h1>
      </div>

      {query.isLoading && <p className="text-muted-foreground">Loading HUD inspections...</p>}
      {query.isError && <p className="text-destructive">Unable to load HUD inspections.</p>}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
          <ClipboardCheck className="mx-auto mb-3 h-10 w-10 opacity-30" />
          No HUD inspections submitted for review.
        </div>
      )}

      {rows.map((row) => {
        const state = row.state || {};
        const status = text(state.status, "Submitted");
        const deficiencies = Array.isArray(state.deficiencies) ? state.deficiencies : [];
        const correctiveActions = Array.isArray(state.correctiveActions) ? state.correctiveActions : [];
        const submitted = status === "Submitted";

        return (
          <Card key={row.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{text(state.unitAddress, "HUD inspection")}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {text(row.development || state.development)} · {text(state.inspectionType)} · {text(state.inspectionDate)}
                  </p>
                </div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  {status}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="text-muted-foreground">Inspector</span><p className="font-medium">{text(state.inspectorName)}</p></div>
                <div><span className="text-muted-foreground">Result</span><p className="font-medium capitalize">{text(state.overallResult)}</p></div>
                <div><span className="text-muted-foreground">Deficiencies</span><p className="font-medium">{deficiencies.length}</p></div>
                <div><span className="text-muted-foreground">Corrective actions</span><p className="font-medium">{correctiveActions.length}</p></div>
              </div>

              {deficiencies.length > 0 && (
                <div className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-sm font-semibold">Deficiencies</p>
                  <div className="space-y-2">
                    {deficiencies.map((item, index) => {
                      const deficiency = item && typeof item === "object"
                        ? item as Record<string, unknown>
                        : {};
                      return (
                        <div key={text(deficiency.id, String(index))} className="text-sm">
                          <p className="font-medium">{text(deficiency.title, "Deficiency")}</p>
                          <p className="text-muted-foreground">{text(deficiency.location)} · {text(deficiency.correctionTimeframe)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {submitted && (
                <div className="space-y-3 border-t border-border pt-4">
                  <Textarea
                    aria-label="Review note"
                    placeholder="Review note"
                    value={notes[row.id] || ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => decide(row, "approve")} disabled={action.isPending}>
                      <Check className="mr-1 h-4 w-4" />Approve
                    </Button>
                    <Button variant="outline" onClick={() => decide(row, "correction")} disabled={action.isPending}>
                      <RotateCcw className="mr-1 h-4 w-4" />Correction
                    </Button>
                    <Button variant="destructive" onClick={() => decide(row, "deny")} disabled={action.isPending}>
                      <X className="mr-1 h-4 w-4" />Deny
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}