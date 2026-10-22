import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Clock, Zap, ClipboardCheck, UsersRound, MapPin, DoorOpen, Languages, Building2, BellRing, Wrench, Droplets, Mic, Lock,
  FileText, Briefcase, FolderOpen, Ruler, CalendarDays, Users, UserCog, AlertTriangle, UserRoundCheck, ShoppingCart, Target, Trash2, FileCog,
  ArrowUpToLine, Plane, MessageSquare, History, Database, Settings, Info, Plus, Upload,
} from "lucide-react";
import type { StaffModule } from "./access-policy";

// The website's left side panel, item by item, each with its own switch in
// Platform Control → Module Management → Website menu, for the whole company or one
// person. Unset: on. Off: hidden (and the page closed). On: shown, even where another
// setting would hide it. A person's own switch wins over the company's.
export type MenuItem = { href: string; name: string; icon: LucideIcon; module: StaffModule; quick?: boolean };
export const MENU_ITEMS: MenuItem[] = [
  { href: "/dashboard", name: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
  { href: "/time-clock", name: "Time clock", icon: Clock, module: "dashboard" },
  { href: "/quick-quote", name: "Quick Quote", icon: Zap, module: "dashboard" },
  { href: "/complaint-dashboard", name: "Complaint Dashboard", icon: LayoutDashboard, module: "complaint-dashboard" },
  { href: "/baseline-report", name: "Building Baseline", icon: ClipboardCheck, module: "baseline-report" },
  { href: "/community", name: "Community Coordinators", icon: UsersRound, module: "community" },
  { href: "/site-checkins", name: "Site Check-Ins", icon: MapPin, module: "site-checkins" },
  { href: "/door-visits", name: "Door Visits", icon: DoorOpen, module: "door-visits" },
  { href: "/translator", name: "Translator", icon: Languages, module: "translator" },
  { href: "/property-lookup", name: "HPD / DOB Lookup", icon: Building2, module: "property-lookup" },
  { href: "/violation-alerts", name: "Violation Alerts", icon: BellRing, module: "violation-alerts" },
  { href: "/smart-repairs", name: "Smart Repair", icon: Wrench, module: "dashboard" },
  { href: "/mold-compliance", name: "Mold Compliance", icon: Droplets, module: "mold-compliance" },
  { href: "/command-center", name: "Command Center", icon: Mic, module: "command-center" },
  { href: "/company-forms", name: "Company Forms", icon: Lock, module: "company-forms" },
  { href: "/inspections", name: "Inspections", icon: ClipboardCheck, module: "inspections" },
  { href: "/hud-inspections", name: "HUD Inspections", icon: ClipboardCheck, module: "hud-inspections" },
  { href: "/inspection-approvals", name: "Inspection Approvals", icon: ClipboardCheck, module: "inspection-approvals" },
  { href: "/my-inspections", name: "My Inspections", icon: ClipboardCheck, module: "my-inspections" },
  { href: "/estimates", name: "Estimates", icon: FileText, module: "estimates" },
  { href: "/repairs", name: "Repairs", icon: Wrench, module: "repairs" },
  { href: "/projects", name: "Projects", icon: Briefcase, module: "projects" },
  { href: "/reports", name: "Reports", icon: FolderOpen, module: "reports" },
  { href: "/measurements", name: "Measurements", icon: Ruler, module: "measurement" },
  { href: "/calendar", name: "Calendar", icon: CalendarDays, module: "calendar" },
  { href: "/clients", name: "Clients", icon: Users, module: "clients" },
  { href: "/team", name: "Team", icon: UsersRound, module: "team" },
  { href: "/hr", name: "HR Workspace", icon: UserCog, module: "hr" },
  { href: "/violations", name: "Violations", icon: AlertTriangle, module: "violations" },
  { href: "/trade-requests", name: "Trade-Supervisors:", icon: UserRoundCheck, module: "trade-requests" },
  { href: "/my-jobs", name: "My Jobs", icon: Wrench, module: "my-jobs" },
  { href: "/scope-review", name: "CPM Supervisor", icon: UserRoundCheck, module: "scope-review" },
  { href: "/procurement", name: "Procurement", icon: ShoppingCart, module: "procurement" },
  { href: "/scope-writing", name: "Scope Writing", icon: ClipboardCheck, module: "scope-writing" },
  { href: "/emergency", name: "Emergency", icon: BellRing, module: "emergency" },
  { href: "/scores", name: "Scores", icon: Target, module: "scores" },
  { href: "/deleted-items", name: "Deleted items", icon: Trash2, module: "dashboard" },
  { href: "/change-orders", name: "Change Orders", icon: FileCog, module: "change-orders" },
  { href: "/elevators", name: "Elevators", icon: ArrowUpToLine, module: "elevators" },
  { href: "/leave", name: "Leave", icon: Plane, module: "leave" },
  { href: "/notifications", name: "Manage All Requests", icon: BellRing, module: "notifications" },
  { href: "/messages", name: "Messages", icon: MessageSquare, module: "notifications" },
  { href: "/audit-log", name: "Audit Log", icon: History, module: "audit-log" },
  { href: "/shared-data", name: "Shared Data", icon: Database, module: "shared-data" },
  { href: "/settings", name: "Settings", icon: Settings, module: "settings" },
  { href: "/platform", name: "What is FIAREP?", icon: Info, module: "dashboard" },
  { href: "/inspections/new", name: "Quick Action → New Inspection", icon: Plus, module: "inspection-create", quick: true },
  { href: "/reports/upload", name: "Quick Action → Upload Report", icon: Upload, module: "report-upload", quick: true },
];
export const menuKey = (href: string) => "menu." + href.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
/** One person's switch for a menu item (Platform Control → Module Management → pick the person). */
export const personKey = (staffId: string, key: string) => `p.${staffId}.${key}`;
/** The person's own switch first, then the company's; undefined: normal rules (on). */
export function menuOverride(modules: Record<string, boolean> | null | undefined, href: string, staffId?: string | null): boolean | undefined {
  if (staffId) { const pv = modules?.[personKey(staffId, menuKey(href))]; if (typeof pv === "boolean") return pv; }
  const v = modules?.[menuKey(href)];
  return typeof v === "boolean" ? v : undefined;
}

/** Buttons on pages, each with its own switch in Platform Control → Module Management → Website menu. */
export const PAGE_BUTTONS = [
  { key: "button.trade-request", name: "Trade Request button (Violations / NYC Property Lookup, Reports)" },
  { key: "button.efile", name: "E-file button (Company Forms — forms the City takes online)" },
] as const;
/** The person's switch, then the company's, then the normal rule. */
export function buttonShown(modules: Record<string, boolean> | null | undefined, key: string, staffId: string | null | undefined, normal: boolean): boolean {
  if (staffId) { const pv = modules?.[personKey(staffId, key)]; if (typeof pv === "boolean") return pv; }
  const v = modules?.[key];
  return typeof v === "boolean" ? v : normal;
}
