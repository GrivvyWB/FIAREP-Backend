import { hasModuleAccess, type OrganizationModules, type StaffModule } from "./access-policy";
import type { Staff } from "@workspace/api-client-react";
// Turns raw server messages like "resident reports work_approved" into
// plain words ("Complaint work approved"). Messages that are already
// written for people pass through unchanged.

const ENTITY: Record<string, string> = {
  "resident reports": "Complaint",
  "building violations": "Violation",
  "priority violations": "Priority violation",
  "manpower requests": "Trade request",
  "procurement": "Scope",
  "procurement bids": "Vendor bid",
  "change orders": "Change order",
  "emergency jobs": "Emergency job",
  "elevator jobs": "Elevator job",
  "leave requests": "Time-off request",
  "route assignments": "Route",
  "hud inspections": "HUD inspection",
  "inspections": "Inspection",
  "projects": "Project",
};

const STATUS: Record<string, string> = {
  submitted: "submitted",
  assigned: "assigned",
  in_progress: "started",
  done: "completed — ready for review",
  resolved: "resolved",
  work_approved: "work approved",
  rework: "sent back for rework",
  returned: "returned",
  approved: "approved",
  rejected: "rejected",
  routed: "routed",
  dispatched: "dispatched",
  pending: "waiting",
  bidding: "sent to vendors",
  awarded: "awarded",
  closed: "closed",
  in_house: "sent to in-house workers",
  in_house_completed: "in-house work completed",
  cancelled: "cancelled",
  completed: "completed",
};

export function notificationTitle(message: string | null | undefined): string {
  const text = String(message || "").trim();
  const m = text.match(/^([a-z][a-z ]*?)\s+([a-z_]+)$/);
  if (!m) return text;
  const entity = ENTITY[m[1]!];
  if (!entity) return text;
  const status = STATUS[m[2]!] || m[2]!.replace(/_/g, " ");
  return `${entity} ${status}`;
}



/** Where tapping an alert should take the person.
 * Each kind of alert has pages it can open, best first; the first one this
 * person actually has is used, so an alert always opens somewhere useful
 * (a CPM Supervisor's inspection alert opens Scope Review, not a page they
 * are bounced off). Falls back to the Inbox. */
export function notificationHref(
  message: string,
  reportId: string,
  opts?: { inspector?: boolean; staff?: Staff | null; modules?: OrganizationModules | null },
): string {
  const id = encodeURIComponent(reportId);
  const m = message || "";
  const inspector = opts?.inspector ?? (opts?.staff?.role === "inspector" && opts?.staff?.position === "Inspector");
  type Candidate = { module: StaffModule; href: string };
  let candidates: Candidate[];
  if (/change work order|^change orders /i.test(m)) {
    candidates = [{ module: "change-orders", href: "/change-orders" }];
  } else if (/^Measurement added to inspection/i.test(m) || /inspection logged|awaiting review|approved inspection|^inspection |^building violations|violation/i.test(m)) {
    // Inspections / violations: the inspector's own copy, the approver's
    // page, the CPM Supervisor's review page, the violations list, or the
    // complaint it came from.
    candidates = inspector
      ? [{ module: "my-inspections", href: "/my-inspections" }, { module: "violations", href: "/violations" }]
      : [
          { module: "inspection-approvals", href: "/inspection-approvals" },
          { module: "scope-review", href: "/scope-review" },
          { module: "violations", href: `/violations?id=${id}` },
          { module: "inspections", href: `/inspections?id=${id}` },
          { module: "reports", href: `/reports?id=${id}` },
        ];
  } else if (/^Measurement added/i.test(m)) {
    candidates = [{ module: "reports", href: `/reports?id=${id}` }];
  } else if (/^Scope approved for Procurement|Procurement returned|bid/i.test(m)) {
    candidates = [{ module: "procurement", href: "/procurement" }, { module: "scope-review", href: "/scope-review" }, { module: "scope-writing", href: "/scope-writing" }];
  } else if (/^Scope submitted|^Scope /i.test(m)) {
    candidates = [{ module: "scope-review", href: "/scope-review" }, { module: "scope-writing", href: "/scope-writing" }, { module: "procurement", href: "/procurement" }];
  } else {
    candidates = [{ module: "reports", href: `/reports?id=${id}` }, { module: "my-jobs", href: "/my-jobs" }];
  }
  // Without a staff record (older callers) keep the best page.
  if (!opts?.staff) return candidates[0]!.href;
  const allowed = candidates.find((c) => hasModuleAccess(opts.staff, c.module, opts.modules));
  return allowed ? allowed.href : "/notifications";
}
