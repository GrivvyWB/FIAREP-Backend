// Sync-ready metadata foundation. No backend yet — these fields prepare every
// record to sync later (UUID, timestamps, device origin, sync status).
import * as SQLite from 'expo-sqlite';

export type SyncStatus = 'local' | 'pending' | 'synced';
export type SyncMeta = {
  uuid: string;
  createdAt: string;   // ISO timestamp
  updatedAt: string;   // ISO timestamp
  deviceId: string;
  syncStatus: SyncStatus;
};

// RFC4122-ish v4 UUID (no external dep)
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// A stable per-install device id, generated once and cached.
let _deviceId: string | null = null;

export async function getDeviceId(db: SQLite.SQLiteDatabase): Promise<string> {
  if (_deviceId) return _deviceId;
  try {
    await db.execAsync('CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)');
    const row = await db.getFirstAsync<{ v: string }>('SELECT v FROM app_meta WHERE k = ?', 'deviceId');
    if (row?.v) { _deviceId = row.v; return _deviceId; }
    const id = uuidv4();
    await db.runAsync('INSERT INTO app_meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'deviceId', id);
    _deviceId = id;
    return id;
  } catch {
    // fallback: ephemeral id if the table op fails (never blocks the app)
    if (!_deviceId) _deviceId = uuidv4();
    return _deviceId;
  }
}

// Build fresh metadata for a new record.
export async function newMeta(db: SQLite.SQLiteDatabase): Promise<SyncMeta> {
  const now = new Date().toISOString();
  const deviceId = await getDeviceId(db);
  return { uuid: uuidv4(), createdAt: now, updatedAt: now, deviceId, syncStatus: 'local' };
}

// Bump metadata on an update (keeps uuid/createdAt, refreshes updatedAt, marks local).
export function touchMeta(prev: Partial<SyncMeta> | undefined, deviceId: string): SyncMeta {
  const now = new Date().toISOString();
  return {
    uuid: prev?.uuid ?? uuidv4(),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    deviceId: prev?.deviceId ?? deviceId,
    syncStatus: 'local',
  };
}
