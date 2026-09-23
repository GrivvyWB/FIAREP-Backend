export type Persona = 'resident' | 'vendor' | 'staff' | null;
import type { Staff } from "@workspace/api-client-react";

export type StaffModule =
  | "dashboard" | "inspections" | "inspection-create" | "estimates"
  | "repairs" | "projects" | "reports" | "report-upload" | "calendar"
  | "clients" | "team" | "violations" | "procurement" | "scope-review"
  | "scope-writing" | "emergency" | "change-orders" | "scores" | "elevators"
  | "leave" | "hr" | "notifications" | "settings" | "shared-data"
   | "hud-inspections" | "trade-requests" | "my-jobs" | "complaint-dashboard";

export type OrganizationModules = Record<string, boolean>;

const MANAGEMENT_ROLES = new Set(["management", "administrator"]);
const UPPER_MANAGEMENT_POSITIONS = new Set(["Director", "Borough Director", "Regional Director", "Assistant Regional Director"]);
const ADMIN_ONLY_MODULES = new Set<StaffModule>(["clients", "shared-data"]);
const ELEVATOR_POSITIONS = new Set(["Elevator Supervisor", "Elevator Service"]);
const HUD_REVIEW_POSITIONS = new Set(["Supervisor Inspector"]);
// Modules that are OFF until the platform owner enables them (none today;
// the per-tool Project switches are handled in Module Management).
const OPT_IN_MODULES = new Set<StaffModule>([]);
const CPM_ONLY_MODULES = new Set<StaffModule>([
  "estimates",
  "repairs",
  "projects",
  "scope-review",
  "change-orders",
]);

export function isSupervisor(staff: Staff | null | undefined): boolean {
  const position = staff?.position?.trim().toLowerCase() || "";
  return position.includes("supervisor") ||
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
  if (["human_resources", "procurement", "vendor", "resident", "worker", "emergency"].includes(staff.role)) {
    return false;
  }
  return isSupervisor(staff);
}

export function canReviewHud(staff: Staff | null | undefined): boolean {
  return !!staff && HUD_REVIEW_POSITIONS.has(staff.position || "");
}

export function canReadSharedDefaultRates(staff: Staff | null | undefined): boolean {
  return !!staff && staff.position !== "Maintenance Worker";
}

/** One client-side policy shared by navigation, routes, and data surfaces.
 * The API remains the final authority; this prevents unauthorized UI from
 * mounting and issuing requests in the first place. */
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
  // The Team (staff management) page is restricted to Human Resources only —
  // no other role, including Administrator or Borough Director, sees it.
  if (module === "team") return staff.role === "human_resources";
  const position = staff.position?.trim() || "";
  const exactWorkflowShell = new Set(["dashboard", "calendar", "notifications", "settings"]);
  if (isSupervisor(staff) && (module === "reports" || module === "violations")) {
    return true;
  }
  // These field personas have deliberately separate workflow tabs.  Handoffs
  // connect records; they must not broaden the recipient's navigation.
  if (staff.role === "inspector" && position === "Inspector") {
    return exactWorkflowShell.has(module) || ["inspections", "inspection-create", "violations"].includes(module);
  }
  if (staff.role === "management" && position === "Supervisor Inspector") {
    return exactWorkflowShell.has(module);
  }
  if (staff.role === "inspector" && position === "CPM") {
    return exactWorkflowShell.has(module) || module === "scope-writing";
  }
  if (staff.role === "management" && position === "CPM Supervisor") {
    return exactWorkflowShell.has(module) || module === "scope-review";
  }
  const isTradeSupervisor =
    isSupervisor(staff) &&
    !["Supervisor Inspector", "CPM Supervisor"].includes(position);
  if (isTradeSupervisor) {
    return exactWorkflowShell.has(module) || module === "trade-requests";
  }
  if ((staff.role as string) === "worker") {
    return exactWorkflowShell.has(module) || module === "my-jobs" || module === "reports";
  }
  if (
    staff.position?.trim().toLowerCase() === "cpm supervisor" &&
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
  if (module === "hud-inspections") return canReviewHud(staff);
  // Shared Data remains an administrator-only module.  Default-rate
  // visibility is a Settings concern, not a reason to broaden this module.
  if (module === "shared-data") return staff.role === "administrator";
  if (module === "change-orders" && isSupervisor(staff)) return true;
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
    return staff.role === "administrator" || ELEVATOR_POSITIONS.has(staff.position || "");
  }
  if (module === "scope-review") {
    return staff.role === "management" && staff.position === "CPM Supervisor";
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

export function canHandleResidentReports(staff: Staff | null | undefined): boolean {
  if (!staff) return false;
  if (staff.role === "administrator") return true;
  if (staff.position === "Superintendent Ⓔ") return true;
  const position = staff.position?.trim() || "";
  return staff.role === "management" &&
    position !== "CPM Supervisor" &&
    (
      position.toLowerCase().includes("supervisor") ||
      ["Superintendent", "Assistant Superintendent"].includes(position)
    );
}

export interface AccessEvaluation {
  redirect?: string;
  setPersona?: 'staff' | 'resident' | 'vendor';
  clearAuth?: boolean;
}

export function evaluateAccess(
  persona: Persona,
  path: string,
  isAuthenticated: boolean
): AccessEvaluation {
  if (path === "/platform") return {};
  const isProcurement = path === '/procurement' || path.startsWith('/procurement/');

  if (!persona) {
    if (isAuthenticated) {
      return { setPersona: 'staff' };
    }
    if (isProcurement) {
      return { setPersona: 'staff' };
    }
    if (path !== '/') {
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
    if (path === '/' || path === '/resident' || path === '/vendor') {
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
