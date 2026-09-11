import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListEntityRecordsQueryKey, useCreateEntityRecord, useListEntityRecords, useListStaff, usePerformEntityAction, useUpdateEntityRecord } from "@workspace/api-client-react";
import { ArrowUpToLine, CheckCircle2, Search, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

type Job = { id: string; version: number; development?: string | null; state?: Record<string, unknown>; createdAt: string };

export default function Elevators() {
  const { staff } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const query = useListEntityRecords("elevator-jobs", undefined, { query: { queryKey: getListEntityRecordsQueryKey("elevator-jobs"), refetchInterval: 20_000 } });
  const { data: staffList = [] } = useListStaff({ status: "approved" });
  const action = usePerformEntityAction();
  const create = useCreateEntityRecord();
  const update = useUpdateEntityRecord();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [draft, setDraft] = useState({ title: "", building: "", floor: "", issue: "", assignedTo: "" });
  const jobs = (query.data || []) as Job[];
  const filtered = jobs.filter((job) => { const s = job.state || {}; return [job.id, job.development, ...Object.values(s)].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()); });
  const refresh = () => client.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("elevator-jobs") });
  const save = async () => {
    try {
      const assigned = staffList.find((person) => person.id === draft.assignedTo);
      const state = { ...draft, assignedStaffId: assigned?.id, assignedTo: assigned?.name || draft.assignedTo };
      if (editing) await update.mutateAsync({ entity: "elevator-jobs", id: editing.id, data: { id: editing.id, version: editing.version, state } });
      else await create.mutateAsync({ entity: "elevator-jobs", data: { id: crypto.randomUUID(), state, version: 1, development: staff?.developments?.[0] } });
      await refresh(); setOpen(false); toast({ title: editing ? "Elevator job updated" : "Elevator job created" });
    } catch (error: any) { toast({ variant: "destructive", title: "Unable to save elevator job", description: error?.message || "Please try again." }); }
  };
  const run = async (job: Job, name: "on-my-way" | "start" | "complete") => {
    try { await action.mutateAsync({ entity: "elevator-jobs", id: job.id, action: name }); await refresh(); toast({ title: `Job marked ${name.replaceAll("-", " ")}` }); }
    catch (error: any) { toast({ variant: "destructive", title: "Workflow action failed", description: error?.message || "The server rejected this action." }); }
  };
  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold tracking-tight">Elevator Jobs</h1><p className="text-sm text-muted-foreground">Management oversight of elevator service requests, assignments, and progress.</p></div><Button onClick={() => { setEditing(null); setDraft({ title: "", building: "", floor: "", issue: "", assignedTo: "" }); setOpen(true); }}>New elevator job</Button></div>
    <div className="rounded-[14px] border border-border bg-card shadow-sm"><div className="border-b border-border p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search EL number, building, assignment…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div><div className="p-4">
      {query.isLoading && <div className="p-10 text-center text-muted-foreground">Loading elevator jobs…</div>}
      {query.isError && <div className="p-10 text-center text-destructive">Unable to load elevator jobs. <Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div>}
      {!query.isLoading && !query.isError && !filtered.length && <div className="p-12 text-center text-muted-foreground"><ArrowUpToLine className="mx-auto mb-3 h-10 w-10 opacity-30" />{jobs.length ? "No jobs match your search." : "No elevator jobs yet."}</div>}
      <div className="grid gap-3">{filtered.map((job) => { const s = job.state || {}; const status = String(s.status || "assigned"); const assigned = String(s.assignedTo || s.assignedStaffName || "Unassigned"); return <div key={job.id} className="rounded-xl border border-border p-4"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary"><Wrench className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h3 className="font-semibold">{String(s.title || s.elId || `Elevator job ${job.id.slice(0, 8)}`)}</h3><p className="text-sm text-muted-foreground">{String(s.building || s.address || "Building not specified")} · Floor {String(s.floor || "—")} · {job.development || "All developments"}</p><p className="mt-1 text-sm">{String(s.issue || s.description || "No issue details provided.")}</p><p className="mt-2 text-xs text-muted-foreground">Assigned to: <span className="font-medium text-foreground">{assigned}</span></p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{status}</span></div><div className="mt-3 flex flex-wrap justify-end gap-2">{status === "assigned" && <><Button size="sm" variant="outline" onClick={() => run(job, "on-my-way")} disabled={action.isPending}>On my way</Button><Button size="sm" onClick={() => run(job, "start")} disabled={action.isPending}>Start</Button></>}{status === "assigned" && <Button size="sm" variant="outline" onClick={() => run(job, "complete")} disabled={action.isPending}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Complete</Button>}<Button size="sm" variant="ghost" onClick={() => { setEditing(job); setDraft({ title: String(s.title || ""), building: String(s.building || s.address || ""), floor: String(s.floor || ""), issue: String(s.issue || s.description || ""), assignedTo: String(s.assignedStaffId || "") }); setOpen(true); }}>Edit / assign</Button></div></div>; })}</div>
    </div></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Edit / assign elevator job" : "New elevator job"}</DialogTitle></DialogHeader><div className="space-y-3"><Input placeholder="Job title or elevator name" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /><div className="grid grid-cols-2 gap-2"><Input placeholder="Building / address" value={draft.building} onChange={(e) => setDraft({ ...draft, building: e.target.value })} /><Input placeholder="Floor" value={draft.floor} onChange={(e) => setDraft({ ...draft, floor: e.target.value })} /></div><Input placeholder="Issue details" value={draft.issue} onChange={(e) => setDraft({ ...draft, issue: e.target.value })} /><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.assignedTo} onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}><option value="">Select assignment…</option>{staffList.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.position}</option>)}</select><Button className="w-full" onClick={save} disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save job"}</Button></div></DialogContent></Dialog>
  </div>;
}