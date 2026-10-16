// Building Check-In. Tap the building you are at; the phone reads where it
// really is. The time and the place your phone was are what the client sees.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { activeSiteCheckin, checkInAt, checkOut, listSiteBuildings, mySiteCheckins, type SiteBuilding, type SiteCheckin } from '../lib/site-checkin';
import { ui } from '../lib/ui';

const NAVY = '#0B2A4A';
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const far = (m: number | null) => (m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1609).toFixed(1)} mi`);

function Where({ c }: { c: SiteCheckin }) {
  return (
    <>
      <Text style={{ fontSize: 13, marginTop: 4 }}>Your phone was at: <Text style={{ fontWeight: '700' }}>{c.phone.address}</Text></Text>
      {c.atBuilding === true && <Text style={{ color: '#166534', fontWeight: '700', marginTop: 2 }}>✓ At the building</Text>}
      {c.atBuilding === false && <Text style={{ color: '#b91c1c', fontWeight: '700', marginTop: 2 }}>⚠ Not at the building — {far(c.distanceM)} away</Text>}
      {c.atBuilding == null && <Text style={ui.listSub}>The building's location could not be found on the map.</Text>}
    </>
  );
}
function Timeline({ c }: { c: SiteCheckin }) {
  return (
    <View style={{ marginTop: 6, gap: 2 }}>
      <Text style={{ fontSize: 13 }}>🟢 {time(c.checkedInAt)} checked in</Text>
      {c.events.map((e, i) => (
        <Text key={i} style={{ fontSize: 13 }}>
          {e.type === 'left' ? `🚶 ${time(e.at)} left the building` : e.type === 'back' ? `🏢 ${time(e.at)} back at the building` : `📍 ${time(e.at)}–${time(e.until)} at ${e.address || 'a stop'}`}
        </Text>
      ))}
      {!!c.checkedOutAt && <Text style={{ fontSize: 13 }}>🔴 {time(c.checkedOutAt)} checked out</Text>}
    </View>
  );
}

export default function SiteCheckinScreen() {
  const [buildings, setBuildings] = useState<SiteBuilding[]>([]);
  const [mine, setMine] = useState<SiteCheckin[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const act = await activeSiteCheckin().catch(() => null);
    setActiveId(act?.id || null);
    try { setBuildings(await listSiteBuildings()); } catch { /* shown empty */ }
    try { setMine(await mySiteCheckins()); } catch { /* shown empty */ }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const active = mine.find((c) => c.id === activeId && !c.checkedOutAt) || null;
  // Buildings already checked out today: done until tomorrow.
  const todayKey = new Date().toDateString();
  const doneToday = useMemo(() => new Set(mine.filter((c) => !!c.checkedOutAt && new Date(c.checkedInAt).toDateString() === todayKey).map((c) => c.building.address.trim().toLowerCase())), [mine, todayKey]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? buildings.filter((b) => b.address.toLowerCase().includes(t) || (b.development || '').toLowerCase().includes(t)) : buildings).slice(0, 40);
  }, [buildings, q]);

  function confirm(b: SiteBuilding) {
    Alert.alert('Check in here?', `${b.address}\nYour phone's location is recorded with the time.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Check in', onPress: () => void (async () => {
        setBusy('Reading your location…');
        try { const c = await checkInAt({ propertyId: b.id, address: b.address }); setActiveId(c.id); await load(); }
        catch (e: any) { Alert.alert('Check-in', e?.data?.error || e?.message || 'Try again.'); }
        finally { setBusy(''); }
      })() },
    ]);
  }
  function out() {
    Alert.alert(
      'Are you completely finished at this building for today?',
      `${active?.building.address || ''}\n\nChecking out logs this building out for today — you cannot check back in here until tomorrow.\n\nGoing to the store or a supply run? Do not check out. Your trip is recorded and you are still checked in when you come back.`,
      [
      { text: 'No, I am coming back', style: 'cancel' },
      { text: 'Yes, done for today', style: 'destructive', onPress: () => void (async () => {
        setBusy('Checking out…');
        try { await checkOut(); setActiveId(null); await load(); }
        catch (e: any) { Alert.alert('Check out', e?.data?.error || e?.message || 'Try again.'); }
        finally { setBusy(''); }
      })() },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: '#eef2f7' }} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
      <View style={{ backgroundColor: NAVY, borderRadius: 10, padding: 14 }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>Building Check-In</Text>
        <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2 }}>Tap the building you are at. Your phone's location and the time are recorded, and so is every time you leave and come back. Check in once; check out once, when you are done for the day.</Text>
      </View>

      {!!busy && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Text style={ui.listSub}>{busy}</Text></View>}

      {active ? (
        <View style={[ui.card, { gap: 2 }]}>
          <Text style={{ fontWeight: '800', color: '#166534' }}>CHECKED IN</Text>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{active.building.address}</Text>
          <Text style={ui.listSub}>Since {time(active.checkedInAt)} · {day(active.checkedInAt)}</Text>
          <Where c={active} />
          <Timeline c={active} />
          <Pressable style={[ui.btn, { backgroundColor: '#b91c1c', marginTop: 10 }]} disabled={!!busy} onPress={out}><Text style={{ color: '#fff', fontWeight: '700' }}>Done for today — check out</Text></Pressable>
        </View>
      ) : (
        <View style={[ui.card, { gap: 6 }]}>
          <Text style={{ fontWeight: '800' }}>Which building are you at?</Text>
          <TextInput style={ui.input} value={q} onChangeText={setQ} placeholder="Search an address" autoCapitalize="characters" />
          {matches.map((b) => {
            const done = doneToday.has(b.address.trim().toLowerCase());
            return (
              <Pressable key={b.id} onPress={() => confirm(b)} disabled={!!busy || done} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#eef2f7', opacity: done ? 0.5 : 1 }}>
                <Text style={{ fontWeight: '600' }}>{b.address}</Text>
                {!!b.development && b.development !== b.address && <Text style={ui.listSub}>{b.development}</Text>}
                {done && <Text style={{ fontSize: 12, color: '#166534', fontWeight: '700' }}>✓ Finished for today</Text>}
              </Pressable>
            );
          })}
          {buildings.length === 0 && !loading && <Text style={ui.listSub}>No buildings yet — they are added in Platform Control → Properties.</Text>}
          {buildings.length > matches.length && <Text style={ui.listSub}>Showing {matches.length} of {buildings.length.toLocaleString()} — type to narrow it down.</Text>}
        </View>
      )}

      {mine.filter((c) => c.id !== active?.id).slice(0, 10).map((c) => (
        <View key={c.id} style={[ui.card, { gap: 2, padding: 12 }]}>
          <Text style={{ fontWeight: '700' }}>{c.building.address}</Text>
          <Text style={ui.listSub}>{day(c.checkedInAt)} · {time(c.checkedInAt)}{c.checkedOutAt ? `–${time(c.checkedOutAt)}` : ''}</Text>
          <Where c={c} />
        </View>
      ))}
    </ScrollView>
  );
}
