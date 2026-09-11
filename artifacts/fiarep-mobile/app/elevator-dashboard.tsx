import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { listElevatorJobs, getElevator, type ElevatorJob } from '../lib/store';
import { ELEVATOR_SECTIONS } from '../lib/elevator';
import { photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string { try { return new Date(iso).toLocaleString(); } catch { return iso; } }
const statusColor = (st: string) => st === 'done' ? '#1a8f4c' : '#B4741A';
const condColor = (c?: string) => c === 'Good' ? '#1a8f4c' : c === 'Repair' ? '#B4741A' : c === 'Replace' ? '#c0392b' : '#666';

// Map an item id to its label from the elevator sections catalog.
const ITEM_LABELS: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const sec of (ELEVATOR_SECTIONS as any[])) {
    for (const it of (sec.items || [])) { m[it.id] = it.label || it.id; }
  }
  return m;
})();

export default function ElevatorDashboard() {
  const [jobs, setJobs] = useState<ElevatorJob[]>([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  const load = useCallback(() => { listElevatorJobs().then(setJobs); }, []);
  useFocusEffect(load);

  async function toggle(j: ElevatorJob) {
    if (openId === j.id) { setOpenId(null); setDetail(null); return; }
    setOpenId(j.id);
    const d = await getElevator(j.id).catch(() => null);
    setDetail(d);
  }

  const q = query.trim().toLowerCase();
  const filtered = jobs.filter(j => !q
    || (j.address || '').toLowerCase().includes(q)
    || (j.elId || '').toLowerCase().includes(q)
    || (j.mechanic || '').toLowerCase().includes(q));

  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Elevator Dashboard</Text>
      <Text style={ui.label}>All elevator jobs and mechanics. Tap a job for the mechanic's report.</Text>

      <TextInput style={[ui.input, { marginTop: 8 }]} value={query} onChangeText={setQuery} placeholder="Search by address, EL-ID, or mechanic" autoCapitalize="none" />

      {filtered.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No elevator jobs.</Text>}

      {filtered.map((j) => (
        <View key={j.id} style={[ui.card, { gap: 4, marginTop: 10 }]}>
          <Pressable onPress={() => toggle(j)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{j.elId}</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: statusColor(j.status) }}>{j.status === 'done' ? 'Done' : 'Assigned'}</Text>
            </View>
            <Text style={{ fontSize: 15 }}>{j.address}{j.unit ? '  ' + j.unit : ''}</Text>
            <Text style={ui.listSub}>Mechanic: {j.mechanic || '—'}</Text>
            {!!j.issue && <Text style={ui.listSub}>Issue: {j.issue}</Text>}
            <Text style={ui.listSub}>{j.refNum ? j.refNum + '  · ' : ''}Assigned by {j.assignedBy}  {fmt(j.assignedAt)}</Text>
          </Pressable>

          {openId === j.id && (
            <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, gap: 6 }}>
              <View style={{ gap: 3, marginBottom: 4 }}>
                <Text style={{ fontWeight: '700', fontSize: 13 }}>Progress</Text>
                {[
                  ['Assigned', j.assignedAt],
                  ['On my way', j.onMyWayAt],
                  ['Started', j.startedAt],
                  ['Completed', j.completedAt],
                ].map(([label, ts]) => (
                  <View key={label as string} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, color: ts ? '#1a8f4c' : '#bbb' }}>{ts ? '\u2713 ' : '\u25cb '}{label as string}</Text>
                    <Text style={{ fontSize: 12, color: '#999' }}>{ts ? fmt(ts as string) : 'pending'}</Text>
                  </View>
                ))}
              </View>
              {(() => {
                const items = (detail && detail.items) || {};
                const filled = Object.keys(items).filter(k => items[k] && (items[k].condition || items[k].note));
                if (filled.length === 0) return <Text style={ui.listSub}>The mechanic hasn't filed a report yet.</Text>;
                return filled.map((k, i) => {
                  const rec = items[k];
                  return (
                    <View key={k} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: '#f2f2f2', paddingTop: i ? 6 : 0 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', flex: 1 }}>{ITEM_LABELS[k] || k}</Text>
                        {!!rec.condition && <Text style={{ fontSize: 13, fontWeight: '700', color: condColor(rec.condition) }}>{rec.condition}</Text>}
                      </View>
                      {!!rec.note && <Text style={{ fontSize: 13 }}>{rec.note}</Text>}
                    </View>
                  );
                });
              })()}
              {!!(detail && detail.header && detail.header.elevatorId) && <Text style={ui.listSub}>Elevator ID: {detail.header.elevatorId}</Text>}
              {detail && Array.isArray(detail.photos) && detail.photos.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  {detail.photos.map((uri: string, i: number) => (
                    <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
                      <RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      ))}
      <View style={{ height: 40 }} />
      <PhotoViewer uri={viewer} onClose={() => setViewer(null)} />
    </ScrollView>
  );
}
