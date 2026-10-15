// What each home tile looks like: icon + one-line description, keyed by the
// tile's label. Every staff home (CPM, Inspector, trades, supervisors,
// management, administrator, FIAREP technicians) draws from this one list so
// the same button looks the same everywhere.
export type TileArt = { icon: string; lib: 'ion' | 'mci'; desc: string };

const C: Record<string, TileArt> = {
  'My Jobs': { lib: 'mci', icon: 'account-hard-hat', desc: 'View and manage assigned work orders.' },
  'Projects': { lib: 'mci', icon: 'clipboard-check-outline', desc: 'View & manage inspection projects.' },
  'Projects / Inspections': { lib: 'mci', icon: 'clipboard-check-outline', desc: 'All projects and inspections.' },
  '+ New Project': { lib: 'ion', icon: 'add', desc: 'Create a new inspection project.' },
  'Request Time Off': { lib: 'ion', icon: 'time-outline', desc: 'Submit or view time off requests.' },
  'Attendance': { lib: 'ion', icon: 'stopwatch-outline', desc: 'Clock in when you arrive, out when you leave.' },
  'Time Clock': { lib: 'ion', icon: 'stopwatch-outline', desc: 'Clock in when you arrive, out when you leave.' },
  'Price Quote': { lib: 'mci', icon: 'tag-outline', desc: 'Price what a job needs and send it to the client.' },
  'Quick Quote': { lib: 'mci', icon: 'lightning-bolt-outline', desc: 'Price a walk on the spot: send it, or approve it yourself.' },
  'FIAREP Services': { lib: 'mci', icon: 'account-group-outline', desc: 'Visits FIAREP Services log, waiting for your approval.' },
  'Past quotes': { lib: 'mci', icon: 'history', desc: 'Quick quotes already sent or approved. Tap one to reopen it.' },
  'Submit Scope': { lib: 'mci', icon: 'bullseye-arrow', desc: 'Create a new scope of work.' },
  'Change Work Order': { lib: 'mci', icon: 'file-document-edit-outline', desc: 'Modify existing work orders.' },
  'Change Orders': { lib: 'mci', icon: 'file-document-edit-outline', desc: 'Review and approve change orders.' },
  'Measurement': { lib: 'mci', icon: 'ruler', desc: 'Record and update measurements.' },
  'Saved Measurements': { lib: 'mci', icon: 'database-outline', desc: 'View your saved measurements.' },
  'Inbox': { lib: 'ion', icon: 'mail-outline', desc: 'View your messages and notifications.' },
  'Check HPD / DOB': { lib: 'mci', icon: 'office-building-outline', desc: 'Validate building records.' },
  'Translator': { lib: 'ion', icon: 'globe-outline', desc: 'Translate content and language.' },
  'Sign out': { lib: 'ion', icon: 'log-out-outline', desc: 'End your session securely.' },
  'HUD Inspections': { lib: 'mci', icon: 'home-search-outline', desc: 'HUD / NSPIRE inspections.' },
  'Log Violations': { lib: 'mci', icon: 'alert-octagon-outline', desc: 'Record violations on site.' },
  'FIAREP Vision (AI)': { lib: 'mci', icon: 'eye-outline', desc: 'Photo analysis for conditions.' },
  'Smart Repair': { lib: 'mci', icon: 'toolbox-outline', desc: 'Photo in. Repair plan out.' },
  'Priority Queue': { lib: 'mci', icon: 'sort-descending', desc: 'Every complaint ranked, most critical first.' },
  'My Routes': { lib: 'mci', icon: 'map-marker-path', desc: 'Buildings on your route today.' },
  'My Inspections': { lib: 'mci', icon: 'clipboard-list-outline', desc: 'Inspections assigned to you.' },
  'Create Report': { lib: 'mci', icon: 'file-plus-outline', desc: 'Write up a new report.' },
  'Elevator Jobs': { lib: 'mci', icon: 'elevator-passenger-outline', desc: 'Elevator service calls.' },
  'Elevator Dashboard': { lib: 'mci', icon: 'elevator-passenger-outline', desc: 'Elevator status across buildings.' },
  'Emergency Units': { lib: 'mci', icon: 'truck-fast-outline', desc: 'Emergency crews on the road.' },
  'Check Report Status': { lib: 'ion', icon: 'search-outline', desc: 'Look up a report by its number.' },
  'Send Violation': { lib: 'mci', icon: 'send-outline', desc: 'Send a violation to an inspector.' },
  'Inspection Approvals': { lib: 'mci', icon: 'check-decagram-outline', desc: 'Approve logged inspections.' },
  'In-house assignments': { lib: 'mci', icon: 'account-group-outline', desc: 'Jobs given to your own staff.' },
  'CPM Supervisor Scope Review': { lib: 'mci', icon: 'file-search-outline', desc: 'Review scopes from your CPMs.' },
  'CPM Supervisor': { lib: 'mci', icon: 'file-search-outline', desc: 'Review scopes from your CPMs.' },
  'Assign a Job': { lib: 'mci', icon: 'account-arrow-right-outline', desc: 'Dispatch work to a trade.' },
  'Cover a Site': { lib: 'mci', icon: 'shield-key-outline', desc: 'Unlock another development for today.' },
  'Staff Member Jobs': { lib: 'mci', icon: 'account-multiple-outline', desc: 'What each worker has on.' },
  'Assign Emergency Unit': { lib: 'mci', icon: 'truck-alert-outline', desc: 'Send an emergency truck.' },
  'Manage Trucks': { lib: 'mci', icon: 'truck-outline', desc: 'Register and manage trucks.' },
  'Truck Scores': { lib: 'mci', icon: 'speedometer', desc: 'Response scores per truck.' },
  'Emergency Activity': { lib: 'mci', icon: 'alarm-light-outline', desc: 'Emergency calls and responses.' },
  'Leave Calendar': { lib: 'ion', icon: 'calendar-outline', desc: 'Who is off and when.' },
  'Vendor Score': { lib: 'mci', icon: 'star-outline', desc: 'How vendors are performing.' },
  'Development Scores': { lib: 'mci', icon: 'chart-line', desc: 'Scores by development.' },
  'Building & Residential Scores': { lib: 'mci', icon: 'home-analytics', desc: 'Scores by building and unit.' },
  'Review Reports': { lib: 'mci', icon: 'clipboard-text-outline', desc: 'Resident reports to review.' },
  'Resident Reports': { lib: 'mci', icon: 'clipboard-text-outline', desc: 'Resident reports to review.' },
  'Manage All Requests': { lib: 'mci', icon: 'inbox-multiple-outline', desc: 'Every request in one place.' },
  'Default rates': { lib: 'ion', icon: 'settings-outline', desc: 'Rates and app settings.' },
  'Add Job for Mgmt': { lib: 'mci', icon: 'briefcase-plus-outline', desc: 'Create a job for management.' },
  'Assign Route': { lib: 'mci', icon: 'map-marker-path', desc: 'Give an inspector a route.' },
  'Audit Log': { lib: 'mci', icon: 'history', desc: 'Who did what, and when.' },
};

/** Strip a count suffix and leading emoji: "Inbox (3)" → "Inbox", "🏢 Check HPD / DOB" → "Check HPD / DOB". */
export function cleanLabel(label: string): { label: string; badge: number } {
  const m = label.match(/\((\d+)\)\s*$/);
  const badge = m ? Number(m[1]) : 0;
  const clean = label.replace(/\s*\(\d+\)\s*$/, '').replace(/^[^\w+]+\s*/u, '').trim();
  return { label: clean, badge };
}

export function tileArt(label: string): TileArt {
  const { label: l } = cleanLabel(label);
  return C[l] || { lib: 'ion', icon: 'ellipse-outline', desc: '' };
}

/** Section colour by heading. */
export function sectionColor(heading: string): string {
  const h = heading.toLowerCase();
  if (h.includes('work') || h === 'jobs') return '#3B9BFF';
  if (h.includes('inspection')) return '#1F5C45';
  if (h.includes('scope') || h.includes('purchas')) return '#F59E0B';
  if (h.includes('request')) return '#F43F5E';
  if (h.includes('supervis')) return '#06B6D4';
  return '#7C5CFF';
}

/** Banner tagline per title. */
export function taglineFor(title: string): string {
  const t = title.toLowerCase();
  if (t === 'technician') return 'Get it done. Keep it running.';
  if (t.includes('inspector')) return 'See it. Log it. Clear it.';
  if (t.includes('cpm')) return 'Scope it right the first time.';
  if (t.includes('director') || t === 'management') return 'Every building, one view.';
  if (t.includes('supervisor') || t.includes('superintendent')) return 'Your crew, your sites, today.';
  if (t.includes('administrator')) return 'Everything, everywhere.';
  return 'Get it done. Keep it running.';
}

/** Banner icon per title (MaterialCommunityIcons). */
export function iconFor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('inspector')) return 'clipboard-search-outline';
  if (t.includes('cpm')) return 'ruler-square';
  if (t.includes('plumb')) return 'pipe-wrench';
  if (t.includes('electric')) return 'lightning-bolt-outline';
  if (t.includes('carpent')) return 'hammer-screwdriver';
  if (t.includes('paint')) return 'format-paint';
  if (t.includes('elevator')) return 'elevator-passenger-outline';
  if (t.includes('heat') || t.includes('boiler')) return 'fire';
  if (t.includes('exterm')) return 'bug-outline';
  if (t.includes('emergency')) return 'truck-fast-outline';
  if (t.includes('director') || t === 'management' || t.includes('administrator')) return 'office-building-cog-outline';
  if (t.includes('supervisor') || t.includes('superintendent')) return 'account-tie-hat-outline';
  return 'account-hard-hat';
}
