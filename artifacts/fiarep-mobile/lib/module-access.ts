import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { db, getSessionIdentity } from './store';

export type ModuleId =
  | 'dashboard' | 'inspections' | 'inspection-create' | 'estimates' | 'repairs'
  | 'projects' | 'reports' | 'report-upload' | 'calendar' | 'clients' | 'team'
  | 'violations' | 'procurement' | 'scope-review' | 'scope-writing' | 'emergency'
  | 'change-orders' | 'scores' | 'elevators' | 'leave' | 'hr' | 'notifications'
  | 'settings' | 'shared-data' | 'hud-inspections' | 'trade-requests' | 'my-jobs'
  | 'complaint-dashboard' | 'measurement'
  // Per-tool, per-client construction-PM switches (all opt-in / OFF by default).
  | 'proj-new' | 'proj-room' | 'proj-rates' | 'proj-checklist' | 'proj-inspection'
  | 'proj-estimate' | 'proj-scope' | 'proj-intake' | 'proj-elevator'
  | 'proj-photos' | 'proj-scans' | 'proj-roofplan' | 'proj-compass';

export type ModuleConfig = { propertyLimit?: number; features?: { modules?: Record<string, boolean> } };
let cached: ModuleConfig | null = null;
let cachedStaffId = '';
let cachedPosition = '';
let cachedOwner = '';

async function settingKey(): Promise<string> {
  const identity = await getSessionIdentity();
  cachedStaffId = identity?.staffId || cachedStaffId;
  cachedPosition = identity?.position || cachedPosition;
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
  if (p.includes('cpm supervisor')) return 'cpm-supervisor';
  if (p === 'cpm' || p.includes('cpm')) return 'cpm';
  if (p.includes('supervisor inspector')) return 'supervisor-inspector';
  if (p.includes('inspector')) return 'inspector';
  if (p.includes('property manager')) return 'property-manager';
  if (p.startsWith('superintendent')) return 'superintendent';
  if (p.includes('director')) return 'director';
  if (p.includes('maintenance')) return 'maintenance';
  return null;
}

export function moduleEnabled(module: ModuleId, config: ModuleConfig | null = cached): boolean {
  const modulesMap = config?.features?.modules || {};
  const value = modulesMap[module];
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

export async function loadModuleConfig(): Promise<ModuleConfig | null> {
  const key = await settingKey();
  if (cached && cachedOwner === key) return cached;
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
    cached = row?.value ? JSON.parse(row.value) as ModuleConfig : null;
    cachedOwner = key;
  } catch { /* missing cache is intentionally enabled */ }
  return cached;
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
    return config;
  } catch {
    return loadModuleConfig();
  }
}

export function useModuleAccess(): Record<string, boolean> {
  const [config, setConfig] = useState<ModuleConfig | null>(cached);
  useEffect(() => { loadModuleConfig().then(setConfig).catch(() => undefined); }, []);
  return new Proxy({}, { get: (_target, key: string) => moduleEnabled(key as ModuleId, config) }) as Record<string, boolean>;
}

// Raw features.modules map (values exactly as saved). Use for opt-in keys such
// as the per-trade measurement switches (meas.<trade>.<material>), which must be
// read as `=== true` rather than through the default-on module proxy.
export function useRawModules(): Record<string, boolean> {
  const [cfg, setCfg] = useState<ModuleConfig | null>(cached);
  useEffect(() => { loadModuleConfig().then(setCfg).catch(() => undefined); }, []);
  return (cfg?.features?.modules || {}) as Record<string, boolean>;
}

const ROUTE_MODULES: Array<[string, ModuleId]> = [
  ['/hud-', 'hud-inspections'], ['/violation-', 'violations'], ['/inspector-violations', 'violations'],
  ['/create-report', 'inspection-create'], ['/report-detail', 'reports'], ['/worker', 'my-jobs'],
  ['/my-jobs', 'my-jobs'], ['/change-orders', 'change-orders'], ['/cpm-change-order', 'change-orders'],
  ['/scope-submit', 'scope-writing'], ['/scope-', 'scope-review'], ['/dispatch-job', 'trade-requests'], ['/in-house-assignments', 'trade-requests'],
  ['/assign-route', 'calendar'], ['/leave-', 'leave'], ['/attendance', 'calendar'],
  ['/notifications', 'notifications'], ['/settings', 'settings'], ['/contractor-scores', 'scores'],
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
    'Audit Log': 'reports', 'Assign Route': 'calendar', 'Measurement': 'measurement',
  };
  return modules[value] || null;
}