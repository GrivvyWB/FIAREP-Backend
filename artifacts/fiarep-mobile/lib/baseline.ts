// FIAREP Building Baseline — the phone side of the onboarding walk-through.
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAccessToken } from './store';
import { photoUri } from './photos';

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
export type Finding = {
  id: string; code?: string; area: string; floor: string; unit: string; wall: string; issue: string; description: string;
  trade: string; priority: Priority; time: string; action: string; tools: string[]; materials: string[]; fixtures: string[];
  photos: string[]; existing: boolean; sourceRef: string; status: 'open' | 'repaired'; createdAt: string;
};
export type Assessment = {
  id: string; reportId: string; clientOrgId: string; clientName: string; propertyName: string; address: string; ownerCompany: string;
  buildingType: string; units: number | null; inspectionDate: string; inspector: string; areas: Record<string, boolean>;
  findings: Finding[]; status: 'in_progress' | 'complete'; signatures: { inspector: string; representative: string; date: string };
  completedAt: string | null; createdAt: string; photoUrls: Record<string, string>; areaGroups: Record<string, string[]>;
  score: number; band: string; counts: Record<Priority, number>; roadmap: { immediate: number; shortTerm: number; longTerm: number };
};
export type ClientOrg = { id: string; name: string; licensedUnits: number | null; buildings: Array<{ address: string; units: number | null }> };

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const token = await getAccessToken();
  if (!domain || !token) throw new Error('Sign in first.');
  const res = await fetch(`https://${domain}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) { const t = await res.json().catch(() => null); throw new Error((t && t.error) || 'Request failed (' + res.status + ')'); }
  return res.json();
}

export const listBaselines = () => api<Assessment[]>('/v1/baseline');
export const getBaseline = (id: string) => api<Assessment>('/v1/baseline/' + encodeURIComponent(id));
export const baselineClients = () => api<ClientOrg[]>('/v1/baseline/clients');
export const baselineStatus = () => api<{ required: boolean; complete: boolean }>('/v1/baseline/status');
export const createBaseline = (b: { clientOrgId: string; address: string; propertyName: string; ownerCompany: string; buildingType: string; units: number | null }) => api<Assessment>('/v1/baseline', 'POST', b);
export const updateBaseline = (id: string, patch: Partial<Pick<Assessment, 'areas' | 'findings' | 'signatures' | 'status' | 'propertyName' | 'ownerCompany' | 'buildingType' | 'units'>>) => api<Assessment>('/v1/baseline/' + encodeURIComponent(id), 'PUT', patch);
export const importViolations = (id: string) => api<{ added: number; assessment: Assessment }>('/v1/baseline/' + encodeURIComponent(id) + '/import-violations', 'POST', {});

/** Send a finding's photo to FIAREP's storage; returns its stored path. */
export async function uploadFindingPhoto(stored: string): Promise<string> {
  const uri = photoUri(stored);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !('size' in info) || !info.size) throw new Error('Photo file is unavailable.');
  const { uploadUrl, objectPath } = await api<{ uploadUrl: string; objectPath: string }>('/v1/baseline/upload-url', 'POST', { name: stored.split('/').pop() || 'photo.jpg', size: info.size });
  const r = await FileSystem.uploadAsync(uploadUrl, uri, { httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, mimeType: 'image/jpeg' });
  if (r.status < 200 || r.status >= 300) throw new Error('Photo upload failed (' + r.status + ').');
  return objectPath;
}

export const PRIORITY_COLOR: Record<Priority, string> = { Critical: '#b91c1c', High: '#c2410c', Medium: '#b45309', Low: '#166534' };
export const BAND_ICON: Record<string, string> = { Excellent: '🟢', Good: '🟡', Fair: '🟠', Poor: '🔴' };
/** Smart Repair's priority → the baseline's four levels. */
export function priorityFromTicket(p: string, note: string): Priority {
  if (p === 'High' && /immediate|24 hours|emergency|now/i.test(note)) return 'Critical';
  return p === 'High' ? 'High' : p === 'Low' ? 'Low' : 'Medium';
}
/** The report's trade categories. */
export function tradeCategory(t: string): string {
  const s = t.toLowerCase();
  return /plumb/.test(s) ? 'Plumbing' : /electr/.test(s) ? 'Electrical' : /carpent/.test(s) ? 'Carpentry' : /roof/.test(s) ? 'Roofing' : /mason/.test(s) ? 'Masonry' : /paint/.test(s) ? 'Painting' : /hvac|boiler|heat/.test(s) ? 'HVAC' : 'General Maintenance';
}

/** True while a client's complaint tools wait for FIAREP's baseline walk-through (Platform Control switch). */
export function useBaselineWaiting(): boolean {
  const [waiting, setWaiting] = useState(false);
  useFocusEffect(useCallback(() => { baselineStatus().then((x) => setWaiting(x.required && !x.complete)).catch(() => undefined); }, []));
  return waiting;
}
export const COMPLAINT_TILES = new Set(['Review Reports', 'Manage All Requests', 'Resident Reports', 'Priority Queue']);
