import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, RefreshControl, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { clearAppMode, getCurrentActor, getSessionIdentity, logout } from '../lib/store';
import { useAppMode } from './_layout';
import { ui } from '../lib/ui';
import {
  approveCommunity, isCommunitySupervisor, listCommunity, removeCommunity, shareResidentPdf, shareResidentText, str, today, type CommunityRecord,
} from '../lib/community';
import { sectionsOnRecord } from '../lib/community-report';

const ACCENT = '#F2C14E';

export default function CommunityHome() {
  const router = useRouter();
  const { refresh } = useAppMode();
  const [tab, setTab] = useState<'residents' | 'buildings'>('residents');
  const [search, setSearch] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [review, setReview] = useState<'all' | 'today' | 'pending' | 'approved'>('all');
  const [who, setWho] = useState('');
  const [supervisor, setSupervisor] = useState(false);
  const [meId, setMeId] = useState('');
  const [name, setName] = useState('');
  const [residents, setResidents] = useState<CommunityRecord[]>([]);
  const [buildings, setBuildings] = useState<CommunityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [actor, identity, sup, r, b] = await Promise.all([
        getCurrentActor(), getSessionIdentity().catch(() => null), isCommunitySupervisor(),
        listCommunity('community-residents'), listCommunity('community-buildings'),
      ]);
      setName(actor.name); setMeId(identity?.staffId || actor.id || ''); setSupervisor(sup);
      setResidents(r); setBuildings(b);
    } catch (e: any) {
      setError(e?.message || 'Could not load. Check your connection.');
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onSignOut() {
    await logout();
    await clearAppMode();
    refresh();
  }

  const coordinators = Array.from(new Map(
    [...residents, ...buildings].map((r) => [str(r.state.loggedById), str(r.state.loggedByName)] as const).filter(([id, n]) => id && n),
  ).entries()).sort((a, b) => a[1].localeCompare(b[1]));

  const matches = (r: CommunityRecord) => {
    if (who && str(r.state.loggedById) !== who) return false;
    if (criticalOnly && tab === 'residents' && r.state.critical !== true) return false;
    const rs = str(r.state.reviewStatus) || 'submitted';
    if (review === 'pending' && rs === 'approved') return false;
    if (review === 'approved' && rs !== 'approved') return false;
    if (review === 'today' && str(r.state.visitedOn) !== today()) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return Object.values(r.state).some((v) => typeof v === 'string' && v.toLowerCase().includes(needle)) ||
      str(r.development).toLowerCase().includes(needle);
  };
  const rows = (tab === 'residents' ? residents : buildings).filter(matches);
  // The coordinator who logged it edits it; the supervisor reads and approves.
  const canEdit = (r: CommunityRecord) => !supervisor && str(r.state.loggedById) === meId;
  const pendingCount = [...residents, ...buildings].filter((r) => (str(r.state.reviewStatus) || 'submitted') !== 'approved').length;
  async function approve(r: CommunityRecord) {
    const entity = tab === 'residents' ? 'community-residents' : 'community-buildings';
    try { await approveCommunity(entity, r); await load(); }
    catch (e: any) { Alert.alert('Could not approve', e?.message || 'Try again.'); }
  }
  const residentsAt = (address: string) => residents.filter((r) => str(r.state.address).toLowerCase() === address.toLowerCase()).length;

  function confirmDelete(r: CommunityRecord) {
    const entity = tab === 'residents' ? 'community-residents' : 'community-buildings';
    const label = tab === 'residents' ? `${str(r.state.name)} · ${str(r.state.address)}` : str(r.state.address);
    Alert.alert('Delete this record?', `${label} will be removed for your whole unit.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { removeCommunity(entity, r).then(load).catch((e) => Alert.alert('Could not delete', e?.message || 'Try again.')); } },
    ]);
  }

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? '#111' : '#eee' }}>
      <Text style={{ color: active ? '#fff' : '#333', fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      contentContainerStyle={[ui.wrap, { paddingTop: 24 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 24, fontWeight: '600', textAlign: 'center' }}>{supervisor ? 'Community Coordinator Supervisor' : 'Community Coordinator'}</Text>
      <Text style={[ui.label, { textAlign: 'center', marginBottom: 8 }]}>
        {name ? `${name} · ` : ''}{supervisor ? 'Everything your coordinators log.' : 'Only you and your supervisor see what you log.'}
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={[ui.card, { flex: 1, padding: 12 }]}><Text style={ui.label}>Residents</Text><Text style={{ fontSize: 22, fontWeight: '700' }}>{residents.length}</Text></View>
        <View style={[ui.card, { flex: 1, padding: 12 }]}><Text style={ui.label}>Buildings</Text><Text style={{ fontSize: 22, fontWeight: '700' }}>{buildings.length}</Text></View>
        <View style={[ui.card, { flex: 1, padding: 12, borderColor: residents.some((r) => r.state.critical === true) ? ACCENT : '#e0e0e0' }]}><Text style={ui.label}>Critical</Text><Text style={{ fontSize: 22, fontWeight: '700' }}>{residents.filter((r) => r.state.critical === true).length}</Text></View>
      </View>
      <View style={[ui.card, { padding: 12, borderColor: pendingCount > 0 ? ACCENT : '#e0e0e0' }]}>
        <Text style={ui.label}>{supervisor ? 'Waiting for your review' : 'Waiting for supervisor'}</Text>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>{pendingCount}</Text>
      </View>

      {!supervisor && (
        <>
          <Pressable style={ui.btn} onPress={() => router.push('/community-resident')}>
            <Text style={ui.btnText}>+ Log a resident</Text>
          </Pressable>
          <Pressable style={ui.btnOutline} onPress={() => router.push('/community-building')}>
            <Text style={ui.btnOutlineText}>+ Add building / owner</Text>
          </Pressable>
        </>
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {chip(`Residents (${residents.length})`, tab === 'residents', () => setTab('residents'))}
        {chip(`Buildings (${buildings.length})`, tab === 'buildings', () => setTab('buildings'))}
        {tab === 'residents' && chip('Critical', criticalOnly, () => setCriticalOnly((v) => !v))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {chip('All', review === 'all', () => setReview('all'))}
        {chip('Done today', review === 'today', () => setReview('today'))}
        {chip(supervisor ? 'Needs my review' : 'Waiting', review === 'pending', () => setReview('pending'))}
        {chip('Approved', review === 'approved', () => setReview('approved'))}
      </View>
      <TextInput style={ui.input} value={search} onChangeText={setSearch} placeholder="Search name, address, phone, notes…" autoCapitalize="none" />
      {supervisor && coordinators.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {chip('All coordinators', who === '', () => setWho(''))}
          {coordinators.map(([id, n]) => chip(n, who === id, () => setWho(id)))}
        </View>
      )}

      {!!error && <Text style={{ color: '#b91c1c', textAlign: 'center' }}>{error}</Text>}
      {rows.length === 0 && !loading && (
        <Text style={ui.empty}>{tab === 'residents' ? 'No residents logged yet.' : 'No buildings on file yet.'}</Text>
      )}
      {rows.map((r) => {
        const st = r.state;
        const editHref = tab === 'residents' ? `/community-resident?id=${r.id}` : `/community-building?id=${r.id}`;
        return (
          <Pressable key={r.id} style={[ui.card, st.critical === true ? { borderColor: ACCENT, borderWidth: 2 } : null]} onPress={() => { if (canEdit(r)) router.push(editHref as never); }}>
            {tab === 'residents' ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={ui.listTitle}>{str(st.name) || 'Unnamed resident'}</Text>
                  {st.critical === true && <Text style={{ backgroundColor: '#fef3c7', color: '#92400e', fontWeight: '700', fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>CRITICAL</Text>}
                </View>
                <Text style={ui.listSub}>{[str(st.address), st.apartment ? `Apt ${str(st.apartment)}` : '', str(r.development), str(st.borough)].filter(Boolean).join(' · ')}</Text>
                {!!str(st.phone) && <Text style={ui.listSub}>{str(st.phone)}{str(st.email) ? ` · ${str(st.email)}` : ''}</Text>}
                {!!str(st.program) && <Text style={ui.listSub}>{str(st.program)}</Text>}
                {(sectionsOnRecord(st).length > 0 || (Array.isArray(st.criticalTags) && st.criticalTags.length > 0)) && (
                  <Text style={[ui.listSub, { color: '#92400e', fontWeight: '600' }]}>{[...sectionsOnRecord(st), ...(Array.isArray(st.criticalTags) ? st.criticalTags : [])].join(' · ')}</Text>
                )}
                {!!str(st.notes) && <Text style={{ marginTop: 6 }}>{str(st.notes)}</Text>}
              </>
            ) : (
              <>
                <Text style={ui.listTitle}>{str(st.address) || 'Address missing'}</Text>
                <Text style={ui.listSub}>{[str(r.development), str(st.borough), st.units ? `${st.units} apartment units` : '', st.floors ? `${st.floors} floors` : ''].filter(Boolean).join(' · ')}</Text>
                <Text style={ui.listSub}>Owner: {str(st.ownerName) || '—'}{str(st.ownerPhone) ? ` · ${str(st.ownerPhone)}` : ''}</Text>
                {!!str(st.managementCompany) && <Text style={ui.listSub}>Managed by {str(st.managementCompany)}{str(st.managementPhone) ? ` · ${str(st.managementPhone)}` : ''}</Text>}
                {!!str(st.superName) && <Text style={ui.listSub}>Super: {str(st.superName)}{str(st.superPhone) ? ` · ${str(st.superPhone)}` : ''}{str(st.superApartment) ? ` · Apt ${str(st.superApartment)}` : ''}</Text>}
                <Text style={ui.listSub}>{residentsAt(str(st.address))} resident(s) on file here</Text>
                {!!str(st.notes) && <Text style={{ marginTop: 6 }}>{str(st.notes)}</Text>}
              </>
            )}
            {(str(st.reviewStatus) || 'submitted') === 'approved' ? (
              <Text style={{ fontSize: 12, color: '#047857', fontWeight: '600', marginTop: 6 }}>Approved — received by {str(st.reviewedByName) || 'supervisor'}{st.reviewedAt ? ` · ${new Date(String(st.reviewedAt)).toLocaleString()}` : ''}</Text>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <Text style={{ backgroundColor: '#fef3c7', color: '#92400e', fontWeight: '700', fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>{str(st.reviewStatus) === 'updated' ? 'UPDATED — REVIEW AGAIN' : 'WAITING FOR SUPERVISOR'}</Text>
                {supervisor && <Pressable onPress={() => void approve(r)} style={{ backgroundColor: ACCENT, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}><Text style={{ fontWeight: '700' }}>Approve — received</Text></Pressable>}
              </View>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ fontSize: 12, color: '#888' }}>
                Visited {str(st.visitedOn)}{supervisor && str(st.loggedByName) ? ` · ${str(st.loggedByName)}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                {tab === 'residents' && <Pressable onPress={() => shareResidentPdf(r).catch((e) => Alert.alert('Could not make the PDF', e?.message || 'Try again.'))}><Text style={{ color: '#111', fontWeight: '600' }}>PDF</Text></Pressable>}
                {tab === 'residents' && <Pressable onPress={() => shareResidentText(r).catch(() => undefined)}><Text style={{ color: '#111', fontWeight: '600' }}>Share</Text></Pressable>}
                {canEdit(r) && <Text style={{ color: '#2563eb', fontWeight: '600' }}>Edit</Text>}
                {supervisor && <Pressable onPress={() => confirmDelete(r)}><Text style={{ color: '#b91c1c', fontWeight: '600' }}>Delete</Text></Pressable>}
              </View>
            </View>
          </Pressable>
        );
      })}

      <Pressable style={[ui.btnOutline, { marginTop: 16 }]} onPress={() => router.push('/notifications')}>
        <Text style={ui.btnOutlineText}>Inbox</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={() => router.push('/settings')}>
        <Text style={ui.btnOutlineText}>Settings</Text>
      </Pressable>
      <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={onSignOut}>
        <Text style={ui.btnOutlineText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
