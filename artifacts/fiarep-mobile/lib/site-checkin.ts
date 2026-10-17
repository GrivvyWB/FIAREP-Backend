// Building check-in on the phone. The member taps the building they are at;
// the phone reads where it really is and sends both. While checked in, the
// background location task (the same one the time clock uses) watches the
// building: leaving it, every stop away from it (e.g. a supply store) and
// coming back are sent with their times and places.
import * as Location from 'expo-location';
import { customFetch } from '@workspace/api-client-react';
import { db } from './store';
import * as FileSystem from 'expo-file-system/legacy';
import { photoUri, photoBase64 } from './photos';

const SITE_KEY = 'site_checkin_active';
const SITE_ONLY_KEY = 'site_tracking_only'; // tracking runs for the check-in, not for the clock
const LEAVE_M = 150;  // farther than this from the building = left the building
const BACK_M = 120;   // within this = back at the building
const MOVE_M = 150;   // away from the building, a move of more than this ends a stop
const STOP_MIN = 5;   // stayed this long somewhere while away = a stop (a supply run counts)

export type SiteBuilding = { id: string; address: string; development: string | null };
export type SiteEvent = { type: 'left' | 'stop' | 'back'; at: string; until?: string | null; address?: string };
export type SiteCheckin = {
  id: string; staffName: string; building: { address: string; latitude: number | null; longitude: number | null };
  phone: { latitude: number; longitude: number; address: string }; distanceM: number | null; atBuilding: boolean | null;
  checkedInAt: string; checkedOutAt: string; events: SiteEvent[]; visits?: AptVisit[]; outOfNetwork?: boolean; requestedBy?: string;
};
export type AptVisit = {
  id: string; unit: string; outcome: 'access' | 'refused'; at: string; photoUrl?: string; address?: string;
  distanceM: number | null; atBuilding: boolean | null; doorNumber: string | null; doorMatches: boolean | null;
};
type Active = {
  id: string; address: string; latitude: number; longitude: number; status: 'on' | 'away';
  anchor: { latitude: number; longitude: number; since: number; key: string } | null;
};

const get = <T,>(url: string) => customFetch<T>(url, { responseType: 'json' } as never);
const post = <T,>(url: string, body: unknown) => customFetch<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), responseType: 'json' } as never);

async function readSetting<T>(key: string): Promise<T | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}
async function writeSetting(key: string, value: unknown | null): Promise<void> {
  const d = await db();
  if (value == null) { await d.runAsync('DELETE FROM settings WHERE key=?', key); return; }
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
export const activeSiteCheckin = () => readSetting<Active>(SITE_KEY);
/** True while location runs only for a building check-in (not clocked in). */
export async function siteTrackingOnly(): Promise<boolean> { return (await readSetting<boolean>(SITE_ONLY_KEY)) === true; }
export async function setSiteTrackingOnly(v: boolean): Promise<void> { await writeSetting(SITE_ONLY_KEY, v ? true : null); }

function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = 6371000; const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
async function placeFor(p: { latitude: number; longitude: number }): Promise<string | null> {
  try {
    const hits = await Promise.race([Location.reverseGeocodeAsync(p), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    const a = hits && hits[0];
    if (!a) return null;
    const street = [a.streetNumber, a.street].filter(Boolean).join(' ');
    return [a.name && a.name !== street ? a.name : '', street, a.city || a.subregion, a.region].filter(Boolean).join(', ') || null;
  } catch { return null; }
}
async function sendEvent(id: string, ev: { type: 'left' | 'stop' | 'back'; at: number; until?: number; p: { latitude: number; longitude: number }; key: string }): Promise<void> {
  try {
    await post(`/api/v1/site-checkins/${encodeURIComponent(id)}/events`, {
      type: ev.type, at: new Date(ev.at).toISOString(), until: ev.until ? new Date(ev.until).toISOString() : null,
      location: { latitude: ev.p.latitude, longitude: ev.p.longitude }, deviceAddress: await placeFor(ev.p), key: ev.key,
    });
  } catch { /* the next fix tries the next event; a lost one is not resent */ }
}
const newKey = () => `ev-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Called by the background location task with each new position. */
export async function handleSiteFix(fix: { latitude: number; longitude: number; accuracyM: number | null }): Promise<void> {
  const s = await activeSiteCheckin();
  if (!s) return;
  const now = Date.now();
  const fromBuilding = metersBetween(s, fix);
  const slack = Math.min(fix.accuracyM ?? 0, 100);
  if (s.status === 'on') {
    if (fromBuilding > LEAVE_M + slack) {
      await sendEvent(s.id, { type: 'left', at: now, p: fix, key: newKey() });
      await writeSetting(SITE_KEY, { ...s, status: 'away', anchor: { latitude: fix.latitude, longitude: fix.longitude, since: now, key: newKey() } });
    }
    return;
  }
  // Away from the building.
  const anchor = s.anchor;
  const stayed = anchor ? now - anchor.since >= STOP_MIN * 60_000 : false;
  if (fromBuilding <= BACK_M + slack) {
    if (anchor && stayed) await sendEvent(s.id, { type: 'stop', at: anchor.since, until: now, p: anchor, key: anchor.key });
    await sendEvent(s.id, { type: 'back', at: now, p: fix, key: newKey() });
    await writeSetting(SITE_KEY, { ...s, status: 'on', anchor: null });
    return;
  }
  if (!anchor || metersBetween(anchor, fix) > MOVE_M) {
    if (anchor && stayed) await sendEvent(s.id, { type: 'stop', at: anchor.since, until: now, p: anchor, key: anchor.key });
    await writeSetting(SITE_KEY, { ...s, anchor: { latitude: fix.latitude, longitude: fix.longitude, since: now, key: newKey() } });
  }
}

export const listSiteBuildings = () => get<SiteBuilding[]>('/api/v1/site-checkins/buildings');
/** Out of network: the client companies FIAREP's crew can file a check-in for (empty for everyone else). */
export const listSiteClients = () => get<Array<{ id: string; name: string }>>('/api/v1/site-checkins/clients');
export const mySiteCheckins = () => get<SiteCheckin[]>('/api/v1/site-checkins/mine');

/** Check in at a building: the phone's real position goes with it, then tracking starts. */
export async function checkInAt(b: { propertyId?: string; address: string; outOfNetwork?: boolean; requestedBy?: string; clientId?: string }): Promise<SiteCheckin> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) throw new Error('Turn Location on for FIAREP (Settings → FIAREP → Location → Always) to check in.');
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) throw new Error('FIAREP needs Location set to "Always" to check in — it records when you leave the building and when you come back.');
  const pos = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    new Promise<null>((r) => setTimeout(() => r(null), 12000)),
  ]);
  if (!pos) throw new Error('Could not read where your phone is. Step outside or near a window and try again.');
  const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? null };
  let buildingLocation: { latitude: number; longitude: number } | null = null;
  try { const g = await Location.geocodeAsync(b.address); if (g[0]) buildingLocation = { latitude: g[0].latitude, longitude: g[0].longitude }; } catch { /* the server uses the City's map */ }
  const c = await post<SiteCheckin>('/api/v1/site-checkins', { propertyId: b.propertyId || '', address: b.address, location: here, deviceAddress: await placeFor(here), buildingLocation, outOfNetwork: !!b.outOfNetwork, requestedBy: b.requestedBy || '', clientId: b.clientId || '' });
  const center = c.building.latitude != null && c.building.longitude != null ? { latitude: c.building.latitude, longitude: c.building.longitude } : here;
  const onSite = metersBetween(center, here) <= LEAVE_M + Math.min(here.accuracyM ?? 0, 100);
  await writeSetting(SITE_KEY, { id: c.id, address: c.building.address, ...center, status: onSite ? 'on' : 'away', anchor: onSite ? null : { latitude: here.latitude, longitude: here.longitude, since: Date.now(), key: newKey() } } as Active);
  const { ensureLocationTracking } = await import('./clock-location');
  const wasRunning = await ensureLocationTracking();
  if (!wasRunning) await setSiteTrackingOnly(true);
  return c;
}

/** Check out: the phone's position goes with it; tracking stops unless the clock is running. */
export async function checkOut(): Promise<void> {
  const s = await activeSiteCheckin();
  if (!s) return;
  let here: { latitude: number; longitude: number } | null = null;
  try { const pos = await Location.getLastKnownPositionAsync(); if (pos) here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }; } catch { /* sent without */ }
  await post(`/api/v1/site-checkins/${encodeURIComponent(s.id)}/checkout`, { location: here, deviceAddress: here ? await placeFor(here) : null });
  await writeSetting(SITE_KEY, null);
  if (await siteTrackingOnly()) {
    await setSiteTrackingOnly(false);
    const { stopLocationTracking } = await import('./clock-location');
    await stopLocationTracking();
  }
}


/** Where the phone is right now, against the checked-in building (for an apartment visit). */
export async function hereNow(): Promise<{ latitude: number; longitude: number; accuracyM: number | null; distanceM: number | null } | null> {
  const s = await activeSiteCheckin();
  const pos = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), new Promise<null>((r) => setTimeout(() => r(null), 12000))]).catch(() => null);
  if (!pos) return null;
  const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? null };
  return { ...here, distanceM: s ? Math.round(metersBetween(s, here)) : null };
}

/**
 * Record an apartment visit: the door photo (taken now), the unit, and Access
 * Gained / Tenant Refused Access. The server stamps the time and keeps it for good.
 */
export async function recordVisit(input: { unit: string; outcome: 'access' | 'refused'; photo: string; here: { latitude: number; longitude: number; accuracyM: number | null } | null }): Promise<AptVisit> {
  const s = await activeSiteCheckin();
  if (!s) throw new Error('Check in at the building first.');
  const uri = photoUri(input.photo);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !('size' in info) || !info.size) throw new Error('The door photo is unavailable. Take it again.');
  const { uploadUrl, objectPath } = await post<{ uploadUrl: string; objectPath: string }>(`/api/v1/site-checkins/${encodeURIComponent(s.id)}/upload-url`, { size: info.size });
  const up = await FileSystem.uploadAsync(uploadUrl, uri, { httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, mimeType: 'image/jpeg' });
  if (up.status < 200 || up.status >= 300) throw new Error('Photo upload failed (' + up.status + ').');
  const image = await photoBase64(input.photo);
  return post<AptVisit>(`/api/v1/site-checkins/${encodeURIComponent(s.id)}/visits`, {
    unit: input.unit, outcome: input.outcome, photo: objectPath, image,
    location: input.here, deviceAddress: input.here ? await placeFor(input.here) : null,
  });
}
