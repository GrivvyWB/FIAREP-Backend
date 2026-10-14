// Messaging FIAREP: people with a code and client companies on the plan write
// to FIAREP Services or FIAREP's administrator - never to a technician or a
// worker. Every conversation is seen only by its two sides. The master switch
// is on FIAREP's own Module Management page ("Messaging FIAREP").
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';

export type ChatMessage = { id: string; mine: boolean; author: string; body: string; at: string };

export const msgGet = <T,>(url: string) => customFetch<T>(url, { responseType: 'json' } as never);
export const msgPost = <T,>(url: string, body: unknown) => customFetch<T>(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), responseType: 'json',
} as never);

/** Is messaging FIAREP switched on? null while checking. */
export function useMessagingOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => {
    let alive = true;
    msgGet<{ open: boolean }>('/api/v1/public/messages/status')
      .then((r) => { if (alive) setOpen(r.open !== false); })
      .catch(() => { if (alive) setOpen(false); });
    return () => { alive = false; };
  }, []));
  return open;
}
