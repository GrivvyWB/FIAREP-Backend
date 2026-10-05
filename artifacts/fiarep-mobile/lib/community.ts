// Community Coordinators: field outreach records (residents, buildings &
// owners). Online-only — these live on the server, inside the coordinator
// unit, and are never copied into the phone's offline tables.
import {
  createEntityRecord,
  deleteEntityRecord,
  getEntityRecord,
  listEntityRecords,
  updateEntityRecord,
  type EntityRecord,
} from '@workspace/api-client-react';
import { getSessionIdentity } from './store';

export type CommunityEntity = 'community-residents' | 'community-buildings';
export type CommunityRecord = EntityRecord & { state: Record<string, any> };

export const PROGRAMS = [
  'General outreach',
  'Tenant & Owner Resources (rent subsidies, Section 8)',
  'Enforcement & Neighborhood Services (violations, owner accountability)',
  'Emergency Housing & Relocation (vacate orders, fire, displacement)',
];
export const CRITICAL_TAGS = [
  'No heat / hot water', 'Mold', 'Lead paint', 'Pests', 'Vacate order', 'Fire damage',
  'Elderly / disabled resident', 'Children in unit', 'Owner unresponsive', 'Other',
];
export const BOROUGHS = ['Manhattan', 'Brooklyn', 'Bronx', 'Queens', 'Staten Island'];

export const str = (v: unknown) => String(v ?? '').trim();
export const today = () => new Date().toISOString().slice(0, 10);

export async function isCommunitySupervisor(): Promise<boolean> {
  const identity = await getSessionIdentity().catch(() => null);
  return str(identity?.position).toLowerCase() === 'community coordinator supervisor';
}

export async function listCommunity(entity: CommunityEntity): Promise<CommunityRecord[]> {
  const rows = (await listEntityRecords(entity)) as CommunityRecord[];
  return rows.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
}

export async function getCommunity(entity: CommunityEntity, id: string): Promise<CommunityRecord> {
  return (await getEntityRecord(entity, id)) as CommunityRecord;
}

function newId(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0; const v = ch === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
  });
}

export async function saveCommunity(
  entity: CommunityEntity,
  existing: CommunityRecord | null,
  state: Record<string, unknown>,
  development: string,
): Promise<CommunityRecord> {
  if (existing) {
    return (await updateEntityRecord(entity, existing.id, {
      id: existing.id, version: existing.version, development: development || undefined, state,
    } as never)) as CommunityRecord;
  }
  return (await createEntityRecord(entity, {
    id: newId(), version: 1, development: development || undefined, state,
  } as never)) as CommunityRecord;
}

export async function removeCommunity(entity: CommunityEntity, record: CommunityRecord): Promise<void> {
  await deleteEntityRecord(entity, record.id, { version: record.version } as never);
}
