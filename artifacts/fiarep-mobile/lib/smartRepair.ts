// FIAREP Smart Repair Instructions — the phone side. Reads the compass at the
// moment of the photo, finds the street address from GPS, and asks the server
// for the Smart Field Ticket.
import * as FileSystem from 'expo-file-system/legacy';
import { getAccessToken } from './store';
import { currentFix, placeFor } from './clock-location';

let Location: any = null;
try { Location = require('expo-location'); } catch (e) { Location = null; }
let Magnetometer: any = null;
try { Magnetometer = require('expo-sensors').Magnetometer; } catch (e) { Magnetometer = null; }

export type SmartTicket = {
  issueFound: string; location: string; exactArea: string; repairRequired: string;
  tools: string[]; supplies: string[]; fixtures: string[]; steps: string[];
  trade: string; priority: 'Low' | 'Medium' | 'High'; priorityNote: string; estimatedTime: string; status: string;
  facing: string | null;
};

/** Compass heading in degrees (0 = north), or null when the phone can't tell. */
export async function readHeading(): Promise<number | null> {
  try {
    if (Location?.getHeadingAsync) {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm?.granted) {
        const h = await Promise.race([Location.getHeadingAsync(), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
        const v = h && (h.trueHeading >= 0 ? h.trueHeading : h.magHeading);
        if (typeof v === 'number' && v >= 0) return Math.round(v);
      }
    }
  } catch {}
  try {
    if (Magnetometer && await Magnetometer.isAvailableAsync()) {
      return await new Promise<number | null>((resolve) => {
        const sub = Magnetometer.addListener(({ x, y }: { x: number; y: number }) => {
          sub.remove();
          let a = Math.atan2(y, x) * (180 / Math.PI) - 90; if (a < 0) a += 360;
          resolve(Math.round((360 - a) % 360));
        });
        setTimeout(() => { try { sub.remove(); } catch {} resolve(null); }, 2000);
      });
    }
  } catch {}
  return null;
}

export const facingLabel = (h: number | null): string | null => {
  if (h == null) return null;
  return ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'][Math.round(h / 45) % 8]!;
};

/** Street address where the phone is now (GPS), or '' when it can't be found. */
export async function gpsAddress(): Promise<string> {
  const fix = await currentFix();
  if (!fix) return '';
  return (await placeFor(fix)) || '';
}

/** A resident's photo (https) saved into the app's photo folder so it can be analyzed. */
export async function saveRemotePhoto(url: string): Promise<string | null> {
  try {
    const dir = FileSystem.documentDirectory + 'photos/';
    try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch {}
    const name = 'sr-' + Date.now().toString(36) + '.jpg';
    await FileSystem.downloadAsync(url, dir + name);
    return 'photos/' + name;
  } catch { return null; }
}

export async function requestSmartTicket(input: { image: string; heading: number | null; address: string; area: string; note?: string }): Promise<SmartTicket> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error('The FIAREP backend domain is not configured.');
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(`https://${domain}/api/ai/smart-repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const t = await res.json().catch(() => null);
    throw new Error((t && t.error) || 'Smart Repair failed (' + res.status + ')');
  }
  const p = await res.json();
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    issueFound: String(p.issueFound || ''), location: String(p.location || ''), exactArea: String(p.exactArea || ''),
    repairRequired: String(p.repairRequired || ''), tools: arr(p.tools), supplies: arr(p.supplies), fixtures: arr(p.fixtures), steps: arr(p.steps),
    trade: String(p.trade || ''), priority: (['Low', 'Medium', 'High'].includes(p.priority) ? p.priority : 'Medium'),
    priorityNote: String(p.priorityNote || ''), estimatedTime: String(p.estimatedTime || ''), status: String(p.status || 'Action Required'),
    facing: p.facing ? String(p.facing) : null,
  };
}

/** The ticket as plain text — what goes on the work order. */
export function ticketText(t: SmartTicket, fromComplaint: boolean): string {
  const list = (h: string, xs: string[]) => (xs.length ? `\n${h}\n` + xs.map((x) => '• ' + x).join('\n') : '');
  return [
    fromComplaint ? '📸 Resident Complaint Received' : '📸 Photo Uploaded',
    `✅ Issue Found: ${t.issueFound}`,
    `📍 Location: ${t.location}`,
    `🎯 Exact Area: ${t.exactArea}`,
    `🔨 Repair: ${t.repairRequired}`,
    `⚠ Priority: ${t.priority}${t.priorityNote ? ' — ' + t.priorityNote : ''}`,
    `📋 Status: ${t.status}`,
  ].join('\n')
    + list('Bring These Tools', t.tools)
    + list('Bring These Supplies', t.supplies)
    + list('Fixtures / Parts', t.fixtures)
    + (t.steps.length ? '\nRepair Instructions\n' + t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '')
    + `\n👷 Trade Required: ${t.trade}\n⏱ Estimated Repair Time: ${t.estimatedTime}`;
}
