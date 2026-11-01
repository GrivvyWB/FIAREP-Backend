import { useEffect, useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import { customFetch, type ViolationClassification } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Photos, SmartTicketBox } from "@/pages/reports";
import { FieldEvidenceDisplay } from "@/components/field-evidence-display";
import { useAuth } from "@/hooks/use-auth";
import { hasModuleAccess } from "@/lib/access-policy";
import { menuOverride } from "@/lib/website-menu";
import { knownComplaint, rememberComplaint } from "@/lib/complaint-cache";

type Report = { id: string; development?: string | null; state?: Record<string, unknown>; createdAt: string };

/** One complaint, opened from the Complaint Dashboard, an alert or the dashboard:
 *  the details, the resident's photo and what Smart Repair found. */
export default function ComplaintPage() {
  const { id = "" } = useParams<{ id: string }>();
  // Shown at once when the page that was pressed already had it; refreshed from the server below.
  const [report, setReport] = useState<Report | null>(() => knownComplaint(id));
  // The link to Resident Reports only when that page is open to this person (Platform Control switches).
  const { staff, organizationModules } = useAuth();
  const reportsOverride = menuOverride(organizationModules, "/reports", staff?.id);
  const canOpenReports = reportsOverride === false ? false : reportsOverride === true || hasModuleAccess(staff, "reports", organizationModules);
  const [error, setError] = useState("");
  // FIAREP watching a client quietly: the client's complaint, looked at only (the client is never told).
  const watched = new URLSearchParams(useSearch()).get("watched") === "1";
  useEffect(() => {
    setReport(knownComplaint(id)); setError("");
    customFetch<Report>(watched ? `/api/v1/fiarep/watched/${encodeURIComponent(id)}` : `/api/v1/resident-reports/${encodeURIComponent(id)}`, { responseType: "json" } as never)
      .then((r) => { rememberComplaint(id, r); setReport(r); })
      .catch(() => { setReport(null); setError("This complaint couldn't be opened. It may have been deleted, or it's at a development you can't see."); });
  }, [id, watched]);
  const state = (report?.state || {}) as Record<string, unknown>;
  const scans = state.aiPhotoScans && typeof state.aiPhotoScans === "object" && !Array.isArray(state.aiPhotoScans) ? (state.aiPhotoScans as Record<string, ViolationClassification>) : undefined;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!report && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Opening the complaint…</div>}
      {report && (
        <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold">{String(state.complaintNo || state.title || "Complaint")}</h1>
            {watched && <p className="text-xs font-semibold text-slate-500">{String((report as { clientName?: string }).clientName || "")} · watching quietly — the client doesn't see that FIAREP looked</p>}
            <p className="text-sm text-muted-foreground">Submitted {new Date(report.createdAt).toLocaleString()}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">Status</span><p className="font-medium capitalize">{String(state.status || "submitted").replaceAll("_", " ")}</p></div>
            <div><span className="text-muted-foreground">Development</span><p className="font-medium">{report.development || "—"}</p></div>
            <div><span className="text-muted-foreground">Address</span><p className="font-medium">{String(state.address || "—")}{state.unit ? ` · Apt ${String(state.unit)}` : ""}</p></div>
            <div><span className="text-muted-foreground">Resident</span><p className="font-medium">{String(state.residentName || state.reporterName || "—")}</p></div>
            {!!state.assignedTo && <div><span className="text-muted-foreground">Assigned to</span><p className="font-medium">{String(state.assignedTo)}</p></div>}
          </div>
          {!!state.description && <div><p className="mb-1 text-sm text-muted-foreground">Details</p><p className="whitespace-pre-wrap text-sm">{String(state.description)}</p></div>}
          <div>
            <p className="mb-2 text-sm font-semibold">Before — resident's photo</p>
            <Photos reportId={report.id} savedScans={scans} readOnly={watched} />
          </div>
          <SmartTicketBox state={state} />
          <FieldEvidenceDisplay state={state} reportId={report.id} photosLabel="After — completed work" />
          {watched && Array.isArray(state.updates) && (state.updates as unknown[]).length > 0 && (
            <div>
              <p className="mb-1 text-sm font-semibold">Everything that happened</p>
              <ul className="space-y-1 text-sm">
                {(state.updates as Array<{ at?: string; by?: string; note?: string; status?: string }>).map((u, i) => (
                  <li key={i} className="rounded-md border bg-muted/30 px-3 py-1.5"><span className="text-xs text-muted-foreground">{u.at ? new Date(u.at).toLocaleString() : ""}{u.by ? ` · ${u.by}` : ""}</span><br />{u.note || u.status || ""}</li>
                ))}
              </ul>
            </div>
          )}
          {!watched && canOpenReports && <Link href={`/reports?id=${encodeURIComponent(report.id)}`} className="inline-block text-sm font-semibold text-[#185FA5] hover:underline">Assign or update it in Resident Reports</Link>}
        </div>
      )}
    </div>
  );
}
