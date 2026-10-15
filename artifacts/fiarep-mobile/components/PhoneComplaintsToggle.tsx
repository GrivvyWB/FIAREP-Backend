// "Complaints on my phone" — each person's own switch, the same one as on the
// platform. Off: complaints still come in on the platform and in the Inbox here,
// but the phone isn't buzzed for each one.
import { useEffect, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { getAccessToken } from '../lib/store';
import { ACCENT } from '../lib/ui';

async function call(method: 'GET' | 'PUT', on?: boolean): Promise<boolean | null> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const token = await getAccessToken();
  if (!domain || !token) return null;
  const res = await fetch(`https://${domain}/api/v1/notifications/phone-complaints`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(method === 'PUT' ? { body: JSON.stringify({ on }) } : {}),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const p = await res.json().catch(() => null);
  return p && typeof p.on === 'boolean' ? p.on : null;
}

export default function PhoneComplaintsToggle({ dark }: { dark?: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void call('GET').then(setOn); }, []);
  if (on === null) return null;
  const change = async (next: boolean) => {
    setOn(next); setSaving(true);
    const saved = await call('PUT', next);
    if (saved === null) setOn(!next);
    setSaving(false);
  };
  return (
    <View style={{ borderWidth: 1, borderColor: on ? ACCENT : '#cbd5e1', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: dark ? 'rgba(255,255,255,0.06)' : on ? '#f2f7fb' : '#f8fafc' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: dark ? '#fff' : '#0f172a' }}>Complaints on my phone</Text>
        <Text style={{ fontSize: 12, color: dark ? '#cbd5e1' : '#667085', marginTop: 2 }}>
          {on ? 'Each new complaint buzzes this phone.' : 'Off — complaints go to the platform and the Inbox only; no buzz on this phone.'}
        </Text>
      </View>
      <Switch value={on} onValueChange={change} disabled={saving} trackColor={{ false: '#94a3b8', true: ACCENT }} thumbColor="#ffffff" />
    </View>
  );
}
