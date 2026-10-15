// FIAREP Smart Repair Instructions — the phone side. Reads the compass at the
// moment of the photo, finds the street address from GPS, and asks the server
// for the Smart Field Ticket.
import * as FileSystem from 'expo-file-system/legacy';
import { getAccessToken, db } from './store';
import { currentFix, placeFor } from './clock-location';

let Location: any = null;
try { Location = require('expo-location'); } catch (e) { Location = null; }
let Magnetometer: any = null;
try { Magnetometer = require('expo-sensors').Magnetometer; } catch (e) { Magnetometer = null; }

export type SmartTicket = {
  issueFound: string; location: string; exactArea: string; repairRequired: string;
  tools: string[]; supplies: string[]; fixtures: string[]; steps: string[];
  trade: string; priority: 'Low' | 'Medium' | 'High'; priorityNote: string; estimatedTime: string; status: string;
  spec: string; diagram: string; partLabel: string;
  issueDetail: string; room: string; spot: string; distance: string; specs: Array<{ label: string; value: string }>;
  mark: { x: number; y: number; r: number }; arrow: { x: number; y: number };
  facing: string | null;
};
export type RepairVerification = { before: string[]; after: string[]; compliant: boolean; summary: string };

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
    spec: String(p.spec || ''), diagram: String(p.diagram || ''), partLabel: String(p.partLabel || ''),
    issueDetail: String(p.issueDetail || ''), room: String(p.room || ''), spot: String(p.spot || ''), distance: String(p.distance || ''),
    specs: Array.isArray(p.specs) ? p.specs.filter((x: any) => x && x.label).map((x: any) => ({ label: String(x.label), value: String(x.value || '') })) : [],
    mark: { x: Number(p.mark?.x ?? 0.5), y: Number(p.mark?.y ?? 0.5), r: Number(p.mark?.r ?? 0.15) },
    arrow: { x: Number(p.arrow?.x ?? 0.5), y: Number(p.arrow?.y ?? 0.5) },
    facing: p.facing ? String(p.facing) : null,
  };
}

/** Before photo vs after photo: is the repair done? */
export async function requestVerification(before: string, after: string, issue: string): Promise<RepairVerification> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error('The FIAREP backend domain is not configured.');
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(`https://${domain}/api/ai/smart-repair/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ before, after, issue }),
  });
  if (!res.ok) { const t = await res.json().catch(() => null); throw new Error((t && t.error) || 'Verification failed (' + res.status + ')'); }
  const p = await res.json();
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return { before: arr(p.before), after: arr(p.after), compliant: p.compliant === true, summary: String(p.summary || '') };
}

/** FIAREP Summary Card, as text. */
export function summaryCard(t: SmartTicket, area: string, status: string): string {
  const block = (k: string, v: string | string[]) => `${k}:\n` + (Array.isArray(v) ? (v.length ? v.join('\n') : '—') : (v || '—'));
  const loc = [t.facing ? t.facing.charAt(0).toUpperCase() + t.facing.slice(1) + ' Wall' : '', area].filter(Boolean).join('\n') || t.exactArea;
  return [
    block('ISSUE', t.issueFound), block('LOCATION', loc), block('TRADE', t.trade), block('TOOLS', t.tools),
    block('MATERIALS', [...t.fixtures, ...t.supplies]), block('SPEC', t.spec),
    block('DIAGRAM', t.diagram ? 'Included' : '—'), block('REFERENCE IMAGE', 'Included'), block('STATUS', status),
  ].join('\n\n');
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
    + `\n👷 Trade Required: ${t.trade}\n⏱ Estimated Repair Time: ${t.estimatedTime}`
    + (t.spec ? `\nSpec: ${t.spec}` : '')
    + (t.diagram ? `\n\nRepair Diagram\n${t.diagram}` : '');
}

export type SmartDrawings = { diagram: string | null; part: string | null; items: Record<string, string | null> };

/** FIAREP's drawings for a ticket: exploded diagram, replacement part, each tool and material. */
export async function requestDrawings(t: SmartTicket): Promise<SmartDrawings> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const token = await getAccessToken();
  if (!domain || !token) throw new Error('Sign in first.');
  const res = await fetch(`https://${domain}/api/ai/smart-repair/drawings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ issue: t.issueFound, trade: t.trade, partLabel: t.partLabel, spec: t.spec, diagram: t.diagram, tools: t.tools.slice(0, 6), materials: [...t.fixtures, ...t.supplies].slice(0, 6) }),
  });
  if (!res.ok) throw new Error('Drawings unavailable (' + res.status + ')');
  const p = await res.json();
  return { diagram: p.diagram || null, part: p.part || null, items: p.items && typeof p.items === 'object' ? p.items : {} };
}

// ── Saved repairs: each photo and its repair directions stay on the phone until
// the member deletes them.
export type SavedRepair = {
  id: string; at: string; photo: string | null; heading: number | null; address: string; apt: string; room: string; note: string;
  reportId?: string; ticket: SmartTicket; jobId?: string | null; ordered?: boolean; after?: string | null; check?: RepairVerification | null;
};
const SAVED_KEY = 'smart_repairs';

export async function listSavedRepairs(): Promise<SavedRepair[]> {
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', SAVED_KEY);
    const list = row?.value ? JSON.parse(row.value) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
async function writeSaved(list: SavedRepair[]): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', SAVED_KEY, JSON.stringify(list.slice(0, 200)));
}
export async function saveRepair(item: SavedRepair): Promise<void> {
  const list = await listSavedRepairs();
  await writeSaved([item, ...list.filter((x) => x.id !== item.id)]);
}
/** Delete a saved repair and its photos. A photo that went onto a work order stays — the job still uses it. */
export async function deleteSavedRepair(id: string): Promise<void> {
  const list = await listSavedRepairs();
  const item = list.find((x) => x.id === id);
  await writeSaved(list.filter((x) => x.id !== id));
  if (!item) return;
  const drop = async (p?: string | null) => {
    if (!p || !p.startsWith('photos/')) return;
    try { await FileSystem.deleteAsync(FileSystem.documentDirectory + p, { idempotent: true }); } catch {}
  };
  if (!item.jobId && !item.reportId) await drop(item.photo);
  if (!item.jobId) await drop(item.after);
}
