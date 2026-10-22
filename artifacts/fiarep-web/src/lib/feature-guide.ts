import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, ClipboardCheck, Plus, FileText, Wrench, Briefcase, FolderOpen, Upload, CalendarDays, Users, UsersRound,
  UserCog, AlertTriangle, UserRoundCheck, ShoppingCart, BellRing, FileCog, Target, ArrowUpToLine, Plane, Settings, Database,
  Ruler, Lock, Building2, History, MapPin, Languages, Droplets, Mic, ScanSearch, ClipboardList, Send, Mail, ListOrdered,
  Compass, MapPinPlus, Hourglass, MessageSquare, Smartphone,
} from "lucide-react";
import { hasModuleAccess, isCoverageEligible, type StaffModule } from "./access-policy";

// Settings → "What each icon means": every feature this company has, its icon,
// what it is, how to get to it and how it opens. Only what is switched on for
// the company (and that this person can open) is listed.
type Modules = Record<string, boolean>;
type Staff = Parameters<typeof hasModuleAccess>[0];
export type FeatureGuide = {
  name: string; icon: LucideIcon; what: string; where: string; opens: string;
  show: (staff: Staff, modules: Modules) => boolean;
};

const page = (module: StaffModule) => (staff: Staff, modules: Modules) => hasModuleAccess(staff, module, modules);
const on = (key: string) => (_s: Staff, m: Modules) => m[key] === true;            // off until switched on
const notOff = (key: string) => (_s: Staff, m: Modules) => m[key] !== false;       // on unless switched off
const menu = (name: string) => `Left menu → ${name}.`;
const FULL = "Opens as a full page in this window.";

export const FEATURE_GUIDE: FeatureGuide[] = [
  { name: "Dashboard", icon: LayoutDashboard, show: page("dashboard"), what: "Your company at a glance: open complaints, inspections, emergencies, time off and your latest alerts.", where: menu("Dashboard") + " It is also the first page after you sign in.", opens: FULL },
  { name: "Complaint Dashboard", icon: LayoutDashboard, show: page("complaint-dashboard"), what: "Every resident complaint in one place: what is open, who has it and how long it has been waiting.", where: menu("Complaint Dashboard"), opens: FULL },
  { name: "Inspections", icon: ClipboardCheck, show: page("inspections"), what: "Every inspection record: what was inspected, by whom, and the findings.", where: menu("Inspections"), opens: FULL + " Press an inspection to open it." },
  { name: "New Inspection", icon: Plus, show: page("inspection-create"), what: "Start a new inspection.", where: "Left menu, bottom box (Quick Action) → New Inspection. Also the New Inspection button on the Inspections page.", opens: "Opens the inspection form as a full page." },
  { name: "HUD Inspections", icon: ClipboardCheck, show: page("hud-inspections"), what: "The HUD inspection workflow, step by step.", where: menu("HUD Inspections"), opens: FULL },
  { name: "Estimates", icon: FileText, show: page("estimates"), what: "Cost estimates for repair work.", where: menu("Estimates"), opens: FULL },
  { name: "Repairs", icon: Wrench, show: page("repairs"), what: "Repair work from start to finish.", where: menu("Repairs"), opens: FULL },
  { name: "Projects", icon: Briefcase, show: page("projects"), what: "Your project area and its tools.", where: menu("Projects"), opens: FULL + " Press a project to open it." },
  { name: "Reports", icon: FolderOpen, show: page("reports"), what: "Resident complaints and records for your buildings.", where: menu("Reports"), opens: FULL + " Press a complaint to open it with its photos and buttons." },
  { name: "Upload Report", icon: Upload, show: page("report-upload"), what: "Upload a report file.", where: "Left menu, bottom box (Quick Action) → Upload Report.", opens: "Opens the upload page as a full page." },
  { name: "Calendar", icon: CalendarDays, show: page("calendar"), what: "Your company calendar: visits, jobs and time off.", where: menu("Calendar"), opens: FULL },
  { name: "Clients", icon: Users, show: page("clients"), what: "Your client list.", where: menu("Clients"), opens: FULL },
  { name: "Team", icon: UsersRound, show: page("team"), what: "Your staff: names, titles, buildings and login codes.", where: menu("Team"), opens: FULL },
  { name: "HR Workspace", icon: UserCog, show: page("hr"), what: "Human resources: staff records and requests.", where: menu("HR Workspace"), opens: FULL },
  { name: "Violations", icon: AlertTriangle, show: page("violations"), what: "Building violations and the work to clear them.", where: menu("Violations"), opens: FULL },
  { name: "Trade Requests", icon: UserRoundCheck, show: page("trade-requests"), what: "Work sent to a trade (plumbing, electrical, carpentry …) and its supervisor.", where: menu("Trade-Supervisors"), opens: FULL },
  { name: "My Jobs", icon: Wrench, show: page("my-jobs"), what: "The jobs assigned to you.", where: menu("My Jobs"), opens: FULL },
  { name: "Scope Review", icon: UserRoundCheck, show: page("scope-review"), what: "CPM Supervisor reviews the scopes of work CPMs write.", where: menu("CPM Supervisor"), opens: FULL },
  { name: "Scope Writing", icon: ClipboardCheck, show: page("scope-writing"), what: "CPMs write a scope of work.", where: menu("Scope Writing"), opens: FULL },
  { name: "Procurement", icon: ShoppingCart, show: page("procurement"), what: "Purchasing and vendor work.", where: menu("Procurement"), opens: FULL },
  { name: "Emergency", icon: BellRing, show: page("emergency"), what: "Emergency work and who is on it.", where: menu("Emergency"), opens: FULL },
  { name: "Change Orders", icon: FileCog, show: page("change-orders"), what: "Changes to the agreed work and price.", where: menu("Change Orders"), opens: FULL },
  { name: "Scores", icon: Target, show: page("scores"), what: "Performance scores for buildings, staff and vendors.", where: menu("Scores"), opens: FULL },
  { name: "Elevators", icon: ArrowUpToLine, show: page("elevators"), what: "Elevator work.", where: menu("Elevators"), opens: FULL },
  { name: "Leave", icon: Plane, show: page("leave"), what: "Time-off requests and approvals.", where: menu("Leave"), opens: FULL },
  { name: "Notifications", icon: BellRing, show: page("notifications"), what: "Every alert and request sent to you, newest first.", where: "The bell at the top right. Administrators and management also have Left menu → Manage All Requests.", opens: FULL },
  { name: "Settings", icon: Settings, show: page("settings"), what: "Your account, language, default rates and this guide.", where: menu("Settings"), opens: FULL },
  { name: "Shared Data", icon: Database, show: page("shared-data"), what: "Data shared across the platform.", where: menu("Shared Data"), opens: FULL },
  { name: "Measurement", icon: Ruler, show: page("measurement"), what: "Material take-off measured with the phone camera (concrete, sheetrock, window openings).", where: "Measure on the FIAREP app (Measurement button on the home screen). Saved measurements: Left menu → Measurements.", opens: "On the app it opens the camera. On the website the saved list opens as a full page." },
  { name: "Company Forms", icon: Lock, show: page("company-forms"), what: "Compliance forms: DOB certificate of correction, vermin, lead, tenant notices.", where: menu("Company Forms"), opens: FULL + " Press a form to fill it in." },
  { name: "HPD / DOB Lookup", icon: Building2, show: page("property-lookup"), what: "Look up a building's HPD and DOB violations by address.", where: menu("HPD / DOB Lookup") + " Also on the app.", opens: FULL + " Type the address and the violations show below." },
  { name: "Audit Log", icon: History, show: page("audit-log"), what: "Who did what, and when.", where: menu("Audit Log"), opens: FULL },
  { name: "Site Check-Ins", icon: MapPin, show: page("site-checkins"), what: "Where each member checked in (the building tapped and where the phone was) and when they left and came back.", where: menu("Site Check-Ins") + " Members check in on the app with Building Check-In.", opens: FULL },
  { name: "Translator", icon: Languages, show: page("translator"), what: "Voice-to-voice interpreter for talking with residents.", where: menu("Translator") + " Also on the app home screen.", opens: FULL + " Press to talk; it speaks the translation out loud." },
  { name: "Building Baseline", icon: ClipboardCheck, show: page("baseline-report"), what: "The onboarding walk-through of each building and its baseline report.", where: menu("Building Baseline"), opens: FULL + " Press a building to open its report." },
  { name: "Mold Compliance", icon: Droplets, show: page("mold-compliance"), what: "Active mold violations per building, % completed and remaining, Inspection Recommended at 60%, certification deadlines.", where: menu("Mold Compliance"), opens: FULL },
  { name: "Inspection Approvals", icon: ClipboardCheck, show: page("inspection-approvals"), what: "Supervisors approve inspections.", where: menu("Inspection Approvals"), opens: FULL },
  { name: "Cover a site", icon: MapPin, show: (s, m) => isCoverageEligible(s) && ((s?.tenantId || "default") === "default" || m["cover-site"] === true), what: "A supervisor working at one of your buildings that isn't theirs confirms its 2-digit code and can act there for 24 hours.", where: "The Cover a site button at the top of the page. On the app: Cover a Site on the home screen.", opens: "Opens a small window over the page: pick the building, type the 2-digit code." },
  { name: "Violation Alerts", icon: BellRing, show: page("violation-alerts"), what: "New 311 complaints, HPD / DOB violations and OATH summonses on your watched buildings, checked every 30 minutes.", where: menu("Violation Alerts"), opens: FULL },
  { name: "Command Center", icon: Mic, show: page("command-center"), what: "Talk to your buildings, alerts and work orders by voice.", where: menu("Command Center") + " On the app: Command Center on the home screen.", opens: FULL + " Press the microphone and talk." },
  { name: "Violation Alerts — Upper Management", icon: AlertTriangle, show: page("violation-alerts-command"), what: "The same violation alerts as a red strip for the Borough Director, with its own on / off switch.", where: menu("Complaint Dashboard") + " The red strip is at the top.", opens: "Shows on the Complaint Dashboard page; press an alert to open it." },
  { name: "Residential photo AI scan", icon: ScanSearch, show: on("residentPhotoAiViolationReader"), what: "A private violation reading of a resident's complaint photo, for supervisors only.", where: menu("Reports") + " Open a complaint that has a photo.", opens: "Shows under the photo inside the complaint." },
  { name: "Community Coordinator Supervisor review", icon: UsersRound, show: (s, m) => hasModuleAccess(s, "community", m) && m["communitySupervisorReview"] !== false, what: "A visit waits for the Community Coordinator Supervisor to read and approve it.", where: "The visits page in the left menu.", opens: "Visits waiting show there with Approve." },
  { name: "Resident complaints come to FIAREP", icon: Send, show: on("fiarepComplaintRouting"), what: "A resident complaint on one of your buildings on the plan goes straight to FIAREP's crew when it is filed.", where: "Nothing to open: it happens by itself. You see it in Reports.", opens: "—" },
  { name: "Smart Repair", icon: Wrench, show: notOff("smartRepair"), what: "Photo in, repair plan out: the issue, exact location, tools, supplies, fixtures, steps, trade, priority and time.", where: "The FIAREP app → Smart Repair on the home screen.", opens: "Opens the camera on the phone; the repair plan opens after the photo." },
  { name: "Smart Repair on all their phones", icon: Smartphone, show: on("smartRepairSync"), what: "Your Smart Repair photos and directions follow your account to every phone or iPad you sign in to.", where: "The FIAREP app → Smart Repair. On the website: Left menu → Smart Repair.", opens: FULL },
  { name: "Smart Field Ticket", icon: ClipboardList, show: notOff("smartRepairComplaints"), what: "A repair plan from a resident complaint's photo.", where: "The FIAREP app: open a resident complaint that came in with a photo.", opens: "Press Smart Field Ticket inside the complaint; the plan opens on the phone." },
  { name: "Completed Smart Repair goes to management", icon: BellRing, show: notOff("smartRepairToManagement"), what: "When the after-repair photo verifies the repair, management gets it in the app right away.", where: "Management's app notifications.", opens: "Opens from the push notification on the phone." },
  { name: "Email a copy when a Smart Repair is complete", icon: Mail, show: on("smartRepairEmailCopy"), what: "The finished repair summary is emailed from fiarep@outlook.com to the address on file.", where: "Your email inbox.", opens: "Opens as an email." },
  { name: "Priority Queue", icon: ListOrdered, show: notOff("priorityEngine"), what: "Every open resident complaint in a building, read from its photo and words, ranked most critical first, with the same trade grouped into one route.", where: "The FIAREP app → Priority Queue on the home screen.", opens: "Opens as a full screen on the phone." },
  { name: "Take me there", icon: Compass, show: notOff("violationGuide"), what: "Step-by-step guidance to the floor, apartment, room and wall the HPD inspector wrote, with a live compass arrow.", where: "The FIAREP app: open an HPD violation.", opens: "Press Take me there inside the violation; it opens full screen with the arrow." },
  { name: "Out of network complaint", icon: MapPinPlus, show: on("outOfNetwork"), what: "Check in at a building that is not in the system: one press reads the address from where the phone is and files it as Out of network.", where: "The FIAREP app → Building Check-In.", opens: "Opens inside Building Check-In on the phone." },
  { name: "Baseline assessment before complaint management", icon: Hourglass, show: on("requireBaseline"), what: "Review Reports, Manage All Requests, Resident Reports and Priority Queue wait until FIAREP completes the building baseline walk-through. Residents can still send complaints.", where: "A notice shows at the top while it waits.", opens: "The tools come back by themselves once the baseline is complete." },
  { name: "Message FIAREP Services", icon: MessageSquare, show: notOff("fiarepMessaging"), what: "Write to FIAREP Services from your account and get an answer back.", where: menu("Messages") + " On the app: Message FIAREP.", opens: FULL },
];
