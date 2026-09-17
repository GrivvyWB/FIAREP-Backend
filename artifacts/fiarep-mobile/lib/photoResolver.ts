import * as FileSystem from 'expo-file-system/legacy';
import { requestFileDownloadUrl } from '@workspace/api-client-react';
import { photoUri } from './photos';

export type StoredPhotoRef = { localUri?: string; objectPath?: string; contentType?: string };
const remoteByLocalUri = new Map<string, StoredPhotoRef>();
export function registerRemotePhotos(files: StoredPhotoRef[]) {
  for (const file of files) if (file.localUri) remoteByLocalUri.set(file.localUri, file);
}
export function hydrateRemotePhotos(rows: Array<{ remoteFiles?: string | null }>) {
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.remoteFiles || '[]');
      registerRemotePhotos(Array.isArray(parsed) ? parsed : (parsed.remoteFiles || []));
    } catch {}
  }
}
export async function hydrateRemotePhotosFromDb(d: any): Promise<void> {
  const tables = ['rooms','projects','checklists','roofplans','inspections','cost_estimates','intakes','elevators','resident_reports','violations','building_violations','priority_violations','route_assignments','procurement','procurement_bids','vendor_contacts','vendor_quotes','change_orders','elevator_jobs','emergency_jobs','emergency_units','leave_requests'];
  for (const table of tables) {
    try {
      const columns = await d.getAllAsync(`PRAGMA table_info(${table})`) as any[];
      const column = columns.some((item: any) => item.name === 'remoteFiles') ? 'remoteFiles' : columns.some((item: any) => item.name === 'state') ? 'state' : columns.some((item: any) => item.name === 'data') ? 'data' : null;
      if (!column) continue;
      const rows = await d.getAllAsync(`SELECT ${column} AS remoteFiles FROM ${table}`);
      hydrateRemotePhotos(rows);
    } catch {}
  }
}

/** Local-first, authenticated remote fallback for every photo-bearing screen. */
export async function resolvePhoto(ref: StoredPhotoRef | string): Promise<string | null> {
  const local = typeof ref === 'string' ? ref : ref.localUri;
  // Report-scoped download helpers already return authorized URLs. Do not
  // send those URLs through the generic file downloader or local-file check.
  if (local && /^https?:\/\//i.test(local)) return local;
  if (local) {
    const localInfo = await FileSystem.getInfoAsync(photoUri(local)).catch(() => ({ exists: false }));
    if (localInfo.exists) return photoUri(local);
  }
  const matched = typeof ref === 'string' ? remoteByLocalUri.get(ref) : undefined;
  const objectPath = typeof ref === 'string' ? matched?.objectPath : ref.objectPath;
  if (!objectPath) return local ? photoUri(local) : null;
  try {
    return (await requestFileDownloadUrl({ objectPath })).downloadUrl;
  } catch {
    return local ? photoUri(local) : null;
  }
}