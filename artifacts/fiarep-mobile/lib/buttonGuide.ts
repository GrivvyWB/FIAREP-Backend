// Plain-words guide to the app's tiles and buttons, shown under Settings.
// Filtered by who is signed in (mode / position).
export type AppButtonGuide = {
  for: Array<'administrator' | 'management' | 'inspector' | 'worker' | 'emergency' | 'resident' | 'vendor'>;
  title: string;
  does: string;
};

export const APP_BUTTON_GUIDE: AppButtonGuide[] = [
  { for: ['management', 'administrator', 'inspector', 'worker', 'emergency'], title: 'Inbox', does: 'Every alert sent to you. Tap one to read it in full — the complaint, inspection, scope or change order it refers to — even with poor service. Supervisors and management read here and act on fiarep.com.' },
  { for: ['management', 'administrator'], title: 'Resident Reports', does: 'Complaints for your development and any sent to you. View here; assign, send as violation, approve work and resolve on fiarep.com.' },
  { for: ['management', 'administrator'], title: 'Inspection Approvals', does: 'Supervisor Inspector: inspections waiting for approval. Approve & send to a CPM Supervisor, or deny with a reason, on fiarep.com.' },
  { for: ['management', 'administrator'], title: 'HUD Inspections', does: 'HUD inspection forms and their review outcome.' },
  { for: ['management', 'administrator'], title: 'Emergency Activity', does: 'Emergency jobs and the units responding. Request an emergency unit from here.' },
  { for: ['management', 'administrator'], title: 'Development / Building & Residential / Vendor / Truck Scores', does: 'Performance scores built from the complaints and work you can see.' },
  { for: ['management', 'administrator'], title: 'Change Orders', does: 'Change work orders from CPMs and workers. Reviewed (approve → Procurement, or decline) on fiarep.com.' },
  { for: ['management', 'administrator'], title: 'Leave Calendar / Request Time Off', does: 'See who is off and send your own time-off request to your supervisor.' },
  { for: ['management', 'administrator'], title: 'Attendance', does: 'Clock in and out; supervisors see their team.' },
  { for: ['management', 'administrator'], title: 'Cover a Site', does: 'Enter a development’s 2-digit code to see and act on its complaints for 24 hours.' },
  { for: ['management', 'administrator'], title: 'CPM Supervisor Scope Review', does: 'Scopes written by CPMs. Approve (→ Procurement) or return with notes on fiarep.com.' },
  { for: ['management', 'administrator'], title: 'Default rates', does: 'Rates every project starts with (waste, sheet cost, labor, paint, flooring).' },
  { for: ['administrator'], title: 'Assign a Job / Add Job for Mgmt / Assign Route', does: 'Create work and send it to a worker, or plan an inspector’s route.' },
  { for: ['administrator'], title: 'Manage Trucks / Assign Emergency Unit', does: 'Emergency units and which truck goes where.' },
  { for: ['administrator'], title: 'Audit Log', does: 'Who did what, and when.' },
  { for: ['inspector'], title: 'My Routes', does: 'Buildings to inspect today. Tap a stop when you reach it; "Done for the day" closes a route once every stop is reached.' },
  { for: ['inspector'], title: 'Log Violations', does: 'Log what you found: pick an issue phrase, the violation code fills in (change it if needed), set the class A/B/C, add notes and photos. Sends to the Supervisor Inspector for approval.' },
  { for: ['inspector'], title: 'My Inspections', does: 'Your permanent read-only copy of every inspection you logged — full reading, code, class, notes and what happened next. Your proof of work.' },
  { for: ['inspector'], title: 'HUD Inspections', does: 'Fill out a HUD inspection form; the Supervisor Inspector reviews it.' },
  { for: ['inspector'], title: 'Submit Scope (CPM)', does: 'Write a scope of work for a complaint or inspection sent to you and send it to the CPM Supervisor.' },
  { for: ['inspector'], title: 'Change Work Order (CPM)', does: 'Ask for extra work beyond the scope; the CPM Supervisor reviews it.' },
  { for: ['inspector'], title: 'Measurement / Projects', does: 'Rooms, measurements and rates for renovation projects.' },
  { for: ['worker'], title: 'My Jobs', does: 'Work assigned to you. "Arrived" stamps your time and location; "Done" sends your note and photos to your supervisor for review.' },
  { for: ['worker'], title: 'Create Report', does: 'Report a problem you found on site.' },
  { for: ['worker'], title: 'Change Work Order', does: 'Ask for extra work beyond the job as assigned; management reviews it.' },
  { for: ['worker', 'inspector'], title: 'Request Time Off', does: 'Send a time-off request to your supervisor.' },
  { for: ['emergency'], title: 'Emergency Units', does: 'Jobs sent to your unit. Respond, update and close them here.' },
  { for: ['management', 'administrator', 'inspector', 'worker', 'emergency'], title: 'FIAREP Vision (AI)', does: 'Point the camera at a problem for a suggested description and code.' },
  { for: ['management', 'administrator', 'inspector', 'worker', 'emergency'], title: 'Sign out', does: 'Signs you out of this phone.' },
];
