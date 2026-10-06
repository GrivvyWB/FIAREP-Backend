export type Persona = 'resident' | 'vendor' | 'staff' | null;
import { isCpmSupervisorTitle, isInspectionSupervisorTitle, isSupervisorTitle, sameTitle, supervisedTradeForPosition } from "./titles.ts";
import type { Staff } from "@workspace/api-client-react";

export type StaffModule =
  | "dashboard" | "inspections" | "inspection-create" | "estimates"
  | "repairs" | "projects" | "reports" | "report-upload" | "calendar"
  | "clients" | "team" | "violations" | "procurement" | "scope-review"
  | "scope-writing" | "emergency" | "change-orders" | "scores" | "elevators"
  | "leave" | "hr" | "notifications" | "settings" | "shared-data"
   | "hud-inspections" | "trade-requests" | "my-jobs" | "complaint-dashboard" | "inspection-approvals" | "my-inspections"
   | "community" | "translator" | "property-lookup" | "company-forms";

export type OrganizationModules = Record<string, boolean>;

const MANAGEMENT_ROLES = new Set(["management", "administrator"]);
const UPPER_MANAGEMENT_POSITIONS = new Set(["Director", "Borough Director", "Regional Director", "Assistant Regional Director"]);
const ADMIN_ONLY_MODULES = new Set<StaffModule>(["clients", "shared-data"]);
const isElevatorTitle = (position: string | null | undefined) =>
  sameTitle(position, "Elevator Service") || supervisedTradeForPosition(position) === "Elevator Service";
// Modules that are OFF until the platform owner enables them (none today;
// the per-tool Project switches are handled in Module Management).
const OPT_IN_MODULES = new Set<StaffModule>(["company-forms"]);
const CPM_ONLY_MODULES = new Set<StaffModule>([
  "estimates",
  "repairs",
  "projects",
  "scope-review",
  "change-orders",
]);

/** Community Coordinators (field outreach) and their supervisor. Their
 * records stay inside that unit; they see nothing else on the website. */
export function isCommunityCoordinator(staff: Staff | null | undefined): boolean {
  if (!staff) return false;
  if (String(staff.role || "") === "community_coordinator") return true;
  // The title decides, whatever role the account was saved with.
  return /^community coordinator( supervisor)?$/i.test(String(staff.position || "").trim());
}
export function isCommunityCoordinatorSupervisor(staff: Staff | null | undefined): boolean {
  return isCommunityCoordinator(staff) && sameTitle(staff?.position, "Community Coordinator Supervisor");
}

export function isSupervisor(staff: Staff | null | undefined): boolean {
  const position = staff?.position?.trim().toLowerCase() || "";
  return isSupervisorTitle(position) ||
    position === "superintendent" ||
    position === "superintendent Ⓔ";
}

/**
 * Supervisors/superintendents who float between developments. They may view
 * every development, and may unlock the ability to act on a development they
 * don't normally cover ("Cover a site"). Mirrors the server's isCoverageEligible.
 * HR, procurement, workers, emergency and public roles are never eligible.
 */
export function isCoverageEligible(staff: Staff | null | undefined): boolean {
  if (!staff) return false;
  if (staff.role === "administrator") return true;
  if (["human_resources", "procurement", "vendor", "resident", "worker", "emergency", "community_coordinator"].includes(staff.role)) {
    return false;
  }
  return isSupervisor(staff);
}

export function canReviewHud(staff: Staff | null | undefined): boolean {
  return !!staff && isInspectionSupervisorTitle(staff.position);
}

// Shared default rates are for CPMs (who write scopes) and the managers /
// administrators who set them — not for Inspectors or the Supervisor Inspector.
export function canReadSharedDefaultRates(staff: Staff | null | undefined): boolean {
  if (!staff) return false;
  if (sameTitle(staff.position, "CPM")) return true;
  if (staff.role === "inspector") return false;
  if (isInspectionSupervisorTitle(staff.position)) return false;
  return (staff.role === "management" || staff.role === "administrator") &&
    staff.position !== "Maintenance Worker";
}

/** One client-side policy shared by navigation, routes, and data surfaces.
 * The API remains the final authority; this prevents unauthorized UI from
 * mounting and issuing requests in the first place. */
// HPD / DOB Lookup access by trade (control panel). Stored as lookup.<trade>
// inside features.modules; every trade is ON unless switched off.
export const LOOKUP_TRADES: Array<{ key: string; label: string }> = [
  { key: "superintendent", label: "Superintendent" },
  { key: "maintenance", label: "Maintenance Worker" },
  { key: "plumber", label: "Plumber" },
  { key: "electrician", label: "Electrician" },
  { key: "carpenter", label: "Carpenter" },
  { key: "painter", label: "Painter" },
  { key: "mason", label: "Mason / Bricklayer" },
  { key: "roofer", label: "Roofer" },
  { key: "heating", label: "Heating / Boiler" },
  { key: "elevator", label: "Elevator Mechanic" },
  { key: "exterminator", label: "Exterminator" },
  { key: "worker", label: "Other workers" },
  { key: "emergency", label: "Emergency Crew" },
  { key: "inspector", label: "Inspector" },
  { key: "supervisor-inspector", label: "Supervisor Inspector" },
  { key: "cpm", label: "CPM" },
  { key: "cpm-supervisor", label: "CPM Supervisor" },
  { key: "property-manager", label: "Property Manager" },
  { key: "director", label: "Director" },
  { key: "supervisor", label: "Other supervisors / management" },
  { key: "administrator", label: "Administrator" },
  { key: "community", label: "Community Coordinator" },
];

/** Which lookup-access switch applies to a person, from their title (and role as a fallback). */
export function lookupTradeFor(position: string, role: string): string {
  const p = (position || "").trim().toLowerCase();
  const r = (role || "").trim().toLowerCase();
  if (r === "community_coordinator" || p.includes("community coordinator")) return "community";
  if (p.includes("cpm supervisor") || p.includes("cpm-supervisor")) return "cpm-supervisor";
  if (p === "cpm" || p.includes("cpm")) return "cpm";
  if (p.includes("supervisor") && p.includes("inspect")) return "supervisor-inspector";
  if (p.includes("inspector")) return "inspector";
  if (p.includes("property manager")) return "property-manager";
  if (p.includes("director")) return "director";
  if (p.includes("superintendent") || p === "super") return "superintendent";
  if (p.includes("plumb")) return "plumber";
  if (p.includes("electric")) return "electrician";
  if (p.includes("carpent")) return "carpenter";
  if (p.includes("paint")) return "painter";
  if (p.includes("mason") || p.includes("brick") || p.includes("concrete")) return "mason";
  if (p.includes("roof")) return "roofer";
  if (p.includes("heat") || p.includes("boiler") || p.includes("hvac")) return "heating";
  if (p.includes("elevator")) return "elevator";
  if (p.includes("exterm") || p.includes("pest")) return "exterminator";
  if (p.includes("maintenance") || p.includes("caretaker")) return "maintenance";
  if (r === "emergency") return "emergency";
  if (r === "administrator") return "administrator";
  if (r === "management") return "supervisor";
  if (r === "inspector") return "inspector";
  return "worker";
}

export function hasModuleAccess(
  staff: Staff | null | undefined,
  module: StaffModule,
  organizationModules?: OrganizationModules | null,
): boolean {
  if (!staff) return false;
  if (organizationModules?.[module] === false) return false;
  // Opt-in modules are OFF until the platform owner enables them for the
  // organization (Platform -> Module Management). Keeps parity with mobile.
  if (OPT_IN_MODULES.has(module) && organizationModules?.[module] !== true) return false;
  // Community Coordinators: their own section, alerts and settings — nothing else,
  // and nobody else gets their section.
  if (module === "community") return isCommunityCoordinator(staff);
  // Company Forms: FIAREP's locked folder. Only an organization the platform
  // owner unlocked (opt-in above), and only its staff — never residents or vendors.
  if (module === "company-forms") return !["vendor", "resident", "procurement"].includes(String(staff.role));
  // The live translator: every signed-in staff member who talks to residents.
  if (module === "translator") return !["vendor", "resident", "procurement"].includes(String(staff.role));
  // HPD / DOB lookup (read-only): staff who work a building, unless the
  // platform owner switched it off for their trade (Platform -> Modules).
  if (module === "property-lookup") {
    if (["vendor", "resident", "procurement", "human_resources"].includes(String(staff.role))) return false;
    return organizationModules?.[`lookup.${lookupTradeFor(staff.position || "", String(staff.role))}`] !== false;
  }
  if (isCommunityCoordinator(staff)) return module === "notifications" || module === "settings";
  // The Team (staff management) page is restricted to Human Resources only —
  // no other role, including Administrator or Borough Director, sees it.
  // Team: HR runs it; an administrator gets in too, so a locked-out HR
  // account (or anyone) can have its access code reset by someone.
  if (module === "team") return staff.role === "human_resources" || staff.role === "administrator";
  // Measurements are a field tool (the app). Management, supervisors and
  // administrators don't get the website page; only the people who take
  // measurements in the field (workers, CPMs, inspectors) see them.
  if (module === "measurement" && (staff.role === "management" || staff.role === "administrator")) return false;
  const position = staff.position?.trim() || "";
  // Every supervisor's shell on the website mirrors the tiles they had in the
  // app: Inbox, Time off / Leave calendar, Emergency activity, Scores
  // (vendor / development / building & residential), Change orders, Reports.
  const exactWorkflowShell = new Set(["dashboard", "calendar", "notifications", "settings", "leave", "emergency", "scores", "change-orders", "reports"]);
  // Inspectors and the Supervisor Inspector have no part in change work orders
  // (CPMs / workers write them; CPM Supervisor and management review them).
  if (module === "change-orders" && (staff.role === "inspector" && position !== "CPM" || isInspectionSupervisorTitle(position))) return false;
  if (isSupervisor(staff) && (module === "reports" || module === "violations")) {
    return true;
  }
  // These field personas have deliberately separate workflow tabs.  Handoffs
  // connect records; they must not broaden the recipient's navigation.
  if (staff.role === "inspector" && position === "Inspector") {
    // HUD Inspections: inspectors see their HUD inspections and the review
    // outcome here; they fill new ones out in the app.
    return exactWorkflowShell.has(module) || ["inspections", "inspection-create", "violations", "hud-inspections", "my-inspections"].includes(module);
  }
  // Inspector / CPM manpower requests are addressed to these supervisors, so
  // like every trade supervisor they need the Trade Requests page.
  if (staff.role === "management" && isInspectionSupervisorTitle(position)) {
    // Send Violation / Inspection Approvals / HUD Inspections (app tiles).
    return exactWorkflowShell.has(module) ||
      ["trade-requests", "inspections", "violations", "hud-inspections", "inspection-approvals"].includes(module);
  }
  if (staff.role === "inspector" && position === "CPM") {
    return exactWorkflowShell.has(module) || module === "scope-writing";
  }
  if (staff.role === "management" && isCpmSupervisorTitle(position)) {
    return exactWorkflowShell.has(module) || module === "scope-review" || module === "trade-requests";
  }
  // Any other supervisor title — including new ones — is a trade supervisor.
  const isTradeSupervisor =
    isSupervisor(staff) &&
    !isInspectionSupervisorTitle(position) &&
    !isCpmSupervisorTitle(position);
  if (isTradeSupervisor) {
    return exactWorkflowShell.has(module) || module === "trade-requests";
  }
  if ((staff.role as string) === "worker") {
    return exactWorkflowShell.has(module) || module === "my-jobs" || module === "reports";
  }
  if (
    isCpmSupervisorTitle(staff.position) &&
    (module === "violations" || module === "hud-inspections")
  ) {
    return false;
  }
  const isEmergencyMaintenance =
    staff.role === "emergency" && staff.position === "Maintenance Worker";
  if (
    staff.position?.trim().toLowerCase() === "supervisor inspector" &&
    CPM_ONLY_MODULES.has(module)
  ) {
    return false;
  }
  if (staff.role === "human_resources") {
    // "team" is handled by the HR-only rule above; excluded here to keep the type exhaustive.
    return module === "dashboard" ||
      module === "leave" || module === "hr" || module === "notifications" || module === "settings";
  }
  if (staff.role === "procurement") return module === "procurement";
  if (module === "hud-inspections") return canReviewHud(staff) || staff.role === "inspector";
  if (module === "my-inspections") return staff.role === "inspector" && position === "Inspector";
  if (module === "inspection-approvals") return staff.role === "administrator" || (staff.role === "management" && isInspectionSupervisorTitle(position));
  // Shared Data remains an administrator-only module.  Default-rate
  // visibility is a Settings concern, not a reason to broaden this module.
  if (module === "shared-data") return staff.role === "administrator";
  if (module === "change-orders" && isSupervisor(staff)) return true;
  if (module === "change-orders" && staff.role === "inspector") return position === "CPM";
  if (module === "trade-requests") {
    return MANAGEMENT_ROLES.has(staff.role) || isSupervisor(staff);
  }
  if (module === "my-jobs") {
    return staff.role === "worker";
  }
  if (module === "complaint-dashboard") {
    return MANAGEMENT_ROLES.has(staff.role) && UPPER_MANAGEMENT_POSITIONS.has(staff.position || "");
  }
  if (ADMIN_ONLY_MODULES.has(module)) return staff.role === "administrator";
  if (module === "hr") return false;
  if (module === "elevators") {
    return staff.role === "administrator" || isElevatorTitle(staff.position);
  }
  if (module === "scope-review") {
    return staff.role === "management" && isCpmSupervisorTitle(staff.position);
  }
  if (MANAGEMENT_ROLES.has(staff.role)) {
    if (module === "scope-writing") return false;
    return true;
  }
  if (module === "dashboard" || module === "calendar" || module === "leave" ||
      module === "notifications" || module === "settings") return true;
  if (staff.role === "inspector") {
    if (module === "violations" || module === "inspections" || module === "inspection-create" ||
        module === "reports" || module === "report-upload" || module === "repairs" ||
        module === "projects" || module === "estimates") return true;
    if (module === "scope-writing") return staff.position === "CPM";
    return false;
  }
  if (staff.role === "worker" || isEmergencyMaintenance) {
    if (isEmergencyMaintenance && module === "emergency") return true;
    if (module === "repairs" || module === "projects" || module === "reports") return true;
    return false;
  }
  if (staff.role === "emergency") return module === "emergency";
  return false;
}

export function canApproveWork(staff: Staff | null | undefined): boolean {
  return !!staff && (MANAGEMENT_ROLES.has(staff.role) || isSupervisor(staff));
}

/** Who runs the Procurement desk: the Procurement role, or the company "Director"
 * (an administrator titled plainly "Director" — not a Borough/Regional Director). */
export function isProcurementDesk(staff: Staff | null | undefined): boolean {
  if (!staff) return false;
  if (staff.role === "procurement") return true;
  return staff.role === "administrator" && (staff.position || "").trim().toLowerCase() === "director";
}

/** Procurement / HR / payroll desks: office roles that never handle a complaint. */
export function isProcurementOrHrStaff(staff: Staff | null | undefined): boolean {
  if (!staff) return false;
  if (["procurement", "human_resources"].includes(String(staff.role || ""))) return true;
  // The company "Director" (administrator titled plainly "Director") runs Procurement.
  if (isProcurementDesk(staff)) return true;
  return /procurement|human resources|\bhr\b|payroll/i.test(staff.position || "");
}

export function canHandleResidentReports(staff: Staff | null | undefined): boolean {
  if (!staff) return false;
  if (staff.role === "administrator") return true;
  if (isProcurementOrHrStaff(staff)) return false;
  if (staff.position === "Superintendent Ⓔ") return true;
  const position = staff.position?.trim() || "";
  // Every supervisor handles complaints the same way (CPM Supervisor included).
  return staff.role === "management" &&
    (
      isSupervisorTitle(position) ||
      ["Superintendent", "Assistant Superintendent"].includes(position)
    );
}

export interface AccessEvaluation {
  redirect?: string;
  setPersona?: 'staff' | 'resident' | 'vendor';
  clearAuth?: boolean;
}

/** Pages anyone may open before the website is locked to a signed-in person:
 * the landing page, the Enter Platform picker, and the sign-in pages. */
export const OPEN_PATHS = new Set(['/', '/platform', '/access', '/login', '/procurement/login', '/resident', '/vendor']);

export function evaluateAccess(
  persona: Persona,
  path: string,
  isAuthenticated: boolean
): AccessEvaluation {
  if (path === "/platform" || path === "/join") return {};
  const isProcurement = path === '/procurement' || path.startsWith('/procurement/');

  // Nobody is signed in yet: the landing page opens first, and the sign-in
  // pages stay reachable. The website locks to a person only once they sign in.
  if (!persona) {
    if (isAuthenticated) {
      return { setPersona: 'staff' };
    }
    if (isProcurement) {
      return { setPersona: 'staff' };
    }
    if (!OPEN_PATHS.has(path)) {
      return { redirect: '/' };
    }
    return {};
  }

  if (persona === 'resident') {
    if (isAuthenticated) {
      return { clearAuth: true };
    }
    if (path !== '/resident') {
      return { redirect: '/resident' };
    }
    return {};
  }

  if (persona === 'vendor') {
    if (isAuthenticated) {
      return { clearAuth: true };
    }
    if (path !== '/vendor') {
      return { redirect: '/vendor' };
    }
    return {};
  }

  if (persona === 'staff') {
    if (path === '/' || path === '/access' || path === '/resident' || path === '/vendor') {
      return { redirect: isAuthenticated ? '/dashboard' : '/login' };
    }
    return {};
  }

  return {};
}

export const PERSONA_KEY = 'fiarep_persona';

export function choosePersona(
  existing: Persona,
  requested: Exclude<Persona, null>,
): Exclude<Persona, null> {
  return existing || requested;
}

/** Lock the website to the person who just signed in (staff, resident or
 * vendor). Replaces any earlier choice; signing out clears it. */
export function lockPersona(persona: Exclude<Persona, null>): void {
  try { localStorage.setItem(PERSONA_KEY, persona); } catch { /* storage unavailable */ }
}

/** Sign out: unlock the website so the landing page opens first again. */
export function clearStoredPersona(): void {
  try { localStorage.removeItem(PERSONA_KEY); } catch { /* storage unavailable */ }
}

export function getStoredPersona(): Persona {
  try {
    const p = localStorage.getItem(PERSONA_KEY);
    if (p === 'resident' || p === 'vendor' || p === 'staff') return p as Persona;
  } catch (e) {
    // ignore
  }
  return null;
}

export function setStoredPersona(persona: Exclude<Persona, null>): Persona {
  try {
    const chosen = choosePersona(getStoredPersona(), persona);
    localStorage.setItem(PERSONA_KEY, chosen);
    return chosen;
  } catch {
    return null;
  }
}
