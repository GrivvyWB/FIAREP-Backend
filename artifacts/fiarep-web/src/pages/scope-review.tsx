import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useListEntityRecords, usePerformEntityAction } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getListEntityRecordsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function ScopeReview() {
  const { staff } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = staff?.role === "management" &&
    !["Borough Director", "Regional Director", "Superintendent"].includes(staff.position || "");
  const { data, isLoading } = useListEntityRecords("procurement", { status: "submitted" });
  const action = usePerformEntityAction();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (staff && !allowed) setLocation("/dashboard");
  }, [allowed, staff, setLocation]);
  if (!allowed) return null;
  const rows = (data || []).filter((r) => (r.state as any)?.status === "submitted");
  async function decide(id: string, name: "approve" | "reject") {
    try {
      await action.mutateAsync({ entity: "procurement", id, action: name, data: notes[id] ? { note: notes[id] } : {} });
      await queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("procurement") });
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
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Scope Review</h1><p className="text-muted-foreground">Submitted CPM scopes awaiting Management review.</p></div>
    {isLoading ? <p>Loading scopes...</p> : rows.length === 0 ? <p className="text-muted-foreground">No submitted scopes.</p> : rows.map((row) => {
      const state = row.state as any;
      return <Card key={row.id}><CardHeader><CardTitle>{state.address || "Scope"}</CardTitle></CardHeader><CardContent className="space-y-3">
        <p>{state.scope || state.description || "No scope description."}</p>
        {state.scopeFileName && <p className="text-sm text-muted-foreground">Attachment: {state.scopeFileName}</p>}
        <Textarea placeholder="Optional review note" value={notes[row.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))} />
        <div className="flex gap-2"><Button onClick={() => decide(row.id, "approve")} disabled={action.isPending}>Approve for Procurement</Button><Button variant="outline" onClick={() => decide(row.id, "reject")} disabled={action.isPending}>Return to CPM</Button></div>
      </CardContent></Card>;
    })}
  </div>;
}