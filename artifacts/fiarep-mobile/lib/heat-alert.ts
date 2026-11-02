// The open heat & hot water alert for this company (HPD / DOB / OATH heat and hot water violations and
// complaints, and residents' heat complaints), checked when a screen opens and every minute while it is open.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';

export type HeatItem = { key: string; building: string; apt: string; kind: 'heat' | 'hot water' | 'hazard'; source: string; what: string; at: string };
export type HeatAlert = { id: string; items: HeatItem[]; openedAt: string; counts: { buildings: number; apartments: number; heat: number; hotWater: number; hazard: number }; sentence: string } | null;

export async function fetchHeatAlert(): Promise<HeatAlert> {
  return customFetch<HeatAlert>('/api/v1/heat-alert', { responseType: 'json' } as never).catch(() => null);
}
export async function ackHeatAlert(id: string): Promise<void> {
  await customFetch(`/api/v1/heat-alert/${encodeURIComponent(id)}/ack`, { method: 'POST', responseType: 'json' } as never);
}

export function useHeatAlert(): [HeatAlert, () => Promise<void>] {
  const [alert, setAlert] = useState<HeatAlert>(null);
  const load = useCallback(async () => { setAlert(await fetchHeatAlert()); }, []);
  useFocusEffect(useCallback(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void load(); });
    return () => sub.remove();
  }, [load]);
  return [alert, load];
}
