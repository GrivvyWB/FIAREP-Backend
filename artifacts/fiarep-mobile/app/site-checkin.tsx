// Building Check-In. Tap the building you are at; the phone reads where it
// really is. The time and the place your phone was are what the client sees.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { takePhoto, photoUri } from '../lib/photos';
import { useFocusEffect } from 'expo-router';
import { activeSiteCheckin, addressHere, checkInAt, checkOut, hereNow, listSiteBuildings, listSiteClients, mySiteCheckins, recordVisit, type AptVisit, type SiteBuilding, type SiteCheckin } from '../lib/site-checkin';
import { ui } from '../lib/ui';
import { useRawModules } from '../lib/module-access';
import { getSessionIdentity } from '../lib/store';

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
function VisitLine({ v }: { v: AptVisit }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: '#eef2f7', paddingVertical: 6, gap: 2 }}>
      <Text style={{ fontWeight: '700', color: v.outcome === 'access' ? '#166534' : '#b91c1c' }}>{time(v.at)} · Apt {v.unit} — {v.outcome === 'access' ? 'Access gained' : 'Tenant refused access'}</Text>
      <Text style={{ fontSize: 12, color: '#475569' }}>
        {v.atBuilding === true ? '✓ At the building' : v.atBuilding === false ? `⚠ ${far(v.distanceM)} from the building` : 'Location recorded'}
        {v.doorNumber ? (v.doorMatches ? ` · Door shows ${v.doorNumber} ✓` : ` · ⚠ Door shows ${v.doorNumber}`) : ' · Door number not visible in the photo'}
      </Text>
      {!!v.photoUrl && <Image source={{ uri: v.photoUrl }} style={{ width: '100%', height: 160, borderRadius: 8, backgroundColor: '#111' }} resizeMode="cover" />}
    </View>
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
  // Apartment visit being recorded, and the saved visits' drop-down.
  const [visitOpen, setVisitOpen] = useState(false);
  const [unit, setUnit] = useState('');
  const [here, setHere] = useState<Awaited<ReturnType<typeof hereNow>>>(null);
  const [doorPhoto, setDoorPhoto] = useState<string | null>(null);
  const [visitsOpen, setVisitsOpen] = useState(false);
  // Out of network complaint: a building not in the system that a client asked a member to check.
  const [oonOpen, setOonOpen] = useState(false);
  const rawModules = useRawModules();
  const [myTenant, setMyTenant] = useState('');
  const [oonBy, setOonBy] = useState('');
  const [oonClient, setOonClient] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const act = await activeSiteCheckin().catch(() => null);
    setActiveId(act?.id || null);
    try { setBuildings(await listSiteBuildings()); } catch { /* shown empty */ }
    try { setMine(await mySiteCheckins()); } catch { /* shown empty */ }
    try { setClients(await listSiteClients()); } catch { setClients([]); }
    try { setMyTenant((await getSessionIdentity())?.tenantId || 'default'); } catch { /* unknown */ }
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

  // A paid add-on: a client's members see it when it is on for their company; FIAREP's crew sees it when any client has it.
  const oonAllowed = myTenant === 'default' ? clients.length > 0 : rawModules['outOfNetwork'] === true;
  async function checkInOutOfNetwork() {
    if (myTenant === 'default' && !oonClient) { Alert.alert('Out of network complaint', 'Pick the client who asked you to check this building.'); return; }
    // No typing: the address is read from where the phone is.
    setBusy('Reading where you are…');
    let address = '';
    try { address = await addressHere(); }
    catch (e: any) { setBusy(''); Alert.alert('Out of network complaint', e?.message || 'Could not read where you are.'); return; }
    setBusy('');
    Alert.alert('You are at', `${address || 'this location'}\n\nOut of network complaint. Check in here? Your phone's location is recorded with the time.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Check in', onPress: () => void (async () => {
        setBusy('Reading your location…');
        try { const c = await checkInAt({ address, outOfNetwork: true, requestedBy: oonBy.trim(), clientId: oonClient }); setActiveId(c.id); setOonOpen(false); setOonBy(''); setOonClient(''); await load(); }
        catch (e: any) { Alert.alert('Check-in', e?.data?.error || e?.message || 'Try again.'); }
        finally { setBusy(''); }
      })() },
    ]);
  }

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
  async function confirmLocation() {
    setBusy('Reading your location…');
    try { const h = await hereNow(); if (!h) throw new Error('Could not read where your phone is. Step near a window and try again.'); setHere(h); }
    catch (e: any) { Alert.alert('Location', e?.message || 'Try again.'); }
    finally { setBusy(''); }
  }
  async function saveVisit(outcome: 'access' | 'refused') {
    if (!unit.trim()) { Alert.alert('Apartment', 'Enter the apartment.'); return; }
    if (!doorPhoto) { Alert.alert('Door photo', 'Take a photo of the apartment door.'); return; }
    setBusy('Saving the visit…');
    try {
      await recordVisit({ unit: unit.trim(), outcome, photo: doorPhoto, here });
      setVisitOpen(false); setUnit(''); setHere(null); setDoorPhoto(null);
      await load();
    } catch (e: any) { Alert.alert('Apartment visit', e?.data?.error || e?.message || 'Try again.'); }
    finally { setBusy(''); }
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
          {active.outOfNetwork && <Text style={{ fontSize: 12, color: '#92400e', fontWeight: '700' }}>Out of network complaint{active.requestedBy ? ` · asked by ${active.requestedBy}` : ''}</Text>}
          <Text style={ui.listSub}>Since {time(active.checkedInAt)} · {day(active.checkedInAt)}</Text>
          <Where c={active} />
          <Timeline c={active} />

          {/* Apartment visits: location, door photo, Access Gained / Tenant Refused Access. */}
          {!visitOpen ? (
            <Pressable style={[ui.btnOutline, { marginTop: 10 }]} disabled={!!busy} onPress={() => { setVisitOpen(true); setHere(null); setDoorPhoto(null); }}><Text style={{ color: '#1C4E86', fontWeight: '700' }}>+ Apartment visit</Text></Pressable>
          ) : (
            <View style={{ marginTop: 10, gap: 8, backgroundColor: '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: '#dbe3ee', padding: 10 }}>
              <Text style={{ fontWeight: '800' }}>Apartment visit</Text>
              <TextInput style={ui.input} value={unit} onChangeText={setUnit} placeholder="Apartment (e.g. 4B)" autoCapitalize="characters" />
              <Pressable style={ui.btnOutline} disabled={!!busy} onPress={() => void confirmLocation()}><Text style={{ color: '#1C4E86', fontWeight: '700' }}>{here ? 'Read my location again' : '1. Confirm my location'}</Text></Pressable>
              {!!here && (here.distanceM != null && here.distanceM <= 150 + Math.min(here.accuracyM ?? 0, 100)
                ? <Text style={{ color: '#166534', fontWeight: '700' }}>✓ You are at the building ({here.distanceM} m)</Text>
                : <Text style={{ color: '#b91c1c', fontWeight: '700' }}>⚠ You are {here.distanceM != null ? far(here.distanceM) : 'away'} from the building</Text>)}
              <Pressable style={ui.btnOutline} disabled={!!busy} onPress={() => void (async () => { const u = await takePhoto().catch(() => null); if (u) setDoorPhoto(u); })()}><Text style={{ color: '#1C4E86', fontWeight: '700' }}>{doorPhoto ? 'Retake door photo' : '2. 📷 Photo of the apartment door'}</Text></Pressable>
              {!!doorPhoto && <Image source={{ uri: photoUri(doorPhoto) }} style={{ width: '100%', height: 170, borderRadius: 8, backgroundColor: '#111' }} resizeMode="cover" />}
              <Text style={ui.label}>3. What happened</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={[ui.btn, { flex: 1, backgroundColor: '#166534' }]} disabled={!!busy} onPress={() => void saveVisit('access')}><Text style={{ color: '#fff', fontWeight: '700' }}>Access Gained</Text></Pressable>
                <Pressable style={[ui.btn, { flex: 1, backgroundColor: '#b91c1c' }]} disabled={!!busy} onPress={() => void saveVisit('refused')}><Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>Tenant Refused Access</Text></Pressable>
              </View>
              <Pressable onPress={() => setVisitOpen(false)}><Text style={{ color: '#64748b', textAlign: 'center' }}>Cancel</Text></Pressable>
            </View>
          )}
          {(active.visits?.length || 0) > 0 && (
            <>
              <Pressable onPress={() => setVisitsOpen((o) => !o)} style={{ marginTop: 8 }}>
                <Text style={{ color: '#1C4E86', fontWeight: '700' }}>{visitsOpen ? '▾' : '▸'} Apartment visits ({active.visits!.length}) · {active.visits!.filter((v) => v.outcome === 'access').length} access, {active.visits!.filter((v) => v.outcome === 'refused').length} refused</Text>
              </Pressable>
              {visitsOpen && active.visits!.slice().reverse().map((v) => <VisitLine key={v.id} v={v} />)}
            </>
          )}
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
          {/* A building that is not in the system: the client asked you to go check it. */}
          {oonAllowed && <Pressable onPress={() => setOonOpen((o) => !o)} style={{ marginTop: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#eef2f7' }}>
            <Text style={{ color: '#1C4E86', fontWeight: '800' }}>{oonOpen ? '▾' : '▸'} Out of network complaint</Text>
            <Text style={ui.listSub}>A building not in the system — your location is read for you</Text>
          </Pressable>}
          {oonAllowed && oonOpen && (
            <View style={{ gap: 8 }}>
              <TextInput style={ui.input} value={oonBy} onChangeText={setOonBy} placeholder="Who asked / who called (optional)" />
              {clients.length > 0 && (
                <View style={{ gap: 4 }}>
                  <Text style={ui.label}>For which client?</Text>
                  {clients.map((c) => (
                    <Pressable key={c.id} onPress={() => setOonClient(c.id)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: oonClient === c.id ? '#1C4E86' : '#e2e8f0', backgroundColor: oonClient === c.id ? '#eff6ff' : '#fff' }}>
                      <Text style={{ fontWeight: oonClient === c.id ? '800' : '500' }}>{oonClient === c.id ? '✓ ' : ''}{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Pressable style={[ui.btn, { marginTop: 4 }]} disabled={!!busy} onPress={() => void checkInOutOfNetwork()}><Text style={ui.btnText}>📍 Check in where I am — out of network</Text></Pressable>
            </View>
          )}
        </View>
      )}

      {mine.filter((c) => c.id !== active?.id).slice(0, 10).map((c) => (
        <View key={c.id} style={[ui.card, { gap: 2, padding: 12 }]}>
          <Text style={{ fontWeight: '700' }}>{c.building.address}</Text>
          {c.outOfNetwork && <Text style={{ fontSize: 12, color: '#92400e', fontWeight: '700' }}>Out of network complaint{c.requestedBy ? ` · asked by ${c.requestedBy}` : ''}</Text>}
          <Text style={ui.listSub}>{day(c.checkedInAt)} · {time(c.checkedInAt)}{c.checkedOutAt ? `–${time(c.checkedOutAt)}` : ''}</Text>
          <Where c={c} />
        </View>
      ))}
    </ScrollView>
  );
}
