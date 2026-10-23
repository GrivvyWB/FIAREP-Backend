// Site Check-Ins (the office's view, from the bottom bar): every check-in at the company's
// buildings for a day — the building tapped, where the phone really was, when they left
// and came back, apartments visited, notes. Reading only; delete and print are on fiarep.com.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';
import { ui, ACCENT } from '../lib/ui';

type Ev = { type: 'left' | 'stop' | 'back'; at: string; until?: string | null; address?: string };
type Row = {
  id: string; staffName: string; position?: string; staffTenant?: string;
  building: { address: string }; phone: { address: string; accuracyM?: number | null };
  distanceM: number | null; atBuilding: boolean | null; checkedInAt: string; checkedOutAt?: string; events?: Ev[];
  visits?: { id: string; unit: string; outcome: 'access' | 'refused'; at: string }[];
  notes?: { id: string; text: string; at: string }[];
};
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const far = (m: number | null) => (m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1609).toFixed(1)} mi`);
const ymd = (d: Date) => d.toLocaleDateString('en-CA');

export default function SiteCheckins() {
  const [day, setDay] = useState(() => new Date());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = ymd(day);
      setRows(await customFetch<Row[]>(`/api/v1/site-checkins?from=${d}&to=${d}`, { responseType: 'json' } as never));
    } catch (e: any) { setError(e?.data?.error || e?.message || 'Could not load check-ins.'); setRows([]); }
  }, [day]);
  useFocusEffect(useCallback(() => { setRows(null); void load(); }, [load]));

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => !t || r.staffName.toLowerCase().includes(t) || r.building.address.toLowerCase().includes(t));
  }, [rows, q]);
  const flagged = shown.filter((r) => r.atBuilding === false).length;
  const isToday = ymd(day) === ymd(new Date());
  const move = (n: number) => setDay((d) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });

  return (
    <ScrollView contentContainerStyle={[ui.wrap, { gap: 10 }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => move(-1)} style={{ padding: 10 }}><Text style={{ fontSize: 20, color: ACCENT }}>‹</Text></Pressable>
        <Text style={{ fontWeight: '800', fontSize: 16 }}>{isToday ? 'Today' : day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
        <Pressable onPress={() => !isToday && move(1)} style={{ padding: 10, opacity: isToday ? 0.3 : 1 }}><Text style={{ fontSize: 20, color: ACCENT }}>›</Text></Pressable>
      </View>
      <TextInput style={ui.input} value={q} onChangeText={setQ} placeholder="Search a member or a building" />
      {rows === null && <ActivityIndicator style={{ marginTop: 20 }} />}
      {!!error && <Text style={{ color: '#C0392B' }}>{error}</Text>}
      {rows && <Text style={{ color: '#475569' }}>{shown.length} check-in{shown.length === 1 ? '' : 's'}{flagged ? <Text style={{ color: '#C0392B', fontWeight: '700' }}>{`  ·  ${flagged} not at the building`}</Text> : null}</Text>}
      {rows && shown.length === 0 && !error && <Text style={ui.empty}>No check-ins this day.</Text>}
      {shown.map((r) => {
        const isOpen = open === r.id;
        const away = (r.events || []).filter((e) => e.type === 'left').length;
        return (
          <Pressable key={r.id} onPress={() => setOpen(isOpen ? null : r.id)} style={[ui.card, { gap: 3, borderColor: r.atBuilding === false ? '#f5a5a5' : '#e2e8f0', borderWidth: 1 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '800', flex: 1 }}>{r.staffName}{r.position ? <Text style={{ fontWeight: '400', color: '#64748b' }}>{`  ${r.position}`}</Text> : null}</Text>
              <Text style={{ fontWeight: '700' }}>{time(r.checkedInAt)}–{r.checkedOutAt ? time(r.checkedOutAt) : 'still in'}</Text>
            </View>
            <Text>Tapped: <Text style={{ fontWeight: '700' }}>{r.building.address}</Text></Text>
            <Text style={{ color: '#475569' }}>Phone was at: {r.phone.address}</Text>
            {r.atBuilding === true && <Text style={{ color: '#1E7D4F', fontWeight: '700' }}>✓ At the building</Text>}
            {r.atBuilding === false && <Text style={{ color: '#C0392B', fontWeight: '700' }}>⚠ Not at the building — {far(r.distanceM)} away</Text>}
            <Text style={{ color: '#64748b', fontSize: 12 }}>{away === 0 ? 'Never left' : `Left ${away}×`}{r.visits?.length ? ` · ${r.visits.length} apartment${r.visits.length === 1 ? '' : 's'}` : ''}{r.notes?.length ? ` · ${r.notes.length} note${r.notes.length === 1 ? '' : 's'}` : ''}</Text>
            {isOpen && (
              <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 6, gap: 3 }}>
                <Text>🟢 {time(r.checkedInAt)} checked in</Text>
                {(r.events || []).map((e, i) => (
                  <Text key={i}>{e.type === 'left' ? '🟠' : e.type === 'back' ? '🔵' : '⏸'} {time(e.at)}{e.until ? `–${time(e.until)}` : ''} {e.type === 'left' ? 'left the building' : e.type === 'back' ? 'came back' : 'stopped'}{e.address ? ` · ${e.address}` : ''}</Text>
                ))}
                {(r.visits || []).map((v) => <Text key={v.id}>🚪 {time(v.at)} Apt {v.unit} — {v.outcome === 'access' ? 'access' : 'refused'}</Text>)}
                {(r.notes || []).map((n) => <Text key={n.id}>📝 {time(n.at)} {n.text}</Text>)}
                {r.checkedOutAt ? <Text>🔴 {time(r.checkedOutAt)} checked out</Text> : null}
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
