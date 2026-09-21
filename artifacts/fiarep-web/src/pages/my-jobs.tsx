import { useState } from "react";
import {
  getListEntityRecordsQueryKey,
  useListEntityRecords,
  usePerformEntityAction,
  useRequestFileUploadUrl,
  type EntityRecord,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { FieldEvidenceDisplay } from "@/components/field-evidence-display";

export default function MyJobs() {
  const { staff } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const action = usePerformEntityAction();
  const requestUpload = useRequestFileUploadUrl();
  const [completionJob, setCompletionJob] = useState<EntityRecord | null>(null);
  const [completionNote, setCompletionNote] = useState("");
  const [completionPhoto, setCompletionPhoto] = useState<File | null>(null);
  const workerFilter = {
    sourceEntity: "procurement",
    assignedStaffId: staff?.id || "",
  } as any;
  const query = useListEntityRecords("manpower-requests", workerFilter, {
    query: {
      queryKey: getListEntityRecordsQueryKey("manpower-requests", workerFilter),
      enabled: Boolean(staff?.id),
      refetchOnMount: "always",
      refetchInterval: 15_000,
    },
  });
  const residentQuery = useListEntityRecords("resident-reports", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("resident-reports"),
      enabled: Boolean(staff?.id),
      refetchOnMount: "always",
      refetchInterval: 15_000,
    },
  });
  const jobs = query.data || [];
  const residentJobs = (residentQuery.data || []).filter((record) => {
    const state = record.state || {};
    return String(state.assignedStaffId || "") === staff?.id &&
      !["resolved", "done", "cleared"].includes(String(state.status || ""));
  });
  const loading = query.isLoading || residentQuery.isLoading;

  const textList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((item) => typeof item === "string" ? item : item && typeof item === "object"
          ? String((item as Record<string, unknown>).name || (item as Record<string, unknown>).description || "")
          : "")
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
  };

  async function start(job: EntityRecord) {
    try {
      await action.mutateAsync({ entity: "manpower-requests", id: job.id, action: "start" });
      await client.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("manpower-requests") });
      toast({ title: "Work started" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to start work", description: error?.message || "Please try again." });
    }
  }

  async function complete() {
    if (!completionJob || !completionNote.trim() || !completionPhoto) return;
    try {
      const uploaded = await requestUpload.mutateAsync({
        data: {
          kind: "completion-photo",
          name: completionPhoto.name || "completed-work.jpg",
          size: completionPhoto.size,
          contentType: completionPhoto.type || "image/jpeg",
          entity: "manpower-requests",
          recordId: completionJob.id,
        },
      });
      const response = await fetch(uploaded.uploadUrl, {
        method: "PUT",
        body: completionPhoto,
        headers: { "Content-Type": completionPhoto.type || "image/jpeg" },
      });
      if (!response.ok) throw new Error("Could not upload completion evidence.");
      const state = completionJob.state || {};
      await action.mutateAsync({
        entity: "manpower-requests",
        id: completionJob.id,
        action: "complete",
        data: {
          completionNote: completionNote.trim(),
          photoEvidence: [
            ...(Array.isArray(state.photoEvidence) ? state.photoEvidence : []),
            {
              objectPath: uploaded.file.objectPath,
              id: uploaded.file.id || uploaded.file.name,
              name: uploaded.file.name,
              contentType: uploaded.file.contentType || completionPhoto.type || "image/jpeg",
            },
          ],
        },
      });
      await client.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("manpower-requests") });
      setCompletionJob(null);
      setCompletionNote("");
      setCompletionPhoto(null);
      toast({ title: "Work completed" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to complete work", description: error?.message || "Please try again." });
    }
  }

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">My Jobs</h1><p className="text-muted-foreground">Work assigned to you.</p></div>
    {loading ? <p>Loading assigned jobs...</p> : !jobs.length && !residentJobs.length ? <p className="text-muted-foreground">No assigned jobs.</p> : <div className="space-y-3">
      {residentJobs.map((job) => {
        const state = job.state || {};
        const materials = textList(
          state.materialBreakdown ??
          state.materials ??
          state.materialList ??
          state.partsNeeded ??
          state.parts,
        );
        const work = String(state.scopeOfWork || state.workDescription || state.description || state.issue || "");
        return <div key={job.id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{String(state.complaintNo || state.title || "Assigned complaint")}</h2>
              <p className="text-sm text-muted-foreground">{String(state.address || "No address")} · {job.development || "No development"} · {String(state.status || "assigned").replaceAll("_", " ")}</p>
              {work && <div className="mt-3"><p className="text-sm font-semibold">Work to complete</p><p className="mt-1 whitespace-pre-wrap text-sm">{work}</p></div>}
              {materials.length > 0 && <div className="mt-3"><p className="text-sm font-semibold">Material breakdown</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{materials.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
            </div>
            <Button size="sm" asChild><Link href={`/reports?id=${encodeURIComponent(job.id)}`}>Open job</Link></Button>
          </div>
          <FieldEvidenceDisplay state={state} reportId={job.id} />
        </div>;
      })}
      {jobs.map((job) => {
        const state = job.state || {};
        const status = String(state.status || "pending");
        return <div key={job.id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold">{String(state.sourceTitle || state.address || state.scope || "Procurement work")}</h2><p className="text-sm text-muted-foreground">{String(state.requestedTrade || "Trade")} · {job.development || "No development"} · {status.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-muted-foreground">Source: procurement</p></div>
            {["assigned", "dispatched"].includes(status) && <Button size="sm" onClick={() => start(job)} disabled={action.isPending}>Start</Button>}
            {["started", "in_progress"].includes(status) && <Button size="sm" onClick={() => setCompletionJob(job)}>Complete</Button>}
          </div>
          <FieldEvidenceDisplay state={state} />
        </div>;
      })}
    </div>}
    <Dialog open={Boolean(completionJob)} onOpenChange={(open) => { if (!open) { setCompletionJob(null); setCompletionNote(""); setCompletionPhoto(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Complete assigned work</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Completion note</Label><Textarea value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="Describe the completed work" /></div>
          <div className="space-y-2"><Label>Completion photo evidence</Label><input type="file" accept="image/*" onChange={(event) => setCompletionPhoto(event.target.files?.[0] || null)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCompletionJob(null)}>Cancel</Button><Button onClick={complete} disabled={!completionNote.trim() || !completionPhoto || action.isPending || requestUpload.isPending}>Complete</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}