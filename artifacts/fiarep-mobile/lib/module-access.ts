import { isCpmSupervisorTitle, isInspectionSupervisorTitle } from './titles';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { db, getSessionIdentity, setSiteNames } from './store';

export type ModuleId =
  | 'dashboard' | 'inspections' | 'inspection-create' | 'estimates' | 'repairs'
  | 'projects' | 'reports' | 'report-upload' | 'calendar' | 'clients' | 'team'
  | 'violations' | 'procurement' | 'scope-review' | 'scope-writing' | 'emergency'
  | 'change-orders' | 'scores' | 'elevators' | 'leave' | 'hr' | 'notifications'
  | 'settings' | 'shared-data' | 'hud-inspections' | 'trade-requests' | 'my-jobs'
  | 'complaint-dashboard' | 'measurement' | 'translator' | 'property-lookup'
  // Per-tool, per-client construction-PM switches (all opt-in / OFF by default).
  | 'proj-new' | 'proj-room' | 'proj-rates' | 'proj-checklist' | 'proj-inspection'
  | 'proj-estimate' | 'proj-scope' | 'proj-intake' | 'proj-elevator'
  | 'proj-photos' | 'proj-scans' | 'proj-roofplan' | 'proj-compass';

export type ModuleConfig = { propertyLimit?: number; name?: string; features?: { modules?: Record<string, boolean> } };
let cached: ModuleConfig | null = null;
let cachedStaffId = '';
let cachedPosition = '';
let cachedRole = '';
let cachedOwner = '';

async function settingKey(): Promise<string> {
  const identity = await getSessionIdentity();
  cachedStaffId = identity?.staffId || cachedStaffId;
  cachedPosition = identity?.position || cachedPosition;
  cachedRole = identity?.role || cachedRole;
  return `organization_module_config:${identity?.tenantId || 'default'}:${identity?.staffId || ''}`;
}

// Modules that are OFF until the platform owner explicitly turns them on for a
// client (opt-in). Everything else stays enabled unless explicitly disabled.
const OPT_IN_MODULES = new Set<ModuleId>([
  'proj-new', 'proj-room', 'proj-rates', 'proj-checklist', 'proj-inspection',
  'proj-estimate', 'proj-scope', 'proj-intake', 'proj-elevator',
  'proj-photos', 'proj-scans', 'proj-roofplan', 'proj-compass',
  'measurement',
]);

// Map a worker's position to the project-tool trade key used by the control-panel
// "Project tool access by trade" matrix.
function projectRoleForPosition(position: string): string | null {
  const p = (position || '').trim().toLowerCase();
  if (!p) return null;
  if (isCpmSupervisorTitle(p)) return 'cpm-supervisor';
  if (p === 'cpm' || p.includes('cpm')) return 'cpm';
  if (isInspectionSupervisorTitle(p)) return 'supervisor-inspector';
  if (p.includes('inspector')) return 'inspector';
  if (p.includes('property manager')) return 'property-manager';
  if (p.startsWith('superintendent')) return 'superintendent';
  if (p.includes('director')) return 'director';
  if (p.includes('maintenance')) return 'maintenance';
  if (p.includes('technician') || p === 'tech') return 'technician';
  return null;
}

// HPD / DOB Lookup access by trade (control panel). Stored as lookup.<trade>
// inside features.modules; every trade is ON unless switched off.
const LOOKUP_TRADES: Array<{ key: string; label: string }> = [
  { key: 'superintendent', label: 'Superintendent' },
  { key: 'maintenance', label: 'Maintenance Worker' },
  { key: 'plumber', label: 'Plumber' },
  { key: 'electrician', label: 'Electrician' },
  { key: 'carpenter', label: 'Carpenter' },
  { key: 'painter', label: 'Painter' },
  { key: 'mason', label: 'Mason / Bricklayer' },
  { key: 'roofer', label: 'Roofer' },
  { key: 'heating', label: 'Heating / Boiler' },
  { key: 'elevator', label: 'Elevator Mechanic' },
  { key: 'exterminator', label: 'Exterminator' },
  { key: 'worker', label: 'Other workers' },
  { key: 'emergency', label: 'Emergency Crew' },
  { key: 'inspector', label: 'Inspector' },
  { key: 'supervisor-inspector', label: 'Supervisor Inspector' },
  { key: 'cpm', label: 'CPM' },
  { key: 'cpm-supervisor', label: 'CPM Supervisor' },
  { key: 'property-manager', label: 'Property Manager' },
  { key: 'director', label: 'Director' },
  { key: 'supervisor', label: 'Other supervisors / management' },
  { key: 'administrator', label: 'Administrator' },
  { key: 'community', label: 'Community Coordinator' }, // FIAREP shows this as FIAREP Services
];

/** Which lookup-access switch applies to a person, from their title (and role as a fallback). */
export function lookupTradeFor(position: string, role: string): string {
  const p = (position || '').trim().toLowerCase();
  const r = (role || '').trim().toLowerCase();
  // An administrator answers to the Administrator switch, whatever the title.
  if (r === 'administrator') return 'administrator';
  if (r === 'community_coordinator' || p.includes('community coordinator') || p.includes('fiarep services')) return 'community';
  if (p.includes('cpm supervisor') || p.includes('cpm-supervisor')) return 'cpm-supervisor';
  if (p === 'cpm' || p.includes('cpm')) return 'cpm';
  if (p.includes('supervisor') && p.includes('inspect')) return 'supervisor-inspector';
  if (p.includes('inspector')) return 'inspector';
  if (p.includes('property manager')) return 'property-manager';
  if (p.includes('director')) return 'director';
  if (p.includes('superintendent') || p === 'super') return 'superintendent';
  if (p.includes('plumb')) return 'plumber';
  if (p.includes('electric')) return 'electrician';
  if (p.includes('carpent')) return 'carpenter';
  if (p.includes('paint')) return 'painter';
  if (p.includes('mason') || p.includes('brick') || p.includes('concrete')) return 'mason';
  if (p.includes('roof')) return 'roofer';
  if (p.includes('heat') || p.includes('boiler') || p.includes('hvac')) return 'heating';
  if (p.includes('elevator')) return 'elevator';
  if (p.includes('exterm') || p.includes('pest')) return 'exterminator';
  if (p.includes('maintenance') || p.includes('caretaker')) return 'maintenance';
  if (p.includes('technician') || p === 'tech') return 'technician';
  if (r === 'emergency') return 'emergency';
  if (r === 'administrator') return 'administrator';
  if (r === 'management') return 'supervisor';
  if (r === 'inspector') return 'inspector';
  return 'worker';
}
void LOOKUP_TRADES;

export function moduleEnabled(module: ModuleId, config: ModuleConfig | null = cached): boolean {
  const modulesMap = config?.features?.modules || {};
  // A person's own module switch (p.<staff id>.module.<module>, as on the website) wins.
  const own = cachedStaffId ? modulesMap[`p.${cachedStaffId}.module.${module}`] : undefined;
  if (typeof own === 'boolean') return own;
  const value = modulesMap[module];
  // HPD / DOB lookup: the client switch, then the per-trade switch for this
  // person's title (Platform -> Modules -> "HPD / DOB Lookup by trade").
  if (module === 'property-lookup') {
    if (value === false) return false;
    return modulesMap['lookup.' + lookupTradeFor(cachedPosition, cachedRole)] !== false;
  }
  if (OPT_IN_MODULES.has(module)) {
    if (value !== true) return false;
    // Per-user project-tool assignment: if any worker is individually assigned
    // this project tool, only assigned workers get it; otherwise it stays at the
    // client-level toggle. (projtool.<staffId>.<toolId> keys from the control panel.)
    if (typeof module === 'string' && module.startsWith('proj-')) {
      const anyAssigned = Object.keys(modulesMap).some(
        (k) => k.startsWith('projtool.') && k.endsWith('.' + module) && modulesMap[k] === true,
      );
      if (anyAssigned) { const role = projectRoleForPosition(cachedPosition); return !!role && modulesMap['projtool.' + role + '.' + module] === true; }
    }
    return true;
  }
  return value !== false;
}

/**
 * Read-only locks (Platform Control -> Module Management -> Read-only locks).
 * A lock is OFF unless switched on: with it off, nobody is blocked by it.
 */
export type LockKey = 'appViewOnly' | 'defaultRatesDirectorOnly' | 'adminProjectsViewOnly' | 'approvedInspection' | 'reportsOtherDevelopments' | 'tradeSupWaitForSend';
export function lockOnCached(key: LockKey): boolean {
  return cached?.features?.modules?.['lock.' + key] === true;
}
export async function lockOn(key: LockKey): Promise<boolean> {
  const c = await loadModuleConfig().catch(() => null);
  return c?.features?.modules?.['lock.' + key] === true;
}

export async function loadModuleConfig(): Promise<ModuleConfig | null> {
  const key = await settingKey();
  if (cached && cachedOwner === key) return cached;
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
    cached = row?.value ? JSON.parse(row.value) as ModuleConfig : null;
    cachedOwner = key;
    const sites = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', 'sites:' + key);
    if (sites?.value) { const s = JSON.parse(sites.value) as { sites: string[]; nycha: boolean }; setSiteNames(s.sites || [], s.nycha !== false); }
  } catch { /* missing cache is intentionally enabled */ }
  return cached;
}

/** The company's developments and buildings for every "where" picker (developments and regular addresses). */
async function refreshSites(key: string): Promise<void> {
  try {
    const s = await customFetch<{ sites: string[]; nycha: boolean }>('/api/v1/sites', { responseType: 'json' });
    setSiteNames(Array.isArray(s?.sites) ? s.sites : [], s?.nycha !== false);
    const d = await db();
    await d.runAsync('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'sites:' + key, JSON.stringify(s));
  } catch { /* offline: keep what was loaded */ }
}

/** Fetch the tenant policy after authentication and retain it for offline navigation. */
export async function refreshModuleConfig(): Promise<ModuleConfig | null> {
  try {
    const config = await customFetch<ModuleConfig>('/api/v1/auth/organization-config', { responseType: 'json' });
    const d = await db();
    const key = await settingKey();
    await d.runAsync(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      JSON.stringify(config),
    );
    cached = config;
    cachedOwner = key;
    await refreshSites(key);
    return config;
  } catch {
    return loadModuleConfig();
  }
}

/** Re-read the control panel on mount AND every time the app is brought back
 *  to the front. A switch flipped on fiarep.com used to need the app killed
 *  and reopened before it took: the fetch ran once, when the hook mounted, and
 *  the home screen mounts once for the life of the app. */
function useLiveModuleConfig(): ModuleConfig | null {
  const [config, setConfig] = useState<ModuleConfig | null>(cached);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      loadModuleConfig().then((c) => { if (alive) setConfig(c); }).catch(() => undefined);
      refreshModuleConfig().then((c) => { if (alive) setConfig(c); }).catch(() => undefined);
    };
    pull();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') pull(); });
    return () => { alive = false; sub.remove(); };
  }, []);
  return config;
}

export function useModuleAccess(): Record<string, boolean> {
  const config = useLiveModuleConfig();
  return new Proxy({}, { get: (_target, key: string) => moduleEnabled(key as ModuleId, config) }) as Record<string, boolean>;
}

// Raw features.modules map (values exactly as saved). Use for opt-in keys such
// as the per-trade measurement switches (meas.<trade>.<material>), which must be
// read as `=== true` rather than through the default-on module proxy.
export function useRawModules(): Record<string, boolean> {
  // Cached copy first, live control-panel settings straight after, and again
  // whenever the app comes back to the front.
  const cfg = useLiveModuleConfig();
  return (cfg?.features?.modules || {}) as Record<string, boolean>;
}

const ROUTE_MODULES: Array<[string, ModuleId]> = [
  ['/hud-', 'hud-inspections'], ['/violation-', 'violations'], ['/inspector-violations', 'violations'], ['/my-inspections', 'violations'],
  ['/create-report', 'inspection-create'], ['/report-detail', 'reports'], ['/worker', 'my-jobs'],
  ['/my-jobs', 'my-jobs'], ['/change-orders', 'change-orders'], ['/cpm-change-order', 'change-orders'],
  ['/scope-submit', 'scope-writing'], ['/scope-', 'scope-review'], ['/dispatch-job', 'trade-requests'], ['/in-house-assignments', 'trade-requests'],
  ['/assign-route', 'calendar'], ['/leave-', 'leave'], ['/attendance', 'calendar'],
  ['/notifications', 'notifications'], ['/settings', 'settings'], ['/contractor-scores', 'scores'], ['/translator', 'translator'],
  ['/dev-scores', 'scores'], ['/property-scores', 'scores'], ['/truck-scores', 'scores'],
  ['/elevator-', 'elevators'], ['/project/elevator', 'elevators'], ['/emergency-', 'emergency'],
  ['/manage-trucks', 'emergency'], ['/assign-emergency', 'emergency'], ['/management', 'complaint-dashboard'],
  ['/manage-requests', 'complaint-dashboard'], ['/resident', 'complaint-dashboard'],
  ['/admin-job', 'projects'], ['/?new=', 'projects'], ['/project', 'projects'],
  ['/index', 'projects'], ['/estimate', 'estimates'], ['/procurement', 'procurement'],
  ['/measurement', 'measurement'],
];

export function moduleForRoute(path: string): ModuleId | null {
  const entry = ROUTE_MODULES.find(([prefix]) => (
    prefix === '/management'
      ? path === prefix
      : path.startsWith(prefix) || path.includes(prefix)
  ));
  return entry?.[1] || null;
}

// ── App tabs: every tile on every home screen can be switched off from the
// control panel (features.modules["apptab.<slug>"] === false hides it).
// Keyed PER SCREEN ("apptab.<screen>.<slug>") so switching Attendance off on
// the worker screen leaves it on for management, and vice versa.
export type AppTabScreen = 'management' | 'admin' | 'cpm' | 'tech' | 'worker' | 'community' | 'resident' | 'vendor';
export const appTabKey = (screen: AppTabScreen, label: string): string =>
  'apptab.' + screen + '.' + label.replace(/\s*\(\d+\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** This person's own switch for a home button (Platform Control → App tabs → pick the person): true, false, or unset. */
export function personTile(screen: AppTabScreen, label: string, raw: Record<string, boolean> | null | undefined): boolean | undefined {
  if (!cachedStaffId) return undefined;
  const v = (raw || {})[`p.${cachedStaffId}.${appTabKey(screen, label)}`];
  return typeof v === 'boolean' ? v : undefined;
}
/** A button this person's own switch turns on: shown even where the company's switch or module is off. */
export const personTileOn = (screen: AppTabScreen, label: string, raw: Record<string, boolean> | null | undefined): boolean => personTile(screen, label, raw) === true;

export function tileEnabled(screen: AppTabScreen, label: string, raw: Record<string, boolean> | null | undefined): boolean {
  const map = raw || {};
  // A person's own switch wins over everything else.
  const own = personTile(screen, label, map);
  if (own !== undefined) return own;
  // FIAREP Smart Repair Instructions has a master switch over every screen's tile.
  if (label === 'Smart Repair' && map['smartRepair'] === false) return false;
  if (label === 'Priority Queue' && map['priorityEngine'] === false) return false;
  // Door Visits module (Platform Control → Modules) is the master switch over every screen's Door Visit button.
  if (label === 'Door Visit' && map['door-visits'] === false) return false;
  const value = map[appTabKey(screen, label)];
  // Technician switches not saved yet fall back to the CPM / Inspector ones
  // they were split from, so a technician's home does not change on its own.
  if (screen === 'tech' && value === undefined) return map[appTabKey('cpm', label)] !== false;
  return value !== false;
}

export function moduleForTile(label: string): ModuleId | null {
  const value = label.replace(/\s*\(\d+\)\s*$/, '');
  const modules: Record<string, ModuleId> = {
    'HUD Inspections': 'hud-inspections', 'Send Violation': 'violations',
    'Inspection Approvals': 'hud-inspections', 'Projects / Inspections': 'projects',
    'Add Job for Mgmt': 'projects', '+ New Project': 'projects', 'Assign a Job': 'trade-requests',
    'In-house assignments': 'trade-requests', 'Staff Member Jobs': 'my-jobs', 'Worker Jobs': 'my-jobs',
    'Assign Emergency Unit': 'emergency', 'Manage Trucks': 'emergency', 'Emergency Units': 'emergency',
    'Truck Scores': 'scores', 'Emergency Activity': 'emergency', 'Change Orders': 'change-orders',
    'Vendor Score': 'scores', 'Development Scores': 'scores', 'Building & Residential Scores': 'scores',
    'Manage All Requests': 'complaint-dashboard', 'Resident Reports': 'complaint-dashboard',
    'Review Reports': 'complaint-dashboard', 'Create Report': 'inspection-create',
    'CPM Supervisor': 'scope-review', 'CPM Supervisor Scope Review': 'scope-review',
    'Elevator Dashboard': 'elevators', 'Default rates': 'settings', 'Inbox': 'notifications',
    'Request Time Off': 'leave', 'Leave Calendar': 'leave', 'Attendance': 'calendar',
    'Audit Log': 'reports', 'Assign Route': 'calendar', 'Measurement': 'measurement', 'My Inspections': 'violations',
  };
  return modules[value] || null;
}