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


/** Where tapping an alert should take the person. */
export function notificationHref(message: string, reportId: string, opts?: { inspector?: boolean }): string {
  const id = encodeURIComponent(reportId);
  const m = message || "";
  if (/^Measurement added to inspection/i.test(m)) return opts?.inspector ? "/my-inspections" : "/inspection-approvals";
  if (/^Measurement added/i.test(m)) return `/reports?id=${id}`;
  if (/^Scope approved for Procurement|Procurement returned|bid/i.test(m)) return "/procurement";
  if (/^Scope submitted|^Scope /i.test(m)) return "/scope-review";
  // Inspections logged by inspectors are approved / routed on Inspection Approvals.
  // Inspection alerts: the inspector opens his own read-only copy (My
  // Inspections); supervisors / management open Inspection Approvals.
  if (/inspection logged|awaiting review|approved inspection|^inspection |^building violations/i.test(m)) {
    return opts?.inspector ? "/my-inspections" : "/inspection-approvals";
  }
  if (/violation/i.test(m)) return `/inspections?id=${id}`;
  return `/reports?id=${id}`;
}
