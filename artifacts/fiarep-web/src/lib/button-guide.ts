import type { StaffModule } from "./access-policy";

// Plain-words guide to every page and its buttons. Shown under Settings →
// "What the buttons do", filtered to the pages the signed-in person has.
export type ButtonGuide = {
  module: StaffModule;
  page: string;
  purpose: string;
  buttons: { name: string; does: string }[];
};

export const BUTTON_GUIDE: ButtonGuide[] = [
  {
    module: "dashboard", page: "Dashboard",
    purpose: "Your starting point: counts of open complaints, inspections, emergencies and time-off, plus your latest alerts.",
    buttons: [
      { name: "Alert (in the list)", does: "Opens the thing the alert is about — a complaint, an inspection awaiting review, a scope, a change order." },
      { name: "Count cards", does: "Open the matching page (Reports, Inspections, Emergency, Leave)." },
    ],
  },
  {
    module: "notifications", page: "Inbox / Manage All Requests",
    purpose: "Every alert sent to you, newest first. Read state is yours alone — reading an alert does not mark it read for anyone else.",
    buttons: [
      { name: "Open", does: "Goes to the record the alert is about." },
      { name: "Mark read / Delete", does: "Clears the alert from your inbox only; the underlying work is untouched." },
    ],
  },
  {
    module: "reports", page: "Reports (resident complaints)",
    purpose: "Complaints from residents for your development, and any complaint that was sent to you.",
    buttons: [
      { name: "Assign", does: "Sends the complaint to a worker (or a trade supervisor) — it appears in their inbox and My Jobs." },
      { name: "Ask a supervisor to assign", does: "Sends the complaint to another supervisor to handle; it shows in their Reports and inbox." },
      { name: "Send as violation", does: "Turns the complaint into an inspection request for the inspectors (Supervisor Inspector reviews the result)." },
      { name: "Write scope / Start project", does: "CPM only: writes a scope of work from the complaint. Grayed once the scope is sent." },
      { name: "Approve work / Send back", does: "After a worker marks it done: accept the repair, or send it back with a reason for rework." },
      { name: "Resolve", does: "Closes the complaint for good once the work is accepted." },
    ],
  },
  {
    module: "inspection-approvals", page: "Inspection Approvals (Supervisor Inspector)",
    purpose: "Inspections logged by inspectors, waiting for your decision.",
    buttons: [
      { name: "Approve & send to CPM Supervisor", does: "Approves the inspection and hands it to the CPM Supervisor you pick, to be scoped." },
      { name: "Approve only", does: "Approves it and keeps it here until you route it." },
      { name: "Deny", does: "Rejects it with a reason; the inspector is told to correct and log it again." },
      { name: "Clear for staff", does: "Lets the assigned person remove a finished inspection from their own list." },
    ],
  },
  {
    module: "my-inspections", page: "My Inspections (Inspector)",
    purpose: "A permanent read-only copy of every inspection you logged — the full reading, code, class, notes and what happened to it since. Your proof of work.",
    buttons: [{ name: "(read only)", does: "Nothing to press — this is your record." }],
  },
  {
    module: "inspections", page: "Inspections / Send Violation",
    purpose: "Building violations and the DOB / HPD lookups behind them.",
    buttons: [
      { name: "Send violation", does: "Sends a violation to an inspector to be logged in the field." },
      { name: "Route", does: "Sends an approved inspection to a CPM (to scope) or a trade (to fix)." },
    ],
  },
  {
    module: "hud-inspections", page: "HUD Inspections",
    purpose: "HUD inspection forms filled out in the app, with their review outcome.",
    buttons: [
      { name: "Approve / Return", does: "Supervisor Inspector only: accepts the HUD inspection or returns it with notes." },
    ],
  },
  {
    module: "violations", page: "Violations",
    purpose: "Open building violations for your developments and their status.",
    buttons: [{ name: "Open", does: "Shows the violation, who has it and its history." }],
  },
  {
    module: "scope-review", page: "CPM Supervisor — Scope Review",
    purpose: "Scopes written by CPMs, waiting for your review.",
    buttons: [
      { name: "Approve", does: "Sends the scope to Procurement for cost and vendor bids." },
      { name: "Return", does: "Sends the scope back to the CPM with your notes to correct and resubmit." },
    ],
  },
  {
    module: "scope-writing", page: "Scope Writing (CPM)",
    purpose: "Write and submit a scope of work for a complaint or inspection sent to you.",
    buttons: [
      { name: "Submit scope", does: "Sends the scope to the CPM Supervisor for review." },
      { name: "Save draft", does: "Keeps it on your page without sending." },
    ],
  },
  {
    module: "change-orders", page: "Change Orders",
    purpose: "Change work orders written by CPMs and workers when the job turns out bigger than the scope.",
    buttons: [
      { name: "Approve & send to Procurement", does: "CPM Supervisor / management: accepts the change and sends it to Procurement for cost." },
      { name: "Decline", does: "Rejects the change with a reason; the writer is told." },
      { name: "Approve cost", does: "Procurement: confirms the cost so the work can go ahead." },
    ],
  },
  {
    module: "trade-requests", page: "Trade-Supervisors (trade requests)",
    purpose: "Requests for your trade's manpower coming from inspectors, CPMs and other supervisors.",
    buttons: [
      { name: "Assign", does: "Puts one of your workers on the request; it lands in their My Jobs." },
      { name: "Release", does: "Gives the request back so it can be assigned elsewhere." },
    ],
  },
  {
    module: "my-jobs", page: "My Jobs (workers)",
    purpose: "Work assigned to you.",
    buttons: [
      { name: "Arrived", does: "Stamps your arrival time and location." },
      { name: "Done", does: "Marks the job complete with your note and photos; your supervisor reviews it." },
      { name: "Change work order", does: "Asks for extra work beyond the job as assigned." },
    ],
  },
  {
    module: "emergency", page: "Emergency",
    purpose: "Emergency jobs and the Superintendent Ⓔ units that respond.",
    buttons: [
      { name: "Request emergency unit", does: "Sends an emergency job to the emergency supervisor." },
      { name: "Assign unit / Close", does: "Emergency supervisor: dispatches a unit, then closes the job." },
    ],
  },
  {
    module: "scores", page: "Scores & Performance",
    purpose: "Development, building, vendor and residential scores from the complaints and work you can see.",
    buttons: [
      { name: "Refresh", does: "Recalculates from the latest records." },
      { name: "Development (drop-down)", does: "Narrows the complaint counts to one development." },
    ],
  },
  {
    module: "leave", page: "Leave / Time off",
    purpose: "Time-off requests and the leave calendar.",
    buttons: [
      { name: "Request time off", does: "Sends a request to your supervisor." },
      { name: "Approve / Deny", does: "Supervisors: answer a request; the person is told." },
    ],
  },
  {
    module: "calendar", page: "Calendar",
    purpose: "Scheduled work, inspections and time off in one view.",
    buttons: [{ name: "Day / Week / Month", does: "Changes the view; tap an item to open it." }],
  },
  {
    module: "procurement", page: "Procurement",
    purpose: "Approved scopes and change orders waiting for cost, bids and awards.",
    buttons: [
      { name: "Invite vendors", does: "Opens the scope for vendor bids." },
      { name: "Award", does: "Picks the winning vendor and starts the work." },
      { name: "Return", does: "Sends the scope back to the CPM Supervisor with notes." },
    ],
  },
  {
    module: "hr", page: "HR Workspace",
    purpose: "Staff accounts, positions, developments and approvals.",
    buttons: [
      { name: "Approve / Deactivate", does: "Turns a staff account on or off." },
      { name: "Edit", does: "Changes a person's title, developments or supervisor." },
    ],
  },
  {
    module: "team", page: "Team",
    purpose: "Human Resources only: everyone in the organization.",
    buttons: [{ name: "Add staff", does: "Creates a new staff account and sends their code." }],
  },
  {
    module: "elevators", page: "Elevators",
    purpose: "Elevator jobs and mechanics.",
    buttons: [{ name: "Assign mechanic / Done", does: "Dispatches an elevator job, then closes it." }],
  },
  {
    module: "projects", page: "Projects",
    purpose: "Renovation projects with rooms, measurements and rates.",
    buttons: [{ name: "New project", does: "Starts a project; add rooms and measurements inside it." }],
  },
  {
    module: "company-forms", page: "Company Forms — filling in a form for a building",
    purpose: "Every form fills in its building for you from the City's records, so the address is written the way the City wants it. You pick the building once; the forms after that use the same one until you change it.",
    buttons: [
      { name: "Fill in", does: "Opens a new form. If you were already working on a building, its address is filled in right away. If not, the form asks: \"Which building is this form for?\"" },
      { name: "Pick one of your buildings", does: "The list of your company's buildings. Pick one and the form fills in the address, borough, ZIP, county, HPD registration number, owner and managing agent wherever the form asks for them." },
      { name: "Type any address → Fill the form / Use this address", does: "For a building that is not on your list: type the house number and street, with the borough if you know it (for example \"1386 Ogden Avenue, Bronx\"), then press the button. To switch buildings, do the same — the address on the form is replaced." },
      { name: "Fill from OATH summons # (AEU2)", does: "On the DOB Certificate of Correction: type the summons (ticket) number and press Fill. The summons number, the address it was written at, borough / ZIP and the notary county fill in. Or press Fill AEU2 next to the summons in the building lookup." },
      { name: "Fill from violation #", does: "On an HPD affidavit (AF-6, AF-7, AF-8, lead, mold): type the HPD violation number and the right affidavit fills in from that violation — violation number, apartment, address, county and registration." },
      { name: "Before you sign", does: "Read every filled-in line against the notice in your hand. Fill in the apartment, names and dates the City's records do not have, then Save. Nothing is sent anywhere until you send it." },
    ],
  },
  {
    module: "command-center", page: "Command Center — having it fill a form",
    purpose: "Ask the Command Center on your phone to fill a form; it saves the form on Company Forms filled in, and gives you an Open button to check it and sign.",
    buttons: [
      { name: "Say the form and the building", does: "For example: \"Fill a lead paint disclosure for 1386 Ogden Avenue, Bronx, apartment 3B\" or \"Fill the AF-6 for 1386 Ogden Avenue\". Give the house number and street, and the borough if you can." },
      { name: "For an OATH summons", does: "Say the summons number: \"Fill the AEU2 for summons 035551995X\". The address comes from the summons itself." },
      { name: "If you leave the building out", does: "It asks you which address to use. Answer with the address and it fills the form." },
      { name: "Open", does: "Opens the filled-in form on the website. Check it, add what the City's records do not have (names, dates, apartment), and Save." },
    ],
  },
  {
    module: "settings", page: "Settings",
    purpose: "Your profile, shared default rates (CPMs and management) and sign out.",
    buttons: [
      { name: "Save shared rates", does: "Borough Director only: updates the rates every project starts with." },
      { name: "Sign out", does: "Signs you out and unlocks the website so the landing page shows again." },
    ],
  },
];
