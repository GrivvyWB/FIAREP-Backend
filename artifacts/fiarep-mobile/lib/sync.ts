import {
  createEntityRecord,
  deleteEntityRecord,
  pullSync,
  performEntityAction,
  updateEntityRecord,
} from '@workspace/api-client-react';
import { db, getAccessToken, getAlertsMuted, getCurrentActor, getSessionIdentity } from './store';
import { ensureQueue } from './queue';
import { registerRemotePhotos } from './photoResolver';
import { notifyLocal } from './push';

// This is deliberately data-driven: adding a local state table only requires
// adding its backend entity and key column here, not another sync algorithm.
const TABLES: Array<{ table: string; entity: string; key: string; column?: 'state' | 'data' }> = [
  { table: 'projects', entity: 'projects', key: 'id' },
  { table: 'rooms', entity: 'rooms', key: 'id' },
  { table: 'checklists', entity: 'checklists', key: 'projectId' },
  { table: 'roofplans', entity: 'roofplans', key: 'projectId', column: 'data' },
  { table: 'inspections', entity: 'inspections', key: 'projectId' },
  { table: 'hud_inspections', entity: 'hud-inspections', key: 'id' },
  { table: 'cost_estimates', entity: 'cost-estimates', key: 'projectId' },
  { table: 'intakes', entity: 'intakes', key: 'projectId' },
  { table: 'elevators', entity: 'elevators', key: 'projectId' },
  { table: 'project_scopes', entity: 'project-scopes', key: 'projectId' },
  { table: 'project_notes', entity: 'project-notes', key: 'id' },
  { table: 'project_reviews', entity: 'project-reviews', key: 'id' },
  { table: 'resident_reports', entity: 'resident-reports', key: 'id' },
  { table: 'violations', entity: 'violations', key: 'id' },
  { table: 'building_violations', entity: 'building-violations', key: 'id' },
  { table: 'priority_violations', entity: 'priority-violations', key: 'id' },
  { table: 'route_assignments', entity: 'route-assignments', key: 'id' },
  { table: 'procurement', entity: 'procurement', key: 'id' },
  { table: 'manpower_requests', entity: 'manpower-requests', key: 'id' },
  { table: 'procurement_bids', entity: 'procurement-bids', key: 'id' },
  { table: 'vendor_contacts', entity: 'vendor-contacts', key: 'id' },
  { table: 'vendor_quotes', entity: 'vendor-quotes', key: 'key' },
  { table: 'change_orders', entity: 'change-orders', key: 'id' },
  { table: 'elevator_jobs', entity: 'elevator-jobs', key: 'id' },
  { table: 'emergency_units', entity: 'emergency-units', key: 'id' },
  { table: 'emergency_jobs', entity: 'emergency-jobs', key: 'id' },
  { table: 'leave_requests', entity: 'leave-requests', key: 'id' },
  { table: 'global_settings', entity: 'global-settings', key: 'id' },
];
const ROLE_ENTITIES: Record<string, Set<string>> = {
  administrator: new Set(TABLES.map((item) => item.entity)),
  management: new Set(TABLES.map((item) => item.entity)),
  inspector: new Set(['projects', 'rooms', 'checklists', 'roofplans', 'inspections', 'hud-inspections', 'cost-estimates', 'intakes', 'elevators', 'project-scopes', 'project-notes', 'project-reviews', 'resident-reports', 'building-violations', 'manpower-requests', 'violations', 'priority-violations', 'route-assignments', 'procurement', 'global-settings']),
  worker: new Set(['projects', 'rooms', 'project-notes', 'project-reviews', 'resident-reports', 'building-violations', 'manpower-requests', 'violations', 'elevator-jobs', 'emergency-jobs', 'leave-requests', 'global-settings']),
  vendor: new Set(['projects', 'project-scopes', 'project-notes', 'project-reviews', 'building-violations', 'route-assignments', 'procurement', 'procurement-bids', 'vendor-contacts', 'vendor-quotes']),
  resident: new Set(['resident-reports']),
  // Emergency devices only request the emergency tables. The server still
  // applies assignment filtering to each returned record.
  emergency: new Set(['emergency-units', 'emergency-jobs', 'manpower-requests']),
};
const PROJECT_KEYED = new Set(['checklists', 'roofplans', 'inspections', 'cost-estimates', 'intakes', 'elevators', 'project-scopes']);
function normalizeLocalState(mapping: any, state: any) {
  if (mapping.table === 'projects') {
    const meta = { ...(state.meta || {}) };
    const nested = meta._meta || state._meta || {};
    if (nested.serverVersion && !meta.serverVersion) Object.assign(meta, nested);
    delete meta._meta;
    delete state._meta;
    state.meta = meta;
  } else if (mapping.table === 'rooms') {
    const scan = { ...(state.scan || {}) };
    const meta = scan._meta || state._meta || {};
    scan._meta = meta;
    delete state._meta;
    state.scan = scan;
  }
  return state;
}

type QueueRow = { entity: string; id: string; state: string; operation: string; baseVersion?: number; status: string };
const WORKFLOW_FIELDS = new Set(['status', 'clearedByMgmt', 'submitAt', 'approveAt', 'rejectAt', 'returnAt', 'broadcastAt', 'awardAt', 'rate_closeAt', 'assignAt', 'startAt', 'resolveAt', 'clearAt', 'completeAt', 'denyAt', 'cancelAt', 'on_my_wayAt', 'approvedAt', 'returnedAt', 'assignedAt', 'startedAt', 'resolvedAt', 'completedAt', 'cancelledAt']);
function writableState(entity: string, state: Record<string, any>) {
  const copy = { ...state };
  delete copy._meta;
  delete copy._pendingWorkflowActions;
  if (['procurement', 'resident-reports', 'building-violations', 'leave-requests', 'elevator-jobs', 'emergency-jobs', 'hud-inspections'].includes(entity)) {
    for (const key of WORKFLOW_FIELDS) delete copy[key];
    if (entity === 'hud-inspections') delete copy.review;
  }
  return copy;
}
async function prepareUploadState(
  entity: string,
  recordId: string,
  state: Record<string, any>,
) {
  const photos = Array.isArray(state.photos) ? state.photos : [];
  const completionPhotos = Array.isArray(state.completionPhotos) ? state.completionPhotos : [];
  const photoEvidence = Array.isArray(state.photoEvidence) ? state.photoEvidence : [];
  const completionPhotoEvidence = Array.isArray(state.completionPhotoEvidence) ? state.completionPhotoEvidence : [];
  const localPhotos = [...new Set([...photos, ...completionPhotos])];
  if (!localPhotos.length) return state;
  const kind = entity === 'change-orders' || entity === 'emergency-jobs' || entity === 'elevator-jobs'
    ? 'completion-photo' : entity === 'inspections' || entity === 'building-violations'
      ? 'inspection-evidence' : 'room-photo';
  const { uploadPhoto } = await import('./photos');
  const remoteFiles = Array.isArray(state.remoteFiles) ? [...state.remoteFiles] : [];
  const evidenceFor = (localUri: string) => {
    const source = completionPhotos.includes(localUri) ? completionPhotos : photos;
    const evidence = completionPhotos.includes(localUri) ? completionPhotoEvidence : photoEvidence;
    const sourceIndex = source.indexOf(localUri);
    const evidenceIndex = sourceIndex - Math.max(0, source.length - evidence.length);
    const stamp = evidenceIndex >= 0 ? evidence[evidenceIndex] : undefined;
    return stamp && typeof stamp === 'object'
      ? { capturedAt: stamp.capturedAt, geo: stamp.geo }
      : undefined;
  };
  for (const localUri of localPhotos) {
    if (remoteFiles.some((file: any) => file.localUri === localUri)) continue;
    try {
      const uploadKind = completionPhotos.includes(localUri) ? 'completion-photo' : kind;
      remoteFiles.push({
        ...(await uploadPhoto(localUri, uploadKind as any, {
          entity,
          recordId,
         }, evidenceFor(localUri))),
        localUri,
      });
    } catch { /* retained for retry */ }
  }
  return remoteFiles.length ? { ...state, remoteFiles } : state;
}
export function shouldApplyRemote(hasPendingLocal: boolean): boolean {
  return !hasPendingLocal;
}

function stateColumn(mapping: { table: string; column?: string }): string {
  return mapping.table === 'rooms' || mapping.table === 'projects' ? '' : (mapping.column || 'state');
}

async function discoverQueue(d: any) {
  await ensureQueue(d);
  const identity = await getSessionIdentity();
  const owner = `${identity?.tenantId || 'default'}:${identity?.staffId || ''}`;
  for (const mapping of TABLES) {
    try {
      const rows = await d.getAllAsync(`SELECT * FROM ${mapping.table}`) as any[];
      for (const row of rows) {
        const id = String(row[mapping.key]);
        if (!id) continue;
        let state: any;
        if (stateColumn(mapping)) {
          try { state = JSON.parse(row[stateColumn(mapping)]); } catch { continue; }
        } else {
          state = { ...row };
          delete state.id;
          if (mapping.table === 'projects') {
            try { state.meta = row.meta ? JSON.parse(row.meta) : {}; } catch { state.meta = {}; }
            try { state.rates = row.rates ? JSON.parse(row.rates) : null; } catch {}
          }
          try { state.lines = JSON.parse(row.lines); } catch {}
          try { state.photos = JSON.parse(row.photos); } catch {}
          try { state.walls2d = JSON.parse(row.walls2d); } catch {}
          try { state.scan = JSON.parse(row.scan); } catch {}
          try { state.remoteFiles = JSON.parse(row.remoteFiles); } catch {}
        }
        normalizeLocalState(mapping, state);
        if (mapping.entity === 'hud-inspections' &&
            state.status !== 'completed' &&
            !state._meta?.serverVersion) continue;
        const encoded = JSON.stringify(state);
        const prior = await d.getFirstAsync(
          'SELECT * FROM sync_queue WHERE owner=? AND entity = ? AND id = ?', owner, mapping.entity, id,
        );
        // Pulled records carry authoritative metadata. Do not enqueue them
        // again on every foreground pass; only an explicit local mutation
        // (which changes the metadata to local) should enter the queue.
        const cleanMeta = mapping.table === 'projects' ? state.meta : mapping.table === 'rooms' ? state.scan?._meta : state._meta;
        if (cleanMeta?.syncStatus === 'synced' && !prior) continue;
        // A shadow fingerprint prevents unchanged clean records being pushed
        // on every foreground event, while preserving all offline mutations.
        if (!prior || prior.state !== encoded) {
          const version = Number(cleanMeta?.serverVersion || 0) || undefined;
          await d.runAsync(
            `INSERT INTO sync_queue(entity,id,state,operation,baseVersion,owner,status)
             VALUES (?,?,?,?,?,?,'pending')
             ON CONFLICT(owner,entity,id) DO UPDATE SET state=excluded.state,
               operation=excluded.operation,baseVersion=excluded.baseVersion,owner=excluded.owner,status='pending',error=NULL`,
            mapping.entity, id, encoded, 'upsert', version ?? null, owner,
          );
        }
      }
    } catch {
      // Tables are lazily created by feature stores; absent tables are normal.
    }
  }
}

async function pushQueue(d: any) {
  const identity = await getSessionIdentity();
  const owner = `${identity?.tenantId || 'default'}:${identity?.staffId || ''}`;
  const rows = await d.getAllAsync(
    `SELECT * FROM sync_queue WHERE owner=? AND status IN ('pending','conflict') ORDER BY rowid`, owner,
  );
  for (const row of rows) {
    try {
      const state = row.state ? JSON.parse(row.state) : {};
      const pendingActions = Array.isArray(state._pendingWorkflowActions)
        ? state._pendingWorkflowActions
        : [];
      if (PROJECT_KEYED.has(row.entity) && !state.projectId) state.projectId = row.id;
      const localMapping = TABLES.find((item) => item.entity === row.entity);
      const input: any = {
        id: row.id,
        state: writableState(row.entity, state),
        ...(state.projectId ? { projectId: state.projectId } : {}),
        ...((state.development || state.meta?.development) ? { development: state.development || state.meta.development } : {}),
      };
      if (row.baseVersion) input.version = row.baseVersion;
      let result: any;
      if (row.operation === 'delete') {
        if (!row.baseVersion) throw new Error('Cannot delete without a server version.');
        await deleteEntityRecord(row.entity, row.id, { version: row.baseVersion });
      } else {
        try {
          result = await createEntityRecord(row.entity, input);
        } catch (error: any) {
          // A create collision is only safely recoverable with an optimistic
          // version supplied by the local record. Never issue an unversioned
          // PATCH that could overwrite another device's work.
          if (error?.status !== 409 || !row.baseVersion) throw error;
          result = await updateEntityRecord(row.entity, row.id, input);
        }
        // A new record must exist before an object URL can be issued. This
        // also binds retries for existing records to the same authorization
        // boundary used by the API.
        const uploadedState = await prepareUploadState(row.entity, row.id, state);
        if (uploadedState.remoteFiles) {
          registerRemotePhotos(uploadedState.remoteFiles);
          if (localMapping) {
            if (localMapping.table === 'rooms') {
              await d.runAsync('UPDATE rooms SET remoteFiles=? WHERE id=?', JSON.stringify(uploadedState.remoteFiles), row.id);
            } else if (localMapping.table !== 'projects') {
              await d.runAsync(`UPDATE ${localMapping.table} SET ${localMapping.column || 'state'}=? WHERE ${localMapping.key}=?`, JSON.stringify(uploadedState), row.id);
            }
            await d.runAsync('UPDATE sync_queue SET state=? WHERE owner=? AND entity=? AND id=?', JSON.stringify(uploadedState), row.owner, row.entity, row.id);
          }
          result = await updateEntityRecord(row.entity, row.id, {
            id: row.id,
            state: writableState(row.entity, uploadedState),
            ...(uploadedState.projectId ? { projectId: uploadedState.projectId } : {}),
            ...(uploadedState.development || uploadedState.meta?.development
              ? { development: uploadedState.development || uploadedState.meta.development }
              : {}),
            version: result.version,
          });
        }
        for (const pending of pendingActions) {
          result = await performEntityAction(row.entity, row.id, String(pending.action), pending.body || {});
        }
      }
      if (pendingActions.length) delete state._pendingWorkflowActions;
      const serverVersion = result?.version;
      if (serverVersion) {
        const authoritative = { ...(state.meta || {}), serverVersion, syncStatus: 'synced', updatedAt: result.updatedAt };
        state.meta = authoritative;
        state._meta = { ...(state._meta || {}), serverVersion, syncStatus: 'synced', updatedAt: result.updatedAt };
      }
      const mapping = TABLES.find((item) => item.entity === row.entity);
      if (mapping && serverVersion) {
        if (mapping.table === 'projects') {
          await d.runAsync('UPDATE projects SET name=?,client=?,rates=?,meta=? WHERE id=?',
            String(state.name || 'Untitled project'), String(state.client || ''),
            state.rates == null ? null : JSON.stringify(state.rates), JSON.stringify(state.meta), row.id);
        } else if (mapping.table === 'rooms') {
          const scan = { ...(state.scan || {}), _meta: state._meta };
          await d.runAsync('UPDATE rooms SET scan=? WHERE id=?', JSON.stringify(scan), row.id);
        } else {
          await d.runAsync(`UPDATE ${mapping.table} SET ${mapping.column || 'state'}=? WHERE ${mapping.key}=?`, JSON.stringify(state), row.id);
        }
      }
      await d.runAsync(
        `UPDATE sync_queue SET state=?,status='synced',error=NULL WHERE owner=? AND entity=? AND id=?`,
        JSON.stringify(state), row.owner, row.entity, row.id,
      );
    } catch (error: any) {
      const conflict = error?.status === 409 || /version|conflict/i.test(String(error?.message));
      await d.runAsync(
        `UPDATE sync_queue SET status=?,error=? WHERE owner=? AND entity=? AND id=?`,
        conflict ? 'conflict' : 'pending',
        conflict ? 'Server version conflict; local changes retained for review.' : String(error?.message || error),
        row.owner, row.entity, row.id,
      );
      if (conflict) continue;
      throw error;
    }
  }
}

async function applyRecord(d: any, record: any, owner: string) {
  const mapping = TABLES.find((item) => item.entity === record.entity);
  if (!mapping) return;
  if (record.deleted) {
    await d.runAsync(`DELETE FROM ${mapping.table} WHERE ${mapping.key} = ?`, record.id);
    return;
  }
  const state = { ...(record.state || {}), id: record.id };
  // Keep the server version beside locally edited workflow records. Without
  // this metadata, an edit to a pulled record is mistaken for a new record and
  // cannot safely be retried through the versioned PATCH path.
  if (mapping.table !== 'projects' && mapping.table !== 'rooms') {
    state._meta = {
      ...(state._meta || {}),
      serverVersion: record.version,
      syncStatus: 'synced',
      updatedAt: record.updatedAt,
    };
  }
  if (Array.isArray(state.remoteFiles)) registerRemotePhotos(state.remoteFiles);
  if (mapping.table === 'projects') {
    const projectMeta = { ...(state.meta || {}), serverVersion: record.version, syncStatus: 'synced', updatedAt: record.updatedAt };
    await d.runAsync(
      `INSERT INTO projects(id,name,client,createdAt,rates,meta) VALUES(?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name,client=excluded.client,
       createdAt=excluded.createdAt,rates=excluded.rates,meta=excluded.meta`,
      record.id, state.name || 'Untitled project', state.client || '',
      record.createdAt, state.rates == null ? null : JSON.stringify(state.rates),
      JSON.stringify(projectMeta),
    );
  } else if (mapping.table === 'rooms') {
    const roomScan = { ...(state.scan || {}), _meta: { ...(state.scan?._meta || {}), serverVersion: record.version, syncStatus: 'synced', updatedAt: record.updatedAt } };
    await d.runAsync(
      `INSERT INTO rooms(id,projectId,name,unit,lines,photos,walls2d,scan,remoteFiles) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET projectId=excluded.projectId,name=excluded.name,
       unit=excluded.unit,lines=excluded.lines,photos=excluded.photos,walls2d=excluded.walls2d,scan=excluded.scan,remoteFiles=excluded.remoteFiles`,
      record.id, record.projectId || state.projectId || '', state.name || '', state.unit || '',
      JSON.stringify(state.lines || []), JSON.stringify(state.photos || []),
      JSON.stringify(state.walls2d || []), JSON.stringify(roomScan), JSON.stringify(state.remoteFiles || []),
    );
  } else if (mapping.table === 'roofplans') {
    await d.runAsync(
      `INSERT INTO roofplans(projectId,data) VALUES(?,?)
       ON CONFLICT(projectId) DO UPDATE SET data=excluded.data`,
      record.id, JSON.stringify(state),
    );
  } else {
    await d.runAsync(
      `INSERT INTO ${mapping.table}(${mapping.key},state) VALUES(?,?)
       ON CONFLICT(${mapping.key}) DO UPDATE SET state=excluded.state`,
      record.id, JSON.stringify(state),
    );
  }
  await d.runAsync(
    `DELETE FROM sync_queue WHERE owner=? AND entity=? AND id=? AND status='synced'`,
    owner, record.entity, record.id,
  );
}

export async function syncAllEntities(options?: {
  refreshEntities?: string[];
}): Promise<void> {
  if (!(await getAccessToken())) return;
  const d = await db();
  await ensureQueue(d);
  const actor = await getCurrentActor();
  const identity = await getSessionIdentity();
  const owner = `${identity?.tenantId || 'default'}:${identity?.staffId || ''}`;
  const scope = `sync_all_cursor:${identity?.tenantId || 'default'}:${identity?.staffId || actor.name}:${identity?.role || actor.role}:${identity?.developments?.join('|') || ''}`;
  const recordScope = `${scope}:record`;
  const notificationScope = `${scope}:notification`;
  const recordCursorsScope = `${scope}:records`;
  await discoverQueue(d);
  await pushQueue(d);
  const [cursorRow, recordCursorRow, notificationCursorRow, recordCursorsRow] =
    await Promise.all([
      d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', scope),
      d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', recordScope),
      d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', notificationScope),
      d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', recordCursorsScope),
    ]);
  let recordCursors: Record<string, string> = {};
  try {
    const parsed = recordCursorsRow?.value ? JSON.parse(recordCursorsRow.value) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) recordCursors = parsed;
  } catch {
    // A corrupt optional per-entity cursor should not prevent legacy sync.
  }
  for (const entity of options?.refreshEntities || []) {
    if (TABLES.some((item) => item.entity === entity)) {
      recordCursors[entity] = new Date(0).toISOString();
    }
  }
  const legacyCursor = cursorRow?.value || new Date(0).toISOString();
  const result = await pullSync({
    since: legacyCursor,
    recordCursor: recordCursorRow?.value || legacyCursor,
    notificationCursor: notificationCursorRow?.value || legacyCursor,
    recordCursors: JSON.stringify(recordCursors),
    entities: TABLES.filter((item) => (ROLE_ENTITIES[identity?.role || actor.role] || ROLE_ENTITIES.worker).has(item.entity)).map((item) => item.entity).join(','),
  });
  const newNotifications: Array<{ message: string; detail?: string; reportId?: string }> = [];
  await d.withTransactionAsync(async () => {
    for (const record of result.records || []) {
      const pending = await d.getFirstAsync(
        'SELECT * FROM sync_queue WHERE owner=? AND entity=? AND id=? AND status IN (\'pending\',\'conflict\')',
        owner, record.entity, record.id,
      );
      // Never destroy an unsent local edit. It remains an explicit conflict.
      if (!shouldApplyRemote(Boolean(pending))) {
        await d.runAsync(
          `UPDATE sync_queue SET status='conflict',error=? WHERE owner=? AND entity=? AND id=?`,
          'Remote update arrived while local changes were pending.', owner, record.entity, record.id,
        );
      } else await applyRecord(d, record, owner);
    }
    await d.execAsync('CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL)');
    for (const notification of result.notifications || []) {
      const existing = await d.getFirstAsync<{ id: string }>(
        'SELECT id FROM notifications WHERE id=?',
        notification.id,
      );
      const localNotification = {
        id: notification.id,
        target: notification.target,
        message: notification.message,
        detail: notification.detail || '',
        read: Boolean(notification.read),
        at: notification.at || new Date().toISOString(),
        reportId: notification.reportId || undefined,
      };
      await d.runAsync(
        'INSERT INTO notifications(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state',
        notification.id,
        JSON.stringify(localNotification),
      );
      if (!existing) newNotifications.push(localNotification);
    }
    await d.runAsync(
      `INSERT INTO settings(key,value) VALUES(?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`, scope, result.cursor,
    );
    await d.runAsync(
      `INSERT INTO settings(key,value) VALUES(?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      recordScope,
      result.recordCursor || result.cursor,
    );
    await d.runAsync(
      `INSERT INTO settings(key,value) VALUES(?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      notificationScope,
      result.notificationCursor || result.cursor,
    );
    await d.runAsync(
      `INSERT INTO settings(key,value) VALUES(?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      recordCursorsScope,
      JSON.stringify(result.recordCursors || {}),
    );
  });
  const alertsMuted = await getAlertsMuted().catch(() => false);
  for (const notification of newNotifications) {
    const urgent = /emergency|priority|elevator|resident report/i.test(
      `${notification.message} ${notification.detail || ''}`,
    );
    if (!alertsMuted) {
      await notifyLocal(
        notification.message || 'FIAREP alert',
        notification.detail || 'A new item needs your attention.',
        urgent,
      );
    }
  }
}
