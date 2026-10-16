import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getCurrentActor, getCurrentPosition, isFiarepAdministrator } from './store';
import { lockOn } from './module-access';

// Supervisors, managers, directors and administrators take action on
// fiarep.com; the app is view-only for them (the server enforces this too).
// Superintendent Ⓔ is exempt — they respond in the field. Their own time off,
// attendance, Inbox and emergency requests to workers still work in the app.
export async function isAppReadOnly(): Promise<boolean> {
  // A read-only lock switched in Platform Control; off unless switched on.
  if (!(await lockOn('appViewOnly'))) return false;
  const [actor, position] = await Promise.all([
    getCurrentActor().catch(() => ({ role: '' } as { role: string })),
    getCurrentPosition().catch(() => ''),
  ]);
  const role = String(actor?.role || '');
  // FIAREP's own administrators work in the field and approve from the phone.
  if (role === 'administrator' && await isFiarepAdministrator().catch(() => false)) return false;
  return (role === 'management' || role === 'administrator') && position.trim() !== 'Superintendent Ⓔ';
}

/** null while loading, then true for view-only supervisors/managers. */
export function useAppReadOnly(): boolean | null {
  const [readOnly, setReadOnly] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    isAppReadOnly().then((value) => { if (active) setReadOnly(value); }).catch(() => { if (active) setReadOnly(false); });
    return () => { active = false; };
  }, []));
  return readOnly;
}

export const READ_ONLY_NOTE =
  'View-only on the app. Assign, send, approve and create on fiarep.com. Time off, attendance, Inbox and emergency requests still work here.';
