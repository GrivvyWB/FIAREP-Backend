import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getAttendanceHistory,
  getAttendanceStatus,
  punchAttendance,
  type TimeClockPunch,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { customFetch } from '@workspace/api-client-react';

/** A place the worker stayed 30+ minutes while on the clock. The server has
 *  recorded these all along on /v1/time-clock/locations; this screen never
 *  asked for them, so the places you worked were invisible to you. */
type Stop = { id: string; address: string | null; latitude: number; longitude: number; arrivedAt: string; leftAt: string | null };

const span = (from: string, to: string | null) => {
  const mins = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
};

export default function Attendance() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getAttendanceStatus>> | null>(null);
  const [history, setHistory] = useState<TimeClockPunch[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextHistory] = await Promise.all([getAttendanceStatus(), getAttendanceHistory()]);
      setStatus(nextStatus);
      setHistory(nextHistory);
      setMessage('');
      // The places worked, not just the punches.
      try {
        setStops(await customFetch<Stop[]>('/api/v1/time-clock/locations', { responseType: 'json' } as never));
      } catch { /* the punches still show */ }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load attendance.');
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function punch() {
    if (!status) return;
    setBusy(true);
    setMessage('');
    try {
      const idempotencyKey = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await punchAttendance(status.nextDirection, idempotencyKey);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record attendance.');
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return <View style={[ui.wrap, { justifyContent: 'center' }]}><ActivityIndicator color={ACCENT} /><Text style={ui.label}>{message}</Text></View>;
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 14 }}>Attendance</Text>
      <Text style={ui.label}>
        {status.current ? `Currently ${status.current.direction === 'in' ? 'clocked in' : 'clocked out'}.` : 'No punches recorded.'}
      </Text>
      {status.config.mobileClockEnabled && (
        <Pressable style={ui.btn} onPress={punch} disabled={busy}>
          <Text style={ui.btnText}>{busy ? '…' : status.nextDirection === 'in' ? 'Clock in' : 'Clock out'}</Text>
        </Pressable>
      )}
      {!!message && <Text style={{ color: '#b91c1c', marginVertical: 10 }}>{message}</Text>}
      {status.config.mobileClockEnabled && (
        <Text style={[ui.label, { marginTop: 8 }]}>Each punch records where you are. On the clock, the app notes each place you stay more than 30 minutes — when you got there and when you left — and nothing while you stay put.</Text>
      )}
      <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 18, marginBottom: 8 }}>Places worked</Text>
      {stops.length === 0 ? (
        <Text style={ui.label}>No stops recorded yet. While you are on the clock, anywhere you stay more than 30 minutes is listed here.</Text>
      ) : stops.map((stop) => (
        <View key={stop.id} style={{ borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingVertical: 10 }}>
          <Text style={{ fontWeight: '600' }}>{stop.address || `${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}`}</Text>
          <Text style={ui.label}>
            Arrived {new Date(stop.arrivedAt).toLocaleString()}
            {stop.leftAt ? ` · left ${new Date(stop.leftAt).toLocaleTimeString()}` : ' · still here'}
            {` · ${span(stop.arrivedAt, stop.leftAt)}`}
          </Text>
        </View>
      ))}

      <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 18, marginBottom: 8 }}>Punch history</Text>
      {history.map((punch) => (
        <View key={punch.id} style={{ borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingVertical: 10 }}>
          <Text style={{ fontWeight: '600' }}>{punch.direction === 'in' ? 'Clock in' : 'Clock out'}</Text>
          <Text style={ui.label}>{new Date(punch.punchAt).toLocaleString()} · {punch.source === 'external' ? 'External' : 'FIAREP mobile'}</Text>
          {!!(punch as { location?: { address?: string | null; latitude?: number; longitude?: number } | null }).location && (
            <Text style={ui.label}>{(punch as { location?: { address?: string | null; latitude?: number; longitude?: number } }).location?.address || `${(punch as { location?: { latitude?: number } }).location?.latitude?.toFixed(4)}, ${(punch as { location?: { longitude?: number } }).location?.longitude?.toFixed(4)}`}</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}