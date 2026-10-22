import { BUTTON_GUIDE } from "./button-guide";

// What the website's Settings page shows, each with its own switch in Platform Control
// → Module Management → Settings page. On unless switched off for the client.
export const SETTINGS_SECTIONS: { key: string; name: string }[] = [
  { key: "settings.profile", name: "Profile Details (role and status)" },
  { key: "settings.language", name: "Language" },
  { key: "settings.defaultRates", name: "Shared Default Rates" },
  { key: "settings.access", name: "Access & Security (assigned developments)" },
  { key: "settings.buttonGuide", name: "What the buttons do (the whole guide)" },
  ...BUTTON_GUIDE.map((g) => ({ key: `settings.guide.${g.module}`, name: `What the buttons do → ${g.page}` })),
];
// The app's Settings screen (phone): the guide's entries, by title (same list as the app's buttonGuide.ts).
const APP_GUIDE_TITLES = [
  "Inbox",
  "Resident Reports",
  "Inspection Approvals",
  "HUD Inspections",
  "Emergency Activity",
  "Development / Building & Residential / Vendor / Truck Scores",
  "Change Orders",
  "Leave Calendar / Request Time Off",
  "Attendance",
  "Cover a Site",
  "CPM Supervisor Scope Review",
  "Default rates",
  "Assign a Job / Add Job for Mgmt / Assign Route",
  "Manage Trucks / Assign Emergency Unit",
  "Audit Log",
  "My Routes",
  "Log Violations",
  "My Inspections",
  "Submit Scope (CPM)",
  "Change Work Order (CPM)",
  "Measurement / Projects",
  "My Jobs",
  "Create Report",
  "Change Work Order",
  "Request Time Off",
  "Emergency Units",
  "FIAREP Vision (AI)",
  "Sign out",
];
export const appGuideKey = (title: string) => "settings.app.guide." + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
SETTINGS_SECTIONS.push(
  { key: "settings.app.defaultRates", name: "App → Default rates" },
  { key: "settings.app.buttonGuide", name: "App → What the buttons do (the whole guide)" },
  ...APP_GUIDE_TITLES.map((t) => ({ key: appGuideKey(t), name: `App → What the buttons do → ${t}` })),
);
export const settingShown = (modules: Record<string, boolean> | null | undefined, key: string) => modules?.[key] !== false;
