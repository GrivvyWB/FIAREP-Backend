import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  bootstrapAdministrator as bootstrapAdministratorOnServer,
  createStaff,
  getBootstrapStatus,
  getCurrentStaff,
  lookupPublicResidentReports,
  lookupPublicVendorScope,
  listStaff,
  login as loginOnServer,
  logout as logoutOnServer,
  refreshSession,
  registerDeviceToken,
  submitPublicResidentReport,
  submitPublicVendorBid,
  unregisterDeviceToken,
  setAuthTokenGetter,
  setAuthRefreshHandler,
  setBaseUrl,
  type AuthResponse,
  type Staff,
} from '@workspace/api-client-react';
import type { Rates } from './takeoff';
import type { LineItem } from './catalog';
import { touchMeta, getDeviceId, newMeta } from './syncmeta';
import { DEVELOPMENT_NAMES } from './developments.seed';
import { ensureQueue, recoverLegacyQueue } from './queue';
import { hydrateRemotePhotosFromDb } from './photoResolver';
async function rotateActorCache(staff: Staff) {
  const d = await db();
  const fingerprint = `${staff.tenantId || ''}:${staff.id}:${[...(staff.developments || [])].sort().join('|')}`;
  const prior = await d.getFirstAsync('SELECT value FROM settings WHERE key=?', 'cache_fingerprint') as { value: string } | null;
  if (prior?.value && prior.value !== fingerprint) {
    for (const table of ['projects','rooms','checklists','roofplans','inspections','cost_estimates','intakes','elevators','resident_reports','violations','building_violations','priority_violations','route_assignments','procurement','procurement_bids','vendor_contacts','vendor_quotes','change_orders','elevator_jobs','emergency_jobs','emergency_units','leave_requests']) {
      try { await d.runAsync(`DELETE FROM ${table}`); } catch {}
    }
  }
  await d.runAsync("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", 'cache_fingerprint', fingerprint);
}

const backendDomain = process.env.EXPO_PUBLIC_DOMAIN;
setBaseUrl(backendDomain ? `https://${backendDomain}` : null);
setAuthTokenGetter(() => getAccessToken());
setAuthRefreshHandler(() => refreshAccessToken());

async function withMeta(d: any, state: any): Promise<any> {
  const deviceId = await getDeviceId(d);
  const prev = (state && state._meta) ? state._meta : undefined;
  return { ...(state ?? {}), _meta: touchMeta(prev, deviceId) };
}


export type Project = { id: string; name: string; client: string; createdAt: string; rates?: Rates | null };
export type Room = { id: string; projectId: string; name: string; unit?: string; lines: LineItem[]; photos?: string[]; walls2d?: { x1:number; y1:number; x2:number; y2:number }[]; scan?: any; remoteFiles?: any[] };

let _db: SQLite.SQLiteDatabase | null = null;
let _dbInit: Promise<SQLite.SQLiteDatabase> | null = null;
let _refreshInFlight: Promise<string | null> | null = null;
let _refreshing = false;
let _syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync(): void {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    import('./sync')
      .then(({ syncAllEntities }) => syncAllEntities())
      .catch(() => undefined);
  }, 150);
}
export function tokenExpiryMs(token: string): number | null {
  try {
    const part = token.split('.')[1] || '';
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4);
    const payload = JSON.parse(typeof atob === 'function' ? atob(normalized) : '');
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch { return null; }
}
export function isRoleAuthorized(staff: Pick<Staff, 'role'>, requested: string): boolean {
  return staff.role === requested;
}
export async function db() {
  if (_db) return _db;
  if (_dbInit) return _dbInit;
  _dbInit = (async () => {
  const database = await SQLite.openDatabaseAsync('construction.db');
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, client TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS global_settings (
      id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checklists (
      projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS roofplans (
      projectId TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL
    );
  `);
  // One-time migration: the rooms table changed from a scan-based schema to a
  // line-item schema. If an old rooms table exists without a 'lines' column,
  // drop it once so the new schema is created clean.
  try {
    const cols = await database.getAllAsync<{ name: string }>("PRAGMA table_info(rooms)");
    const hasRooms = cols.length > 0;
    const hasLines = cols.some(c => c.name === 'lines');
    if (hasRooms && !hasLines) { await database.execAsync('DROP TABLE rooms'); }
  } catch (e) { /* no rooms table yet */ }
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY NOT NULL, projectId TEXT NOT NULL, name TEXT NOT NULL, unit TEXT, lines TEXT NOT NULL, photos TEXT, walls2d TEXT, remoteFiles TEXT
    );
  `);
  try { await database.execAsync('ALTER TABLE rooms ADD COLUMN unit TEXT'); } catch (e) {}
  try { await database.execAsync('ALTER TABLE rooms ADD COLUMN photos TEXT'); } catch (e) {}
  try { await database.execAsync('ALTER TABLE rooms ADD COLUMN walls2d TEXT'); } catch (e) {}
  try { await database.execAsync('ALTER TABLE rooms ADD COLUMN scan TEXT'); } catch (e) {}
  try { await database.execAsync('ALTER TABLE rooms ADD COLUMN remoteFiles TEXT'); } catch (e) {}
  try { await database.execAsync('ALTER TABLE projects ADD COLUMN rates TEXT'); } catch (e) { /* exists */ }
  try { await database.execAsync('ALTER TABLE projects ADD COLUMN meta TEXT'); } catch (e) {}
  _db = database;
  return database;
  })();
  try {
    return await _dbInit;
  } finally {
    if (!_db) _dbInit = null;
  }
}
async function queueMutation(entity: string, id: string, state: any, operation: 'upsert' | 'delete' = 'upsert', baseVersion?: number) {
  const d = await db();
  await ensureQueue(d);
  const identityRow = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', 'session_identity');
  let owner = 'legacy';
  try { const i = identityRow ? JSON.parse(identityRow.value) : null; owner = `${i?.tenantId || 'default'}:${i?.staffId || ''}`; } catch {}
  let version = baseVersion ?? (Number(state?._meta?.serverVersion || state?.meta?.serverVersion || state?.scan?._meta?.serverVersion || 0) || null);
  if (!version && operation === 'delete') {
    const tables: Record<string, string> = {
      projects: 'projects', rooms: 'rooms', inspections: 'inspections',
      'cost-estimates': 'cost_estimates', 'resident-reports': 'resident_reports',
      violations: 'violations', 'building-violations': 'building_violations',
      'priority-violations': 'priority_violations', 'elevator-jobs': 'elevator_jobs',
      'emergency-jobs': 'emergency_jobs', 'emergency-units': 'emergency_units',
      'leave-requests': 'leave_requests', procurement: 'procurement',
      'procurement-bids': 'procurement_bids', 'vendor-contacts': 'vendor_contacts',
      'vendor-quotes': 'vendor_quotes', 'change-orders': 'change_orders',
      'route-assignments': 'route_assignments',
    };
    const table = tables[entity];
    if (table) {
      const valueColumn = table === 'projects' ? 'meta' : table === 'rooms' ? 'scan' : table === 'roofplans' ? 'data' : 'state';
      const keyColumn = table === 'vendor_quotes' ? 'key' : table.includes('project') || ['inspections', 'cost_estimates', 'intakes', 'elevators', 'checklists', 'roofplans'].includes(table) ? 'projectId' : 'id';
      const row = await d.getFirstAsync<any>(`SELECT ${valueColumn} AS value FROM ${table} WHERE ${keyColumn}=? LIMIT 1`, id).catch(() => null);
      try {
        const old = row?.value ? JSON.parse(row.value) : null;
        version = Number(old?._meta?.serverVersion || old?.meta?.serverVersion || 0) || null;
      } catch {}
    }
  }
  await d.runAsync(
    `INSERT INTO sync_queue(entity,id,state,operation,baseVersion,owner,status) VALUES(?,?,?,?,?,?,'pending')
     ON CONFLICT(owner,entity,id) DO UPDATE SET state=excluded.state,operation=excluded.operation,
     baseVersion=excluded.baseVersion,owner=excluded.owner,status='pending',error=NULL`,
    entity, id, state == null ? null : JSON.stringify(state), operation, version, owner,
  );
  scheduleSync();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function rowToProject(r: any): Project {
  return { id: r.id, name: r.name, client: r.client, createdAt: r.createdAt, rates: r.rates ? JSON.parse(r.rates) : null, _meta: r.meta ? JSON.parse(r.meta) : undefined } as any;
}

export async function listProjects(): Promise<Project[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>('SELECT * FROM projects ORDER BY createdAt DESC');
  return rows.map(rowToProject);
}
export async function createProject(name: string, client: string, _meta: Record<string, any> = {}, development?: string): Promise<Project> {
  const d = await db();
  const meta = await newMeta(d);
  const actor = await getCurrentActor();
  const metaWithOwner = { ..._meta, ownerName: (actor.name || '').trim(), ownerRole: actor.role || 'inspector' };
  const devRow = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', 'auth_developments');
  let developments: string[] = [];
  try {
    developments = devRow?.value ? JSON.parse(devRow.value) : [];
  } catch { developments = []; }
  if (development) (metaWithOwner as any).development = development;
  else if (developments.length === 1) (metaWithOwner as any).development = developments[0];
  else if (developments.length > 1) throw new Error('Select a development for this project.');
  const p: Project = { id: uid(), name, client, createdAt: new Date().toISOString(), rates: null };
  await d.runAsync('INSERT INTO projects (id,name,client,createdAt,meta) VALUES (?,?,?,?,?)', p.id, p.name, p.client, p.createdAt, JSON.stringify(metaWithOwner));
  await queueMutation('projects', p.id, { ...p, meta: metaWithOwner });
  return p;
}

// Supervisor dispatches a job to an inspector: create project from address + assign (auto-notifies inspector).
export async function dispatchJob(address: string, unit: string, inspectorName: string, development?: string): Promise<Project> {
  const name = unit.trim() ? address.trim() + ' \u00b7 ' + unit.trim() : address.trim();
  const proj = await createProject(name, '', {}, development);
  if (inspectorName.trim()) { await assignProjectInspector(proj.id, inspectorName.trim()); }
  return proj;
}

// Read the owner (inspector) name stored in a project's meta, if any.
export async function getProjectOwner(projectId: string): Promise<string | null> {
  const d = await db();
  try {
    const row = await d.getFirstAsync<{ meta: string }>('SELECT meta FROM projects WHERE id = ?', projectId);
    if (!row || !row.meta) return null;
    const m = JSON.parse(row.meta);
    return (m && m.ownerName) ? m.ownerName : null;
  } catch { return null; }
}

// Assign a project to a specific inspector (stored in project meta).
export async function assignProjectInspector(projectId: string, inspectorName: string): Promise<void> {
  const d = await db();
  try {
    const row = await d.getFirstAsync<{ meta: string }>('SELECT meta FROM projects WHERE id = ?', projectId);
    let m: any = {};
    if (row && row.meta) { try { m = JSON.parse(row.meta); } catch {} }
    m.assignedInspector = (inspectorName || '').trim();
    await d.runAsync('UPDATE projects SET meta = ? WHERE id = ?', JSON.stringify(m), projectId);
    const updated = await getProject(projectId);
    if (updated) await queueMutation('projects', projectId, updated);
    const a = await getCurrentActor();
    await logAudit(a.role || 'management', a.name, 'Assigned to project', inspectorName.trim(), 'proj:' + projectId);
    // Notify the assigned inspector that they've been given the project.
    const proj = await getProject(projectId);
    if (inspectorName.trim()) { await addNotification(inspectorName.trim(), 'New assignment', (proj ? proj.name : 'Project'), 'proj:' + projectId); }
  } catch {}
}

// Inspector submits a project for supervisor review -> notifies management + administrator.
export async function submitProjectForReview(projectId: string): Promise<void> {
  const d = await db();
  try {
    const row = await d.getFirstAsync<{ meta: string }>('SELECT meta FROM projects WHERE id = ?', projectId);
    let m: any = {};
    if (row && row.meta) { try { m = JSON.parse(row.meta); } catch {} }
    m.status = 'submitted';
    await d.runAsync('UPDATE projects SET meta = ? WHERE id = ?', JSON.stringify(m), projectId);
    const updated = await getProject(projectId);
    if (updated) await queueMutation('projects', projectId, updated);
    const a = await getCurrentActor();
    const proj = await getProject(projectId);
    const detail = (proj ? proj.name : 'Project') + (a.name ? ' \u00b7 ' + a.name : '');
    await logAudit(a.role || 'inspector', a.name, 'Inspection submitted for review', detail, 'proj:' + projectId);
    await addNotification('management', 'Inspection submitted for review', detail, 'proj:' + projectId);
    await addNotification('administrator', 'Inspection submitted for review', detail, 'proj:' + projectId);
  } catch {}
}

export async function getProjectInspector(projectId: string): Promise<string | null> {
  const d = await db();
  try {
    const row = await d.getFirstAsync<{ meta: string }>('SELECT meta FROM projects WHERE id = ?', projectId);
    if (!row || !row.meta) return null;
    const m = JSON.parse(row.meta);
    return (m && m.assignedInspector) ? m.assignedInspector : null;
  } catch { return null; }
}
export async function getProject(id: string): Promise<Project | null> {
  const d = await db();
  const r = await d.getFirstAsync<any>('SELECT * FROM projects WHERE id = ?', id);
  return r ? rowToProject(r) : null;
}
export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  await queueMutation('projects', id, null, 'delete');
  await d.runAsync('DELETE FROM rooms WHERE projectId = ?', id);
  await d.runAsync('DELETE FROM projects WHERE id = ?', id);
}

export async function listRooms(projectId: string): Promise<Room[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>('SELECT * FROM rooms WHERE projectId = ? ORDER BY rowid ASC', projectId);
  return rows.map((r:any) => ({ id: r.id, projectId: r.projectId, name: r.name, unit: r.unit || '', lines: JSON.parse(r.lines), photos: r.photos ? JSON.parse(r.photos) : [], walls2d: r.walls2d ? JSON.parse(r.walls2d) : [], scan: r.scan ? JSON.parse(r.scan) : null, remoteFiles: r.remoteFiles ? JSON.parse(r.remoteFiles) : [] }));
}
export async function getRoom(id: string): Promise<Room | null> {
  const d = await db();
  const r = await d.getFirstAsync<any>('SELECT * FROM rooms WHERE id = ?', id);
  return r ? { id: r.id, projectId: r.projectId, name: r.name, unit: r.unit || '', lines: JSON.parse(r.lines), photos: r.photos ? JSON.parse(r.photos) : [], walls2d: r.walls2d ? JSON.parse(r.walls2d) : [], scan: r.scan ? JSON.parse(r.scan) : null, remoteFiles: r.remoteFiles ? JSON.parse(r.remoteFiles) : [] } : null;
}
// Throws if a project is approved (locked). Called by every project-content mutator so that
// no screen can edit an approved inspection, regardless of UI gating. Review reversal is exempt.
async function assertProjectUnlocked(projectId: string): Promise<void> {
  if (await isProjectApproved(projectId)) {
    throw new Error('This inspection is approved and locked. Editing is disabled.');
  }
}

export async function addRoom(projectId: string, name: string, lines: LineItem[], photos: string[] = [], walls2d: any[] = [], unit: string = '', scan: any = null): Promise<Room> {
  const d = await db();
  const scanWithMeta = { ...(scan ?? {}), _meta: await newMeta(d) };
  await assertProjectUnlocked(projectId);
  const room: Room = { id: uid(), projectId, name, unit, lines, photos, walls2d, scan: scanWithMeta };
  await d.runAsync('INSERT INTO rooms (id,projectId,name,unit,lines,photos,walls2d,scan) VALUES (?,?,?,?,?,?,?,?)', room.id, projectId, name, unit, JSON.stringify(lines), JSON.stringify(photos), JSON.stringify(walls2d), JSON.stringify(scanWithMeta));
  await queueMutation('rooms', room.id, { ...room, scan: scanWithMeta });
  // Keep the local URI in photos for offline/PDF use, while opportunistically
  // recording authenticated remote object metadata for the next sync.
  if (photos.length) {
    const { uploadPhoto } = await import('./photos');
    const remoteFiles: any[] = [];
    for (const photo of photos) {
      try { remoteFiles.push({ ...(await uploadPhoto(photo, 'room-photo')), localUri: photo }); } catch { /* retry remains local */ }
    }
    if (remoteFiles.length) {
      const updatedScan = { ...scanWithMeta, remoteFiles };
      await d.runAsync('UPDATE rooms SET scan=?,remoteFiles=? WHERE id=?', JSON.stringify(updatedScan), JSON.stringify(remoteFiles), room.id);
    }
  }
  return room;
}
export async function updateRoom(id: string, name: string, lines: LineItem[], photos: string[] = [], walls2d: any[] = [], unit: string = '', scan: any = null): Promise<void> {
  const d = await db();
  const deviceId = await getDeviceId(d);
  const prevMeta = (scan && scan._meta) ? scan._meta : undefined;
  const scanWithMeta = { ...(scan ?? {}), _meta: touchMeta(prevMeta, deviceId) };
  await d.runAsync('UPDATE rooms SET name = ?, unit = ?, lines = ?, photos = ?, walls2d = ?, scan = ? WHERE id = ?', name, unit, JSON.stringify(lines), JSON.stringify(photos), JSON.stringify(walls2d), JSON.stringify(scanWithMeta), id);
  const updated = await getRoom(id);
  if (updated) await queueMutation('rooms', id, updated);
}
export async function deleteRoom(id: string): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ projectId: string }>('SELECT projectId FROM rooms WHERE id = ?', id);
  if (row?.projectId) await assertProjectUnlocked(row.projectId);
  await queueMutation('rooms', id, null, 'delete');
  await d.runAsync('DELETE FROM rooms WHERE id = ?', id);
}

export async function setProjectRates(projectId: string, rates: Rates | null): Promise<void> {
  await assertProjectUnlocked(projectId);
  const d = await db();
  await d.runAsync('UPDATE projects SET rates = ? WHERE id = ?', rates ? JSON.stringify(rates) : null, projectId);
  const p = await getProject(projectId);
  if (p) await queueMutation('projects', projectId, p);
}
export async function getGlobalRates(): Promise<Rates> {
  const d = await db();
  const shared = await d.getFirstAsync<{ state: string }>(
    'SELECT state FROM global_settings WHERE id=?',
    'default-rates',
  );
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'rates');
  const { DEFAULT_RATES } = await import('./takeoff');
  if (shared?.state) return { ...DEFAULT_RATES, ...JSON.parse(shared.state) };
  return row ? { ...DEFAULT_RATES, ...JSON.parse(row.value) } : DEFAULT_RATES;
}
export async function setGlobalRates(rates: Rates): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'rates', JSON.stringify(rates));
  await d.runAsync(
    'INSERT INTO global_settings (id,state) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state',
    'default-rates',
    JSON.stringify(rates),
  );
  await queueMutation('global-settings', 'default-rates', rates);
}


export async function getChecklist(projectId: string): Promise<Record<string, { done: boolean; note?: string }>> {
  const d = await db();
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM checklists WHERE projectId = ?', projectId);
  return row ? JSON.parse(row.state) : {};
}
export async function setChecklist(projectId: string, state: Record<string, { done: boolean; note?: string }>): Promise<void> {
  await assertProjectUnlocked(projectId);
  const d = await db();
  await d.runAsync('INSERT INTO checklists (projectId,state) VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET state = excluded.state', projectId, JSON.stringify(await withMeta(d, state)));
  await queueMutation('checklists', projectId, await withMeta(d, state));
}

export async function getRoofPlan(projectId: string): Promise<any | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ data: string }>('SELECT data FROM roofplans WHERE projectId = ?', projectId);
  return row ? JSON.parse(row.data) : null;
}
export async function setRoofPlan(projectId: string, data: any): Promise<void> {
  await assertProjectUnlocked(projectId);
  const d = await db();
  const next = await withMeta(d, data);
  await d.runAsync('INSERT INTO roofplans (projectId,data) VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET data = excluded.data', projectId, JSON.stringify(next));
  await queueMutation('roofplans', projectId, next);
}

export async function getInspection(projectId: string): Promise<any> {
  const d = await db();
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS inspections (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM inspections WHERE projectId = ?', projectId);
  return row ? JSON.parse(row.state) : {};
}
export async function setInspection(projectId: string, state: any): Promise<void> {
  await assertProjectUnlocked(projectId);
  const d = await db();
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS inspections (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
  const next = await withMeta(d, state);
  await d.runAsync('INSERT INTO inspections (projectId,state) VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET state = excluded.state', projectId, JSON.stringify(next));
  await queueMutation('inspections', projectId, next);
}

export async function getCostEstimate(projectId: string): Promise<any> {
  const d = await db();
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS cost_estimates (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM cost_estimates WHERE projectId = ?', projectId);
  return row ? JSON.parse(row.state) : null;
}
export async function setCostEstimate(projectId: string, state: any): Promise<void> {
  await assertProjectUnlocked(projectId);
  const d = await db();
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS cost_estimates (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
  const next = await withMeta(d, state);
  await d.runAsync('INSERT INTO cost_estimates (projectId,state) VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET state = excluded.state', projectId, JSON.stringify(next));
  await queueMutation('cost-estimates', projectId, next);
}

export async function getIntake(projectId: string): Promise<any> {
  const d = await db();
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS intakes (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM intakes WHERE projectId = ?', projectId);
  return row ? JSON.parse(row.state) : null;
}
export async function setIntake(projectId: string, state: any): Promise<void> {
  await assertProjectUnlocked(projectId);
  const d = await db();
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS intakes (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
  await d.runAsync('INSERT INTO intakes (projectId,state) VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET state = excluded.state', projectId, JSON.stringify(await withMeta(d, state)));
  await queueMutation('intakes', projectId, await withMeta(d, state));
}

export async function getElevator(projectId: string): Promise<any> {
  const d = await db();
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS elevators (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM elevators WHERE projectId = ?', projectId);
  return row ? JSON.parse(row.state) : null;
}
export async function setElevator(projectId: string, state: any): Promise<void> {
  await assertProjectUnlocked(projectId);
  const d = await db();
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS elevators (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
  await d.runAsync('INSERT INTO elevators (projectId,state) VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET state = excluded.state', projectId, JSON.stringify(await withMeta(d, state)));
  await queueMutation('elevators', projectId, await withMeta(d, state));
}

// ---- Resident Reporting (isolated from inspection/repair) ----
export type ResidentUpdate = {
  status: ResidentReport['status'];
  note?: string;
  by: string;
  at: string;
  photos?: string[];
};

export const LOCATION_CATEGORIES = ['Apartment/Unit', 'Building', 'Hallways', 'Cellar', 'Compactor Room', 'Elevator', 'Roof', 'Other'] as const;
export type LocationCategory = typeof LOCATION_CATEGORIES[number];

export type ResidentReport = {
  id: string;
  complaintNo?: string;      // friendly complaint number, e.g. RC-48213
  residentName?: string;
  contact?: string;          // optional resident contact info
  location?: string;
  createdBy?: 'resident' | 'management';
  unit: string;
  address: string;
  description: string;
  photos: string[];
  status: 'submitted' | 'assigned' | 'in_progress' | 'resolved';
  assignedTo?: string;
  development?: string;
  updates: ResidentUpdate[];
  createdAt: string;
  rating?: number;
  resolvedAt?: string;
  clearedByMgmt?: boolean;  // management cleared it so the worker may remove it from My Jobs
  _meta?: any;
};

async function ensureResidentTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS resident_reports (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

function normalizeResidentReport(r: any): ResidentReport {
  return {
    ...r,
    address: r.address ?? '',
    assignedTo: r.assignedTo,
    updates: Array.isArray(r.updates) ? r.updates : [],
  } as ResidentReport;
}

export async function createResidentReport(unit: string, address: string, description: string, photos: string[] = [], development: string = '', residentName: string = '', location: string = '', contact: string = ''): Promise<ResidentReport> {
  const now = new Date().toISOString();
  const submitted = await submitPublicResidentReport({
    id: uid(),
    development: development.trim() || undefined,
    state: {
      residentName: residentName.trim(),
      contact: contact.trim() || undefined,
      location: location.trim(),
      unit: unit.trim(),
      address: address.trim(),
      development: development.trim(),
      description: description.trim(),
      photos: [],
      status: 'submitted',
      updates: [{ status: 'submitted', by: 'resident', at: now }],
      createdAt: now,
    },
  });
  const r = normalizeResidentReport({ ...(submitted.state as object), id: submitted.id, photos });
  try {
    const d = await db();
    await ensureResidentTable(d);
    await d.runAsync('INSERT OR REPLACE INTO resident_reports (id,state) VALUES (?,?)', r.id, JSON.stringify(r));
  } catch {}
  return r;
}

export async function createManagementReport(location: string, unit: string, address: string, description: string, photos: string[] = [], development: string = ''): Promise<ResidentReport> {
  const d = await db();
  await ensureResidentTable(d);
  const meta = await newMeta(d);
  const now = new Date().toISOString();
  const r: ResidentReport = {
    id: uid(),
    createdBy: 'management',
    location: location.trim(),
    unit: unit.trim(),
    address: address.trim(),
    development: development.trim(),
    description: description.trim(),
    photos,
    status: 'submitted',
    assignedTo: undefined,
    updates: [{ status: 'submitted', by: 'management', at: now }],
    createdAt: now,
    _meta: meta,
  };
  await d.runAsync('INSERT INTO resident_reports (id,state) VALUES (?,?)', r.id, JSON.stringify(r));
  await queueMutation('resident-reports', r.id, r);
  const _a = await getCurrentActor();
  await logAudit(_a.role || 'management', _a.name, 'Report created', (location.trim() || unit.trim()) + (development.trim() ? ' \u00b7 ' + development.trim() : ''), r.id);
  return r;
}

export async function createAdminJobForManagement(location: string, unit: string, address: string, description: string, photos: string[] = [], development: string = ''): Promise<ResidentReport> {
  const d = await db();
  await ensureResidentTable(d);
  const meta = await newMeta(d);
  const now = new Date().toISOString();
  const a = await getCurrentActor();
  const r: ResidentReport = {
    id: uid(),
    createdBy: 'management',
    location: location.trim(),
    unit: unit.trim(),
    address: address.trim(),
    development: development.trim(),
    description: description.trim(),
    photos,
    status: 'submitted',
    assignedTo: undefined,
    updates: [{ status: 'submitted', by: 'administrator', at: now }],
    createdAt: now,
    _meta: meta,
  };
  await d.runAsync('INSERT INTO resident_reports (id,state) VALUES (?,?)', r.id, JSON.stringify(r));
  await queueMutation('resident-reports', r.id, r);
  await addNotification('management', 'New job from administrator', (location.trim() || unit.trim()) + (development.trim() ? ' \u00b7 ' + development.trim() : ''), r.id);
  await logAudit(a.role || 'administrator', a.name, 'Job sent to management', (location.trim() || unit.trim()) + (development.trim() ? ' \u00b7 ' + development.trim() : ''), r.id);
  return r;
}

export async function sendReportToAdmin(id: string): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM resident_reports WHERE id = ?', id);
  if (!row) return;
  const r = normalizeResidentReport(JSON.parse(row.state));
  const _a = await getCurrentActor();
  await addNotification('administrator', 'Report sent by management', (r.location || r.unit || 'Report') + (r.development ? ' \u00b7 ' + r.development : ''));
  await logAudit(_a.role || 'management', _a.name, 'Report sent to administrator', r.location || r.unit || '');
}

export type LookupResult = { address: string; unit: string; residentName: string; problem: string; kind: 'complaint' | 'violation' } | null;
export async function lookupComplaintOrViolation(num: string): Promise<LookupResult> {
  const key = (num || '').trim().toLowerCase();
  if (!key) return null;
  const reports = await listResidentReports().catch(() => []);
  const rep = reports.find(r => (r.complaintNo || '').trim().toLowerCase() === key);
  if (rep) return { address: rep.address || '', unit: rep.unit || '', residentName: rep.residentName || '', problem: rep.description || '', kind: 'complaint' };
  const viols = await listViolationLookups().catch(() => []);
  const v = viols.find(x => (x.violationNumber || '').trim().toLowerCase() === key);
  if (v) return { address: v.address || '', unit: v.unit || '', residentName: v.residentName || '', problem: v.note || '', kind: 'violation' };
  return null;
}

export async function listResidentReports(): Promise<ResidentReport[]> {
  const d = await db();
  await ensureResidentTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM resident_reports');
  const items = rows.map(r => { try { return normalizeResidentReport(JSON.parse(r.state)); } catch { return null; } }).filter(Boolean) as ResidentReport[];
  return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function findReportByRef(detail: string): Promise<ResidentReport | null> {
  // Best-effort match of a notification detail like "Unit 2B \u00b7 Clinton" or "Building \u00b7 Clinton" to a report.
  const all = await listResidentReports();
  const d = (detail || '').toLowerCase();
  if (!d) return null;
  // Try to match on unit or location AND development appearing in the detail string.
  let best: ResidentReport | null = null;
  for (const r of all) {
    const unit = (r.unit || '').toLowerCase().trim();
    const loc = (r.location || '').toLowerCase().trim();
    const dev = (r.development || '').toLowerCase().trim();
    const unitOrLoc = unit || loc;
    const unitOk = unitOrLoc ? d.includes(unitOrLoc) : false;
    const devOk = dev ? d.includes(dev) : false;
    if (unitOrLoc && dev && unitOk && devOk) return r;      // strong match
    if (!best && (unitOk || devOk)) best = r;                // weak fallback
  }
  return best;
}

export async function getResidentReport(id: string): Promise<ResidentReport | null> {
  const d = await db();
  await ensureResidentTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM resident_reports WHERE id = ?', id);
  if (!row) return null;
  try { return normalizeResidentReport(JSON.parse(row.state)); } catch { return null; }
}

export async function findResidentReports(complaintNo: string, address: string): Promise<ResidentReport[]> {
  const rows = await lookupPublicResidentReports(complaintNo.trim(), { address: address.trim() });
  return rows.map((row) => normalizeResidentReport({ ...(row.state as object), id: row.id }));
}

export async function updateResidentReportStatus(id: string, status: ResidentReport['status']): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM resident_reports WHERE id = ?', id);
  if (!row) return;
  const r = normalizeResidentReport(JSON.parse(row.state));
  const deviceId = await getDeviceId(d);
  const next = { ...r, status, _meta: touchMeta(r._meta, deviceId) };
  await d.runAsync('UPDATE resident_reports SET state = ? WHERE id = ?', JSON.stringify(next), id);
  const _a = await getCurrentActor();
  await logAudit(_a.role, _a.name, 'Report status changed', 'Unit ' + r.unit + ' \u2192 ' + status, id);
}

// Rate (1-5) and resolve a report in one step. Attributes the rating to the assigned staff.
export async function rateAndResolveReport(id: string, rating: number, by: string = 'management'): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM resident_reports WHERE id = ?', id);
  if (!row) return;
  const r = normalizeResidentReport(JSON.parse(row.state));
  const deviceId = await getDeviceId(d);
  const now = new Date().toISOString();
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  const update: ResidentUpdate = { status: 'resolved', note: 'Resolved \u00b7 rated ' + clamped + '/5', by, at: now };
  const next = { ...r, status: 'resolved' as const, rating: clamped, resolvedAt: now, updates: [...r.updates, update], _meta: touchMeta(r._meta, deviceId) };
  await d.runAsync('UPDATE resident_reports SET state = ? WHERE id = ?', JSON.stringify(next), id);
  const _a = await getCurrentActor();
  await logAudit(_a.role, _a.name, 'Report resolved & rated', 'Unit ' + r.unit + ' \u00b7 ' + clamped + '/5', id);
}

export type ContractorScore = {
  name: string;
  completed: number;
  avgRating: number;      // 0-5
  onTimeRate: number;     // 0-1
  score: number;          // 0-100 composite
};

// Aggregate per assigned staff: completed count, avg rating, on-time rate (resolved within `withinDays` of assignment).
export async function getContractorScores(withinDays: number = 7): Promise<ContractorScore[]> {
  const all = await listResidentReports();
  const byName: Record<string, { ratings: number[]; onTime: number; completed: number }> = {};
  for (const r of all) {
    if (r.status !== 'resolved' || !r.assignedTo) continue;
    const name = r.assignedTo.trim();
    if (!name) continue;
    if (!byName[name]) byName[name] = { ratings: [], onTime: 0, completed: 0 };
    const b = byName[name];
    b.completed++;
    if (typeof r.rating === 'number') b.ratings.push(r.rating);
    // On-time: find assigned + resolved timestamps in the timeline.
    const assignedAt = (r.updates || []).find(u => u.status === 'assigned')?.at;
    const resolvedAt = r.resolvedAt || (r.updates || []).slice().reverse().find(u => u.status === 'resolved')?.at;
    if (assignedAt && resolvedAt) {
      const days = (new Date(resolvedAt).getTime() - new Date(assignedAt).getTime()) / 86400000;
      if (days <= withinDays) b.onTime++;
    }
  }
  const out: ContractorScore[] = Object.keys(byName).map(name => {
    const b = byName[name];
    const avgRating = b.ratings.length ? b.ratings.reduce((x, y) => x + y, 0) / b.ratings.length : 0;
    const onTimeRate = b.completed ? b.onTime / b.completed : 0;
    // Composite: 70% rating (of 5), 30% on-time. Scaled to 100.
    const score = Math.round(((avgRating / 5) * 0.7 + onTimeRate * 0.3) * 100);
    return { name, completed: b.completed, avgRating, onTimeRate, score };
  });
  return out.sort((a, b) => b.score - a.score);
}


export async function assignResidentReport(id: string, workerName: string): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM resident_reports WHERE id = ?', id);
  if (!row) return;
  const r = normalizeResidentReport(JSON.parse(row.state));
  const deviceId = await getDeviceId(d);
  const now = new Date().toISOString();
  const update: ResidentUpdate = { status: 'assigned', note: 'Assigned to ' + workerName.trim(), by: 'management', at: now };
  const next = { ...r, status: 'assigned' as const, assignedTo: workerName.trim(), updates: [...r.updates, update], _meta: touchMeta(r._meta, deviceId) };
  await d.runAsync('UPDATE resident_reports SET state = ? WHERE id = ?', JSON.stringify(next), id);
  const _a = await getCurrentActor();
  await logAudit(_a.role, _a.name, 'Report assigned', 'Unit ' + r.unit + ' \u2192 ' + workerName.trim(), id);
  await addNotification(workerName.trim(), 'New job assigned', 'Unit ' + r.unit + (r.development ? ' \u00b7 ' + r.development : ''), id);
}

export async function addResidentUpdate(id: string, status: ResidentReport['status'], note: string, by: string, photos: string[] = []): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM resident_reports WHERE id = ?', id);
  if (!row) return;
  const r = normalizeResidentReport(JSON.parse(row.state));
  const deviceId = await getDeviceId(d);
  const now = new Date().toISOString();
  const update: ResidentUpdate = { status, note: note.trim() || undefined, by: by.trim(), at: now, photos: photos.length ? photos : undefined };
  const next = { ...r, status, photos: [...r.photos, ...photos], updates: [...r.updates, update], _meta: touchMeta(r._meta, deviceId) };
  await d.runAsync('UPDATE resident_reports SET state = ? WHERE id = ?', JSON.stringify(next), id);
}


export function listDevelopmentNames(): string[] {
  return DEVELOPMENT_NAMES;
}

export async function setReportDevelopment(id: string, name: string): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM resident_reports WHERE id = ?', id);
  if (!row) return;
  const r = normalizeResidentReport(JSON.parse(row.state));
  const deviceId = await getDeviceId(d);
  const now = new Date().toISOString();
  const update: ResidentUpdate = { status: r.status, note: 'Tagged development: ' + name.trim(), by: 'management', at: now };
  const next = { ...r, development: name.trim(), updates: [...r.updates, update], _meta: touchMeta(r._meta, deviceId) };
  await d.runAsync('UPDATE resident_reports SET state = ? WHERE id = ?', JSON.stringify(next), id);
}


export type AppMode = 'resident' | 'administrator' | 'management' | 'worker' | 'inspector' | 'vendor' | 'procurement' | 'emergency';

export async function getAppMode(): Promise<AppMode | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'appMode');
  if (!row) return null;
  const v = row.value;
  if (v === 'resident') return 'resident';
  if (v === 'worker') return 'worker';
  if (v === 'inspector') return 'inspector';
  if (v === 'administrator') return 'administrator';
  if (v === 'management' || v === 'staff') return 'management'; // 'staff' migrated
  return null;
}

export async function setAppMode(mode: AppMode): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'appMode', mode);
}


export async function clearAppMode(): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM settings WHERE key = ?', 'appMode');
}


export async function getStaffPin(): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'staffPin');
  return row ? row.value : null;
}

export async function setStaffPin(pin: string): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'staffPin', pin);
}


export type StaffRole = 'administrator' | 'management' | 'worker' | 'inspector' | 'procurement' | 'resident' | 'vendor';

export async function getRolePin(role: StaffRole): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'pin_' + role);
  return row ? row.value : null;
}

export async function setRolePin(role: StaffRole, pin: string): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'pin_' + role, pin);
}


export type StaffStatus = 'pending' | 'approved' | 'revoked';

export const STAFF_POSITIONS = ['Borough Director', 'Regional Director', 'Property Manager', 'Assistant Property Manager', 'Superintendent', 'Assistant Superintendent', 'Housing Assistant', 'Maintenance Worker', 'Caretaker', 'Groundskeeper', 'Janitorial Staff', 'CPM', 'Inspector', 'Elevator Service', 'Plumber', 'Electrician', 'Carpenter', 'Roofer', 'General Construction', 'CCTV Installation', 'Heating Service', 'Staff Worker', 'Director', 'Other'] as const;
export type StaffPosition = typeof STAFF_POSITIONS[number];

export type StaffAccount = {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  position?: StaffPosition;
  developments?: string[];
  code: string;
  role: StaffRole;
  status: StaffStatus;
  createdAt: string;
};
export type SessionIdentity = {
  staffId: string; tenantId: string; role: string; position: string; developments: string[];
};

const webTokenKey = (kind: 'access' | 'refresh') => `fiarep.auth.${kind}`;
function getWebToken(kind: 'access' | 'refresh'): string | null {
  if (Platform.OS !== 'web') return null;
  try { return globalThis.localStorage?.getItem(webTokenKey(kind)) || null; } catch { return null; }
}
function setWebToken(kind: 'access' | 'refresh', value: string): void {
  if (Platform.OS !== 'web') return;
  try { globalThis.localStorage?.setItem(webTokenKey(kind), value); } catch {}
}
function clearWebTokens(): void {
  if (Platform.OS !== 'web') return;
  try {
    globalThis.localStorage?.removeItem(webTokenKey('access'));
    globalThis.localStorage?.removeItem(webTokenKey('refresh'));
  } catch {}
}

async function ensureStaffTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS staff_accounts (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function getAccessToken(): Promise<string | null> {
  const webToken = getWebToken('access');
  if (webToken) return maybeRefresh(webToken);
  const secureToken = await SecureStore.getItemAsync('fiarep.auth.access').catch(() => null);
  if (secureToken) return maybeRefresh(secureToken);
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    'auth_access_token',
  );
  const token = row?.value || null;
  if (!token) return null;
  return maybeRefresh(token);
}

async function maybeRefresh(token: string): Promise<string | null> {
  if (_refreshing) return token;
  // Access tokens are JWTs. Refresh just before expiry so generated-client
  // requests never silently fall back to an unauthenticated session.
  try {
    const expiry = tokenExpiryMs(token);
    if (expiry !== null && expiry < Date.now() + 30_000) {
      return refreshAccessToken();
    }
  } catch { /* opaque token: let the server validate it */ }
  return token;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    const d = await db();
    const row = await d.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?', 'auth_refresh_token',
    );
    const refreshToken = getWebToken('refresh')
      || (await SecureStore.getItemAsync('fiarep.auth.refresh').catch(() => null))
      || row?.value;
    if (!refreshToken) return null;
    try {
      _refreshing = true;
      const session = await refreshSession({ refreshToken });
      await persistServerSession(session);
      return session.accessToken;
    } catch {
      return null;
    } finally {
      _refreshing = false;
      _refreshInFlight = null;
    }
  })();
  return _refreshInFlight;
}

async function persistServerSession(
  session: AuthResponse,
  issuedCode = '',
): Promise<void> {
  const d = await db();
  await ensureStaffTable(d);
  setWebToken('access', session.accessToken);
  setWebToken('refresh', session.refreshToken);
  await d.runAsync(
    'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    'auth_access_token',
    session.accessToken,
  );
  const accessStored = Platform.OS !== 'web' && await SecureStore.setItemAsync(
    'fiarep.auth.access',
    session.accessToken,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  ).then(() => true).catch(() => false);
  await d.runAsync(
    'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    'auth_refresh_token',
    session.refreshToken,
  );
  const refreshStored = Platform.OS !== 'web' && await SecureStore.setItemAsync(
    'fiarep.auth.refresh',
    session.refreshToken,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  ).then(() => true).catch(() => false);
  if (accessStored) await d.runAsync('DELETE FROM settings WHERE key=?', 'auth_access_token');
  if (refreshStored) await d.runAsync('DELETE FROM settings WHERE key=?', 'auth_refresh_token');
  await d.runAsync(
    'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    'auth_developments',
    JSON.stringify(session.staff.developments),
  );
  await d.runAsync(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    'session_identity',
    JSON.stringify({ staffId: session.staff.id, tenantId: (session.staff as any).tenantId || 'default', role: session.staff.role, position: session.staff.position, developments: [...(session.staff.developments || [])].sort() }),
  );
  const staff = session.staff as Staff;
  const localAccount: StaffAccount = {
    id: staff.id,
    name: staff.name,
    firstName: staff.firstName || undefined,
    lastName: staff.lastName || undefined,
    position: (staff.position || 'Other') as StaffPosition,
    developments: staff.developments,
    code: issuedCode,
    role: staff.role as StaffRole,
    status: staff.status as StaffStatus,
    createdAt: new Date().toISOString(),
  };
  await d.runAsync(
    'INSERT INTO staff_accounts (id,state) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state = excluded.state',
    localAccount.id,
    JSON.stringify(localAccount),
  );
}

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', 'session_identity');
  try { return row ? JSON.parse(row.value) as SessionIdentity : null; } catch { return null; }
}

export async function listStaffAccounts(status?: StaffStatus): Promise<StaffAccount[]> {
  const d = await db();
  await ensureStaffTable(d);
  await syncApprovedLocalStaffToServer().catch(() => undefined);
  const localItems = await readLocalStaffAccounts(d);
  let items = localItems;
  if (await getAccessToken()) {
    try {
      const remote = await listStaff();
      const localById = new Map(localItems.map((item) => [item.id, item]));
      const localByName = new Map(localItems.map((item) => [item.name.trim().toLowerCase(), item]));
      const hydrated = remote.map((staff) => {
        const prior = localById.get(staff.id) || localByName.get(staff.name.trim().toLowerCase());
        return {
          id: staff.id,
          name: staff.name,
          firstName: staff.firstName || undefined,
          lastName: staff.lastName || undefined,
          position: staff.position as StaffPosition,
          developments: staff.developments || [],
          code: prior?.code || '',
          role: staff.role as StaffRole,
          status: staff.status as StaffStatus,
          createdAt: prior?.createdAt || new Date().toISOString(),
        };
      });
      const remoteIds = new Set(hydrated.map((item) => item.id));
      const remoteNames = new Set(hydrated.map((item) => item.name.trim().toLowerCase()));
      items = [
        ...hydrated,
        ...localItems.filter((item) => !remoteIds.has(item.id) && !remoteNames.has(item.name.trim().toLowerCase())),
      ];
      for (const item of hydrated) await saveLocalStaffAccount(d, item);
    } catch {
      items = localItems;
    }
  }
  const out = status ? items.filter(a => a.status === status) : items;
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function readLocalStaffAccounts(d: SQLite.SQLiteDatabase): Promise<StaffAccount[]> {
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM staff_accounts');
  return rows
    .map((row) => { try { return JSON.parse(row.state) as StaffAccount; } catch { return null; } })
    .filter(Boolean) as StaffAccount[];
}

async function saveLocalStaffAccount(d: SQLite.SQLiteDatabase, account: StaffAccount): Promise<void> {
  await d.runAsync(
    'INSERT INTO staff_accounts (id,state) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state',
    account.id,
    JSON.stringify(account),
  );
}

async function createServerStaffAccount(account: StaffAccount): Promise<StaffAccount> {
  const position = STAFF_POSITIONS.includes(account.position as StaffPosition)
    ? account.position as StaffPosition
    : 'Other';
  const remote = await createStaff({
    id: account.id,
    name: account.name.trim(),
    firstName: account.firstName,
    lastName: account.lastName,
    role: account.role,
    position,
    developments: account.developments || [],
    code: account.code.trim().toUpperCase(),
  } as any);
  return {
    ...account,
    id: remote.id,
    name: remote.name,
    firstName: remote.firstName || account.firstName,
    lastName: remote.lastName || account.lastName,
    position: remote.position as StaffPosition,
    developments: remote.developments || account.developments || [],
    role: remote.role as StaffRole,
    status: remote.status as StaffStatus,
    code: ((remote as any).code as string | undefined) || account.code,
  };
}

async function syncApprovedLocalStaffToServer(): Promise<void> {
  if (!(await getAccessToken())) return;
  const d = await db();
  await ensureStaffTable(d);
  const local = await readLocalStaffAccounts(d);
  for (const account of local.filter((item) => item.status === 'approved' && item.code)) {
    try {
      const synced = await createServerStaffAccount(account);
      if (synced.id !== account.id) await d.runAsync('DELETE FROM staff_accounts WHERE id=?', account.id);
      await saveLocalStaffAccount(d, synced);
    } catch {
      // Accounts outside the signed-in manager's authority stay local.
    }
  }
}

export async function listStaffByPosition(position?: string): Promise<StaffAccount[]> {
  const all = await listStaffAccounts('approved');
  const staff = all.filter(a => a.role === 'worker' || a.role === 'inspector');
  const out = position ? staff.filter(a => (a.position || '') === position) : staff;
  return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// People who can be sent out to inspect a project: inspectors + management with a supervisor title.
// People assignable to a project, grouped by trade category (for the category dropdown picker).
// Includes approved workers + inspectors + supervisor-titled management. Groups follow STAFF_POSITIONS order.
export type TradeGroup = { position: string; people: StaffAccount[] };
export async function listAssignableByTrade(): Promise<TradeGroup[]> {
  const all = await listStaffAccounts('approved');
  const SUPERVISOR_TITLES = ['Property Manager', 'Superintendent', 'Regional Manager', 'Director'];
  const eligible = all.filter(a =>
    a.role === 'worker' || a.role === 'inspector' ||
    (a.role === 'management' && SUPERVISOR_TITLES.includes((a.position || '') as string))
  );
  const order = [...STAFF_POSITIONS];
  const groups: TradeGroup[] = [];
  for (const pos of order) {
    const people = eligible
      .filter(a => (a.position || 'Other') === pos)
      .sort((x, y) => (x.name || '').localeCompare(y.name || ''));
    if (people.length) groups.push({ position: pos, people });
  }
  // Anyone with an unrecognized/blank position lands under a trailing "Other" group.
  const known = new Set<string>(order as unknown as string[]);
  const leftovers = eligible
    .filter(a => !known.has((a.position || '') as string))
    .sort((x, y) => (x.name || '').localeCompare(y.name || ''));
  if (leftovers.length) {
    const other = groups.find(g => g.position === 'Other');
    if (other) other.people.push(...leftovers);
    else groups.push({ position: 'Other', people: leftovers });
  }
  return groups;
}

// Field inspectors only (role 'inspector'): the people dispatched to do the fieldwork. Excludes supervisors.
export async function listFieldInspectors(): Promise<StaffAccount[]> {
  const all = await listStaffAccounts('approved');
  const out = all.filter(a => a.role === 'inspector');
  return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function hasApprovedManagement(): Promise<boolean> {
  const all = await listStaffAccounts('approved');
  return all.some(a => a.role === 'management');
}

// Request an account. First management (when none approved yet) is auto-approved (bootstrap admin).
// Returns the created account (status reflects pending vs approved).
export async function requestStaffAccount(name: string, code: string, role: StaffRole): Promise<StaffAccount> {
  const d = await db();
  await ensureStaffTable(d);
  const nm = name.trim();
  const cd = code.trim();
  let status: StaffStatus = 'pending';
  if (role === 'management') {
    const bootstrap = !(await hasApprovedManagement());
    if (bootstrap) status = 'approved';
  }
  const acct: StaffAccount = {
    id: uid(),
    name: nm,
    code: cd,
    role,
    status,
    createdAt: new Date().toISOString(),
  };
  await d.runAsync('INSERT INTO staff_accounts (id,state) VALUES (?,?)', acct.id, JSON.stringify(acct));
  return acct;
}

async function setStaffStatus(id: string, status: StaffStatus): Promise<void> {
  const d = await db();
  await ensureStaffTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM staff_accounts WHERE id = ?', id);
  if (!row) return;
  const a = JSON.parse(row.state) as StaffAccount;
  const next = { ...a, status };
  await d.runAsync('UPDATE staff_accounts SET state = ? WHERE id = ?', JSON.stringify(next), id);
}

export async function approveStaffAccount(id: string): Promise<void> {
  const d = await db();
  await ensureStaffTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM staff_accounts WHERE id=?', id);
  if (!row) return;
  const account = JSON.parse(row.state) as StaffAccount;
  const synced = await createServerStaffAccount({ ...account, status: 'approved' });
  if (synced.id !== id) await d.runAsync('DELETE FROM staff_accounts WHERE id=?', id);
  await saveLocalStaffAccount(d, synced);
}
export async function denyStaffAccount(id: string): Promise<void> { await setStaffStatus(id, 'revoked'); }

// ---- Bulk employee upload (paste "First Last, Trade" lines -> pending accounts) ----

// Match a free-text trade to a known STAFF_POSITIONS value (case/spacing tolerant); else 'Other'.
export function categorizeTrade(raw: string): StaffPosition {
  const t = (raw || '').trim().toLowerCase();
  if (!t) return 'Other';
  for (const p of STAFF_POSITIONS) {
    if (p.toLowerCase() === t) return p;
  }
  // loose contains match (e.g. "master plumber" -> Plumber)
  for (const p of STAFF_POSITIONS) {
    const pl = p.toLowerCase();
    if (pl !== 'other' && (t.includes(pl) || pl.includes(t))) return p;
  }
  return 'Other';
}

export type ParsedEmployee = { firstName: string; lastName: string; position: StaffPosition; rawTrade: string };

// Parse pasted text: one employee per line. Accepts "First Last, Trade" (comma) OR
// "First Last Trade" (no comma) by detecting a known trade at the end of the line.
export function parseEmployeeList(text: string): ParsedEmployee[] {
  const out: ParsedEmployee[] = [];
  const lines = (text || '').split(/\r?\n/);
  const trades = [...STAFF_POSITIONS].filter(t => t !== 'Other').sort((a, b) => b.length - a.length);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    let namePart = '';
    let tradePart = '';
    if (raw.includes(',')) {
      const parts = raw.split(',');
      namePart = (parts[0] || '').trim();
      tradePart = (parts.slice(1).join(',') || '').trim();
    } else {
      const low = raw.toLowerCase();
      let matched = '';
      for (const t of trades) {
        const tl = t.toLowerCase();
        if (low.endsWith(' ' + tl) || low === tl) { matched = t; break; }
      }
      if (matched) {
        tradePart = matched;
        namePart = raw.slice(0, raw.length - matched.length).trim();
      } else {
        namePart = raw;
        tradePart = '';
      }
    }
    if (!namePart) continue;
    const nameTokens = namePart.split(/\s+/);
    const firstName = nameTokens[0] || '';
    const lastName = nameTokens.slice(1).join(' ') || '';
    out.push({ firstName, lastName, position: categorizeTrade(tradePart), rawTrade: tradePart });
  }
  return out;
}

// Parse CSV text with columns First, Last, Trade (header row optional/auto-detected).
export function parseEmployeeCSV(csv: string): ParsedEmployee[] {
  const out: ParsedEmployee[] = [];
  const rows = (csv || '').split(/\r?\n/).map(r => r.trim()).filter(Boolean);
  if (rows.length === 0) return out;

  const splitRow = (row: string): string[] => {
    // Simple CSV split handling quoted fields.
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells.map(c => c.trim());
  };

  // Detect header: if the first row contains "first"/"last"/"trade"/"name"/"position", skip it.
  let start = 0;
  const firstCells = splitRow(rows[0]).map(c => c.toLowerCase());
  const headerHints = ['first', 'last', 'trade', 'name', 'position', 'role'];
  if (firstCells.some(c => headerHints.includes(c))) start = 1;

  for (let i = start; i < rows.length; i++) {
    const cells = splitRow(rows[i]);
    if (cells.length === 0) continue;
    let firstName = '', lastName = '', tradePart = '';
    if (cells.length >= 3) {
      firstName = cells[0] || '';
      lastName = cells[1] || '';
      tradePart = cells[2] || '';
    } else if (cells.length === 2) {
      // "Name, Trade" or "First Last, Trade"
      const nameTokens = (cells[0] || '').split(/\s+/);
      firstName = nameTokens[0] || '';
      lastName = nameTokens.slice(1).join(' ') || '';
      tradePart = cells[1] || '';
    } else {
      const nameTokens = (cells[0] || '').split(/\s+/);
      firstName = nameTokens[0] || '';
      lastName = nameTokens.slice(1).join(' ') || '';
    }
    if (!firstName && !lastName) continue;
    out.push({ firstName, lastName, position: categorizeTrade(tradePart), rawTrade: tradePart });
  }
  return out;
}

// Create PENDING staff accounts from parsed employees (each gets a code, usable once approved).
export async function addBulkPendingEmployees(parsed: ParsedEmployee[], role: StaffRole, developments: string[] = []): Promise<number> {
  const d = await db();
  await ensureStaffTable(d);
  let created = 0;
  for (const e of parsed) {
    const fullName = (e.firstName + ' ' + e.lastName).trim();
    if (!fullName) continue;
    const acct: StaffAccount = {
      id: uid(),
      name: fullName,
      firstName: e.firstName,
      lastName: e.lastName,
      position: e.position,
      developments: (developments || []).map(x => x.trim()).filter(Boolean),
      code: generateCode(),
      role,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await d.runAsync('INSERT INTO staff_accounts (id,state) VALUES (?,?)', acct.id, JSON.stringify(acct));
    created++;
  }
  const _a = await getCurrentActor();
  await logAudit(_a.role || 'administrator', _a.name, 'Bulk employees added', created + ' pending');
  return created;
}

export async function revokeStaffAccount(id: string): Promise<void> {
  await setStaffStatus(id, 'revoked');
  const _a = await getCurrentActor();
  await logAudit(_a.role, _a.name, 'Staff account revoked', '');
}

// Verify a login: name + code must match an APPROVED account for the given role.
export async function verifyStaffLogin(name: string, code: string, role: StaffRole, expectedPosition?: string): Promise<boolean> {
  try {
    const preDb = await db();
    const priorIdentity = await preDb.getFirstAsync('SELECT value FROM settings WHERE key=?', 'session_identity') as { value: string } | null;
    let evidence: any;
    try { evidence = priorIdentity?.value ? JSON.parse(priorIdentity.value) : undefined; } catch {}
    const session = await loginOnServer({
      name: name.trim(),
      code: code.trim(),
      role,
    });
    if (expectedPosition && session.staff.position !== expectedPosition) {
      await logoutOnServer({ refreshToken: session.refreshToken }).catch(() => undefined);
      return false;
    }
    await persistServerSession(session);
    try {
      await rotateActorCache(session.staff);
      await recoverLegacyQueue(preDb, session.staff, evidence);
      await setCurrentActor(session.staff.role, session.staff.name);
      await hydrateRemotePhotosFromDb(preDb);
      await registerPushToken().catch(() => undefined);
      const { syncAllEntities } = await import('./sync');
      await syncAllEntities().catch(() => undefined);
    } catch {
      // Authentication succeeded and was persisted. Local cache maintenance
      // and background synchronization must not turn that into a login error.
    }
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      (error as { status?: unknown }).status === 401
    ) {
      return false;
    }
    throw error;
  }
}

/** Restore the server-authoritative actor after an app restart. */
export async function restoreServerSession(): Promise<Staff | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const staff = await getCurrentStaff();
    await rotateActorCache(staff);
    const localDb = await db();
    const priorIdentity = await localDb.getFirstAsync('SELECT value FROM settings WHERE key=?', 'session_identity') as { value: string } | null;
    let evidence: any;
    try { evidence = priorIdentity?.value ? JSON.parse(priorIdentity.value) : undefined; } catch {}
    await recoverLegacyQueue(localDb, staff, evidence);
    await hydrateRemotePhotosFromDb(localDb);
    await setCurrentActor(staff.role, staff.name);
    await syncApprovedLocalStaffToServer().catch(() => undefined);
    const { syncAllEntities } = await import('./sync');
    await syncAllEntities().catch(() => undefined);
    return staff;
  } catch {
    return null;
  }
}

export async function registerPushToken(): Promise<void> {
  const { registerForPush } = await import('./push');
  const token = await registerForPush();
  if (token) {
    await registerDeviceToken({ token, platform: 'expo' });
    const d = await db();
    await d.runAsync('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'push_token', token);
  }
}

export async function logout(): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?', 'auth_refresh_token',
  );
  const secureRefresh = await SecureStore.getItemAsync('fiarep.auth.refresh').catch(() => null);
  const refreshToken = getWebToken('refresh') || secureRefresh || row?.value;
  const push = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', 'push_token');
  if (push?.value) await unregisterDeviceToken({ token: push.value }).catch(() => undefined);
  // The API currently revokes refresh tokens but has no device-token DELETE
  // contract. Revoke the session and clear all local authority state.
  if (refreshToken) {
    await logoutOnServer({ refreshToken }).catch(() => undefined);
  }
  for (const key of ['auth_access_token', 'auth_refresh_token', 'auth_developments']) {
    await d.runAsync('DELETE FROM settings WHERE key = ?', key);
  }
  await d.runAsync('DELETE FROM settings WHERE key=?', 'push_token');
  await d.runAsync('DELETE FROM settings WHERE key=?', 'session_identity');
  await SecureStore.deleteItemAsync('fiarep.auth.access').catch(() => undefined);
  await SecureStore.deleteItemAsync('fiarep.auth.refresh').catch(() => undefined);
  clearWebTokens();
  await d.runAsync("DELETE FROM settings WHERE key LIKE 'sync_%_cursor%'").catch(() => undefined);
  for (const table of ['projects','rooms','checklists','roofplans','inspections','cost_estimates','intakes','elevators','resident_reports','violations','building_violations','priority_violations','route_assignments','procurement','procurement_bids','vendor_contacts','vendor_quotes','change_orders','elevator_jobs','emergency_jobs','emergency_units','leave_requests']) {
    try { await d.runAsync(`DELETE FROM ${table}`); } catch {}
  }
  await clearCurrentActor();
}


// ---- Top-down issuance model ----

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function hasAnyAdministrator(): Promise<boolean> {
  const status = await getBootstrapStatus();
  return status.hasAdministrator;
}

export async function issueStaffAccount(name: string, role: StaffRole, issuedBy: string): Promise<StaffAccount> {
  const d = await db();
  await ensureStaffTable(d);
  const acct: StaffAccount = {
    id: uid(),
    name: name.trim(),
    code: generateCode(),
    position: 'Other',
    role,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
  const withIssuer = { ...acct, issuedBy: issuedBy.trim() } as StaffAccount & { issuedBy?: string };
  const synced = await createServerStaffAccount(withIssuer);
  await saveLocalStaffAccount(d, synced);
  const _a = await getCurrentActor();
  await logAudit(_a.role || issuedBy.trim(), _a.name || issuedBy.trim(), 'Staff account issued', role + ' \u00b7 ' + acct.name);
  return synced;
}

export async function issueStaffAccountFull(firstName: string, lastName: string, position: StaffPosition, role: StaffRole, issuedBy: string, developments: string[] = []): Promise<StaffAccount> {
  const d = await db();
  await ensureStaffTable(d);
  const fn = firstName.trim();
  const ln = lastName.trim();
  const fullName = (fn + ' ' + ln).trim();
  const acct: StaffAccount = {
    id: uid(),
    name: fullName,
    firstName: fn,
    lastName: ln,
    position,
    developments: (developments || []).map(x => x.trim()).filter(Boolean),
    code: generateCode(),
    role,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
  const withIssuer = { ...acct, issuedBy: issuedBy.trim() } as StaffAccount & { issuedBy?: string };
  const synced = await createServerStaffAccount(withIssuer);
  await saveLocalStaffAccount(d, synced);
  const _a = await getCurrentActor();
  await logAudit(_a.role || issuedBy.trim(), _a.name || issuedBy.trim(), 'Staff account issued', position + ' \u00b7 ' + fullName);
  return synced;
}

export async function bootstrapAdministrator(name: string): Promise<StaffAccount> {
  const code = generateCode();
  const session = await bootstrapAdministratorOnServer({
    name: name.trim(),
    code,
  });
  await rotateActorCache(session.staff);
  await persistServerSession(session, code);
  await setCurrentActor(session.staff.role, session.staff.name);
  await registerPushToken().catch(() => undefined);
  const { syncAllEntities } = await import('./sync');
  await syncAllEntities().catch(() => undefined);
  const all = await listStaffAccounts('approved');
  const account = all.find((item) => item.id === session.staff.id);
  if (!account) throw new Error('Administrator session could not be saved.');
  return account;
}

export async function refuseStaffAccount(id: string): Promise<void> {
  await revokeStaffAccount(id);
}


export async function deleteStaffAccount(id: string): Promise<{ ok: boolean; reason?: string }> {
  const d = await db();
  await ensureStaffTable(d);
  // Guard: never delete the last remaining approved administrator (would lock everyone out).
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM staff_accounts WHERE id = ?', id);
  if (row) {
    try {
      const target = JSON.parse(row.state) as StaffAccount;
      if (target.role === 'administrator' && target.status === 'approved') {
        const all = await listStaffAccounts('approved');
        const admins = all.filter(a => a.role === 'administrator');
        if (admins.length <= 1) {
          return { ok: false, reason: 'Cannot delete the last administrator. Assign another admin first.' };
        }
      }
    } catch {}
  }
  await d.runAsync('DELETE FROM staff_accounts WHERE id = ?', id);
  const _a = await getCurrentActor();
  await logAudit(_a.role, _a.name, 'Staff account deleted', '');
  return { ok: true };
}

// Regenerate a new code for an account; returns the new code (to hand over).
export async function resetStaffCode(id: string): Promise<string | null> {
  const d = await db();
  await ensureStaffTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM staff_accounts WHERE id = ?', id);
  if (!row) return null;
  const a = JSON.parse(row.state) as StaffAccount;
  const code = generateCode();
  const next = { ...a, code };
  await d.runAsync('UPDATE staff_accounts SET state = ? WHERE id = ?', JSON.stringify(next), id);
  const _a = await getCurrentActor();
  await logAudit(_a.role, _a.name, 'Staff code reset', a.role + ' \u00b7 ' + a.name);
  return code;
}


// ---- Remembered staff session (admin/management stay signed in across restarts) ----

export async function setRememberedStaff(role: StaffRole, name: string): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'remembered_' + role, name.trim());
}

export async function getRememberedStaff(role: StaffRole): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'remembered_' + role);
  return row ? row.value : null;
}

export async function clearRememberedStaff(role: StaffRole): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM settings WHERE key = ?', 'remembered_' + role);
}


// ---- Audit log ----

export type AuditEntry = {
  id: string;
  at: string;
  actorRole: string;
  actorName: string;
  action: string;
  detail: string;
  reportId?: string;
};

async function ensureAuditTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function logAudit(actorRole: string, actorName: string, action: string, detail: string = '', reportId: string = ''): Promise<void> {
  const d = await db();
  await ensureAuditTable(d);
  const entry: AuditEntry = {
    id: uid(),
    at: new Date().toISOString(),
    actorRole: (actorRole || '').trim(),
    actorName: (actorName || '').trim(),
    action: action.trim(),
    detail: detail.trim(),
    reportId: (reportId || '').trim() || undefined,
  };
  await d.runAsync('INSERT INTO audit_log (id,state) VALUES (?,?)', entry.id, JSON.stringify(entry));
}

export async function listAuditLog(): Promise<AuditEntry[]> {
  const d = await db();
  await ensureAuditTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM audit_log');
  const items = rows.map(r => { try { return JSON.parse(r.state) as AuditEntry; } catch { return null; } }).filter(Boolean) as AuditEntry[];
  return items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export async function deleteAuditEntry(id: string): Promise<void> {
  const d = await db();
  await ensureAuditTable(d);
  await d.runAsync('DELETE FROM audit_log WHERE id = ?', id);
}

export async function clearAuditLog(): Promise<void> {
  const d = await db();
  await ensureAuditTable(d);
  await d.runAsync('DELETE FROM audit_log');
}


// ---- Current actor (who is acting now, for audit attribution) ----

export async function setCurrentActor(role: string, name: string): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'actor_role', (role || '').trim());
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'actor_name', (name || '').trim());
}

export async function getCurrentActor(): Promise<{ role: string; name: string }> {
  const d = await db();
  const r = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'actor_role');
  const n = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'actor_name');
  return { role: r ? r.value : '', name: n ? n.value : '' };
}

export async function clearCurrentActor(): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM settings WHERE key = ?', 'actor_role');
  await d.runAsync('DELETE FROM settings WHERE key = ?', 'actor_name');
}

// Returns the current actor's staff position (e.g. 'CPM' or 'Inspector'), by
// matching their name against approved staff accounts. Used to title the
// CPM/Inspector home for whichever position actually logged in.
export async function getCurrentPosition(): Promise<string> {
  const a = await getCurrentActor();
  const nm = (a.name || '').trim().toLowerCase();
  if (!nm) return '';
  const all = await listStaffAccounts('approved');
  const me = all.find(x => (x.name || '').trim().toLowerCase() === nm);
  return (me && me.position) ? me.position : '';
}


// ---- Notifications (in-app inbox, targeted by role or person name) ----

export type Notification = {
  id: string;
  target: string;
  message: string;
  detail: string;
  read: boolean;
  at: string;
  reportId?: string;
};

async function ensureNotifTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function addNotification(target: string, message: string, detail: string = '', reportId: string = ''): Promise<void> {
  const d = await db();
  await ensureNotifTable(d);
  const n: Notification = {
    id: uid(),
    target: (target || '').trim(),
    message: message.trim(),
    detail: detail.trim(),
    read: false,
    at: new Date().toISOString(),
    reportId: (reportId || '').trim() || undefined,
  };
  await d.runAsync('INSERT INTO notifications (id,state) VALUES (?,?)', n.id, JSON.stringify(n));
}

// Remove notifications matching a reportId and (optionally) an exact message.
// Used to clear a stale 'submitted for approval' when a scope is returned, so
// management's inbox doesn't keep showing it as pending.
export async function removeNotificationsByRef(reportId: string, message: string = ''): Promise<void> {
  const d = await db();
  await ensureNotifTable(d);
  const rid = (reportId || '').trim();
  if (!rid) return;
  const msg = (message || '').trim().toLowerCase();
  const rows = await d.getAllAsync<{ id: string; state: string }>('SELECT id,state FROM notifications');
  for (const row of rows) {
    let n: Notification | null = null;
    try { n = JSON.parse(row.state) as Notification; } catch { n = null; }
    if (!n) continue;
    if ((n.reportId || '').trim() !== rid) continue;
    if (msg && (n.message || '').trim().toLowerCase() !== msg) continue;
    await d.runAsync('DELETE FROM notifications WHERE id = ?', row.id);
  }
}

// One-time sweep: remove any leftover emergency notifications from all inboxes.
// Emergency activity lives in the Emergency Activity screen, not the inbox.
export async function clearEmergencyNotifications(): Promise<void> {
  const d = await db();
  await ensureNotifTable(d);
  const rows = await d.getAllAsync<{ id: string; state: string }>('SELECT id,state FROM notifications');
  for (const row of rows) {
    try {
      const n = JSON.parse(row.state) as Notification;
      if (/^emergency/i.test((n.message || '').trim())) {
        await d.runAsync('DELETE FROM notifications WHERE id = ?', row.id);
      }
    } catch (e) {}
  }
}

export async function listNotifications(target: string): Promise<Notification[]> {
  const d = await db();
  await ensureNotifTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM notifications');
  const items = rows.map(r => { try { return JSON.parse(r.state) as Notification; } catch { return null; } }).filter(Boolean) as Notification[];
  const t = (target || '').trim().toLowerCase();
  return items.filter(n => (n.target || '').trim().toLowerCase() === t).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export async function unreadCount(target: string): Promise<number> {
  const all = await listNotifications(target);
  return all.filter(n => !n.read).length;
}

export async function markNotificationRead(id: string): Promise<void> {
  const d = await db();
  await ensureNotifTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM notifications WHERE id = ?', id);
  if (!row) return;
  try {
    const n = JSON.parse(row.state) as Notification;
    if (!n.read) await d.runAsync('UPDATE notifications SET state = ? WHERE id = ?', JSON.stringify({ ...n, read: true }), id);
  } catch {}
}

export async function markNotificationsRead(target: string): Promise<void> {
  const d = await db();
  await ensureNotifTable(d);
  const rows = await d.getAllAsync<{ id: string; state: string }>('SELECT id, state FROM notifications');
  const t = (target || '').trim().toLowerCase();
  for (const row of rows) {
    try {
      const n = JSON.parse(row.state) as Notification;
      if ((n.target || '').trim().toLowerCase() === t && !n.read) {
        await d.runAsync('UPDATE notifications SET state = ? WHERE id = ?', JSON.stringify({ ...n, read: true }), row.id);
      }
    } catch {}
  }
}


// ---- Change Work Orders (change to an existing job/report) ----

export type ChangeOrderStatus = 'submitted' | 'mgmt_approved' | 'cost_approved' | 'declined';
export type ChangeOrder = {
  id: string;
  reportId: string;
  reportRef: string;
  targetPosition: string;
  targetName: string;
  description: string;
  cost: number;
  photos: string[];
  isWorkerCO?: boolean;  // worker change order: no cost, no procurement, mgmt approves directly
  status: ChangeOrderStatus;
  reason: string;
  createdByRole: string;
  createdByName: string;
  respondedByName: string;
  createdAt: string;
  respondedAt: string;
};

async function ensureChangeTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS change_orders (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function createChangeOrder(reportId: string, reportRef: string, targetPosition: string, targetName: string, description: string, cost: number = 0, photos: string[] = []): Promise<ChangeOrder> {
  const d = await db();
  await ensureChangeTable(d);
  const a = await getCurrentActor();
  const co: ChangeOrder = {
    id: uid(),
    reportId,
    reportRef: (reportRef || '').trim(),
    targetPosition: (targetPosition || '').trim(),
    targetName: (targetName || '').trim(),
    description: description.trim(),
    cost: Number.isFinite(cost) ? cost : 0,
    photos: photos || [],
    status: 'submitted',
    reason: '',
    createdByRole: a.role || 'management',
    createdByName: a.name || '',
    respondedByName: '',
    createdAt: new Date().toISOString(),
    respondedAt: '',
  };
  await d.runAsync('INSERT INTO change_orders (id,state) VALUES (?,?)', co.id, JSON.stringify(co));
  await queueMutation('change-orders', co.id, co);
  await queueMutation('change-orders', co.id, co);
  // A change work order goes to management first for review, then to procurement.
  await addNotification('management', 'Change work order to review', co.reportRef + '  $' + co.cost + (co.description ? ' \u00b7 ' + co.description.slice(0, 40) : ''), co.id);
  await logAudit(co.createdByRole, co.createdByName, 'Change work order created', (co.targetName || co.targetPosition) + ' \u00b7 ' + co.reportRef);
  return co;
}

export async function listChangeOrders(): Promise<ChangeOrder[]> {
  const d = await db();
  await ensureChangeTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM change_orders');
  const items = rows.map(r => { try { return JSON.parse(r.state) as ChangeOrder; } catch { return null; } }).filter(Boolean) as ChangeOrder[];
  return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function listChangeOrdersForRecipient(name: string, position: string): Promise<ChangeOrder[]> {
  const all = await listChangeOrders();
  const nm = (name || '').trim().toLowerCase();
  const pos = (position || '').trim().toLowerCase();
  return all.filter(co =>
    (co.targetName && co.targetName.trim().toLowerCase() === nm) ||
    (!co.targetName && co.targetPosition && co.targetPosition.trim().toLowerCase() === pos)
  );
}

async function _saveChangeOrder(co: ChangeOrder): Promise<void> {
  const d = await db();
  await ensureChangeTable(d);
  await d.runAsync('UPDATE change_orders SET state=? WHERE id=?', JSON.stringify(co), co.id);
  await queueMutation('change-orders', co.id, co);
}
async function _getChangeOrder(id: string): Promise<ChangeOrder | null> {
  const all = await listChangeOrders();
  return all.find(c => c.id === id) || null;
}

// Worker (plumber/electrician/staff) documents an add-on with photos, no cost.
// Goes to management; management approves directly (no procurement).
export async function createWorkerChangeOrder(reportRef: string, description: string, photos: string[] = []): Promise<ChangeOrder> {
  const d = await db();
  await ensureChangeTable(d);
  const a = await getCurrentActor();
  const co: ChangeOrder = {
    id: uid(), reportId: '', reportRef: (reportRef || '').trim(),
    targetPosition: '', targetName: '', description: (description || '').trim(),
    cost: 0, photos: photos || [], isWorkerCO: true, status: 'submitted', reason: '',
    createdByRole: a.role || 'worker', createdByName: a.name || '',
    respondedByName: '', createdAt: new Date().toISOString(), respondedAt: '',
  };
  await d.runAsync('INSERT INTO change_orders (id,state) VALUES (?,?)', co.id, JSON.stringify(co));
  await addNotification('management', 'Worker change order to review', co.reportRef + (co.description ? ' \u00b7 ' + co.description.slice(0, 40) : ''), co.id);
  await logAudit(co.createdByRole, co.createdByName, 'Worker change order created', co.reportRef, co.id);
  return co;
}

// Management approves a worker change order \u2014 completes directly, no procurement.
export async function approveWorkerChangeOrder(id: string): Promise<void> {
  const co = await _getChangeOrder(id);
  if (!co || co.status !== 'submitted') return;
  const a = await getCurrentActor();
  const next: ChangeOrder = { ...co, status: 'cost_approved', respondedByName: a.name || '', respondedAt: new Date().toISOString() };
  await _saveChangeOrder(next);
  await addNotification(next.createdByName, 'Change work order approved', next.reportRef + ' \u2014 approved', next.id);
  await logAudit(a.role || 'management', a.name || '', 'Worker change order approved', next.reportRef, next.id);
}

// Management approves a submitted change order and forwards it to procurement.
export async function approveChangeOrderMgmt(id: string): Promise<void> {
  const co = await _getChangeOrder(id);
  if (!co || co.status !== 'submitted') return;
  const a = await getCurrentActor();
  const next: ChangeOrder = { ...co, status: 'mgmt_approved', respondedByName: a.name || '', respondedAt: new Date().toISOString() };
  await _saveChangeOrder(next);
  await addNotification('procurement', 'Change work order \u2014 approve cost', next.reportRef + '  $' + next.cost, next.id);
  await logAudit(a.role || 'management', a.name || '', 'Change order approved (mgmt)', next.reportRef + ' \u00b7 $' + next.cost, next.id);
}

// Procurement approves the cost \u2014 final approval.
export async function approveChangeOrderProcurement(id: string): Promise<void> {
  const co = await _getChangeOrder(id);
  if (!co || co.status !== 'mgmt_approved') return;
  const a = await getCurrentActor();
  const next: ChangeOrder = { ...co, status: 'cost_approved', respondedByName: a.name || '', respondedAt: new Date().toISOString() };
  await _saveChangeOrder(next);
  await addNotification(next.createdByName, 'Change work order approved', next.reportRef + '  $' + next.cost + ' \u2014 cost approved', next.id);
  await logAudit(a.role || 'procurement', a.name || '', 'Change order cost approved', next.reportRef + ' \u00b7 $' + next.cost, next.id);
}

// CPM edits a declined change order in place and resubmits the SAME record.
export async function resubmitChangeOrder(id: string, description: string, cost: number, photos: string[]): Promise<void> {
  const co = await _getChangeOrder(id);
  if (!co) return;
  const a = await getCurrentActor();
  const next: ChangeOrder = {
    ...co,
    description: (description || '').trim() || co.description,
    cost: Number.isFinite(cost) ? cost : co.cost,
    photos: photos && photos.length ? photos : co.photos,
    status: 'submitted',
    reason: '',
    respondedByName: '',
    respondedAt: '',
  };
  await _saveChangeOrder(next);
  await addNotification('management', 'Change work order to review', next.reportRef + '  $' + next.cost + ' (resubmitted)', next.id);
  await logAudit(a.role || 'inspector', a.name || '', 'Change order resubmitted', next.reportRef + ' \u00b7 $' + next.cost, next.id);
}

// Decline at any stage, with a reason.
export async function declineChangeOrder(id: string, reason: string): Promise<void> {
  const co = await _getChangeOrder(id);
  if (!co) return;
  const a = await getCurrentActor();
  const next: ChangeOrder = { ...co, status: 'declined', reason: (reason || '').trim(), respondedByName: a.name || '', respondedAt: new Date().toISOString() };
  await _saveChangeOrder(next);
  await addNotification(next.createdByName, 'Change work order declined', next.reportRef + (reason ? ' \u2014 ' + reason : ''), next.id);
  await logAudit(a.role || 'management', a.name || '', 'Change order declined', next.reportRef, next.id);
}



// ---- Project notes (admin/others can leave notes for contractor/inspector) ----

export type ProjectNote = {
  id: string;
  projectId: string;
  text: string;
  byRole: string;
  byName: string;
  at: string;
};

async function ensureProjectNotesTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS project_notes (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function addProjectNote(projectId: string, text: string, byRole: string, byName: string): Promise<void> {
  await assertProjectUnlocked(projectId);
  const d = await db();
  await ensureProjectNotesTable(d);
  const note: ProjectNote = {
    id: uid(),
    projectId,
    text: text.trim(),
    byRole: (byRole || '').trim(),
    byName: (byName || '').trim(),
    at: new Date().toISOString(),
  };
  await d.runAsync('INSERT INTO project_notes (id,state) VALUES (?,?)', note.id, JSON.stringify(note));
  await queueMutation('project-notes', note.id, note);
  await logAudit(byRole || 'admin', byName, 'Project note added', text.trim().slice(0, 50));
}

export async function listProjectNotes(projectId: string): Promise<ProjectNote[]> {
  const d = await db();
  await ensureProjectNotesTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM project_notes');
  const items = rows.map(r => { try { return JSON.parse(r.state) as ProjectNote; } catch { return null; } }).filter(Boolean) as ProjectNote[];
  return items.filter(n => n.projectId === projectId).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

// ---- Project review (admin/management approve / needs revision / reject) ----

export type ProjectReviewDecision = 'approved' | 'needs_revision' | 'rejected';
export type ProjectReview = {
  projectId: string;
  decision: ProjectReviewDecision;
  notes?: string;
  byRole: string;
  byName: string;
  at: string;
};

async function ensureProjectReviewsTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS project_reviews (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function setProjectReview(projectId: string, decision: ProjectReviewDecision, notes: string, byRole: string, byName: string): Promise<void> {
  const d = await db();
  await ensureProjectReviewsTable(d);
  const review: ProjectReview = {
    projectId,
    decision,
    notes: notes.trim() || undefined,
    byRole: (byRole || '').trim(),
    byName: (byName || '').trim(),
    at: new Date().toISOString(),
  };
  // One review per project: use projectId as the row id so it overwrites.
  await d.runAsync('INSERT OR REPLACE INTO project_reviews (id,state) VALUES (?,?)', projectId, JSON.stringify(review));
  await queueMutation('project-reviews', projectId, review);
  const label = decision === 'approved' ? 'Project approved' : decision === 'needs_revision' ? 'Project needs revision' : 'Project rejected';
  await logAudit(byRole || 'admin', byName, label, notes.trim().slice(0, 50), 'proj:' + projectId);
  // Notify the specific inspector who owns the project (by name); fall back to the inspector role.
  const proj = await getProject(projectId);
  const detail = (proj ? proj.name : 'Project') + (notes.trim() ? ' \u00b7 ' + notes.trim() : '');
  const assigned = await getProjectInspector(projectId);
  const owner = assigned || await getProjectOwner(projectId);
  if (owner) { await addNotification(owner, label, detail, 'proj:' + projectId); }
  else {
    // No assignee and no owner. 'inspector' is not a bucket any inbox reads, so
    // send it to management, who can then assign the project.
    await addNotification('management', label, detail + ' \u00b7 (unassigned project)', 'proj:' + projectId);
  }
}

export async function getProjectReview(projectId: string): Promise<ProjectReview | null> {
  const d = await db();
  await ensureProjectReviewsTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM project_reviews WHERE id = ?', projectId);
  if (!row) return null;
  try { return JSON.parse(row.state) as ProjectReview; } catch { return null; }
}


// Set of project ids whose review decision is 'approved'. Drives the green "completed" outline
// on the project list and the lock on approved projects. Cheap: one scan of project_reviews.
export async function listApprovedProjectIds(): Promise<Set<string>> {
  const d = await db();
  await ensureProjectReviewsTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM project_reviews');
  const out = new Set<string>();
  for (const r of rows) {
    try {
      const rev = JSON.parse(r.state) as ProjectReview;
      if (rev && rev.decision === 'approved' && rev.projectId) out.add(rev.projectId);
    } catch {}
  }
  return out;
}

// True if this specific project has been approved (locked). Convenience for single-project screens.
export async function isProjectApproved(projectId: string): Promise<boolean> {
  const rev = await getProjectReview(projectId);
  return !!rev && rev.decision === 'approved';
}

// ---- Admin delete functions (admin can remove any request/job/notification) ----

// Management clears a resident job so the assigned worker may remove it from My
// Jobs. The record itself stays for reporting.
export async function clearResidentReportForStaff(id: string): Promise<void> {
  const d = await db();
  await ensureResidentTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM resident_reports WHERE id = ?', id);
  if (!row) return;
  let r: ResidentReport;
  try { r = JSON.parse(row.state) as ResidentReport; } catch { return; }
  const next = { ...r, clearedByMgmt: true };
  await d.runAsync('UPDATE resident_reports SET state=? WHERE id=?', JSON.stringify(next), next.id);
}

export async function deleteResidentReport(id: string): Promise<void> {
  const d = await db();
  await ensureResidentTable(d);
  await queueMutation('resident-reports', id, null, 'delete');
  await d.runAsync('DELETE FROM resident_reports WHERE id = ?', id);
  const a = await getCurrentActor();
  await logAudit(a.role || 'administrator', a.name, 'Report deleted', id);
}

export async function deleteChangeOrder(id: string): Promise<void> {
  const d = await db();
  await ensureChangeTable(d);
  await queueMutation('change-orders', id, null, 'delete');
  await d.runAsync('DELETE FROM change_orders WHERE id = ?', id);
  const a = await getCurrentActor();
  await logAudit(a.role || 'administrator', a.name, 'Change order deleted', id);
}

export async function deleteNotification(id: string): Promise<void> {
  const d = await db();
  await ensureNotifTable(d);
  await d.runAsync('DELETE FROM notifications WHERE id = ?', id);
}

export async function listAllNotifications(): Promise<Notification[]> {
  const d = await db();
  await ensureNotifTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM notifications');
  const items = rows.map(r => { try { return JSON.parse(r.state) as Notification; } catch { return null; } }).filter(Boolean) as Notification[];
  return items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}


// ---- Development scoping (management assigned to specific developments) ----

// Approved management accounts whose assigned developments include the given development.
export async function listManagementForDevelopment(development: string): Promise<StaffAccount[]> {
  const all = await listStaffAccounts('approved');
  const dev = (development || '').trim().toLowerCase();
  return all.filter(a => a.role === 'management' && Array.isArray(a.developments) &&
    a.developments.some(d => (d || '').trim().toLowerCase() === dev));
}

// The developments a given person (by name) is assigned to. Empty array = none/all-per-policy.
// Developments assigned to any staff member (by name), regardless of role.
export async function developmentsForStaff(name: string): Promise<string[]> {
  const all = await listStaffAccounts('approved');
  const nm = (name || '').trim().toLowerCase();
  const acct = all.find(a => (a.name || '').trim().toLowerCase() === nm);
  return (acct && Array.isArray(acct.developments)) ? acct.developments : [];
}

export async function developmentsForManager(name: string): Promise<string[]> {
  const all = await listStaffAccounts('approved');
  const nm = (name || '').trim().toLowerCase();
  const mgr = all.find(a => a.role === 'management' && (a.name || '').trim().toLowerCase() === nm);
  return (mgr && Array.isArray(mgr.developments)) ? mgr.developments : [];
}

// ---- Procurement round-trip ----
// Supervisor clears a job from a contractor/vendor and sends the scope to
// procurement with a tracking id and address. Procurement clears it and sends
// it back to the same supervisor, same id and address, with the winning vendor.

export type ProcurementStatus = 'draft' | 'submitted' | 'approved' | 'pending' | 'bidding' | 'awarded' | 'closed';

export type ProcurementRequest = {
  id: string;
  trackingId: string;
  projectId: string;
  address: string;
  scope: string;
  status: ProcurementStatus;
  requestedBy: string;
  requestedAt: string;
  scopeFile?: string;
  scopeFileName?: string;
  invitedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  returnNote?: string;
  returnedAt?: string;
  vendor?: string;
  awardedBy?: string;
  awardedAt?: string;
  startedAt?: string;
  vendorNote?: string;
  completedAt?: string;
  performance?: VendorPerformance;
  amountCharged?: number;
  deduction?: number;
  deductionReason?: string;
  finalAmount?: number;
  cpmNotes?: string;  // CPM's own notes, separate from the inspector's violation notes
  closedAt?: string;
  walkthroughAt?: string;
  walkthroughNote?: string;
  bidCloseAt?: string;
};

export type VendorPerformance = 'good' | 'fair' | 'poor';

async function ensureProcurementTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS procurement (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

function newTrackingId(): string {
  const n = Math.floor(10000 + Math.random() * 90000);
  return 'RC-' + String(n);
}

export async function createProcurementRequest(
  projectId: string,
  address: string,
  scope: string,
  requestedBy: string,
  scopeFile: string = '',
  scopeFileName: string = '',
  cpmNotes: string = '',
): Promise<ProcurementRequest> {
  const d = await db();
  await ensureProcurementTable(d);
  const r: ProcurementRequest = {
    id: uid(),
    trackingId: '',
    projectId: (projectId || '').trim(),
    address: (address || '').trim(),
    scope: (scope || '').trim(),
    scopeFile: (scopeFile || '').trim() || undefined,
    scopeFileName: (scopeFileName || '').trim() || undefined,
    status: 'draft',
    requestedBy: (requestedBy || '').trim(),
    requestedAt: new Date().toISOString(),
    cpmNotes: (cpmNotes || '').trim() || undefined,
  };
  await d.runAsync('INSERT INTO procurement (id,state) VALUES (?,?)', r.id, JSON.stringify(r));
  await queueMutation('procurement', r.id, r);
  // Created as a draft only. Nothing is sent until the CPM taps Send, so the
  // quote can be built and a file attached first.
  return r;
}

// Update an existing draft's address/scope in place. Used when the CPM edits a
// scope they already saved (or reopened after a return) so we never spawn a
// second record for the same job.
export async function updateScopeDraft(
  id: string,
  address: string,
  scope: string,
  cpmNotes?: string,
): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  r.address = (address || '').trim();
  r.scope = (scope || '').trim();
  if (cpmNotes !== undefined) r.cpmNotes = cpmNotes.trim() || undefined;
  await d.runAsync('UPDATE procurement SET state=? WHERE id=?', JSON.stringify(r), r.id);
  return r;
}

// Repair legacy scopes whose address was stored as a raw id: pull the real
// address from the record's Divisions scope header and write it back. Safe to
// call repeatedly — only touches records that look corrupted.
export async function repairScopeAddresses(): Promise<void> {
  const d = await db();
  await ensureProcurementTable(d);
  const all = await listProcurementRequests();
  for (const r of all) {
    const stored = String(r.address || '');
    const idLike = !!stored && (!stored.includes(' ') || stored === String(r.projectId || ''));
    if (!idLike) continue;
    // Divisions scope is keyed by projectId or the record's own id.
    const key = (r.projectId && r.projectId.trim()) ? r.projectId.trim() : r.id;
    let div = await getProjectScopeForm(key).catch(() => null);
    if (!div) div = await getProjectScopeForm(r.id).catch(() => null);
    const headerAddr = (div && div.header && div.header.address) ? String(div.header.address).trim() : '';
    if (headerAddr && headerAddr !== stored) {
      const next = { ...r, address: headerAddr };
      await d.runAsync('UPDATE procurement SET state=? WHERE id=?', JSON.stringify(next), r.id);
      // Also fix any notification that baked the old id-address into its detail.
      await ensureNotifTable(d);
      const nrows = await d.getAllAsync<{ id: string; state: string }>('SELECT id,state FROM notifications');
      for (const nr of nrows) {
        try {
          const n = JSON.parse(nr.state) as Notification;
          if ((n.reportId || '') === r.id && (n.detail || '') === stored) {
            const fixedN = { ...n, detail: headerAddr };
            await d.runAsync('UPDATE notifications SET state=? WHERE id=?', JSON.stringify(fixedN), nr.id);
          }
        } catch (e) {}
      }
    }
  }
}

// CPM submits a project's Nature of Work & Cost Estimate as a scope to their
// supervisor (Management). The scope record carries the projectId so the
// review screen can load the cost estimate keyed under that project. Deduped
// on projectId so re-tapping updates the same record instead of spawning a new
// one. This is the CPM -> supervisor path only; it does not touch vendors.
export async function submitProjectScope(projectId: string, scopeName: string = '', addressArg: string = ''): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const pid = (projectId || '').trim();
  if (!pid) return null;
  const a = await getCurrentActor();
  const me = (a && a.name) || '';

  // Reuse an existing record. The caller's `pid` may be either a real projectId
  // (project-based Divisions form) OR a procurement draft's own id (Submit Scope
  // flow). Match on BOTH so we never spawn a duplicate that the supervisor can't
  // open and the vendor scope can't key to.
  const all = await listProcurementRequests();
  let r = all.find((x) => x.id === pid || (x.projectId || '').trim() === pid) || null;

  // Address: the caller (Divisions form) passes the real header address. Fall
  // back to the existing record's address, then a real project name. NEVER the
  // raw id (getProject on a non-project id can't supply a real address).
  const proj = await getProject(pid);
  const addrArg = (addressArg || '').trim();
  const address = addrArg
    || (r && r.address && r.address.trim() ? r.address : '')
    || (proj ? proj.name : '');

  // The CPM names the scope. Fall back to any existing name on resubmit, then
  // to a default only if nothing was ever provided.
  const name = (scopeName || '').trim() || (r && r.scope) || 'Scope of Work';

  if (!r) {
    r = await createProcurementRequest(pid, address, name, me);
  }

  const next: ProcurementRequest = {
    ...r,
    address: address || r.address,
    scope: name,
    status: 'submitted',
    returnedAt: undefined,
    returnNote: undefined,
  };
  await saveProcurementRequest(d, next);
  await removeNotificationsByRef(next.id, 'Scope submitted for approval');
  await addNotification('management', 'Scope submitted for approval', next.address, next.id);
  return next;
}

// Return the procurement/scope record tied to a project, if any. Used by the
// project screen to surface a supervisor's return note.
// Resolve the original scope record for a change order, so procurement can
// review it. Tries the projectId (reportId) first, then matches the address
// (reportRef) against existing scopes.
export async function findScopeForChangeOrder(reportId: string, reportRef: string): Promise<ProcurementRequest | null> {
  const all = await listProcurementRequests();
  const pid = (reportId || '').trim();
  if (pid) {
    const byProj = all.find(r => (r.projectId || '').trim() === pid || r.id === pid);
    if (byProj) return byProj;
  }
  const addr = (reportRef || '').trim().toLowerCase();
  if (addr) {
    const byAddr = all.find(r => (r.address || '').trim().toLowerCase() === addr);
    if (byAddr) return byAddr;
    // loose: address contained in the ref (ref may have extra dev suffix)
    const loose = all.find(r => { const a = (r.address || '').trim().toLowerCase(); return a && addr.includes(a); });
    if (loose) return loose;
  }
  return null;
}

export async function getProjectScope(projectId: string): Promise<ProcurementRequest | null> {
  const pid = (projectId || '').trim();
  if (!pid) return null;
  const all = await listProcurementRequests();
  return all.find((x) => (x.projectId || '').trim() === pid) || null;
}

// CPM finalizes a draft: persists any attached scope file and sends it to
// Management for approval. Still no tracking ID.
export async function submitScopeForApproval(id: string, scopeFile: string = '', scopeFileName: string = '', address: string = '', scope: string = ''): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  const next: ProcurementRequest = {
    ...r,
    status: 'submitted',
    address: (address || '').trim() || r.address,
    scope: (scope || '').trim() || r.scope,
    scopeFile: (scopeFile || '').trim() || r.scopeFile,
    scopeFileName: (scopeFileName || '').trim() || r.scopeFileName,
    returnedAt: undefined,
    returnNote: undefined,
  };
  await saveProcurementRequest(d, next);
  await removeNotificationsByRef(next.id, 'Scope submitted for approval');
  await addNotification('management', 'Scope submitted for approval', next.address, next.id);
  return next;
}

// Management (supervisor) approves a CPM's scope+quote and forwards it to
// procurement. Still no tracking ID — that is generated at broadcast.
export async function approveProcurementRequest(id: string, approvedBy: string): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  if (r.status === 'closed') throw new Error('This job is closed and can no longer be changed. Start a new scope instead.');
  const next: ProcurementRequest = {
    ...r,
    status: 'approved',
    approvedBy: (approvedBy || '').trim(),
    approvedAt: new Date().toISOString(),
  };
  await saveProcurementRequest(d, next);
  await addNotification('procurement', 'Scope approved \u2014 ready to send to vendors', next.address, next.id);
  return next;
}

// Procurement sends an approved scope back to the supervisor (Management) for
// revision instead of broadcasting it. Returns the scope to 'submitted' so it
// reappears in the supervisor's Scope Approvals queue, with a note.
export async function returnScopeToManagement(id: string, note: string = ''): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  if (r.status === 'closed') throw new Error('This job is closed and can no longer be changed. Start a new scope instead.');
  const next: ProcurementRequest = {
    ...r,
    status: 'submitted',
    returnNote: (note || '').trim() || undefined,
    returnedAt: new Date().toISOString(),
    approvedBy: undefined,
    approvedAt: undefined,
  };
  await saveProcurementRequest(d, next);
  await removeNotificationsByRef(next.id, 'Scope approved \u2014 ready to send to vendors');
  const detail = next.address + (note.trim() ? '  \u2014 ' + note.trim() : '');
  await addNotification('management', 'Scope returned by procurement', detail, next.id);
  return next;
}

// Management sends a submitted scope back to the CPM for revision.
export async function rejectScope(id: string, note: string = ''): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  if (r.status === 'closed') throw new Error('This job is closed and can no longer be changed. Start a new scope instead.');
  const next: ProcurementRequest = {
    ...r,
    status: 'draft',
    returnNote: (note || '').trim() || undefined,
    returnedAt: new Date().toISOString(),
  };
  await saveProcurementRequest(d, next);
  await removeNotificationsByRef(next.id, 'Scope submitted for approval');
  if (next.requestedBy) {
    const detail = next.address + (note.trim() ? '  \u2014 ' + note.trim() : '');
    // A project-sourced scope routes the CPM back to the project they already
    // built (proj: prefix), so they revise in place rather than starting over.
    const ref = (next.projectId && next.projectId.trim()) ? 'proj:' + next.projectId.trim() : next.id;
    await addNotification(next.requestedBy, 'Scope returned for revision', detail, ref);
  }
  return next;
}

// Scopes returned to a specific CPM for revision: drafts that carry a
// returnedAt marker. New unsent drafts have no returnedAt and are excluded.
export async function listReturnedScopes(cpmName: string): Promise<ProcurementRequest[]> {
  const nm = (cpmName || '').trim().toLowerCase();
  const all = await listProcurementRequests('draft');
  return all
    .filter(r => !!r.returnedAt && (r.requestedBy || '').trim().toLowerCase() === nm)
    .sort((a, b) => (b.returnedAt || '').localeCompare(a.returnedAt || ''));
}

export async function listProcurementRequests(status?: ProcurementStatus): Promise<ProcurementRequest[]> {
  const d = await db();
  await ensureProcurementTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM procurement');
  const all: ProcurementRequest[] = [];
  for (const row of rows) {
    try { all.push(JSON.parse(row.state) as ProcurementRequest); } catch (e) {}
  }
  const filtered = status ? all.filter(r => r.status === status) : all;
  return filtered.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
}

export async function getProcurementRequest(id: string): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM procurement WHERE id = ?', id);
  if (!row) return null;
  try { return JSON.parse(row.state) as ProcurementRequest; } catch (e) { return null; }
}

// Vendor-facing lookup: a contractor is handed the sr- tracking id and enters
// it to reach their one job. Match is case-insensitive and tolerant of a
// missing 'sr-' prefix.
export async function getProcurementByTracking(tracking: string, vendorName: string): Promise<ProcurementRequest | null> {
  if (!tracking.trim() || !vendorName.trim()) return null;
  try {
    const row = await lookupPublicVendorScope(tracking.trim(), { vendorName: vendorName.trim() });
    return { ...(row.state as object), id: row.id } as ProcurementRequest;
  } catch {
    return null;
  }
}

// Vendor marks their awarded job as started. No-op unless it is awarded.
export async function vendorStartProcurement(id: string): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  if (r.status !== 'awarded') return r;
  const next: ProcurementRequest = { ...r, startedAt: r.startedAt || new Date().toISOString() };
  await saveProcurementRequest(d, next);
  return next;
}

// Vendor marks their job complete and leaves an optional note. This does not
// close the record; the supervisor still closes it. It notifies the requester.
export async function vendorCompleteProcurement(id: string, note: string = ''): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  const next: ProcurementRequest = {
    ...r,
    startedAt: r.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    vendorNote: (note || '').trim() || r.vendorNote,
  };
  await saveProcurementRequest(d, next);
  if (next.requestedBy) {
    await addNotification(
      next.requestedBy,
      'Vendor marked work complete: ' + (next.vendor || 'vendor'),
      next.address + '  ID: ' + next.trackingId,
      next.id,
    );
  }
  return next;
}

export type ProcurementBid = {
  id: string;
  requestId: string;
  trackingId: string;
  vendorName: string;
  amount: number;
  note?: string;
  submittedAt: string;
};

async function ensureBidsTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS procurement_bids (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

async function saveProcurementRequest(d: any, r: ProcurementRequest): Promise<void> {
  await d.runAsync('UPDATE procurement SET state = ? WHERE id = ?', JSON.stringify(r), r.id);
  await queueMutation('procurement', r.id, r);
}

// Procurement broadcasts the job to every vendor contact: moves the request to
// 'bidding' and notifies each contact by name with the job-ID. The scope file,
// if attached, lives only on this device until a backend exists.
export async function broadcastProcurement(id: string, walkthroughAt: string = '', walkthroughNote: string = '', bidCloseAt: string = ''): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  if (r.status === 'closed') throw new Error('This job is closed and can no longer be changed. Start a new scope instead.');
  const next: ProcurementRequest = {
    ...r,
    trackingId: r.trackingId || newTrackingId(),
    status: 'bidding',
    invitedAt: r.invitedAt || new Date().toISOString(),
    walkthroughAt: (walkthroughAt || '').trim() || r.walkthroughAt,
    walkthroughNote: (walkthroughNote || '').trim() || r.walkthroughNote,
    bidCloseAt: (bidCloseAt || '').trim() || r.bidCloseAt,
  };
  await saveProcurementRequest(d, next);
  const contacts = await listVendorContacts();
  let detail = next.address + '  ID: ' + next.trackingId;
  if (next.walkthroughAt) detail += '  Walkthrough: ' + next.walkthroughAt;
  if (next.bidCloseAt) detail += '  Bids close: ' + next.bidCloseAt;
  for (const c of contacts) {
    if (c.name) await addNotification(c.name, 'New job open for bid', detail, next.id);
  }
  return next;
}

// A vendor submits a bid against a job they were invited to. Keyed by the
// tracking id the contact was given.
export async function submitBid(trackingId: string, vendorName: string, amount: number, note: string = ''): Promise<ProcurementBid | null> {
  try {
    const row = await submitPublicVendorBid(trackingId.trim(), {
      vendorName: vendorName.trim(),
      amount,
      note: note.trim() || undefined,
    });
    return { ...(row.state as object), id: row.id } as ProcurementBid;
  } catch {
    return null;
  }
}

export async function listBids(requestId: string): Promise<ProcurementBid[]> {
  const d = await db();
  await ensureBidsTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM procurement_bids');
  const all: ProcurementBid[] = [];
  for (const row of rows) {
    try {
      const b = JSON.parse(row.state) as ProcurementBid;
      if (b.requestId === requestId) all.push(b);
    } catch (e) {}
  }
  return all.sort((a, b) => a.amount - b.amount);
}

// Procurement clears the scope and returns it to the requesting supervisor
// with the winning contractor/vendor attached to the same tracking id.
export async function awardProcurementRequest(
  id: string,
  vendor: string,
  awardedBy: string,
): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  const next: ProcurementRequest = {
    ...r,
    status: 'awarded',
    vendor: (vendor || '').trim(),
    awardedBy: (awardedBy || '').trim(),
    awardedAt: new Date().toISOString(),
  };
  await saveProcurementRequest(d, next);
  await addNotification(
    next.requestedBy,
    'Procurement cleared: ' + (next.vendor || 'vendor assigned'),
    next.address + '  ID: ' + next.trackingId,
    next.id,
  );
  // Notify the winner and every losing bidder by job-ID.
  const winner = (next.vendor || '').trim().toLowerCase();
  const bids = await listBids(next.id);
  const notified = new Set<string>();
  for (const b of bids) {
    const nm = (b.vendorName || '').trim();
    if (!nm || notified.has(nm.toLowerCase())) continue;
    notified.add(nm.toLowerCase());
    if (nm.toLowerCase() === winner) {
      await addNotification(nm, 'You won the bid: ' + next.trackingId, next.address, next.id);
    } else {
      await addNotification(nm, 'Bid not selected: ' + next.trackingId, next.address, next.id);
    }
  }
  // If the winner never formally bid, still tell them they won.
  if (next.vendor && !notified.has(winner)) {
    await addNotification(next.vendor, 'You won the bid: ' + next.trackingId, next.address, next.id);
  }
  return next;
}

export async function closeProcurementRequest(id: string): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  const next: ProcurementRequest = { ...r, status: 'closed', closedAt: new Date().toISOString() };
  await saveProcurementRequest(d, next);
  return next;
}

// Permanently remove a procurement request and all its bids. Admin-only action.
export async function deleteProcurementRequest(id: string): Promise<void> {
  const d = await db();
  await ensureProcurementTable(d);
  await ensureBidsTable(d);
  // Grab the record first so we can clear any notifications that point at it.
  const rec = await getProcurementRequest(id);
  const bids = await d.getAllAsync<{ id: string; state: string }>('SELECT id, state FROM procurement_bids');
  for (const row of bids) {
    try {
      const b = JSON.parse(row.state) as ProcurementBid;
      if (b.requestId === id) await d.runAsync('DELETE FROM procurement_bids WHERE id = ?', row.id);
    } catch (e) {}
  }
  await queueMutation('procurement', id, null, 'delete');
  await d.runAsync('DELETE FROM procurement WHERE id = ?', id);
  // Clear notifications tied to this scope (by record id and by project ref) so
  // no stale "returned for revision" / "submitted" cards linger in any inbox.
  await removeNotificationsByRef(id, '');
  if (rec && rec.projectId && rec.projectId.trim()) {
    await removeNotificationsByRef('proj:' + rec.projectId.trim(), '');
  }
}

// The CPM/Inspector closes out a vendor's job: rates the work good/fair/poor,
// records what the vendor charged, and may deduct from that amount for poor
// work. finalAmount is what the vendor is actually paid.
export async function rateAndCloseProcurement(
  id: string,
  performance: VendorPerformance,
  amountCharged: number,
  deduction: number = 0,
  deductionReason: string = '',
): Promise<ProcurementRequest | null> {
  const d = await db();
  await ensureProcurementTable(d);
  const r = await getProcurementRequest(id);
  if (!r) return null;
  const charged = Number.isFinite(amountCharged) && amountCharged > 0 ? amountCharged : 0;
  const cut = Number.isFinite(deduction) && deduction > 0 ? Math.min(deduction, charged) : 0;
  const next: ProcurementRequest = {
    ...r,
    status: 'closed',
    performance,
    amountCharged: charged,
    deduction: cut || undefined,
    deductionReason: cut ? ((deductionReason || '').trim() || undefined) : undefined,
    finalAmount: charged - cut,
    closedAt: new Date().toISOString(),
  };
  await saveProcurementRequest(d, next);
  if (next.vendor) {
    const paid = 'Paid $' + next.finalAmount + (cut ? ' (—$' + cut + ' deducted)' : '');
    await addNotification(next.vendor, 'Job closed: ' + next.trackingId, paid, next.id);
  }
  return next;
}

export type VendorScore = {
  name: string;
  completed: number;
  onTimeRate: number;      // 0-1
  deductions: number;      // count of jobs with a deduction
  score: number;           // 0-100 composite
};

// Vendor-only scoring, keyed by the awarded vendor name on closed procurement
// jobs. Driven by good/fair/poor performance, on-time completion, and a penalty
// for each job that was docked. Separate from the resident-report scores.
export async function getVendorScores(withinDays: number = 14): Promise<VendorScore[]> {
  const all = await listProcurementRequests();
  const PERF: Record<VendorPerformance, number> = { good: 1, fair: 0.6, poor: 0.2 };
  const byName: Record<string, { perf: number[]; onTime: number; completed: number; deductions: number }> = {};
  for (const r of all) {
    if (r.status !== 'closed' || !r.vendor) continue;
    const name = r.vendor.trim();
    if (!name) continue;
    if (!byName[name]) byName[name] = { perf: [], onTime: 0, completed: 0, deductions: 0 };
    const b = byName[name];
    b.completed++;
    if (r.performance) b.perf.push(PERF[r.performance]);
    if (r.deduction && r.deduction > 0) b.deductions++;
    const start = r.awardedAt || r.startedAt;
    const done = r.completedAt || r.closedAt;
    if (start && done) {
      const days = (new Date(done).getTime() - new Date(start).getTime()) / 86400000;
      if (days <= withinDays) b.onTime++;
    }
  }
  const out: VendorScore[] = Object.keys(byName).map(name => {
    const b = byName[name];
    const perfAvg = b.perf.length ? b.perf.reduce((x, y) => x + y, 0) / b.perf.length : 0;
    const onTimeRate = b.completed ? b.onTime / b.completed : 0;
    const dedRate = b.completed ? b.deductions / b.completed : 0;
    // 60% performance, 25% on-time, minus up to 15% for deductions.
    const raw = perfAvg * 0.6 + onTimeRate * 0.25 - dedRate * 0.15;
    const score = Math.max(0, Math.round(raw * 100));
    return { name, completed: b.completed, onTimeRate, deductions: b.deductions, score };
  });
  return out.sort((a, b) => b.score - a.score);
}

// ---- Vendor contact list ----
// A roster of outside contractors procurement broadcasts bid invitations to.
// These are NOT staff accounts and have no login; they are contacts only.

export type VendorContact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  createdAt: string;
};

async function ensureVendorContactsTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS vendor_contacts (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function listVendorContacts(): Promise<VendorContact[]> {
  const d = await db();
  await ensureVendorContactsTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM vendor_contacts');
  const all: VendorContact[] = [];
  for (const row of rows) {
    try { all.push(JSON.parse(row.state) as VendorContact); } catch (e) {}
  }
  return all.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function addVendorContact(name: string, phone: string, email: string): Promise<VendorContact> {
  const d = await db();
  await ensureVendorContactsTable(d);
  const c: VendorContact = {
    id: uid(),
    name: (name || '').trim(),
    phone: (phone || '').trim(),
    email: (email || '').trim(),
    createdAt: new Date().toISOString(),
  };
  await d.runAsync('INSERT INTO vendor_contacts (id,state) VALUES (?,?)', c.id, JSON.stringify(c));
  return c;
}

export async function updateVendorContact(id: string, name: string, phone: string, email: string): Promise<VendorContact | null> {
  const d = await db();
  await ensureVendorContactsTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM vendor_contacts WHERE id = ?', id);
  if (!row) return null;
  let cur: VendorContact;
  try { cur = JSON.parse(row.state) as VendorContact; } catch { return null; }
  const next: VendorContact = {
    ...cur,
    name: (name || '').trim(),
    phone: (phone || '').trim(),
    email: (email || '').trim(),
  };
  await d.runAsync('UPDATE vendor_contacts SET state = ? WHERE id = ?', JSON.stringify(next), id);
  return next;
}

export async function deleteVendorContact(id: string): Promise<void> {
  const d = await db();
  await ensureVendorContactsTable(d);
  await queueMutation('vendor-contacts', id, null, 'delete');
  await d.runAsync('DELETE FROM vendor_contacts WHERE id = ?', id);
}

// ---- Violation lookup ----
// Supervisor sends an inspector or contractor a violation number and address
// to look up when they visit the unit or building.

export type ViolationLookup = {
  id: string;
  violationNumber: string;
  address: string;
  unit?: string;
  note?: string;
  sentTo: string;
  sentBy: string;
  sentAt: string;
  acknowledgedAt?: string;
  // Resident complaint data carried forward through the chain.
  complaintNo?: string;
  residentName?: string;
  contact?: string;
  development?: string;
};

async function ensureViolationTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS violations (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function sendViolationLookup(
  violationNumber: string,
  address: string,
  sentTo: string,
  sentBy: string,
  unit: string = '',
  note: string = '',
  resident: { complaintNo?: string; residentName?: string; contact?: string; development?: string } = {},
): Promise<ViolationLookup> {
  const d = await db();
  await ensureViolationTable(d);
  const v: ViolationLookup = {
    id: uid(),
    violationNumber: (violationNumber || '').trim(),
    address: (address || '').trim(),
    unit: (unit || '').trim() || undefined,
    note: (note || '').trim() || undefined,
    sentTo: (sentTo || '').trim(),
    sentBy: (sentBy || '').trim(),
    sentAt: new Date().toISOString(),
    complaintNo: resident.complaintNo,
    residentName: resident.residentName,
    contact: resident.contact,
    development: resident.development,
  };
  await d.runAsync('INSERT INTO violations (id,state) VALUES (?,?)', v.id, JSON.stringify(v));
  const where = v.unit ? v.address + '  Unit ' + v.unit : v.address;
  await addNotification(
    v.sentTo,
    'Violation to look up: ' + v.violationNumber,
    where + (v.note ? '  ' + v.note : ''),
    v.id,
  );
  return v;
}

export async function listViolationLookups(sentTo?: string): Promise<ViolationLookup[]> {
  const d = await db();
  await ensureViolationTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM violations');
  const all: ViolationLookup[] = [];
  for (const row of rows) {
    try { all.push(JSON.parse(row.state) as ViolationLookup); } catch (e) {}
  }
  const who = (sentTo || '').trim().toLowerCase();
  const filtered = who ? all.filter(v => (v.sentTo || '').trim().toLowerCase() === who) : all;
  return filtered.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
}

export async function getViolationLookup(id: string): Promise<ViolationLookup | null> {
  const d = await db();
  await ensureViolationTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM violations WHERE id = ?', id);
  if (!row) return null;
  try { return JSON.parse(row.state) as ViolationLookup; } catch { return null; }
}

export async function deleteViolationLookup(id: string): Promise<void> {
  const d = await db();
  await ensureViolationTable(d);
  await queueMutation('violations', id, null, 'delete');
  await d.runAsync('DELETE FROM violations WHERE id = ?', id);
}

export async function acknowledgeViolationLookup(id: string): Promise<void> {
  const d = await db();
  await ensureViolationTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM violations WHERE id = ?', id);
  if (!row) return;
  try {
    const v = JSON.parse(row.state) as ViolationLookup;
    if (v.acknowledgedAt) return;
    const next: ViolationLookup = { ...v, acknowledgedAt: new Date().toISOString() };
    await d.runAsync('UPDATE violations SET state = ? WHERE id = ?', JSON.stringify(next), id);
  } catch (e) {}
}

// ---- Priority violation routing ----
// A finding an inspection marks priority (red) routes to every approved
// management account assigned to that development. Stays outstanding until a
// supervisor acknowledges it.
//
// NOTE: this fans out to the local inbox only. Delivery to a supervisor on a
// DIFFERENT phone requires the cross-device sync in BACKEND-BACKLOG.md, and
// waking a locked phone requires the critical-alert entitlement. Do not treat
// this as guaranteed life-safety delivery.

export type PriorityViolation = {
  id: string;
  development: string;
  address: string;
  unit?: string;
  finding: string;
  instruction?: string;
  raisedBy: string;
  raisedAt: string;
  routedTo: string[];
  unrouted: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
};

async function ensurePriorityTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS priority_violations (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

// Who should receive a priority violation at a given development.
//
// Deliberately WIDER than listManagementForDevelopment: a supervisor with no
// developments listed is unscoped and oversees everything, so excluding them
// would silently drop the alert. For a red finding, over-notifying is the
// correct failure mode.
export async function supervisorsForPriority(development: string): Promise<StaffAccount[]> {
  const all = await listStaffAccounts('approved');
  const dev = (development || '').trim().toLowerCase();
  return all.filter(a => {
    if (a.role !== 'management') return false;
    const devs = Array.isArray(a.developments)
      ? a.developments.map(d => (d || '').trim().toLowerCase()).filter(Boolean)
      : [];
    // Unscoped supervisor: no developments listed means all developments.
    if (devs.length === 0) return true;
    if (!dev) return true;
    return devs.includes(dev);
  });
}

export async function raisePriorityViolation(
  development: string,
  address: string,
  finding: string,
  raisedBy: string,
  unit: string = '',
  instruction: string = '',
  projectId: string = '',
): Promise<PriorityViolation> {
  const d = await db();
  await ensurePriorityTable(d);

  const supervisors = await supervisorsForPriority(development);
  const routedTo = supervisors.map(s => (s.name || '').trim()).filter(Boolean);

  // A project may have its own assigned person who is not a development
  // supervisor. Add them so project-scoped staff are not missed.
  if (projectId) {
    const assignee = (await getProjectInspector(projectId) || '').trim();
    if (assignee && !routedTo.includes(assignee)) routedTo.push(assignee);
  }

  const v: PriorityViolation = {
    id: uid(),
    development: (development || '').trim(),
    address: (address || '').trim(),
    unit: (unit || '').trim() || undefined,
    finding: (finding || '').trim(),
    instruction: (instruction || '').trim() || undefined,
    raisedBy: (raisedBy || '').trim(),
    raisedAt: new Date().toISOString(),
    routedTo,
    unrouted: routedTo.length === 0,
  };
  await d.runAsync('INSERT INTO priority_violations (id,state) VALUES (?,?)', v.id, JSON.stringify(v));
  await queueMutation('priority-violations', v.id, v);

  const where = v.unit ? v.address + '  Unit ' + v.unit : v.address;
  const detail = where + (v.instruction ? '  ' + v.instruction : '');
  const message = 'PRIORITY: ' + v.finding;

  if (routedTo.length > 0) {
    for (const target of routedTo) {
      await addNotification(target, message, detail, v.id);
    }
  } else {
    // No supervisor assigned to this development. Notify the general bucket
    // rather than dropping it, and flag the gap on the record.
    await addNotification('management', message, detail + '  (no supervisor assigned)', v.id);
  }
  return v;
}

export async function listPriorityViolations(onlyOutstanding: boolean = false): Promise<PriorityViolation[]> {
  const d = await db();
  await ensurePriorityTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM priority_violations');
  const all: PriorityViolation[] = [];
  for (const row of rows) {
    try { all.push(JSON.parse(row.state) as PriorityViolation); } catch (e) {}
  }
  const filtered = onlyOutstanding ? all.filter(v => !v.acknowledgedAt) : all;
  return filtered.sort((a, b) => (a.raisedAt < b.raisedAt ? 1 : -1));
}

export async function acknowledgePriorityViolation(id: string, by: string): Promise<void> {
  const d = await db();
  await ensurePriorityTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM priority_violations WHERE id = ?', id);
  if (!row) return;
  try {
    const v = JSON.parse(row.state) as PriorityViolation;
    if (v.acknowledgedAt) return;
    const next: PriorityViolation = {
      ...v,
      acknowledgedBy: (by || '').trim(),
      acknowledgedAt: new Date().toISOString(),
    };
    await d.runAsync('UPDATE priority_violations SET state = ? WHERE id = ?', JSON.stringify(next), id);
    await queueMutation('priority-violations', id, next);
  } catch (e) {}
}

export async function deletePriorityViolation(id: string): Promise<void> {
  const d = await db();
  await ensurePriorityTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM priority_violations WHERE id=?', id);
  let state: any = null;
  try { state = row?.state ? JSON.parse(row.state) : null; } catch {}
  await queueMutation('priority-violations', id, state, 'delete');
  await d.runAsync('DELETE FROM priority_violations WHERE id=?', id);
}

// Outstanding priority items for one supervisor, for the inbox badge.
export async function outstandingPriorityFor(name: string): Promise<PriorityViolation[]> {
  const all = await listPriorityViolations(true);
  const nm = (name || '').trim().toLowerCase();
  if (!nm) return all;
  return all.filter(v =>
    v.unrouted || v.routedTo.some(t => (t || '').trim().toLowerCase() === nm));
}

// ---- Assignment start + staleness escalation ----
// `in_progress` already exists on ResidentReport.status and is the started
// state: the UI draws a square border around a started assignment.
//
// Staleness is derived, never stored, so there is nothing to migrate and the
// value is always correct at read time. An assignment that has been sitting
// unstarted escalates over 1, 2, then 3+ days.

export type AssignmentUrgency = 'none' | 'day1' | 'day2' | 'day3';

// Mark an assignment as started by the worker/vendor who picked it up.
export async function startAssignment(reportId: string, by: string, deviceId: string = ''): Promise<ResidentReport | null> {
  const d = await db();
  await ensureResidentTable(d);
  const r = await getResidentReport(reportId);
  if (!r) return null;
  if (r.status !== 'assigned') return r;
  const now = new Date().toISOString();
  const update: ResidentUpdate = { status: 'in_progress', note: 'Started by ' + (by || '').trim(), by: (by || '').trim(), at: now };
  const next: ResidentReport = {
    ...r,
    status: 'in_progress' as const,
    updates: [...(r.updates || []), update],
    _meta: touchMeta(r._meta, deviceId),
  };
  await d.runAsync('UPDATE resident_reports SET state = ? WHERE id = ?', JSON.stringify(next), next.id);
  return next;
}

export function assignmentStartedAt(r: ResidentReport): string | undefined {
  return (r.updates || []).find(u => u.status === 'in_progress')?.at;
}

export function assignmentAssignedAt(r: ResidentReport): string | undefined {
  return (r.updates || []).find(u => u.status === 'assigned')?.at;
}

// Days elapsed since assignment for a report that has not been started.
// Returns 0 for anything started, resolved, or never assigned.
export function assignmentIdleDays(r: ResidentReport, now: Date = new Date()): number {
  if (r.status !== 'assigned') return 0;
  const at = assignmentAssignedAt(r);
  if (!at) return 0;
  const then = new Date(at).getTime();
  if (!isFinite(then)) return 0;
  const ms = now.getTime() - then;
  if (ms <= 0) return 0;
  return Math.floor(ms / 86400000);
}

export function assignmentUrgency(r: ResidentReport, now: Date = new Date()): AssignmentUrgency {
  const days = assignmentIdleDays(r, now);
  if (days >= 3) return 'day3';
  if (days === 2) return 'day2';
  if (days === 1) return 'day1';
  return 'none';
}

// Unstarted assignments float to the top, oldest first, then everything else
// newest first.
export function sortByUrgency(list: ResidentReport[], now: Date = new Date()): ResidentReport[] {
  const rank = (r: ResidentReport) => assignmentIdleDays(r, now);
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return rb - ra;
    return (a.createdAt < b.createdAt ? 1 : -1);
  });
}

// ── Building violations (codes logged by inspectors) ──────────────────
// Inspector is sent a building + violation number by their supervisor, walks
// the building, and logs each violation they find: code, description, the
// hazard class they assign (A/B/C), and free-text notes. Stored per building.
export type BuildingViolationStatus = 'logged' | 'approved' | 'routed' | 'done';
export type BuildingViolation = {
  id: string;
  building: string;        // address / building identifier
  violationNo: string;     // number the supervisor assigned
  code: string;            // violation code
  codeDesc: string;        // the code's description (snapshot)
  hazardClass: 'A' | 'B' | 'C';
  notes: string;
  photos?: string[];
  loggedBy: string;
  loggedAt: string;
  // Workflow chain: inspector logs -> management approves -> routes to a staff
  // member (CPM builds a scope; a trade does the work). Data carries forward.
  status?: BuildingViolationStatus;
  approvedBy?: string;
  approvedAt?: string;
  routedTo?: string;         // specific staff member's name
  routedToPosition?: string; // their position/trade (snapshot)
  routedAt?: string;
  completedBy?: string;
  completedAt?: string;
  completionNote?: string;
  completionPhotos?: string[];
  clearedByMgmt?: boolean;  // management cleared it so staff may delete from their view
  // Resident complaint data carried forward from the originating complaint.
  complaintNo?: string;
  residentName?: string;
  contact?: string;
};

async function ensureBuildingViolTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS building_violations (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function addBuildingViolation(
  building: string,
  violationNo: string,
  code: string,
  codeDesc: string,
  hazardClass: 'A' | 'B' | 'C',
  notes: string,
  photos: string[] = [],
): Promise<BuildingViolation> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const a = await getCurrentActor();
  const v: BuildingViolation = {
    id: uid(),
    building: (building || '').trim(),
    violationNo: (violationNo || '').trim(),
    code: (code || '').trim(),
    codeDesc: (codeDesc || '').trim(),
    hazardClass,
    notes: (notes || '').trim(),
    photos: Array.isArray(photos) ? photos : [],
    loggedBy: (a && a.name) || '',
    loggedAt: new Date().toISOString(),
    status: 'logged',
  };
  await d.runAsync('INSERT INTO building_violations (id,state) VALUES (?,?)', v.id, JSON.stringify(v));
  // Auto-send to management for approval the moment the inspector saves it.
  await addNotification('management', 'Inspection logged \u2014 awaiting approval',
    v.building + '  \u00b7 ' + v.violationNo + '  (Class ' + v.hazardClass + ')', v.id);
  await logAudit('inspector', v.loggedBy, 'Inspection logged', v.building + ' \u00b7 ' + v.violationNo + ' (Class ' + v.hazardClass + ')', v.id);
  return v;
}

// Management approves a logged inspection, then routes it to a specific staff
// member. Class C is flagged in the notification but any class can route. The
// full violation payload travels with it — the recipient re-enters nothing.
export async function approveAndRouteViolation(id: string, toName: string, toPosition: string): Promise<BuildingViolation | null> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM building_violations WHERE id = ?', id);
  if (!row) return null;
  let v: BuildingViolation;
  try { v = JSON.parse(row.state) as BuildingViolation; } catch { return null; }
  const a = await getCurrentActor();
  const now = new Date().toISOString();
  const next: BuildingViolation = {
    ...v,
    status: 'routed',
    approvedBy: (a && a.name) || '',
    approvedAt: v.approvedAt || now,
    routedTo: (toName || '').trim(),
    routedToPosition: (toPosition || '').trim(),
    routedAt: now,
  };
  await d.runAsync('UPDATE building_violations SET state=? WHERE id=?', JSON.stringify(next), next.id);
  const flag = next.hazardClass === 'C' ? '\u26a0\ufe0f Class C \u2014 ' : '';
  const msg = (next.routedToPosition || '').toLowerCase() === 'cpm' ? 'Approved inspection \u2014 build scope' : 'Approved inspection \u2014 work assignment';
  if (next.routedTo) {
    await addNotification(next.routedTo, flag + msg,
      next.building + '  \u00b7 ' + next.violationNo + '  (Class ' + next.hazardClass + ')', next.id);
  }
  await logAudit(a && a.role ? a.role : 'management', next.approvedBy || '', 'Inspection approved & routed', next.violationNo + ' \u2192 ' + (next.routedTo || '') + (next.routedToPosition ? ' (' + next.routedToPosition + ')' : ''), next.id);
  return next;
}

// Inspections awaiting management approval (status 'logged').
export async function listLoggedInspections(): Promise<BuildingViolation[]> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM building_violations');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as BuildingViolation; } catch { return null; } }).filter(Boolean) as BuildingViolation[];
  return items.filter(v => (v.status || 'logged') === 'logged').sort((a, b) => (b.loggedAt || '').localeCompare(a.loggedAt || ''));
}

// Approved inspections routed to a specific person (for their inbox/list).
export async function listRoutedInspectionsFor(name: string): Promise<BuildingViolation[]> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM building_violations');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as BuildingViolation; } catch { return null; } }).filter(Boolean) as BuildingViolation[];
  const nm = (name || '').trim().toLowerCase();
  return items.filter(v => v.status === 'routed' && (v.routedTo || '').trim().toLowerCase() === nm)
    .sort((a, b) => (b.routedAt || '').localeCompare(a.routedAt || ''));
}

// Routed + completed inspections, for management to track and clear for staff.
export async function listActiveInspections(): Promise<BuildingViolation[]> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM building_violations');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as BuildingViolation; } catch { return null; } }).filter(Boolean) as BuildingViolation[];
  return items.filter(v => v.status === 'routed' || v.status === 'done')
    .sort((a, b) => (b.routedAt || b.loggedAt || '').localeCompare(a.routedAt || a.loggedAt || ''));
}

export async function getBuildingViolation(id: string): Promise<BuildingViolation | null> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM building_violations WHERE id = ?', id);
  if (!row) return null;
  try { return JSON.parse(row.state) as BuildingViolation; } catch { return null; }
}

// Management/Admin clears an inspection so the assigned staff member may delete
// it from their own view. Two-stage delete: management clears first, staff then
// removes it. Does not delete the record itself.
export async function clearInspectionForStaff(id: string): Promise<void> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM building_violations WHERE id = ?', id);
  if (!row) return;
  let v: BuildingViolation;
  try { v = JSON.parse(row.state) as BuildingViolation; } catch { return; }
  const next = { ...v, clearedByMgmt: true };
  await d.runAsync('UPDATE building_violations SET state=? WHERE id=?', JSON.stringify(next), next.id);
}

// A staff worker (plumber/electrician/maintenance/etc.) marks a routed repair
// done, with a completion note and photos. Sets status 'done' (so it scores as
// completed) and notifies management the repair is complete.
export async function completeRoutedViolation(id: string, note: string, photos: string[] = []): Promise<BuildingViolation | null> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM building_violations WHERE id = ?', id);
  if (!row) return null;
  let v: BuildingViolation;
  try { v = JSON.parse(row.state) as BuildingViolation; } catch { return null; }
  const a = await getCurrentActor();
  const next: BuildingViolation = {
    ...v,
    status: 'done',
    completedBy: (a && a.name) || v.routedTo || '',
    completedAt: new Date().toISOString(),
    completionNote: (note || '').trim(),
    completionPhotos: photos || [],
  };
  await d.runAsync('UPDATE building_violations SET state=? WHERE id=?', JSON.stringify(next), next.id);
  await addNotification('management', 'Repair complete',
    (next.completedBy || 'Worker') + ' \u00b7 ' + next.building + '  \u00b7 ' + next.violationNo, next.id);
  await logAudit('worker', next.completedBy || '', 'Repair complete', next.building + ' \u00b7 ' + next.violationNo, next.id);
  return next;
}

export async function listBuildingViolations(building: string, violationNo: string = ''): Promise<BuildingViolation[]> {
  const d = await db();
  await ensureBuildingViolTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM building_violations');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as BuildingViolation; } catch { return null; } }).filter(Boolean) as BuildingViolation[];
  const b = (building || '').trim().toLowerCase();
  const n = (violationNo || '').trim().toLowerCase();
  return items
    .filter(v => (v.building || '').trim().toLowerCase() === b && (!n || (v.violationNo || '').trim().toLowerCase() === n))
    .sort((a, b) => (b.loggedAt || '').localeCompare(a.loggedAt || ''));
}

export async function deleteBuildingViolation(id: string): Promise<void> {
  const d = await db();
  await ensureBuildingViolTable(d);
  await queueMutation('building-violations', id, null, 'delete');
  await d.runAsync('DELETE FROM building_violations WHERE id = ?', id);
}

// ── Inspector route assignments (violation/address lists) ─────────────────
// A supervisor uploads a list of addresses and assigns it to one inspector.
// The inspector marks each stop Reached or Not reached as they go. At "Done for
// the day", any pending stop becomes not_reached, and not_reached stops sort to
// the top so unfinished work is front-and-center next time.
export type RouteStopStatus = 'pending' | 'reached' | 'not_reached';
export type RouteStop = { id: string; address: string; status: RouteStopStatus };
export type RouteAssignment = {
  id: string;
  inspector: string;      // assigned inspector's name
  assignedBy: string;
  assignedAt: string;
  fileName: string;
  stops: RouteStop[];
};

async function ensureRouteTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS route_assignments (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

// Parse pasted/CSV text into address lines. Takes the first column of each row
// (before a comma), trims, and drops blanks and an obvious header row.
export function parseAddressList(text: string): string[] {
  const rows = String(text || '').split(/\r?\n/);
  const out: string[] = [];
  for (const raw of rows) {
    const first = (raw.split(',')[0] || '').trim();
    if (!first) continue;
    if (/^address(es)?$/i.test(first)) continue;
    out.push(first);
  }
  return out;
}

export async function createRouteAssignment(inspector: string, addresses: string[], fileName: string): Promise<RouteAssignment> {
  const d = await db();
  await ensureRouteTable(d);
  const a = await getCurrentActor();
  const r: RouteAssignment = {
    id: uid(),
    inspector: (inspector || '').trim(),
    assignedBy: (a && a.name) || '',
    assignedAt: new Date().toISOString(),
    fileName: (fileName || '').trim(),
    stops: addresses.map(addr => ({ id: uid(), address: addr, status: 'pending' as RouteStopStatus })),
  };
  await d.runAsync('INSERT INTO route_assignments (id,state) VALUES (?,?)', r.id, JSON.stringify(r));
  await queueMutation('route-assignments', r.id, r);
  await addNotification(r.inspector, 'New route assigned', r.stops.length + ' stop' + (r.stops.length === 1 ? '' : 's'), r.id);
  return r;
}

async function saveRouteAssignment(d: any, r: RouteAssignment): Promise<void> {
  await d.runAsync('UPDATE route_assignments SET state=? WHERE id=?', JSON.stringify(r), r.id);
}

export async function getRouteAssignment(id: string): Promise<RouteAssignment | null> {
  const d = await db();
  await ensureRouteTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM route_assignments WHERE id = ?', id);
  if (!row) return null;
  try { return JSON.parse(row.state) as RouteAssignment; } catch { return null; }
}

// Lists for an inspector (their own name), newest first.
export async function listRouteAssignments(inspector: string): Promise<RouteAssignment[]> {
  const d = await db();
  await ensureRouteTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM route_assignments');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as RouteAssignment; } catch { return null; } }).filter(Boolean) as RouteAssignment[];
  const nm = (inspector || '').trim().toLowerCase();
  return items
    .filter(r => (r.inspector || '').trim().toLowerCase() === nm)
    .sort((a, b) => (b.assignedAt || '').localeCompare(a.assignedAt || ''));
}

export async function setRouteStopStatus(assignmentId: string, stopId: string, status: RouteStopStatus): Promise<RouteAssignment | null> {
  const d = await db();
  await ensureRouteTable(d);
  const r = await getRouteAssignment(assignmentId);
  if (!r) return null;
  r.stops = r.stops.map(s => s.id === stopId ? { ...s, status } : s);
  await saveRouteAssignment(d, r);
  await queueMutation('route-assignments', r.id, r);
  return r;
}

// End of day: any pending stop becomes not_reached, then not_reached stops sort
// to the top so they lead the list next time. Reached stops fall to the bottom.
export async function finishRouteDay(assignmentId: string): Promise<RouteAssignment | null> {
  const d = await db();
  await ensureRouteTable(d);
  const r = await getRouteAssignment(assignmentId);
  if (!r) return null;
  const bumped = r.stops.map(s => s.status === 'pending' ? { ...s, status: 'not_reached' as RouteStopStatus } : s);
  const rank = (s: RouteStop) => s.status === 'not_reached' ? 0 : s.status === 'pending' ? 1 : 2;
  bumped.sort((a, b) => rank(a) - rank(b));
  r.stops = bumped;
  await saveRouteAssignment(d, r);
  return r;
}

// ── Vendor quotes (the outward form procurement sends to vendors) ──────────
// Separate from the internal cost estimate. Each vendor company fills their own
// blank copy for a job, keyed by trackingId + vendor name, so ABC Co and HIJ
// each have their own. Reuses CostEstimateState shape but never touches the
// internal cost_estimates table. Submitting turns the total into a bid.
async function ensureVendorQuoteTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS vendor_quotes (key TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

function vendorQuoteKey(trackingId: string, vendorName: string): string {
  return (trackingId || '').trim().toLowerCase() + '::' + (vendorName || '').trim().toLowerCase();
}

export async function getVendorQuote(trackingId: string, vendorName: string): Promise<any> {
  const d = await db();
  await ensureVendorQuoteTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM vendor_quotes WHERE key = ?', vendorQuoteKey(trackingId, vendorName));
  return row ? JSON.parse(row.state) : null;
}

export async function setVendorQuote(trackingId: string, vendorName: string, state: any): Promise<void> {
  const d = await db();
  await ensureVendorQuoteTable(d);
  await d.runAsync(
    'INSERT INTO vendor_quotes (key,state) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET state = excluded.state',
    vendorQuoteKey(trackingId, vendorName), JSON.stringify(state),
  );
  await queueMutation('vendor-quotes', vendorQuoteKey(trackingId, vendorName), state);
}

// Vendor submits their filled quote as a bid: sum the category costs and file a
// bid for that amount (reuses the existing bid flow so procurement sees it).
export async function submitVendorQuoteAsBid(trackingId: string, vendorName: string, note: string = ''): Promise<ProcurementBid | null> {
  const state = await getVendorQuote(trackingId, vendorName);
  // New scope shape: sum every line's quantity * unit cost across all
  // divisions/sections. Falls back to the old rows shape for legacy quotes.
  const num = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
  let total = 0;
  if (state && Array.isArray(state.divisions)) {
    for (const d of state.divisions) {
      for (const sec of (d.sections || [])) {
        for (const l of (sec.lines || [])) total += num(l.quantity) * num(l.unitCost);
      }
    }
  } else if (state && state.rows) {
    for (const k of Object.keys(state.rows)) total += num(state.rows[k]?.cost);
  }
  return submitBid(trackingId, vendorName, total, note);
}

// ── CPM project scope (the internal Division/Section form) ─────────────
// Saved per project. This is the CPM's scope with descriptions/qty/unit AND
// their internal prices. When it reaches a vendor, prices are stripped and the
// work is locked (see stripPrices/usedOnly in lib/vendorScope).
async function ensureProjectScopeTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS project_scopes (projectId TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function getProjectScopeForm(projectId: string): Promise<any> {
  const d = await db();
  await ensureProjectScopeTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM project_scopes WHERE projectId = ?', projectId);
  return row ? JSON.parse(row.state) : null;
}

export async function setProjectScopeForm(projectId: string, state: any): Promise<void> {
  const d = await db();
  await ensureProjectScopeTable(d);
  const stateWithMeta = await withMeta(d, state);
  await d.runAsync(
    'INSERT INTO project_scopes (projectId,state) VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET state = excluded.state',
    projectId, JSON.stringify(stateWithMeta),
  );
  await queueMutation('project-scopes', projectId, stateWithMeta);
}

// ── Development scoring ────────────────────────────────────────────────────
// Each development earns/loses points from the work tied to it:
//   +10 completed, -5 open (< 14 days), -10 overdue (open 14+ days).
// Work is any scope, route, violation lookup, or resident report. A record's
// development is resolved from its creator's assigned development(s); resident
// reports carry their own development field. Records with no resolvable
// development fall under "Unassigned".
export type DevScoreItem = {
  id: string;
  kind: 'scope' | 'route' | 'violation' | 'report' | 'inspection';
  label: string;
  who: string;
  at: string;
  state: 'completed' | 'open' | 'overdue';
  points: number;
};
export type DevelopmentScore = {
  development: string;
  score: number;
  completed: number;
  open: number;
  overdue: number;
  items: DevScoreItem[];
};

const OVERDUE_DAYS = 14;
const PTS = { completed: 10, open: -5, overdue: -10 };

function daysSince(iso?: string): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return (Date.now() - t) / 86400000;
}
function stateFor(completed: boolean, startedIso?: string): 'completed' | 'open' | 'overdue' {
  if (completed) return 'completed';
  return daysSince(startedIso) >= OVERDUE_DAYS ? 'overdue' : 'open';
}

export async function getDevelopmentScores(): Promise<DevelopmentScore[]> {
  const staff = await listStaffAccounts();
  const devByName: Record<string, string> = {};
  for (const a of staff) {
    const nm = (a.name || '').trim().toLowerCase();
    const dev = (Array.isArray(a.developments) && a.developments[0]) ? String(a.developments[0]).trim() : '';
    if (nm && dev) devByName[nm] = dev;
  }
  const devOf = (who?: string) => devByName[(who || '').trim().toLowerCase()] || 'Unassigned';
  // Prefer the creator's development; otherwise bucket by the building address
  // so standalone buildings still get their own score line (not "Unassigned").
  const devOrBuilding = (who?: string, address?: string) => {
    const dev = devByName[(who || '').trim().toLowerCase()];
    if (dev) return dev;
    const addr = (address || '').trim();
    return addr || 'Unassigned';
  };

  const buckets: Record<string, DevelopmentScore> = {};
  const bucket = (dev: string): DevelopmentScore => {
    if (!buckets[dev]) buckets[dev] = { development: dev, score: 0, completed: 0, open: 0, overdue: 0, items: [] };
    return buckets[dev];
  };
  const add = (dev: string, it: DevScoreItem) => {
    const b = bucket(dev);
    b.items.push(it);
    b.score += it.points;
    if (it.state === 'completed') b.completed += 1;
    else if (it.state === 'overdue') b.overdue += 1;
    else b.open += 1;
  };
  const mk = (id: string, kind: DevScoreItem['kind'], label: string, who: string, at: string, state: 'completed'|'open'|'overdue'): DevScoreItem =>
    ({ id, kind, label, who, at, state, points: PTS[state] });

  const scopes = await listProcurementRequests();
  for (const r of scopes) {
    const st = stateFor(r.status === 'closed', r.requestedAt);
    const dev = devOrBuilding(r.requestedBy, r.address);
    add(dev, mk(r.id, 'scope', r.address || r.scope || 'Scope', r.requestedBy || '', r.closedAt || r.requestedAt || '', st));
  }
  const _rd = await db();
  await ensureRouteTable(_rd);
  const _rrows = await _rd.getAllAsync<{ state: string }>('SELECT state FROM route_assignments');
  const routes = _rrows.map((r: any) => { try { return JSON.parse(r.state) as RouteAssignment; } catch { return null; } }).filter(Boolean) as RouteAssignment[];
  for (const rt of routes) {
    const allDone = Array.isArray(rt.stops) && rt.stops.length > 0 && rt.stops.every((s) => s.status !== 'pending');
    const st = stateFor(allDone, rt.assignedAt);
    const firstStop = (rt.stops && rt.stops[0] && rt.stops[0].address) ? rt.stops[0].address : '';
    const dev = devOrBuilding(rt.assignedBy, firstStop);
    add(dev, mk(rt.id, 'route', 'Route \u00b7 ' + (rt.stops ? rt.stops.length : 0) + ' stops', rt.assignedBy || '', rt.assignedAt || '', st));
  }
  const viols = await listViolationLookups();
  for (const v of viols) {
    const st = stateFor(!!v.acknowledgedAt, v.sentAt);
    const dev = devOrBuilding(v.sentBy, v.address);
    add(dev, mk(v.id, 'violation', v.violationNumber + ' \u00b7 ' + (v.address || ''), v.sentBy || '', v.acknowledgedAt || v.sentAt || '', st));
  }
  const reports = await listResidentReports();
  for (const rp of reports) {
    const st = stateFor(rp.status === 'resolved', rp.createdAt);
    const dev = (rp.development && rp.development.trim()) ? rp.development.trim() : (rp.address && rp.address.trim() ? rp.address.trim() : 'Unassigned');
    add(dev, mk(rp.id, 'report', (rp.location || rp.unit || 'Report'), rp.residentName || '', rp.resolvedAt || rp.createdAt || '', st));
  }

  // Building violations (the inspection chain: logged -> approved -> routed ->
  // done). A 'done' one is completed; anything earlier is open/overdue by age.
  const _bd = await db();
  await ensureBuildingViolTable(_bd);
  const _bvrows = await _bd.getAllAsync<{ state: string }>('SELECT state FROM building_violations');
  const bviols = _bvrows.map((r: any) => { try { return JSON.parse(r.state) as BuildingViolation; } catch { return null; } }).filter(Boolean) as BuildingViolation[];
  for (const bv of bviols) {
    const done = bv.status === 'done';
    const started = bv.completedAt || bv.routedAt || bv.loggedAt;
    const st = stateFor(done, started);
    // Prefer the assigned worker's development, then the building address.
    const dev = devOrBuilding(bv.routedTo || bv.loggedBy, bv.building);
    add(dev, mk(bv.id, 'inspection', (bv.violationNo || 'Violation') + (bv.building ? ' \u00b7 ' + bv.building : ''), bv.completedBy || bv.routedTo || bv.loggedBy || '', bv.completedAt || bv.routedAt || bv.loggedAt || '', st));
  }

  return Object.values(buckets).sort((a, b) => b.score - a.score);
}

// Delete a route assignment (was missing — used by development score delete).
export async function deleteRouteAssignment(id: string): Promise<void> {
  const d = await db();
  await ensureRouteTable(d);
  await queueMutation('route-assignments', id, null, 'delete');
  await d.runAsync('DELETE FROM route_assignments WHERE id = ?', id);
}

// Unified delete for a development-score item. Removes the underlying record so
// it drops out of the score everywhere. Used by admin/management/procurement
// from the Development Scores detail.
export async function deleteDevelopmentScore(development: string): Promise<void> {
  const scores = await getDevelopmentScores();
  const bucket = scores.find(d => d.development === development);
  if (!bucket) return;
  for (const it of bucket.items) {
    try { await deleteScoreItem(it.kind as any, it.id); } catch (e) {}
  }
}

export async function deleteScoreItem(kind: 'scope' | 'route' | 'violation' | 'report', id: string): Promise<void> {
  if (kind === 'scope') return deleteProcurementRequest(id);
  if (kind === 'route') return deleteRouteAssignment(id);
  if (kind === 'violation') return deleteViolationLookup(id);
  if (kind === 'report') return deleteResidentReport(id);
  if (kind === 'inspection') return deleteBuildingViolation(id);
}

// ── Elevator jobs ──────────────────────────────────────────────────────────
// Created when management assigns a job to an Elevator Service mechanic. Each
// gets a unique EL- id. The mechanic fills the (no-pricing) Elevator Services
// form keyed to this job; the Elevator Supervisor sees all jobs + mechanics.
export type ElevatorJob = {
  id: string;
  elId: string;          // EL-XXXXX
  address: string;
  unit: string;
  mechanic: string;      // assigned mechanic's name
  refNum: string;        // originating complaint/violation number
  issue: string;
  assignedBy: string;
  assignedAt: string;
  status: 'assigned' | 'done';
  onMyWayAt?: string;
  startedAt?: string;
  completedAt?: string;
};

async function ensureElevatorJobTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS elevator_jobs (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function createElevatorJob(address: string, unit: string, mechanic: string, refNum: string, issue: string): Promise<ElevatorJob> {
  const d = await db();
  await ensureElevatorJobTable(d);
  const a = await getCurrentActor();
  const job: ElevatorJob = {
    id: uid(),
    elId: 'EL-' + Math.floor(10000 + Math.random() * 90000),
    address: (address || '').trim(),
    unit: (unit || '').trim(),
    mechanic: (mechanic || '').trim(),
    refNum: (refNum || '').trim(),
    issue: (issue || '').trim(),
    assignedBy: (a && a.name) || 'management',
    assignedAt: new Date().toISOString(),
    status: 'assigned',
  };
  await d.runAsync('INSERT INTO elevator_jobs (id,state) VALUES (?,?)', job.id, JSON.stringify(job));
  await queueMutation('elevator-jobs', job.id, job);
  if (job.mechanic) await addNotification(job.mechanic, 'Elevator job assigned', job.elId + ' \u00b7 ' + job.address + (job.issue ? ' \u00b7 ' + job.issue : ''), job.id);
  await logAudit(job.assignedBy, job.assignedBy, 'Elevator job assigned', job.elId + ' \u2192 ' + job.mechanic, job.id);
  return job;
}

export async function listElevatorJobs(): Promise<ElevatorJob[]> {
  const d = await db();
  await ensureElevatorJobTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM elevator_jobs');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as ElevatorJob; } catch { return null; } }).filter(Boolean) as ElevatorJob[];
  return items.sort((a, b) => (b.assignedAt || '').localeCompare(a.assignedAt || ''));
}

export async function listElevatorJobsForMechanic(name: string): Promise<ElevatorJob[]> {
  const all = await listElevatorJobs();
  const nm = (name || '').trim().toLowerCase();
  return all.filter(j => (j.mechanic || '').trim().toLowerCase() === nm);
}

// Stamp a progress stage on the elevator job (onMyWay | started) and ping
// management + Elevator Supervisor. Persists so the buttons stay greyed.
export async function setElevatorProgress(id: string, stage: 'onMyWay' | 'started'): Promise<ElevatorJob | null> {
  const d = await db();
  await ensureElevatorJobTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM elevator_jobs WHERE id = ?', id);
  if (!row) return null;
  let job: ElevatorJob;
  try { job = JSON.parse(row.state) as ElevatorJob; } catch { return null; }
  const now = new Date().toISOString();
  const next: ElevatorJob = { ...job };
  if (stage === 'onMyWay') next.onMyWayAt = now;
  if (stage === 'started') next.startedAt = now;
  await d.runAsync('UPDATE elevator_jobs SET state=? WHERE id=?', JSON.stringify(next), next.id);
  const a = await getCurrentActor();
  const who = (a && a.name) || job.mechanic;
  const label = stage === 'onMyWay' ? 'On my way' : 'Started job';
  const detail = who + '  \u00b7 ' + label + '  \u00b7 ' + job.elId + ' ' + job.address;
  await addNotification('management', 'Elevator update', detail, job.id);
  await addNotification('Elevator Supervisor', 'Elevator update', detail, job.id);
  return next;
}

// Mechanic submits the finished elevator report. Marks the job done and
// notifies management + the Elevator Supervisor (the report + photos are already
// saved on the elevator form, visible in the Elevator Dashboard).
export async function completeElevatorJob(id: string): Promise<ElevatorJob | null> {
  const d = await db();
  await ensureElevatorJobTable(d);
  const row = await d.getFirstAsync<{ state: string }>('SELECT state FROM elevator_jobs WHERE id = ?', id);
  if (!row) return null;
  let job: ElevatorJob;
  try { job = JSON.parse(row.state) as ElevatorJob; } catch { return null; }
  const a = await getCurrentActor();
  const next: ElevatorJob = { ...job, status: 'done', completedAt: new Date().toISOString() };
  await d.runAsync('UPDATE elevator_jobs SET state=? WHERE id=?', JSON.stringify(next), next.id);
  const detail = next.elId + '  \u00b7 ' + next.address + '  \u00b7 by ' + ((a && a.name) || next.mechanic);
  await addNotification('management', 'Elevator job completed', detail, next.id);
  await addNotification('Elevator Supervisor', 'Elevator job completed', detail, next.id);
  await logAudit('worker', (a && a.name) || next.mechanic, 'Elevator job completed', next.elId + ' \u00b7 ' + next.address, next.id);
  return next;
}

// The mechanic pings management/supervisor with an en-route status (On my way,
// Started job, etc.). Not visible to tenants.
export async function elevatorStatusPing(id: string, status: string): Promise<void> {
  const job = await getElevatorJob(id);
  if (!job) return;
  const a = await getCurrentActor();
  const who = (a && a.name) || job.mechanic;
  const detail = who + '  \u00b7 ' + status + '  \u00b7 ' + job.elId + ' ' + job.address;
  await addNotification('management', 'Elevator update', detail, job.id);
  await addNotification('Elevator Supervisor', 'Elevator update', detail, job.id);
}

export async function getElevatorJob(id: string): Promise<ElevatorJob | null> {
  const all = await listElevatorJobs();
  return all.find(j => j.id === id || j.elId === id) || null;
}

// All distinct addresses known to the system, for address autocomplete.
// Addresses tied to a specific development (from resident reports + emergency
// jobs that carry both), most-recent first. For the development-scoped picker.
export async function listAddressesForDevelopment(development: string): Promise<string[]> {
  const dev = (development || '').trim().toLowerCase();
  if (!dev) return [];
  const map: Record<string, { addr: string; at: string }> = {};
  const push = (addr?: string, jobDev?: string, at?: string) => {
    if ((jobDev || '').trim().toLowerCase() !== dev) return;
    const t = (addr || '').trim(); if (!t) return;
    const k = t.toLowerCase(); const ts = at || '';
    if (!map[k] || ts > map[k].at) map[k] = { addr: t, at: ts };
  };
  try { for (const r of await listResidentReports()) push(r.address, r.development, (r as any).createdAt); } catch (e) {}
  try { for (const j of await listEmergencyJobs()) push(j.address, j.development, (j as any).assignedAt); } catch (e) {}
  return Object.values(map).sort((a, b) => (b.at || '').localeCompare(a.at || '')).map(x => x.addr);
}

export async function listAllAddresses(): Promise<string[]> {
  // Collect each distinct address with its most-recent timestamp, newest first,
  // so autocomplete surfaces recently used addresses.
  const map: Record<string, { addr: string; at: string }> = {};
  const push = (v?: string, at?: string) => {
    const t = (v || '').trim(); if (!t) return;
    const k = t.toLowerCase(); const ts = at || '';
    if (!map[k] || ts > map[k].at) map[k] = { addr: t, at: ts };
  };
  try { for (const p of await listProjects()) push(p.name, (p as any).createdAt); } catch (e) {}
  try { for (const r of await listProcurementRequests()) push(r.address, (r as any).requestedAt); } catch (e) {}
  try { for (const r of await listResidentReports()) push(r.address, (r as any).createdAt); } catch (e) {}
  try { for (const v of await listViolationLookups()) push(v.address, (v as any).sentAt); } catch (e) {}
  try { for (const j of await listElevatorJobs()) push(j.address, (j as any).assignedAt); } catch (e) {}
  try { for (const j of await listEmergencyJobs()) push(j.address, (j as any).assignedAt); } catch (e) {}
  return Object.values(map).sort((a, b) => (b.at || '').localeCompare(a.at || '')).map(x => x.addr);
}

// ── Emergency jobs (Truck units) ───────────────────────────────────────────
// Management assigns a development + truck label + issue; gets an EM- id. The
// unit updates progress + photos via the shared Emergency Units screen; updates
// flow back to the assigning supervisor.
export type EmergencyJob = {
  id: string;
  emId: string;              // EM-XXXXX
  truck: string;             // user-entered truck label, e.g. "Truck 1"
  development: string;
  address: string;
  location: string;
  issue: string;
  photos: string[];
  assignedBy: string;
  assignedAt: string;
  status: 'assigned' | 'done';
  onMyWayAt?: string;
  startedAt?: string;
  completedAt?: string;
  note?: string;
};

async function ensureEmergencyTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS emergency_jobs (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function createEmergencyJob(truck: string, development: string, address: string, issue: string, location: string = ''): Promise<EmergencyJob> {
  const d = await db();
  await ensureEmergencyTable(d);
  const a = await getCurrentActor();
  const job: EmergencyJob = {
    id: uid(),
    emId: 'EM-' + Math.floor(10000 + Math.random() * 90000),
    truck: (truck || '').trim(),
    development: (development || '').trim(),
    address: (address || '').trim(),
    location: (location || '').trim(),
    issue: (issue || '').trim(),
    photos: [],
    assignedBy: (a && a.name) || 'management',
    assignedAt: new Date().toISOString(),
    status: 'assigned',
  };
  await d.runAsync('INSERT INTO emergency_jobs (id,state) VALUES (?,?)', job.id, JSON.stringify(job));
  await queueMutation('emergency-jobs', job.id, job);
  await logAudit(job.assignedBy, job.assignedBy, 'Emergency unit assigned', job.emId + ' \u2192 ' + job.truck, job.id);
  return job;
}

export async function listEmergencyJobs(): Promise<EmergencyJob[]> {
  const d = await db();
  await ensureEmergencyTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM emergency_jobs');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as EmergencyJob; } catch { return null; } }).filter(Boolean) as EmergencyJob[];
  return items.sort((a, b) => (b.assignedAt || '').localeCompare(a.assignedAt || ''));
}

export async function listEmergencyJobsForTruck(truck: string): Promise<EmergencyJob[]> {
  const all = await listEmergencyJobs();
  const t = (truck || '').trim().toLowerCase();
  return all.filter(j => (j.truck || '').trim().toLowerCase() === t);
}

export async function getEmergencyJob(id: string): Promise<EmergencyJob | null> {
  const all = await listEmergencyJobs();
  return all.find(j => j.id === id || j.emId === id) || null;
}

async function _saveEmergencyJob(job: EmergencyJob): Promise<void> {
  const d = await db();
  await ensureEmergencyTable(d);
  await d.runAsync('UPDATE emergency_jobs SET state=? WHERE id=?', JSON.stringify(job), job.id);
  await queueMutation('emergency-jobs', job.id, job);
}

// Progress ping (onMyWay | started) -> notifies the assigning supervisor.
export async function setEmergencyProgress(id: string, stage: 'onMyWay' | 'started'): Promise<EmergencyJob | null> {
  const job = await getEmergencyJob(id);
  if (!job) return null;
  const now = new Date().toISOString();
  const next = { ...job };
  if (stage === 'onMyWay') next.onMyWayAt = now;
  if (stage === 'started') next.startedAt = now;
  await _saveEmergencyJob(next);
  const label = stage === 'onMyWay' ? 'On my way' : 'Started';
  return next;
}

// Add a photo to the emergency job (visible to the assigning supervisor).
export async function addEmergencyPhoto(id: string, uri: string): Promise<EmergencyJob | null> {
  const job = await getEmergencyJob(id);
  if (!job) return null;
  const next = { ...job, photos: [...(job.photos || []), uri] };
  await _saveEmergencyJob(next);
  return next;
}

// Complete the emergency job -> notify the assigning supervisor.
export async function completeEmergencyJob(id: string, note: string = ''): Promise<EmergencyJob | null> {
  const job = await getEmergencyJob(id);
  if (!job) return null;
  const a = await getCurrentActor();
  const next: EmergencyJob = { ...job, status: 'done', completedAt: new Date().toISOString(), note: (note || '').trim() || job.note };
  await _saveEmergencyJob(next);
  await logAudit('emergency', job.truck, 'Emergency job completed', job.emId, job.id);
  return next;
}

// ── Emergency units (trucks) ───────────────────────────────────────────────
// Registered by admin/Borough Director/Regional Director. Each truck has a name
// and an auto-generated code; the unit enters the code to pull up its jobs.
export type EmergencyUnit = {
  id: string;
  name: string;     // e.g. "Truck 1"
  code: string;     // e.g. "TRK-4821"
  createdAt: string;
};

async function ensureEmergencyUnitTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS emergency_units (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

export async function createEmergencyUnit(name: string): Promise<EmergencyUnit> {
  const d = await db();
  await ensureEmergencyUnitTable(d);
  const u: EmergencyUnit = {
    id: uid(),
    name: (name || '').trim(),
    code: 'TRK-' + Math.floor(1000 + Math.random() * 9000),
    createdAt: new Date().toISOString(),
  };
  await d.runAsync('INSERT INTO emergency_units (id,state) VALUES (?,?)', u.id, JSON.stringify(u));
  await queueMutation('emergency-units', u.id, u);
  const a = await getCurrentActor();
  await logAudit(a.role || 'administrator', a.name || '', 'Emergency unit created', u.name + ' \u00b7 ' + u.code, u.id);
  return u;
}

export async function listEmergencyUnits(): Promise<EmergencyUnit[]> {
  const d = await db();
  await ensureEmergencyUnitTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM emergency_units');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as EmergencyUnit; } catch { return null; } }).filter(Boolean) as EmergencyUnit[];
  return items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function getEmergencyUnitByCode(code: string): Promise<EmergencyUnit | null> {
  const all = await listEmergencyUnits();
  const c = (code || '').trim().toLowerCase();
  return all.find(u => (u.code || '').trim().toLowerCase() === c) || null;
}

export async function deleteEmergencyUnit(id: string): Promise<void> {
  const d = await db();
  await ensureEmergencyUnitTable(d);
  await queueMutation('emergency-units', id, null, 'delete');
  await d.runAsync('DELETE FROM emergency_units WHERE id = ?', id);
}

// ── Truck (emergency unit) scoring ─────────────────────────────────────────
// Each truck earns +10 per completed emergency, -5 per still-active one.
export type TruckScoreItem = { emId: string; label: string; state: 'completed' | 'active'; points: number; at: string };
export type TruckScore = { truck: string; score: number; completed: number; active: number; items: TruckScoreItem[] };

export async function getTruckScores(): Promise<TruckScore[]> {
  const jobs = await listEmergencyJobs();
  const units = await listEmergencyUnits().catch(() => []);
  const buckets: Record<string, TruckScore> = {};
  const bucket = (t: string): TruckScore => {
    if (!buckets[t]) buckets[t] = { truck: t, score: 0, completed: 0, active: 0, items: [] };
    return buckets[t];
  };
  // Seed registered trucks so they show even with no jobs yet.
  for (const u of units) bucket(u.name);
  for (const j of jobs) {
    const t = (j.truck || '').trim() || 'Unassigned';
    const b = bucket(t);
    const done = j.status === 'done';
    const pts = done ? 10 : -5;
    b.score += pts;
    if (done) b.completed += 1; else b.active += 1;
    b.items.push({ emId: j.emId, label: (j.development || j.address || '') + (j.issue ? ' \u00b7 ' + j.issue : ''), state: done ? 'completed' : 'active', points: pts, at: j.completedAt || j.assignedAt || '' });
  }
  return Object.values(buckets).sort((a, b) => b.score - a.score);
}

// ── Leave / time-off (development-level) ───────────────────────────────────
export type LeaveType = 'Vacation' | 'Sick' | 'Childcare' | 'Personal' | 'LOA'
  | 'Family Emergency' | 'Jury Duty' | 'Bereavement' | 'Other';
export type LeaveStatus = 'Pending' | 'Approved' | 'Denied' | 'Cancelled';

export const LEAVE_TYPES: LeaveType[] = ['Vacation', 'Sick', 'Childcare', 'Personal', 'LOA', 'Family Emergency', 'Jury Duty', 'Bereavement', 'Other'];

// Standard annual allotment (days). 0 = untracked/unlimited.
export const LEAVE_ALLOTMENT: Record<LeaveType, number> = {
  Vacation: 20, Sick: 10, Childcare: 12, Personal: 5, LOA: 0,
  'Family Emergency': 5, 'Jury Duty': 0, Bereavement: 5, Other: 0,
};

export type LeaveRequest = {
  id: string;
  employee: string;        // employee name
  title: string;          // title/trade (position snapshot)
  development: string;
  supervisor: string;
  type: LeaveType;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  days: number;            // total days requested
  hours?: number;          // optional partial-day hours (8h = 1 day)
  approvedDays?: number;   // total days approved (defaults to days on approve)
  reason?: string;
  status: LeaveStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
};

async function ensureLeaveTable(d: any) {
  try { await d.execAsync('CREATE TABLE IF NOT EXISTS leave_requests (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)'); } catch (e) {}
}

function daysBetween(start: string, end: string): number {
  try {
    const a = new Date(start + 'T00:00:00'); const b = new Date(end + 'T00:00:00');
    const ms = b.getTime() - a.getTime();
    if (isNaN(ms) || ms < 0) return 1;
    return Math.round(ms / 86400000) + 1; // inclusive
  } catch { return 1; }
}

export async function createLeaveRequest(input: {
  employee: string; title?: string; development?: string; supervisor?: string;
  type: LeaveType; startDate: string; endDate: string; reason?: string; hours?: number;
}): Promise<LeaveRequest> {
  const d = await db();
  await ensureLeaveTable(d);
  const a = await getCurrentActor();
  const req: LeaveRequest = {
    id: uid(),
    employee: (input.employee || '').trim(),
    title: (input.title || '').trim(),
    development: (input.development || '').trim(),
    supervisor: (input.supervisor || '').trim(),
    type: input.type,
    startDate: (input.startDate || '').trim(),
    endDate: (input.endDate || input.startDate || '').trim(),
    days: daysBetween(input.startDate, input.endDate || input.startDate),
    hours: (input.hours && input.hours > 0) ? input.hours : undefined,
    reason: (input.reason || '').trim() || undefined,
    status: 'Pending',
    requestedBy: (a && a.name) || (input.employee || ''),
    requestedAt: new Date().toISOString(),
  };
  await d.runAsync('INSERT INTO leave_requests (id,state) VALUES (?,?)', req.id, JSON.stringify(req));
  await queueMutation('leave-requests', req.id, req);
  await addNotification('management', 'Leave request', req.employee + ' \u00b7 ' + req.type + ' \u00b7 ' + req.startDate + (req.endDate && req.endDate !== req.startDate ? ' \u2013 ' + req.endDate : '') + (req.development ? ' \u00b7 ' + req.development : ''), req.id);
  await logAudit((a && a.role) || 'management', (a && a.name) || '', 'Leave requested', req.employee + ' \u00b7 ' + req.type, req.id);
  return req;
}

export async function listLeaveRequests(): Promise<LeaveRequest[]> {
  const d = await db();
  await ensureLeaveTable(d);
  const rows = await d.getAllAsync<{ state: string }>('SELECT state FROM leave_requests');
  const items = rows.map((r: any) => { try { return JSON.parse(r.state) as LeaveRequest; } catch { return null; } }).filter(Boolean) as LeaveRequest[];
  return items.sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
}

export async function listLeaveForEmployee(name: string): Promise<LeaveRequest[]> {
  const all = await listLeaveRequests();
  const nm = (name || '').trim().toLowerCase();
  return all.filter(r => (r.employee || '').trim().toLowerCase() === nm);
}

export async function getLeaveRequest(id: string): Promise<LeaveRequest | null> {
  const all = await listLeaveRequests();
  return all.find(r => r.id === id) || null;
}

async function _saveLeave(req: LeaveRequest) {
  const d = await db();
  await ensureLeaveTable(d);
  await d.runAsync('UPDATE leave_requests SET state=? WHERE id=?', JSON.stringify(req), req.id);
}

export async function decideLeaveRequest(id: string, status: LeaveStatus, approvedDays?: number): Promise<LeaveRequest | null> {
  const req = await getLeaveRequest(id);
  if (!req) return null;
  const a = await getCurrentActor();
  const next: LeaveRequest = { ...req, status, decidedBy: (a && a.name) || 'management', decidedAt: new Date().toISOString() };
  if (status === 'Approved') next.approvedDays = (approvedDays != null ? approvedDays : req.days);
  await _saveLeave(next);
  await addNotification(req.employee, 'Leave ' + status.toLowerCase(), req.type + ' \u00b7 ' + req.startDate + ' (' + status + ')', req.id);
  await logAudit((a && a.role) || 'management', (a && a.name) || '', 'Leave ' + status.toLowerCase(), req.employee + ' \u00b7 ' + req.type, req.id);
  return next;
}

export async function cancelLeaveRequest(id: string): Promise<void> {
  const req = await getLeaveRequest(id);
  if (!req) return;
  await _saveLeave({ ...req, status: 'Cancelled' });
}

export async function deleteLeaveRequest(id: string): Promise<void> {
  const d = await db();
  await ensureLeaveTable(d);
  await queueMutation('leave-requests', id, null, 'delete');
  await d.runAsync('DELETE FROM leave_requests WHERE id = ?', id);
}

// Remaining balance per leave type for an employee this calendar year
// (allotment minus APPROVED days). 0 allotment = unlimited (returns -1).
export type LeaveBalance = { type: LeaveType; allotment: number; used: number; remaining: number };
export async function leaveBalances(name: string): Promise<LeaveBalance[]> {
  const mine = await listLeaveForEmployee(name);
  const year = new Date().getFullYear();
  return LEAVE_TYPES.map((t) => {
    const allotment = LEAVE_ALLOTMENT[t];
    const used = mine
      .filter(r => r.type === t && r.status === 'Approved' && (r.startDate || '').startsWith(String(year)))
      .reduce((sum, r) => sum + (r.hours && r.hours > 0 ? r.hours / 8 : (r.approvedDays != null ? r.approvedDays : r.days)), 0);
    const usedR = Math.round(used * 10) / 10;
    return { type: t, allotment, used: usedR, remaining: allotment > 0 ? Math.round(Math.max(0, allotment - usedR) * 10) / 10 : -1 };
  });
}

// Prefill data for a leave request: an employee's title, development, and the
// management/supervisor for that development (first match).
export async function leavePrefillForEmployee(name: string): Promise<{ title: string; development: string; supervisor: string }> {
  const all = await listStaffAccounts('approved');
  const nm = (name || '').trim().toLowerCase();
  const acct = all.find(a => (a.name || '').trim().toLowerCase() === nm);
  if (!acct) return { title: '', development: '', supervisor: '' };
  const title = acct.position || '';
  const development = (Array.isArray(acct.developments) && acct.developments[0]) ? String(acct.developments[0]) : '';
  let supervisor = '';
  if (development) {
    const mgrs = await listManagementForDevelopment(development).catch(() => []);
    if (mgrs && mgrs[0]) supervisor = mgrs[0].name || '';
  }
  return { title, development, supervisor };
}

// Approved staff names for the employee autocomplete.
export async function listStaffNames(): Promise<string[]> {
  const all = await listStaffAccounts('approved');
  return Array.from(new Set(all.map(a => (a.name || '').trim()).filter(Boolean))).sort();
}
