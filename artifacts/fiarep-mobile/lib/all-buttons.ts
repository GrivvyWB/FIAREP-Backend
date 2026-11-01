// Every button there is on any home screen. Each person's home shows the buttons of their own
// screen, plus every other button under "More" — Platform Control → App tabs switches any of them
// off for the company or for one person. (Keep in step with ALL_APP_BUTTONS in Platform Control.)
export const ALL_BUTTONS: Array<{ label: string; route: string }> = [
  { label: 'My Jobs', route: '/my-jobs' }, { label: 'Quick Quote', route: '/quick-quote' }, { label: 'Past quotes', route: '/quick-quote?past=1' },
  { label: 'Price Quote', route: '/price-quote' }, { label: 'Projects', route: '/?list=1' }, { label: '+ New Project', route: '/?new=1' },
  { label: 'Projects / Inspections', route: '/' }, { label: 'Log Violations', route: '/inspector-violations' }, { label: 'FIAREP Vision (AI)', route: '/fiarep-vision' },
  { label: 'Door Visit', route: '/door-visit' }, { label: 'Building Check-In', route: '/site-checkin' }, { label: 'Smart Repair', route: '/smart-repair' },
  { label: 'My Routes', route: '/inspector-routes' }, { label: 'My Inspections', route: '/my-inspections' }, { label: 'Create Report', route: '/create-report' },
  { label: 'Measurement', route: '/measurement' }, { label: 'Saved Measurements', route: '/saved-measurements' }, { label: 'Submit Scope', route: '/scope-submit' },
  { label: 'CPM Supervisor Scope Review', route: '/scope-review' }, { label: 'FIAREP Services', route: '/community-home' },
  { label: 'Change Work Order', route: '/cpm-change-order' }, { label: 'Request Time Off', route: '/leave-request' }, { label: 'Inbox', route: '/notifications' },
  { label: 'HUD Inspections', route: '/hud-inspections' }, { label: 'Building Baseline', route: '/baseline' }, { label: 'Send Violation', route: '/violation-send' },
  { label: 'Inspection Approvals', route: '/inspection-approvals' }, { label: 'Assign Route', route: '/assign-route' }, { label: 'Add Job for Mgmt', route: '/admin-job' },
  { label: 'Assign a Job', route: '/dispatch-job' }, { label: 'In-house assignments', route: '/in-house-assignments' }, { label: 'Cover a Site', route: '/cover-site' },
  { label: 'Staff Member Jobs', route: '/worker' }, { label: 'Assign Emergency Unit', route: '/assign-emergency' }, { label: 'Manage Trucks', route: '/manage-trucks' },
  { label: 'Truck Scores', route: '/truck-scores' }, { label: 'Emergency Activity', route: '/emergency-activity' }, { label: 'Emergency Units', route: '/emergency-units' },
  { label: 'Elevator Dashboard', route: '/elevator-dashboard' }, { label: 'Elevator Jobs', route: '/elevator-jobs' }, { label: 'Leave Calendar', route: '/leave-dashboard' },
  { label: 'Attendance', route: '/attendance' }, { label: 'Change Orders', route: '/change-orders' }, { label: 'Vendor Score', route: '/contractor-scores' },
  { label: 'Development Scores', route: '/dev-scores' }, { label: 'Building & Residential Scores', route: '/property-scores' },
  { label: 'Manage All Requests', route: '/manage-requests' }, { label: 'Resident Reports', route: '/management' }, { label: 'Review Reports', route: '/management' },
  { label: 'Priority Queue', route: '/priority-queue' }, { label: 'Default rates', route: '/settings' }, { label: 'Check HPD / DOB', route: '/inspector-violations?lookup=1' },
  { label: 'Translator', route: '/translator' }, { label: 'Command Center', route: '/command-center' }, { label: 'Check Report Status', route: '/resident-lookup' },
];

/** A button's name without its emoji or count, to compare buttons across screens. */
export const plainLabel = (label: string) => label.replace(/\s*\(\d+\)\s*$/, '').replace(/^[^\p{L}\p{N}+]+/u, '').trim();
