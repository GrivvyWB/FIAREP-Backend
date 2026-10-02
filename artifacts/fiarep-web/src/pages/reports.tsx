import { isCpmSupervisorTitle, isInspectionSupervisorTitle, isOfficeTradeSupervisorTitle, sameTitle } from "@/lib/titles";
import { AttachedMeasurements } from "@/components/attached-measurements";
import {
  getListEntityRecordsQueryKey,
  getListResidentReportPhotosQueryKey,
  getListStaffQueryKey,
  requestResidentReportPhotoDownload,
  useRequestFileUploadUrl,
  useListEntityRecords,
  useListResidentReportPhotos,
  useListStaff,
  useClassifyResidentReportPhoto,
  useGetResidentReportPhotoAiConfig,
  usePerformEntityAction,
  useDeleteEntityRecord,
  useGetDeletionPolicy,
  useUpdateResidentReportPhoto,
  type ViolationClassification,
  customFetch,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Camera, CheckCircle2, ChevronDown, FolderOpen, Image as ImageIcon,
  MapPin, ScanLine, Search, Send, Trash2, UserRound, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { assignableOperationalStaff, groupStaffByTradeSections } from "@/lib/staff-assignment";
import { FieldEvidenceDisplay } from "@/components/field-evidence-display";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";
import { canHandleResidentReports, isProcurementDesk } from "@/lib/access-policy";
import { useOverrideDelete } from "@/components/override-delete";
import { CreateReportButton, SendAsViolationPanel } from "@/components/report-actions";

type Report = { id: string; development?: string | null; state?: Record<string, unknown>; createdAt: string; updatedAt: string; version: number };

function Photos({ reportId, savedScans }: {
  reportId: string;
  savedScans?: Record<string, ViolationClassification>;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: photos = [], isLoading } = useListResidentReportPhotos({ reportId });
  const renamePhoto = useUpdateResidentReportPhoto();
  const classifyPhoto = useClassifyResidentReportPhoto();
  const { data: aiConfig } = useGetResidentReportPhotoAiConfig();
  const [busy, setBusy] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState<Record<string, boolean>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [scanResults, setScanResults] = useState<Record<string, ViolationClassification>>({});
  const attemptedScans = useRef(new Set<string>());
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

  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const open = async (id: string) => {
    setBusy(id);
    try {
      const existingUrl = photoUrls[id];
      const url = existingUrl || (await requestResidentReportPhotoDownload(id)).downloadUrl;
      setViewPhoto(url);
    } finally { setBusy(null); }
  };
  const saveName = async (id: string, currentName: string) => {
    const name = (names[id] ?? currentName).trim();
    if (!name) return;
    try {
      await renamePhoto.mutateAsync({ id, data: { name } });
      await queryClient.invalidateQueries({ queryKey: getListResidentReportPhotosQueryKey({ reportId }) });
      await invalidateOperationalQueries(queryClient, "resident-reports", reportId);
      toast({ title: "Photo name saved" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save photo name",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  };
  const scanPhoto = async (id: string) => {
    setBusy(id);
    try {
      const result = await classifyPhoto.mutateAsync({ id });
      setScanResults((current) => ({ ...current, [id]: result }));
      await invalidateOperationalQueries(queryClient, "resident-reports", reportId);
      toast({ title: "Violation analysis complete" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Photo analysis failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (!aiConfig?.enabled) return;
    for (const photo of photos) {
      if (
        savedScans?.[photo.id] ||
        scanResults[photo.id] ||
        attemptedScans.current.has(photo.id)
      ) continue;
      attemptedScans.current.add(photo.id);
      void scanPhoto(photo.id);
    }
  }, [aiConfig?.enabled, photoIds, savedScans, scanResults]);
  if (isLoading) return <span className="text-xs text-muted-foreground">Loading photos…</span>;
  if (!photos.length) return <span className="text-xs text-muted-foreground">No photos attached</span>;
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {viewPhoto && <PhotoLightbox src={viewPhoto} alt="Complaint photo" onClose={() => setViewPhoto(null)} />}
    {photos.map((photo) => {
      const scan = scanResults[photo.id] || savedScans?.[photo.id];
      return (
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
          {scan && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-950">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">FIA Code {scan.hpCode}</span>
                <span className="font-semibold">{scan.classification} · {scan.confidence}%</span>
              </div>
              <p className="mt-1 font-medium">{scan.condition}</p>
              <p className="mt-1 text-xs">{scan.trade} · {scan.priority}</p>
            </div>
          )}
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
          {aiConfig?.enabled && (
            !scan && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy === photo.id || classifyPhoto.isPending}
                onClick={() => scanPhoto(photo.id)}
              >
                <ScanLine className="mr-2 h-4 w-4" />
                {busy === photo.id ? "Analyzing…" : "Analyze violation"}
              </Button>
            )
          )}
        </div>
      </div>
      );
    })}
  </div>;
}

function statusLabel(status: unknown) {
  return String(status || "submitted").replaceAll("_", " ");
}

export default function Reports() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { staff: actor } = useAuth();
  // Developments this supervisor has an active coverage unlock for. They may
  // assign at those sites for 24h, so treat them as part of the actor's scope
  // for the assignment picker (server enforces the same on the assign action).
  const [coverageDevs, setCoverageDevs] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/v1/coverage/active", {
          headers: { Authorization: `Bearer ${localStorage.getItem("fiarep_access_token") || ""}` },
        });
        if (r.ok && active) {
          const rows = await r.json();
          setCoverageDevs(Array.isArray(rows) ? rows.map((x: { development: string }) => x.development) : []);
        }
      } catch {
        /* best effort */
      }
    })();
    return () => {
      active = false;
    };
  }, [actor?.id]);
  const assignActor = actor
    ? { ...actor, developments: [...(actor.developments || []), ...coverageDevs] }
    : actor;
  const canHandleComplaints = canHandleResidentReports(actor);
  // CPM Supervisors can't clear/approve complaints, but may assign one to their
  // own CPMs (server: resident-reports assign + canAssignStaff).
  const canAssignComplaints = canHandleComplaints;
  // Office trade supervisors (plumbing, electrical … and CPM Supervisor) only
  // READ a complaint until the development / emergency supervisor or upper
  // management sends it to them (server enforces the same rule).
  // Trade supervisors, CPM Supervisor, CPMs and the Inspection Supervisor wait
  // for building management to send them the complaint.
  const isTradeSup = (actor?.role === "management" && isOfficeTradeSupervisorTitle(actor?.position, actor?.developments)) ||
    isCpmSupervisorTitle(actor?.position) || isInspectionSupervisorTitle(actor?.position) || sameTitle(actor?.position, "CPM");
  const sentToMe = (report: Report) => {
    const st = (report.state || {}) as Record<string, unknown>;
    return String(st.assignedStaffId || "") === actor?.id || String(st.assignedByStaffId || "") === actor?.id || String(st.directedToStaffId || "") === actor?.id;
  };
  const canActOn = (report: Report) => canHandleComplaints && (!isTradeSup || sentToMe(report));
  // CPM Supervisor: the CPM's scope for a complaint, so the complaint page can
  // say where it is and link to Scope Review (Procurement / in-house buttons).
  const isCpmSup = isCpmSupervisorTitle(actor?.position);
  const isCpm = actor?.position === "CPM";
  // Procurement reads the complaint and acts on its scope in Procurement.
  const isProcurement = isProcurementDesk(actor) || /procurement/i.test(actor?.position || "");
  const scopesQuery = useListEntityRecords("procurement", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("procurement"), enabled: isCpmSup || isCpm || isProcurement, refetchInterval: 15_000 },
  });
  // The scope a CPM already started for a complaint (so the button greys out).
  const cpmScopeFor = (report: Report) => {
    const complaintNo = String((report.state as any)?.complaintNo || "");
    return ((scopesQuery.data || []) as any[]).find((row) =>
      row.state?.sourceRecordId === report.id || row.state?.sourceReportId === report.id ||
      (!!complaintNo && (row.state?.complaintNo === complaintNo || row.state?.sourceRef === complaintNo)));
  };
  const reportsQuery = useListEntityRecords("resident-reports", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("resident-reports"),
      staleTime: 15_000,
      refetchInterval: 15_000,
      refetchOnMount: "always",
    },
  });
  const { data: staff = [] } = useListStaff({ status: "approved" }, {
    query: {
      enabled: canHandleComplaints || actor?.role === "management" || actor?.role === "administrator",
      queryKey: getListStaffQueryKey({ status: "approved" }),
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  const action = usePerformEntityAction();
  const deleteMutation = useDeleteEntityRecord();
  const overrideDelete = useOverrideDelete();
  const { data: deletionPolicy } = useGetDeletionPolicy();
  const requestUpload = useRequestFileUploadUrl();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [development, setDevelopment] = useState("all");
  const [selected, setSelected] = useState<Report | null>(null);
  const [dialogMode, setDialogMode] = useState<"details" | "assign">("details");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [releaseUpdate, setReleaseUpdate] = useState("");
  const [sendBackNote, setSendBackNote] = useState("");
  // Complaint handlers review any completed work; a CPM Supervisor reviews the
  // complaints they assigned (server: approve-work / reject-work).
  const canReview = (report: Report) => canActOn(report) ||
    (canAssignComplaints && String((report.state || {}).assignedByStaffId || "") === actor?.id);
  const [completionPhoto, setCompletionPhoto] = useState<File | null>(null);
  const [completionPreview, setCompletionPreview] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [nudgeNote, setNudgeNote] = useState("");
  const [nudging, setNudging] = useState(false);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [nudgeTargetId, setNudgeTargetId] = useState("");
  const [nudgeTargetOpen, setNudgeTargetOpen] = useState(false);
  const [nudgeSearch, setNudgeSearch] = useState("");
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const completionPhotoInput = useRef<HTMLInputElement>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const deepLinkHandled = useRef(false);

  const reports = (reportsQuery.data || []) as Report[];
  // Every supervisor / manager in the organization (not only this person's
  // developments) can be asked to assign.
  const { data: allSupervisors = [] } = useQuery({
    queryKey: ["staff-supervisors"],
    queryFn: () => customFetch<any[]>("/api/v1/staff/supervisors"),
    staleTime: 60_000,
  });
  const supervisorChoices = ((allSupervisors as any[]).length ? allSupervisors as any[] : staff as any[])
    .filter((m) => {
      if (!m) return false;
      const role = String(m.role || "");
      const position = String(m.position || "").trim();
      // The company/procurement "Director" (not Borough/Regional Director) never
      // handles or assigns a resident complaint, whatever role the account carries.
      if (position.trim().toLowerCase() === "director") return false;
      if (["procurement", "human_resources", "vendor", "resident"].includes(role)) return false;
      if (/\bhr\b|human resources|procurement|payroll/i.test(position)) return false;
      // Any trade or inspector supervisor, or a superintendent, can take a
      // complaint - include them regardless of whether their role is management
      // or worker (trade supervisors are sometimes stored as worker).
      if (/supervisor|superintendent/i.test(position)) return true;
      // Everyone else must be operational management/admin. Exclude procurement,
      // HR, vendors, residents, plain workers and emergency crews.
      if (["procurement", "human_resources", "vendor", "resident", "worker", "emergency"].includes(role)) return false;
      return role === "management" || role === "administrator";
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const nudgeTarget = supervisorChoices.find((m) => m.id === nudgeTargetId) || null;
  // Keep an open report detail in sync when the list auto-refreshes, so status
  // and photos update live instead of sitting on the snapshot it was opened with.
  useEffect(() => {
    if (!selected) return;
    const fresh = reports.find((r) => r.id === selected.id);
    if (fresh && (fresh as any).updatedAt !== (selected as any).updatedAt) {
      setSelected(fresh);
    }
  }, [reports, selected]);
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
    if (report) {
      setDialogMode("details");
      setSelected(report);
    }
  }, [reports, reportsQuery.isLoading]);

  const openReport = (report: Report, mode: "details" | "assign") => {
    setDialogMode(mode);
    setSelectedStaffId(String(report.state?.assignedStaffId || ""));
    setSelected(report);
    setReleaseUpdate("");
    setCompletionPhoto(null);
    setCompletionPreview("");
    setCompletionNote("");
    setNudgeNote("");
    setNudging(false);
    setNudgeSent(false);
    setNudgeTargetId("");
    setNudgeTargetOpen(false);
    setNudgeSearch("");
  };

  const requestAssignment = async (report: Report) => {
    setNudging(true);
    try {
      const note = nudgeNote.trim() || "Please answer this — assign right away.";
      await customFetch(`/api/v1/resident-reports/${report.id}/request-assignment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, ...(nudgeTargetId ? { targetStaffId: nudgeTargetId } : {}) }), responseType: "json",
      });
      setNudgeSent(true);
      toast({ title: nudgeTarget ? `Urgent request sent to ${nudgeTarget.name}` : "Urgent request sent to supervisors" });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not send request", description: error instanceof Error ? error.message : "Please try again." });
    } finally { setNudging(false); }
  };

  const confirmDeleteReport = async () => {
    if (!deletingReportId) return;
    const target = reports.find((r) => r.id === deletingReportId);
    try {
      const st = (target?.state || {}) as Record<string, any>;
      const done = await overrideDelete.remove("resident-reports", deletingReportId, Number((target as any)?.version || 0), [st.complaintNo, st.address, st.unit ? `Unit ${st.unit}` : ""].filter(Boolean).join(" · ") || "this report");
      if (!done) return;
      toast({ title: "Report deleted" });
      await invalidateOperationalQueries(queryClient, "resident-reports", deletingReportId);
      if (selected?.id === deletingReportId) setSelected(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not delete", description: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingReportId(null);
    }
  };

  const perform = async (report: Report, actionName: string, body?: Record<string, unknown>) => {
    try {
      await action.mutateAsync({ entity: "resident-reports", id: report.id, action: actionName, data: body });
       await invalidateOperationalQueries(queryClient, "resident-reports", report.id);
      setSelected(null);
      toast({ title: `Report ${actionName.replaceAll("-", " ")} completed` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Workflow action failed", description: error?.message || "The server rejected this action." });
    }
  };

  const captureBrowserGeo = () => new Promise<{
    lat: number;
    lng: number;
    accuracy: number;
    at: string;
    source: "gps";
  }>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is required to record field work."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        at: new Date().toISOString(),
        source: "gps",
      }),
      () => reject(new Error("Allow location access to record field work.")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });

  const startWithLocation = async (report: Report) => {
    try {
      const arrivalGeo = await captureBrowserGeo();
      await perform(report, "start", { arrivalGeo });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Location required",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  const assign = (report: Report, staffId: string) => {
    const person = assignableOperationalStaff(assignActor, staff, report.development, coverageDevs.length > 0)
      .find((member) => member.id === staffId);
    if (!person) return;
    setAssigning(report.id);
    perform(report, "assign", { assignedStaffId: person.id, assignedTo: person.name }).finally(() => setAssigning(null));
  };

  const completeWithPhoto = async (report: Report) => {
    if (!completionPhoto) return;
    try {
      const completionGeo = await captureBrowserGeo();
      const uploaded = await requestUpload.mutateAsync({
        data: {
          kind: "completion-photo",
          name: completionPhoto.name || "completed-work.jpg",
          size: completionPhoto.size,
          contentType: completionPhoto.type || "image/jpeg",
          entity: "resident-reports",
          recordId: report.id,
        },
      });
      const response = await fetch(uploaded.uploadUrl, {
        method: "PUT",
        body: completionPhoto,
        headers: { "Content-Type": completionPhoto.type || "image/jpeg" },
      });
      if (!response.ok) throw new Error("Could not upload the completed-work photo.");
      const state = report.state || {};
      await perform(report, "complete", {
        completionNote: completionNote.trim(),
        completionGeo,
         photoEvidence: [
           ...(Array.isArray(state.photoEvidence) ? state.photoEvidence : []),
           {
             objectPath: uploaded.file.objectPath,
             id: uploaded.file.id || uploaded.file.name,
             name: uploaded.file.name,
             contentType: uploaded.file.contentType || completionPhoto.type || "image/jpeg",
           },
         ],
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Completion photo failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  return (
    <div className="space-y-6">
      {overrideDelete.dialog}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm">Review and manage resident reports across your developments.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(actor?.role === "management" || actor?.role === "administrator") && actor?.position !== "Borough Director" && !isProcurement && <CreateReportButton />}
          {canHandleComplaints && <Button asChild variant="outline"><Link href="/trade-requests"><Send className="mr-2 h-4 w-4" />Trade Request</Link></Button>}
        </div>
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
                <button className="min-w-0 flex-1 text-left" onClick={() => openReport(report, "details")}>
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
                {canActOn(report) && (currentStatus === "submitted" || (currentStatus === "assigned" && String(state.assignedStaffId || "") === actor?.id)) && <Button size="sm" variant="outline" disabled={action.isPending || assigning === report.id} onClick={() => openReport(report, "assign")}>{currentStatus === "assigned" ? (isCpmSupervisorTitle(actor?.position) ? "Send to a CPM" : "Hand to a worker") : "Assign"}</Button>}
                {isTradeSup && !sentToMe(report) && <span className="text-xs rounded-full bg-muted px-2 py-1 text-muted-foreground">Read only — waiting for building management to send it to you</span>}
                 {!canHandleComplaints && actor?.role !== "administrator" && currentStatus === "in_progress" && <Button size="sm" onClick={() => openReport(report, "details")} disabled={action.isPending}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Complete</Button>}
                 {canActOn(report) && currentStatus === "resolved" && <Button size="sm" variant="outline" onClick={() => perform(report, "clear")} disabled={action.isPending}><X className="h-3.5 w-3.5 mr-1" />Clear</Button>}
                 {canReview(report) && ["done", "resolved"].includes(currentStatus) && <Button size="sm" onClick={() => perform(report, "approve-work")} disabled={action.isPending}>Approve Work</Button>}
                <Button size="sm" variant="ghost" onClick={() => openReport(report, "details")}>View details</Button>
                {deletionPolicy?.enabled && (deletionPolicy.canDelete || ((deletionPolicy as any).canDeleteOwn && [report.createdBy, state.assignedStaffId, state.assignedByStaffId, state.directedToStaffId].map((v) => String(v || "")).includes(actor?.id || ""))) && <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { setDeletingReportId(report.id); setIsDeleteDialogOpen(true); }} title="Delete report"><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>;
          })}</div>}
        </div>
      </div>
      <Dialog open={!!selected} onOpenChange={(open) => {
        if (!open) {
          setSelected(null);
          setSelectedStaffId("");
          setDialogMode("details");
          setCompletionPhoto(null);
          setCompletionPreview("");
          setCompletionNote("");
        }
      }}>
        <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
          {selected && (() => {
            const state = selected.state || {};
            const currentStatus = String(state.status || "submitted");
             return <><DialogHeader><DialogTitle>{dialogMode === "assign" ? "Assign complaint" : String(state.title || state.complaintNo || "Resident report")}</DialogTitle><DialogDescription>Submitted {new Date(selected.createdAt).toLocaleString()}</DialogDescription></DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-muted-foreground">Status</span><p className="font-medium capitalize">{statusLabel(currentStatus)}</p></div><div><span className="text-muted-foreground">Development</span><p className="font-medium">{selected.development || "—"}</p></div><div><span className="text-muted-foreground">Complaint number</span><p className="font-medium">{String(state.complaintNo || "—")}</p></div><div><span className="text-muted-foreground">Address</span><p className="font-medium">{String(state.address || "—")}</p></div></div>
                 {!!String(state.description || "") && <div><p className="text-sm text-muted-foreground mb-1">Details</p><p className="text-sm whitespace-pre-wrap">{String(state.description)}</p></div>}
                <div>
                  <p className="text-sm font-semibold text-foreground mb-2">Before — resident's photo</p>
                  <Photos
                    reportId={selected.id}
                    savedScans={
                      state.aiPhotoScans &&
                      typeof state.aiPhotoScans === "object" &&
                      !Array.isArray(state.aiPhotoScans)
                        ? state.aiPhotoScans as Record<string, ViolationClassification>
                        : undefined
                    }
                  />
                </div>
                <FieldEvidenceDisplay state={state} reportId={selected.id} photosLabel="After — completed work" />
                {isCpmSup && (() => {
                  const complaintNo = String(state.complaintNo || "");
                  const scope = ((scopesQuery.data || []) as any[]).find((row) =>
                    row.state?.sourceRecordId === selected.id ||
                    (!!complaintNo && (row.state?.complaintNo === complaintNo || row.state?.sourceRef === complaintNo)));
                  const status = String(scope?.state?.status || "");
                  const label: Record<string, string> = {
                    draft: "being written by the CPM", submitted: "waiting for your review", returned: "returned to the CPM for correction",
                    approved: "with Procurement", bidding: "out to vendors", awarded: "awarded to a vendor", closed: "closed",
                    in_house: "sent to in-house workers", in_house_completed: "in-house work completed",
                  };
                  // No scope yet → show nothing (it arrives when the CPM sends it).
                  if (!scope) return null;
                  return (
                    <div className={`rounded-xl border p-4 space-y-2 ${status === "submitted" ? "border-amber-300 bg-amber-50" : "border-border bg-muted/30"}`}>
                      <p className="text-sm font-semibold">CPM scope</p>
                      {!scope ? (
                        <p className="text-sm text-muted-foreground">No scope yet. {String(state.assignedTo || state.assignedStaffName || "The CPM")} writes it in the app and sends it to you; then you choose Procurement or in-house workers.</p>
                      ) : (
                        <>
                          <p className="text-sm">Scope by {String(scope.state?.cpmName || scope.state?.requestedBy || "CPM")} is <span className="font-semibold">{label[status] || status}</span>{scope.state?.trackingId ? ` · ${scope.state.trackingId}` : ""}.</p>
                          {status === "submitted" && <Button asChild><Link href="/scope-review">Review scope: Procurement or in-house</Link></Button>}
                        </>
                      )}
                    </div>
                  );
                })()}
                 <AttachedMeasurements list={state.measurements} />
                 {isProcurement && (() => {
                   const scope = cpmScopeFor(selected);
                   const st = String(scope?.state?.status || "");
                   const inProcurement = ["approved", "bidding", "awarded", "closed"].includes(st);
                   const label: Record<string, string> = { draft: "being written by the CPM", returned: "returned to the CPM for changes", submitted: "waiting on the CPM Supervisor's approval", pending: "waiting on the CPM Supervisor's approval", approved: "approved — ready to release to vendors", bidding: "out to vendors for bids", awarded: "awarded to a vendor", closed: "closed" };
                   return (
                     <div className="space-y-2 border-t border-border pt-4">
                       <p className="text-sm font-semibold">Scope for {String(state.complaintNo || "this complaint")}</p>
                       {scope ? (
                         <>
                           <p className="text-sm">{scope.state?.address || ""}{scope.state?.cpmName ? ` · scoped by ${scope.state.cpmName}` : ""} — <span className="font-medium">{label[st] || st}</span></p>
                           {inProcurement ? (
                             <Link href={`/procurement?open=${encodeURIComponent(scope.id)}`} className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                               Open in Procurement to approve / release
                             </Link>
                           ) : (
                             <p className="text-xs text-muted-foreground">It reaches Procurement once the CPM Supervisor approves it.</p>
                           )}
                         </>
                       ) : (
                         <p className="text-xs text-muted-foreground">No scope has been written for this complaint yet. The CPM writes it, the CPM Supervisor approves it, then it lands in Procurement.</p>
                       )}
                     </div>
                   );
                 })()}
                 {actor?.position === "CPM" && String(state.assignedStaffId || "") === actor?.id && !["resolved", "closed"].includes(currentStatus) && (
                   <div className="space-y-2 border-t border-border pt-4">
                     <p className="text-sm font-semibold">Scope of work</p>
                     {cpmScopeFor(selected) ? (
                       <Link href="/scope-writing" className="inline-flex w-full items-center justify-center rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground">
                         ✓ Scope {String(cpmScopeFor(selected)?.state?.status || "started")} — open Scope Writing
                       </Link>
                     ) : (
                       <Link href={`/scope-writing?complaintId=${encodeURIComponent(selected.id)}&complaintNo=${encodeURIComponent(String(state.complaintNo || ""))}&address=${encodeURIComponent(String(state.address || ""))}&development=${encodeURIComponent(String(selected.development || state.development || ""))}&description=${encodeURIComponent(String(state.description || ""))}`} className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                         Start project / write scope for {String(state.complaintNo || "this complaint")}
                       </Link>
                     )}
                     <p className="text-xs text-muted-foreground">Write the scope from this complaint and submit it to your CPM Supervisor for review.</p>
                   </div>
                 )}
                 {String(state.assignedStaffId || "") === actor?.id && currentStatus === "in_progress" && (
                   <div className="space-y-3 border-t border-border pt-4">
                     <input
                       ref={completionPhotoInput}
                       type="file"
                       accept="image/*"
                       capture="environment"
                       className="hidden"
                       onChange={(event) => {
                         const file = event.target.files?.[0] || null;
                         setCompletionPhoto(file);
                         setCompletionPreview(file ? URL.createObjectURL(file) : "");
                       }}
                     />
                     {completionPreview && <img src={completionPreview} alt="Completed work" className="h-48 w-full rounded-xl border bg-muted object-contain" />}
                     <Button type="button" variant="outline" className="w-full" onClick={() => completionPhotoInput.current?.click()}>
                       <Camera className="mr-2 h-4 w-4" />Take photo
                     </Button>
                     <Textarea value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} />
                   </div>
                 )}
                   {canActOn(selected) && (dialogMode === "assign" || ["submitted", "assigned", "in_progress"].includes(currentStatus)) && (() => {
                     // Once it has been sent on to someone else, this section greys out and says who has it.
                     const handedOff = currentStatus !== "submitted" && String(state.assignedStaffId || "") !== actor?.id;
                     const sentAt = state.assignAt || state.assignedAt;
                     return <div className={`border-t border-border pt-4 space-y-3 ${handedOff ? "opacity-60" : ""}`}><p className="text-sm font-semibold">{isCpmSupervisorTitle(actor?.position) ? "Send to a CPM" : currentStatus === "assigned" ? "Hand to a worker" : "Assign to a worker"}</p>{handedOff ? <p className="text-sm font-semibold text-emerald-700">✓ Sent to {String(state.assignedTo || "staff")}{sentAt ? ` · ${new Date(String(sentAt)).toLocaleString()}` : ""}{currentStatus === "in_progress" ? " · work started" : ""}</p> : <p className="text-xs text-muted-foreground">{isCpmSupervisorTitle(actor?.position) ? "Your CPMs — the one you pick writes the scope — or an Inspector, if a violation needs to be logged first." : "Any worker who covers this development — plumber, electrician, maintenance, emergency crew. Trade supervisors see their own crew."}</p>}<select value={handedOff ? String(state.assignedStaffId || "") : selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} disabled={handedOff || action.isPending || assigning === selected.id} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:bg-muted disabled:text-muted-foreground"><option value="">Choose a person…</option>{handedOff && <option value={String(state.assignedStaffId || "")}>{String(state.assignedTo || "")}</option>}{groupStaffByTradeSections(assignableOperationalStaff(assignActor, staff, selected.development, coverageDevs.length > 0)).map((group) => <optgroup key={group.label} label={group.label}>{group.people.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.position}</option>)}</optgroup>)}</select><Button className="w-full" onClick={() => assign(selected, selectedStaffId)} disabled={handedOff || !selectedStaffId || action.isPending || assigning === selected.id}>{handedOff ? "Sent" : assigning === selected.id ? "Assigning…" : "Assign complaint"}</Button></div>;
                   })()}
                  {actor?.position !== "Elevator Service" && String(state.assignedStaffId || "") === actor?.id && ["assigned", "in_progress"].includes(currentStatus) && <div className="border-t border-border pt-4 space-y-2"><p className="text-sm font-semibold">Release assignment</p><Textarea value={releaseUpdate} onChange={(event) => setReleaseUpdate(event.target.value)} placeholder="Provide an update before releasing this complaint" /><Button variant="outline" onClick={() => perform(selected, "release", { update: releaseUpdate })} disabled={action.isPending || releaseUpdate.trim().length < 3}>Release with update</Button></div>}
                  {(actor?.role === "management" || actor?.role === "administrator") && currentStatus === "submitted" && (
                    <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
                      <p className="text-sm font-bold text-red-700 flex items-center gap-1.5"><Send className="h-4 w-4" />Ask a supervisor to assign — urgent</p>
                      <div className="relative">
                        <button type="button" onClick={() => setNudgeTargetOpen((open) => !open)} className="flex w-full items-center justify-between rounded-md border border-input bg-white px-3 py-2 text-left text-sm">
                          <span className={nudgeTarget ? "font-medium text-foreground" : "text-muted-foreground"}>{nudgeTarget ? `${nudgeTarget.name}${nudgeTarget.position ? ` · ${nudgeTarget.position}` : ""}` : "Choose a supervisor or manager…"}</span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </button>
                        {nudgeTargetOpen && (
                          <div className="absolute z-20 mt-1 w-full rounded-md border border-input bg-white shadow-lg">
                            <div className="flex items-center gap-2 border-b px-2 py-1.5">
                              <Search className="h-3.5 w-3.5 text-muted-foreground" />
                              <input autoFocus value={nudgeSearch} onChange={(event) => setNudgeSearch(event.target.value)} placeholder="Search a manager or supervisor…" className="w-full bg-transparent text-sm outline-none" />
                            </div>
                            <div className="max-h-56 overflow-y-auto py-1">
                              {supervisorChoices
                                .filter((member) => `${member.name || ""} ${member.position || ""}`.toLowerCase().includes(nudgeSearch.trim().toLowerCase()))
                                .map((member) => (
                                  <button type="button" key={member.id} onClick={() => { setNudgeTargetId(member.id); setNudgeTargetOpen(false); setNudgeSearch(""); }} className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-muted ${nudgeTargetId === member.id ? "bg-primary/10" : ""}`}>
                                    <span className="font-medium">{member.name}</span>{member.position ? <span className="text-muted-foreground"> · {member.position}</span> : null}
                                  </button>
                                ))}
                              {supervisorChoices.filter((member) => `${member.name || ""} ${member.position || ""}`.toLowerCase().includes(nudgeSearch.trim().toLowerCase())).length === 0 && (
                                <p className="px-3 py-2 text-xs text-muted-foreground">{nudgeSearch.trim() ? "No matching supervisor." : "No supervisors available for your developments."}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <Textarea value={nudgeNote} onChange={(event) => setNudgeNote(event.target.value)} placeholder="Please answer this — assign right away." className="bg-white" />
                      <Button variant="destructive" className="w-full" disabled={nudging || nudgeSent || !nudgeTargetId} onClick={() => requestAssignment(selected)}>{nudgeSent ? "Sent \u2713" : nudging ? "Sending\u2026" : nudgeTarget ? `Send urgent request to ${nudgeTarget.name}` : "Choose a supervisor first"}</Button>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">{!canHandleComplaints && actor?.role !== "administrator" && currentStatus === "assigned" && <Button onClick={() => startWithLocation(selected)} disabled={action.isPending}>Start work</Button>}{!canHandleComplaints && actor?.role !== "administrator" && currentStatus === "in_progress" && <Button onClick={() => completeWithPhoto(selected)} disabled={action.isPending || requestUpload.isPending || !completionPhoto || !completionNote.trim()}>Complete</Button>}{canActOn(selected) && currentStatus === "resolved" && <Button variant="outline" onClick={() => perform(selected, "clear")} disabled={action.isPending}>Clear report</Button>}{canReview(selected) && ["done", "resolved"].includes(currentStatus) && <Button onClick={() => perform(selected, "approve-work")} disabled={action.isPending}>Approve Work</Button>}</div>
                  {canActOn(selected) && currentStatus === "submitted" && <SendAsViolationPanel report={selected} staff={staff as never} />}
                  {canReview(selected) && currentStatus === "done" && <div className="border-t border-border pt-4 space-y-2"><p className="text-sm font-semibold">Send back to worker</p><Textarea value={sendBackNote} onChange={(event) => setSendBackNote(event.target.value)} placeholder="What needs fixing? (sent to the worker)" /><Button variant="outline" onClick={() => { perform(selected, "reject-work", { note: sendBackNote.trim() }); setSendBackNote(""); }} disabled={action.isPending || sendBackNote.trim().length < 3}>Send back with note</Button></div>}
              </div></>;
          })()}
        </DialogContent>
      </Dialog>
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. This will permanently delete this resident report.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteReport} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleteMutation.isPending ? "Deleting\u2026" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}