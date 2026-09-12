import {
  getListEntityRecordsQueryKey,
  getListResidentReportPhotosQueryKey,
  requestResidentReportPhotoDownload,
  useListEntityRecords,
  useListResidentReportPhotos,
  useListStaff,
  usePerformEntityAction,
  useUpdateResidentReportPhoto,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCircle2, ChevronDown, FolderOpen, Image as ImageIcon,
  MapPin, Search, UserRound, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Report = { id: string; development?: string | null; state?: Record<string, unknown>; createdAt: string; updatedAt: string; version: number };

function Photos({ reportId }: { reportId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: photos = [], isLoading } = useListResidentReportPhotos({ reportId });
  const renamePhoto = useUpdateResidentReportPhoto();
  const [busy, setBusy] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState<Record<string, boolean>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const photoIds = photos.map((photo) => photo.id).join(",");

  useEffect(() => {
    let cancelled = false;
    if (!photos.length) {
      setPhotoUrls({});
      return;
    }
    Promise.all(
      photos.map(async (photo) => {
        try {
          const result = await requestResidentReportPhotoDownload(photo.id);
          return [photo.id, result.downloadUrl] as const;
        } catch {
          return [photo.id, ""] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setPhotoUrls(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [photoIds]);

  const open = async (id: string) => {
    setBusy(id);
    try {
      const existingUrl = photoUrls[id];
      const url = existingUrl || (await requestResidentReportPhotoDownload(id)).downloadUrl;
      window.open(url, "_blank", "noopener,noreferrer");
    } finally { setBusy(null); }
  };
  const saveName = async (id: string, currentName: string) => {
    const name = (names[id] ?? currentName).trim();
    if (!name) return;
    try {
      await renamePhoto.mutateAsync({ id, data: { name } });
      await queryClient.invalidateQueries({ queryKey: getListResidentReportPhotosQueryKey({ reportId }) });
      toast({ title: "Photo name saved" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save photo name",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  };
  if (isLoading) return <span className="text-xs text-muted-foreground">Loading photos…</span>;
  if (!photos.length) return <span className="text-xs text-muted-foreground">No photos attached</span>;
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {photos.map((photo) => (
      <div
        key={photo.id}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <button type="button" className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" onClick={() => open(photo.id)} disabled={busy === photo.id}>
          {photoUrls[photo.id] && !previewError[photo.id] ? (
            <img
              src={photoUrls[photo.id]}
              alt={photo.name || "Report photo"}
              className="h-48 w-full bg-muted object-contain"
              onError={() => setPreviewError((current) => ({ ...current, [photo.id]: true }))}
            />
          ) : (
            <div className="grid h-48 place-items-center bg-muted text-muted-foreground">
              <ImageIcon className="h-9 w-9 opacity-40" />
            </div>
          )}
        </button>
        <div className="space-y-2 p-3">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`photo-name-${photo.id}`}>Photo name</label>
          <div className="flex gap-2">
            <Input
              id={`photo-name-${photo.id}`}
              maxLength={100}
              value={names[photo.id] ?? photo.name ?? "Report photo"}
              onChange={(event) => setNames((current) => ({ ...current, [photo.id]: event.target.value }))}
              onClick={(event) => event.stopPropagation()}
            />
            <Button
              type="button"
              size="sm"
              disabled={renamePhoto.isPending || !(names[photo.id] ?? photo.name).trim()}
              onClick={() => saveName(photo.id, photo.name)}
            >
              {renamePhoto.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    ))}
  </div>;
}

function statusLabel(status: unknown) {
  return String(status || "submitted").replaceAll("_", " ");
}

export default function Reports() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reportsQuery = useListEntityRecords("resident-reports");
  const { data: staff = [] } = useListStaff({ status: "approved" });
  const action = usePerformEntityAction();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [development, setDevelopment] = useState("all");
  const [selected, setSelected] = useState<Report | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const deepLinkHandled = useRef(false);

  const reports = (reportsQuery.data || []) as Report[];
  const developments = [...new Set(reports.map((r) => r.development).filter(Boolean) as string[])].sort();
  const statuses = [...new Set(reports.map((r) => String(r.state?.status || "submitted")))].sort();
  const q = search.trim().toLowerCase();
  const filtered = reports.filter((report) => {
    const state = report.state || {};
    const haystack = [report.id, report.development, state.title, state.complaintNo, state.description, state.address, state.category, state.assignedTo]
      .filter(Boolean).join(" ").toLowerCase();
    return (!q || haystack.includes(q)) &&
      (status === "all" || state.status === status) &&
      (development === "all" || report.development === development);
  });

  useEffect(() => {
    if (deepLinkHandled.current || reportsQuery.isLoading) return;
    deepLinkHandled.current = true;
    const reportId = new URLSearchParams(window.location.search).get("id");
    if (!reportId) return;
    const report = reports.find((item) => item.id === reportId);
    if (report) setSelected(report);
  }, [reports, reportsQuery.isLoading]);

  const perform = async (report: Report, actionName: string, body?: Record<string, unknown>) => {
    try {
      await action.mutateAsync({ entity: "resident-reports", id: report.id, action: actionName, data: body });
      await queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("resident-reports") });
      setSelected(null);
      toast({ title: `Report ${actionName.replaceAll("-", " ")} completed` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Workflow action failed", description: error?.message || "The server rejected this action." });
    }
  };

  const assign = (report: Report, staffId: string) => {
    const person = staff.find((member) => member.id === staffId);
    if (!person) return;
    setAssigning(report.id);
    perform(report, "assign", { assignedStaffId: person.id, assignedTo: person.name }).finally(() => setAssigning(null));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm">Review and manage resident reports across your developments.</p>
      </div>
      <div className="bg-card rounded-[14px] shadow-sm border border-border">
        <div className="p-4 border-b border-border flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search complaint number, address, title…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="relative">
            <span className="sr-only">Filter status</span>
            <select className="h-10 w-full lg:w-44 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
            </select><ChevronDown className="pointer-events-none absolute right-2 top-3 h-4 w-4 text-muted-foreground" />
          </label>
          <label className="relative">
            <span className="sr-only">Filter development</span>
            <select className="h-10 w-full lg:w-52 rounded-md border border-input bg-background px-3 text-sm" value={development} onChange={(e) => setDevelopment(e.target.value)}>
              <option value="all">All developments</option>{developments.map((value) => <option key={value} value={value}>{value}</option>)}
            </select><ChevronDown className="pointer-events-none absolute right-2 top-3 h-4 w-4 text-muted-foreground" />
          </label>
        </div>
        <div className="p-4">
          {reportsQuery.isLoading && <div className="p-10 text-center text-muted-foreground">Loading resident reports…</div>}
          {reportsQuery.isError && <div className="p-10 text-center text-destructive flex flex-col items-center gap-2"><AlertCircle className="h-8 w-8" /><span>Unable to load reports. Please try again.</span><Button variant="outline" onClick={() => reportsQuery.refetch()}>Retry</Button></div>}
          {!reportsQuery.isLoading && !reportsQuery.isError && !filtered.length && <div className="p-12 text-center flex flex-col items-center"><FolderOpen className="w-12 h-12 text-muted-foreground/30 mb-4" /><h3 className="text-lg font-bold">{reports.length ? "No matching reports" : "No resident reports yet"}</h3><p className="text-sm text-muted-foreground mt-1">{reports.length ? "Try changing your search or filters." : "New resident submissions will appear here automatically."}</p></div>}
          {!!filtered.length && <div className="grid gap-3">{filtered.map((report) => {
            const state = report.state || {};
            const currentStatus = String(state.status || "submitted");
            return <div key={report.id} className="rounded-xl border border-border p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-[9px] bg-secondary text-secondary-foreground grid place-items-center shrink-0"><FolderOpen className="w-5 h-5" /></div>
                <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(report)}>
                  <h4 className="font-semibold truncate">{String(state.title || state.complaintNo || `Report ${report.id.slice(0, 8)}`)}</h4>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                    {report.development && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{report.development}</span>}
                    <span>{new Date(report.createdAt).toLocaleDateString()}</span>
                    {!!String(state.address || "") && <span>{String(state.address)}</span>}
                  </div>
                </button>
                <span className="text-[12px] font-semibold capitalize px-2 py-1 rounded-full bg-primary/10 text-primary whitespace-nowrap">{statusLabel(currentStatus)}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 pl-14">
                {!!String(state.assignedTo || "") && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{String(state.assignedTo)}</span>}
                {currentStatus === "submitted" && <Button size="sm" variant="outline" disabled={action.isPending || assigning === report.id} onClick={() => setSelected(report)}>Assign</Button>}
                {currentStatus === "in_progress" && <Button size="sm" onClick={() => perform(report, "resolve")} disabled={action.isPending}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Resolve</Button>}
                {currentStatus === "resolved" && <Button size="sm" variant="outline" onClick={() => perform(report, "clear")} disabled={action.isPending}><X className="h-3.5 w-3.5 mr-1" />Clear</Button>}
                <Button size="sm" variant="ghost" onClick={() => setSelected(report)}>View details</Button>
              </div>
            </div>;
          })}</div>}
        </div>
      </div>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
          {selected && (() => {
            const state = selected.state || {};
            const currentStatus = String(state.status || "submitted");
            return <><DialogHeader><DialogTitle>{String(state.title || state.complaintNo || "Resident report")}</DialogTitle><DialogDescription>Submitted {new Date(selected.createdAt).toLocaleString()}</DialogDescription></DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-muted-foreground">Status</span><p className="font-medium capitalize">{statusLabel(currentStatus)}</p></div><div><span className="text-muted-foreground">Development</span><p className="font-medium">{selected.development || "—"}</p></div><div><span className="text-muted-foreground">Complaint number</span><p className="font-medium">{String(state.complaintNo || "—")}</p></div><div><span className="text-muted-foreground">Address</span><p className="font-medium">{String(state.address || "—")}</p></div></div>
                 {!!String(state.description || "") && <div><p className="text-sm text-muted-foreground mb-1">Details</p><p className="text-sm whitespace-pre-wrap">{String(state.description)}</p></div>}
                <div><p className="text-sm text-muted-foreground mb-2">Photos</p><Photos reportId={selected.id} /></div>
                <div className="border-t border-border pt-4 space-y-3"><p className="text-sm font-semibold">Staff assignment</p><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={String(state.assignedStaffId || "")} onChange={(e) => assign(selected, e.target.value)} disabled={action.isPending || assigning === selected.id}><option value="">Select staff member…</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.position}</option>)}</select></div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">{currentStatus === "assigned" && <Button onClick={() => perform(selected, "start")} disabled={action.isPending}>Start work</Button>}{currentStatus === "in_progress" && <Button onClick={() => perform(selected, "resolve")} disabled={action.isPending}>Resolve report</Button>}{currentStatus === "resolved" && <Button variant="outline" onClick={() => perform(selected, "clear")} disabled={action.isPending}>Clear report</Button>}</div>
              </div></>;
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}