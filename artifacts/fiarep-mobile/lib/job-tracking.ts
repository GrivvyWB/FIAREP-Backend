// From the moment a job is assigned to this person (staff or freelance — no time clock needed):
// the phone watches where it is and the arrival at the job's address is marked by GPS, time
// stamped, for the resident and the client's platform. Stops when no assigned job is left to reach.
//
// Starts as soon as the app learns of the assignment: the "New job" alert arriving, the app being
// opened, or coming back to the screen.
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { customFetch } from '@workspace/api-client-react';
import { db } from './store';

const KEY = 'job_tracking';
type State = { jobs: number; startedByJobs: boolean; lastSentAt: number };

async function read(): Promise<State | null> {
  try { const d = await db(); const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', KEY); return row?.value ? JSON.parse(row.value) as State : null; } catch { return null; }
}
async function write(s: State | null): Promise<void> {
  try {
    const d = await db();
    if (!s) { await d.runAsync('DELETE FROM settings WHERE key=?', KEY); return; }
    await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', KEY, JSON.stringify(s));
  } catch { /* next refresh */ }
}

let refreshing = false;
/** Ask the server which assigned jobs to watch for; start or stop the background watch. */
export async function refreshJobTracking(): Promise<void> {
  if (refreshing) return; refreshing = true;
  try {
    const r = await customFetch<{ jobs: Array<{ id: string }> }>('/api/v1/jobs/tracking', { responseType: 'json' } as never).catch(() => null);
    if (!r) return; // not signed in, or offline
    const prev = await read();
    const { CLOCK_LOCATION_TASK, ensureLocationTracking, stopLocationTracking } = await import('./clock-location');
    if (r.jobs.length) {
      const fg = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!fg?.granted) return;
      await Location.requestBackgroundPermissionsAsync().catch(() => null);
      const running = await Location.hasStartedLocationUpdatesAsync(CLOCK_LOCATION_TASK).catch(() => false);
      if (!running) await ensureLocationTracking();
      await write({ jobs: r.jobs.length, startedByJobs: prev?.startedByJobs || !running, lastSentAt: prev?.lastSentAt ?? 0 });
      // Already there when it was assigned: send where the phone is now.
      const p = await Location.getLastKnownPositionAsync().catch(() => null);
      if (p) await handleJobFix({ latitude: p.coords.latitude, longitude: p.coords.longitude }, true);
      return;
    }
    // Nothing left to reach: stop the watch if the jobs started it and nothing else needs it.
    if (prev?.startedByJobs) {
      const d = await db();
      const clock = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', 'clock_location_anchor').catch(() => null);
      const { activeSiteCheckin } = await import('./site-checkin');
      if (!clock?.value && !(await activeSiteCheckin())) await stopLocationTracking();
    }
    await write(null);
  } finally { refreshing = false; }
}

/** A position from the background watch: sent while there are jobs to reach (at most every 45 s). */
export async function handleJobFix(fix: { latitude: number; longitude: number }, now = false): Promise<void> {
  const s = await read();
  if (!s || !s.jobs) return;
  if (!now && Date.now() - s.lastSentAt < 45_000) return;
  await write({ ...s, lastSentAt: Date.now() });
  const r = await customFetch<{ arrived: number; remaining: number }>('/api/v1/jobs/track', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fix), responseType: 'json',
  } as never).catch(() => null);
  if (r && r.remaining === 0) void refreshJobTracking();
}

let started = false;
/** Watch for new assignments: app opened, back on screen, and a "New job" alert arriving. */
export function startJobWatch(): void {
  if (started) return; started = true;
  setTimeout(() => { void refreshJobTracking(); }, 4000);
  AppState.addEventListener('change', (s) => { if (s === 'active') void refreshJobTracking(); });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const N = require('expo-notifications');
    N.addNotificationReceivedListener(() => { void refreshJobTracking(); });
    N.addNotificationResponseReceivedListener(() => { void refreshJobTracking(); });
  } catch { /* a build without notifications */ }
}
