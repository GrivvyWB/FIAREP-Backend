// Where a clocked-in technician is. Punches carry the phone's position. While
// on the clock, a background task watches for real movement: when the phone
// moves more than MOVE_METERS from where it was and then stays put for
// STOP_MINUTES, that place is reported as a stop (arrival time); when it moves
// on, the stop is closed (departure time). Nothing is sent while the phone sits
// still, and nothing runs at all once the person punches out.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { customFetch } from '@workspace/api-client-react';
import { db } from './store';

export const CLOCK_LOCATION_TASK = 'fiarep-clock-location';
const MOVE_METERS = 150;        // less than this is GPS drift, not a move
const STOP_MINUTES = 30;        // stay this long somewhere and it is a stop
const KEY = 'clock_location_anchor';

type Anchor = { latitude: number; longitude: number; since: number; reported: boolean; stopId: string | null; key: string };

export type Fix = { latitude: number; longitude: number; accuracyM: number | null };

/** One position fix for a punch, or null if the person declined or it timed out. */
export async function currentFix(): Promise<Fix | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!pos) return null;
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? null };
  } catch { return null; }
}

async function readAnchor(): Promise<Anchor | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', KEY);
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as Anchor; } catch { return null; }
}
async function writeAnchor(a: Anchor | null): Promise<void> {
  const d = await db();
  if (!a) { await d.runAsync('DELETE FROM settings WHERE key=?', KEY); return; }
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', KEY, JSON.stringify(a));
}

function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = 6371000; const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude), dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

async function reportArrival(a: Anchor, fix: Fix): Promise<string | null> {
  try {
    const r = await customFetch<{ id: string }>('/api/v1/time-clock/locations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: fix, arrivedAt: new Date(a.since).toISOString(), idempotencyKey: a.key }),
      responseType: 'json',
    } as never);
    return r?.id ?? null;
  } catch { return null; }
}
async function reportDeparture(stopId: string, at: number): Promise<void> {
  try { await customFetch(`/api/v1/time-clock/locations/${encodeURIComponent(stopId)}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leftAt: new Date(at).toISOString() }), responseType: 'json' } as never); } catch { /* retried on the next move */ }
}

/** Handle one or more fixes from the background task. */
export async function handleFixes(fixes: Fix[]): Promise<void> {
  if (fixes.length === 0) return;
  const now = Date.now();
  let anchor = await readAnchor();
  const latest = fixes[fixes.length - 1]!;
  if (!anchor) {
    anchor = { latitude: latest.latitude, longitude: latest.longitude, since: now, reported: false, stopId: null, key: `stop-${now}-${Math.random().toString(36).slice(2)}` };
    await writeAnchor(anchor); return;
  }
  const moved = metersBetween(anchor, latest) > MOVE_METERS;
  if (moved) {
    // Left the place: close the stop if it had been reported, start watching the new place.
    if (anchor.reported && anchor.stopId) await reportDeparture(anchor.stopId, now);
    anchor = { latitude: latest.latitude, longitude: latest.longitude, since: now, reported: false, stopId: null, key: `stop-${now}-${Math.random().toString(36).slice(2)}` };
    await writeAnchor(anchor); return;
  }
  // Still here. Once it has been STOP_MINUTES, report it — once.
  if (!anchor.reported && now - anchor.since >= STOP_MINUTES * 60_000) {
    const id = await reportArrival(anchor, latest);
    if (id) { anchor.reported = true; anchor.stopId = id; await writeAnchor(anchor); }
  }
}

TaskManager.defineTask(CLOCK_LOCATION_TASK, async ({ data, error }: { data?: { locations?: Location.LocationObject[] }; error?: unknown }) => {
  if (error || !data?.locations?.length) return;
  await handleFixes(data.locations.map((l) => ({ latitude: l.coords.latitude, longitude: l.coords.longitude, accuracyM: l.coords.accuracy ?? null })));
});

/** Workers must allow location (foreground and background) before they can use the app. */
export async function requireWorkerLocation(): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return false;
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.granted;
  } catch { return false; }
}

/** Start watching after a punch in. Returns false if the person did not allow background location. */
export async function startClockTracking(first: Fix | null): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return false;
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) return false;
    const now = Date.now();
    await writeAnchor(first ? { latitude: first.latitude, longitude: first.longitude, since: now, reported: false, stopId: null, key: `stop-${now}-${Math.random().toString(36).slice(2)}` } : null);
    if (await Location.hasStartedLocationUpdatesAsync(CLOCK_LOCATION_TASK)) return true;
    await Location.startLocationUpdatesAsync(CLOCK_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 100,            // a fix only after ~100 m of movement — nothing while parked
      deferredUpdatesInterval: 60_000,
      deferredUpdatesDistance: 100,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: 'FIAREP time clock', notificationBody: 'On the clock — recording where you work.', notificationColor: '#0B2A4A' },
    });
    return true;
  } catch { return false; }
}

/** Stop watching after a punch out; the server closes the open stop itself. */
export async function stopClockTracking(): Promise<void> {
  try { if (await Location.hasStartedLocationUpdatesAsync(CLOCK_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(CLOCK_LOCATION_TASK); } catch { /* not running */ }
  await writeAnchor(null);
}
