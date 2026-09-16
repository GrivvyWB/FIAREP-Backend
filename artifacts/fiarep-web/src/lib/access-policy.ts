export type Persona = 'resident' | 'vendor' | 'staff' | null;
import type { Staff } from "@workspace/api-client-react";

export type StaffModule =
  | "dashboard" | "inspections" | "inspection-create" | "estimates"
  | "repairs" | "projects" | "reports" | "report-upload" | "calendar"
  | "clients" | "team" | "violations" | "procurement" | "scope-review"
  | "scope-writing" | "emergency" | "change-orders" | "scores" | "elevators"
  | "leave" | "hr" | "notifications" | "settings" | "shared-data"
  | "hud-inspections";

const MANAGEMENT_ROLES = new Set(["management", "administrator"]);
const ADMIN_ONLY_MODULES = new Set<StaffModule>(["clients", "team", "shared-data"]);
const ELEVATOR_POSITIONS = new Set(["Elevator Supervisor", "Elevator Service"]);
const HUD_REVIEW_POSITIONS = new Set(["Supervisor Inspector", "CPM Supervisor", "Supervisor CPM"]);
const CPM_ONLY_MODULES = new Set<StaffModule>([
  "estimates",
  "repairs",
  "projects",
  "scope-review",
  "change-orders",
]);

export function isSupervisor(staff: Staff | null | undefined): boolean {
  const position = staff?.position?.trim().toLowerCase() || "";
  return position.includes("supervisor") || position === "superintendent";
}

export function canReviewHud(staff: Staff | null | undefined): boolean {
  return !!staff && HUD_REVIEW_POSITIONS.has(staff.position || "");
}

/** One client-side policy shared by navigation, routes, and data surfaces.
 * The API remains the final authority; this prevents unauthorized UI from
 * mounting and issuing requests in the first place. */
export function hasModuleAccess(staff: Staff | null | undefined, module: StaffModule): boolean {
  if (!staff) return false;
  if (
    staff.position?.trim().toLowerCase() === "supervisor inspector" &&
    CPM_ONLY_MODULES.has(module)
  ) {
    return false;
  }
  if (staff.role === "human_resources") {
    return module === "dashboard" || module === "team" ||
      module === "leave" || module === "hr" || module === "notifications" || module === "settings";
  }
  if (staff.role === "procurement") return module === "procurement";
  if (module === "hud-inspections") return canReviewHud(staff);
  if (module === "change-orders" && isSupervisor(staff)) return true;
  if (ADMIN_ONLY_MODULES.has(module)) return staff.role === "administrator";
  if (module === "hr") return staff.role === "management" || staff.role === "administrator";
  if (module === "elevators") {
    return staff.role === "administrator" || ELEVATOR_POSITIONS.has(staff.position || "");
  }
  if (module === "scope-review") {
    return staff.role === "management" &&
      !["Borough Director", "Regional Director", "Superintendent"].includes(staff.position || "");
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
  if (staff.role === "worker") {
    if (module === "repairs" || module === "projects" || module === "reports") return true;
    return false;
  }
  if (staff.role === "emergency") return module === "emergency";
  return false;
}

export function canApproveWork(staff: Staff | null | undefined): boolean {
  return !!staff && (MANAGEMENT_ROLES.has(staff.role) || isSupervisor(staff));
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
