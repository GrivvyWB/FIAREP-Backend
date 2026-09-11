import { useEffect, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { getAlertsMuted, getCurrentPosition, setAlertsMuted } from '../lib/store';
import { ACCENT } from '../lib/ui';

const UPPER_MANAGEMENT = new Set(['borough director', 'regional director']);

export default function UpperManagementMuteToggle() {
  const [allowed, setAllowed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getCurrentPosition(), getAlertsMuted()])
      .then(([position, current]) => {
        if (!active) return;
        setAllowed(UPPER_MANAGEMENT.has(position.trim().toLowerCase()));
        setMuted(current);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!allowed) return null;

  const onChange = async (next: boolean) => {
    setMuted(next);
    setSaving(true);
    try {
      await setAlertsMuted(next);
    } catch {
      setMuted(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{
      borderWidth: 1,
      borderColor: muted ? '#cbd5e1' : ACCENT,
      borderRadius: 12,
      padding: 14,
      marginBottom: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      backgroundColor: muted ? '#f8fafc' : '#f2f7fb',
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700' }}>Mute alert sounds</Text>
        <Text style={{ fontSize: 12, color: '#667085', marginTop: 2 }}>
          Red alerts and Inbox items remain visible.
        </Text>
      </View>
      <Switch
        value={muted}
        onValueChange={onChange}
        disabled={saving}
        trackColor={{ false: '#94a3b8', true: '#64748b' }}
        thumbColor="#ffffff"
      />
    </View>
  );
}