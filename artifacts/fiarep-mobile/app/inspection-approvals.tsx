import { isCpmSupervisorTitle, isInspectionSupervisorTitle } from '../lib/titles';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Modal, Image, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { listLoggedInspections, listActiveInspections, clearInspectionForStaff, approveAndRouteViolation, handoffViolationToCpmSupervisor, listStaffAccounts, displayStaffPosition, getCurrentActor, getCurrentPosition, type BuildingViolation, type StaffAccount } from '../lib/store';
import { photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
const classColor = (c: string) => c === 'C' ? '#c0392b' : c === 'B' ? '#B4741A' : '#1a8f4c';

export default function InspectionApprovals() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [items, setItems] = useState<BuildingViolation[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [routeFor, setRouteFor] = useState<BuildingViolation | null>(null);
  const [openPos, setOpenPos] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<BuildingViolation[]>([]);
  const [handoffFor, setHandoffFor] = useState<BuildingViolation | null>(null);
  const [cpmSupervisors, setCpmSupervisors] = useState<StaffAccount[]>([]);
  useEffect(() => {
    Promise.all([getCurrentActor(), getCurrentPosition()]).then(([actor, position]) => {
      if (actor.role === 'management' && isInspectionSupervisorTitle(position)) setAuthorized(true);
      else router.replace('/management-home');
    }).catch(() => router.replace('/management-home'));
  }, [router]);

  const load = useCallback(() => {
    listLoggedInspections().then(setItems);
    listActiveInspections().then(setActive);
    listStaffAccounts('approved').then(setStaff);
  }, []);
  useFocusEffect(useCallback(() => {
    if (authorized) load();
  }, [authorized, load]));

  async function route(v: BuildingViolation, s: StaffAccount) {
    try {
      await approveAndRouteViolation(v.id, s.id, s.name, s.position || '');
      setRouteFor(null);
      load();
      Alert.alert('Approved & routed', 'Sent to ' + s.name + (s.position ? ' (' + s.position + ')' : '') + '.');
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    }
  }

  async function handoff(v: BuildingViolation, supervisor: StaffAccount) {
    try {
      await handoffViolationToCpmSupervisor(v.id, supervisor.id);
      setHandoffFor(null);
      load();
      Alert.alert('Sent to CPM Supervisor', 'The approved violation is now in the CPM Supervisor scope-review queue.');
    } catch (e: any) {
      Alert.alert('Handoff failed', String(e?.message || e || 'Could not send this violation.'));
    }
  }

  function clearForStaff(v: BuildingViolation) {
    Alert.alert('Clear for staff?', 'This lets ' + (v.routedTo || 'the assigned worker') + ' remove it from their My Jobs view. The record stays in reporting.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', onPress: async () => { await clearInspectionForStaff(v.id); load(); } },
    ]);
  }

  // The Supervisor Inspector may route only to field inspectors.
  const byPos: Record<string, StaffAccount[]> = {};
  for (const s of staff) {
    if (String(s.position || '').toLowerCase().includes('supervisor') || s.role === 'management') continue;
    if ((s.position || '').trim().toLowerCase() !== 'inspector') continue;
    const p = s.position || 'Other';
    (byPos[p] = byPos[p] || []).push(s);
  }
  const positions = Object.keys(byPos).sort();

  if (!authorized) return null;
  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Inspection Approvals</Text>
      <Text style={ui.label}>Inspections logged by inspectors, awaiting your approval. Approve and route to a CPM (to scope) or a trade (to do the work).</Text>

      {items.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>Nothing awaiting approval.</Text>}

      {items.map((v) => (
        <View key={v.id} style={[ui.card, { gap: 6, marginTop: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{v.violationNo || '(no number)'}</Text>
            <Text style={{ fontSize: 13, fontWeight: '800', color: classColor(v.hazardClass) }}>Class {v.hazardClass}</Text>
          </View>
          <Text style={{ fontSize: 15 }}>{v.building}</Text>
          {!!v.code && <Text style={ui.listSub}>Code {v.code}{v.codeDesc ? ' \u00b7 ' + v.codeDesc : ''}</Text>}
          {!!v.notes && <Text style={{ fontSize: 14 }}>{v.notes}</Text>}
          {Array.isArray(v.photos) && v.photos.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 }}>
              {v.photos.map((uri, i) => (
                <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
                  <RemotePhoto localUri={uri} style={{ width: 80, height: 80, borderRadius: 8, backgroundColor: '#eee' }} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={ui.listSub}>Logged by {v.loggedBy || 'inspector'}  {fmt(v.loggedAt)}</Text>
          {v.hazardClass === 'C' && <Text style={{ color: '#c0392b', fontWeight: '700', fontSize: 12 }}>Class C — priority</Text>}
          <Pressable style={[ui.btn, { marginTop: 4 }]} onPress={() => setRouteFor(v)}>
            <Text style={ui.btnText}>Approve & route</Text>
          </Pressable>
        </View>
      ))}

      {active.length > 0 && (
        <>
          <Text style={[ui.label, { marginTop: 24, fontWeight: '700' }]}>Routed & completed ({active.length})</Text>
          {active.map((v) => (
            <View key={v.id} style={[ui.card, { gap: 4, marginTop: 8 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color: ACCENT }}>{v.violationNo || '(no number)'}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: v.status === 'done' ? '#1a8f4c' : '#B4741A' }}>{v.status === 'done' ? 'Completed' : 'Routed'}</Text>
              </View>
              <Text style={{ fontSize: 14 }}>{v.building}</Text>
              <Text style={ui.listSub}>Assigned to {v.routedTo || '\u2014'}{v.routedToPosition ? ' (' + v.routedToPosition + ')' : ''}</Text>
              {!!v.completionNote && <Text style={ui.listSub}>Note: {v.completionNote}</Text>}
              {v.status === 'approved' && (
                <Pressable style={[ui.btnOutline, { marginTop: 6 }]} onPress={() => {
                  const eligible = staff.filter((s) => isCpmSupervisorTitle(s.position)
                    && (!v.development || (s.developments || []).some((d) => d.trim().toLowerCase() === v.development!.trim().toLowerCase())));
                  setCpmSupervisors(eligible);
                  setHandoffFor(v);
                }}>
                  <Text style={ui.btnOutlineText}>Send to CPM Supervisor</Text>
                </Pressable>
              )}
              {v.status === 'cpm_review' && <Text style={{ color: '#1a8f4c', fontWeight: '700', marginTop: 6 }}>Sent to CPM Supervisor</Text>}
              {!v.clearedByMgmt && (
                <Pressable onPress={() => clearForStaff(v)} style={{ marginTop: 4 }}>
                  <Text style={{ color: ACCENT, fontWeight: '600' }}>Clear for staff</Text>
                </Pressable>
              )}
            </View>
          ))}
        </>
      )}
      <View style={{ height: 40 }} />

      {/* Route-to staff picker */}
      <Modal visible={!!routeFor} transparent animationType="slide" onRequestClose={() => setRouteFor(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Route to Inspector</Text>
            <ScrollView>
              {positions.length === 0 && <Text style={[ui.listSub, { padding: 16 }]}>No approved staff to route to.</Text>}
              {positions.map((pos) => (
                <View key={pos}>
                  <Pressable onPress={() => setOpenPos((m) => ({ ...m, [pos]: !m[pos] }))} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#f2f7fb' }}>
                    <Text style={{ fontWeight: '700', color: ACCENT }}>{openPos[pos] ? '\u2013 ' : '+ '}{displayStaffPosition(pos)}</Text>
                    <Text style={{ color: '#667085', fontSize: 13 }}>{byPos[pos].length}</Text>
                  </Pressable>
                  {openPos[pos] && byPos[pos].map((s) => (
                    <Pressable key={s.id} onPress={() => routeFor && route(routeFor, s)} style={{ paddingVertical: 12, paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: '#eee' }}>
                      <Text style={{ fontSize: 15 }}>{s.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setRouteFor(null)} style={{ padding: 16 }}>
              <Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={!!handoffFor} transparent animationType="slide" onRequestClose={() => setHandoffFor(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Select CPM Supervisor</Text>
            {handoffFor && <Text style={[ui.listSub, { paddingHorizontal: 16, paddingBottom: 8 }]}>Approved exact match for {handoffFor.development || 'this violation’s development'}.</Text>}
            <ScrollView>
              {cpmSupervisors.map((s) => (
                <Pressable key={s.id} onPress={() => handoffFor && handoff(handoffFor, s)} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700' }}>{s.name}</Text>
                  <Text style={ui.listSub}>{s.position}{s.developments?.length ? ' · ' + s.developments.join(', ') : ''}</Text>
                </Pressable>
              ))}
              {cpmSupervisors.length === 0 && <Text style={[ui.empty, { padding: 16 }]}>No approved CPM Supervisor is available for this violation’s development.</Text>}
            </ScrollView>
            <Pressable onPress={() => setHandoffFor(null)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
      <PhotoViewer uri={viewer} onClose={() => setViewer(null)} />
    </ScrollView>
  );
}
