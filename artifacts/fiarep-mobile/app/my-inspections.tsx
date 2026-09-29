// The inspector's own record: every inspection they logged, read-only, with
// the full reading (code, class, notes, photos) and where it went afterwards.
// Nothing here can be changed or removed — it is their proof of the work.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { listMyLoggedInspections, type BuildingViolation } from '../lib/store';
import { syncAllEntities } from '../lib/sync';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';

const CLASS_COLOR: Record<string, string> = { A: '#1E7D4F', B: '#B4741A', C: '#c0392b' };
const STATUS: Record<string, string> = {
  logged: 'Logged — awaiting supervisor review', submitted: 'Logged — awaiting supervisor review',
  approved: 'Approved by supervisor', denied: 'Denied by supervisor', routed: 'Routed to staff',
  cpm_review: 'With CPM Supervisor', cpm_scope_assigned: 'CPM writing the scope', done: 'Work completed',
  work_approved: 'Work approved',
};
function fmt(iso?: string): string { try { return iso ? new Date(iso).toLocaleString() : ''; } catch { return iso || ''; } }

export default function MyInspections() {
  const [items, setItems] = useState<BuildingViolation[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    const show = () => listMyLoggedInspections().then((v) => { if (active) setItems(v); }).catch(() => { if (active) setItems([]); });
    show();
    // Your record lives on the server too: pull it in case this phone's copy
    // was removed or never synced.
    syncAllEntities({ refreshEntities: ['building-violations'] }).catch(() => undefined).then(show);
    return () => { active = false; };
  }, []));
  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>My Inspections</Text>
      <Text style={ui.label}>Your record of every inspection you logged. Read-only — it stays here as proof of your work.</Text>
      {items.length === 0 && <Text style={ui.empty}>No inspections logged yet.</Text>}
      {items.map((v) => {
        const st = String(v.status || 'logged');
        return (
          <View key={v.id} style={[ui.card, { gap: 4, marginTop: 10 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: ACCENT }}>{v.violationNo || '(no number)'} · Code {v.code}</Text>
              <View style={{ backgroundColor: CLASS_COLOR[v.hazardClass] || '#666', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Class {v.hazardClass}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 15 }}>{v.building}{v.development ? ' · ' + v.development : ''}</Text>
            <Text style={{ fontSize: 13, color: '#333' }}>{v.codeDesc}</Text>
            {!!v.notes && <Text style={{ fontSize: 13 }}>Notes: {v.notes}</Text>}
            {Array.isArray(v.photos) && v.photos.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 }}>
                {v.photos.map((uri, i) => (
                  <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
                    <RemotePhoto localUri={uri} style={{ width: 80, height: 80, borderRadius: 8, backgroundColor: '#eee' }} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={ui.listSub}>Logged by {v.loggedBy || 'you'}  {fmt(v.loggedAt)}</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: st === 'denied' ? '#c0392b' : st === 'done' || st === 'work_approved' ? '#1a8f4c' : '#B4741A', marginTop: 4 }}>{STATUS[st] || st}</Text>
            {!!v.approvedBy && <Text style={ui.listSub}>Approved by {v.approvedBy}  {fmt(v.approvedAt)}</Text>}
            {st === 'denied' && !!(v as any).denyReason && <Text style={{ fontSize: 13, color: '#c0392b' }}>Reason: {(v as any).denyReason}</Text>}
            {!!(v as any).cpmSupervisorName && <Text style={ui.listSub}>Sent to CPM Supervisor {(v as any).cpmSupervisorName}  {fmt((v as any).handoffAt)}</Text>}
            {!!v.routedTo && <Text style={ui.listSub}>Routed to {v.routedTo}{v.routedToPosition ? ' (' + v.routedToPosition + ')' : ''}  {fmt(v.routedAt)}</Text>}
            {!!v.completedBy && <Text style={ui.listSub}>Completed by {v.completedBy}  {fmt(v.completedAt)}{v.completionNote ? ' · ' + v.completionNote : ''}</Text>}
          </View>
        );
      })}
      <View style={{ height: 40 }} />
      <PhotoViewer uri={viewer} onClose={() => setViewer(null)} />
    </ScrollView>
  );
}
