import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { listEmergencyJobs, getCurrentActor, developmentsForStaff, type EmergencyJob } from '../lib/store';
import { photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';
import { Alert } from 'react-native';
import { useHeatAlert, ackHeatAlert } from '../lib/heat-alert';

function fmt(iso?: string): string { try { return iso ? new Date(iso).toLocaleString() : ''; } catch { return iso || ''; } }

export default function EmergencyActivity() {
  const { mode } = useAppMode();
  const [jobs, setJobs] = useState<EmergencyJob[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [heat, reloadHeat] = useHeatAlert();
  const [acking, setAcking] = useState(false);

  const load = useCallback(() => {
    (async () => {
      const all = await listEmergencyJobs().catch(() => []);
      const a = await getCurrentActor();
      // Admin sees everything; management/supervisors see their development(s).
      const myDevs = (await developmentsForStaff(a.name || '').catch(() => [])).map((d) => (d || '').trim().toLowerCase()).filter(Boolean);
      const seeAll = mode === 'administrator' || myDevs.length === 0;
      setJobs(seeAll ? all : all.filter((j) => myDevs.includes((j.development || '').trim().toLowerCase())));
    })();
  }, [mode]);
  useFocusEffect(load);

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Emergency Activity</Text>

      <Text style={{ fontSize: 17, fontWeight: '800', marginTop: 8 }}>Heat, hot water & high hazards</Text>
      {!heat ? <Text style={ui.listSub}>Nothing open.</Text> : (
        <View style={[ui.card, { borderWidth: 2, borderColor: '#FF2D2D', backgroundColor: '#FFF1F1', gap: 6, marginTop: 6 }]}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#B91C1C' }}>{heat.sentence}</Text>
          {heat.items.map((h) => (
            <View key={h.key} style={{ borderTopWidth: 1, borderTopColor: '#F5C2C2', paddingTop: 6 }}>
              <Text style={{ fontWeight: '700' }}>{h.kind === 'hot water' ? 'Hot water' : h.kind === 'hazard' ? 'HAZARD' : 'Heat'} · {h.building}{h.apt ? ` · Apt ${h.apt}` : ''}</Text>
              <Text style={ui.listSub}>{h.source} · {fmt(h.at)}</Text>
              {!!h.what && <Text style={{ fontSize: 13 }}>{h.what}</Text>}
            </View>
          ))}
          <Pressable style={[ui.btn, { backgroundColor: '#B91C1C', marginTop: 6 }, acking && ui.btnMuted]} disabled={acking} onPress={() => void (async () => {
            setAcking(true);
            try { await ackHeatAlert(heat.id); await reloadHeat(); } catch (e: any) { Alert.alert('Not done', e?.data?.error || e?.message || 'Try again.'); }
            finally { setAcking(false); }
          })()}>
            <Text style={ui.btnText}>{acking ? 'Saving…' : 'Got it'}</Text>
          </Pressable>
        </View>
      )}

      <Text style={{ fontSize: 17, fontWeight: '800', marginTop: 18 }}>Development emergencies</Text>

      {jobs.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No emergency activity.</Text>}

      {jobs.map((j) => (
        <View key={j.id} style={[ui.card, { gap: 4, marginTop: 10 }]}>
          <Pressable onPress={() => setOpenId(openId === j.id ? null : j.id)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#c0392b' }}>{j.truck || 'Truck'}  <Text style={{ color: ACCENT, fontSize: 13 }}>{j.emId}</Text></Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: j.status === 'done' ? '#1a8f4c' : '#c0392b' }}>{j.status === 'done' ? 'Completed' : 'Active'}</Text>
            </View>
            {!!j.development && <Text style={{ fontSize: 14, fontWeight: '600' }}>{j.development}</Text>}
            {!!j.address && <Text style={{ fontSize: 14 }}>{j.address}</Text>}
            {!!j.issue && <Text style={ui.listSub}>Emergency: {j.issue}</Text>}
            {!!j.location && <Text style={ui.listSub}>Location: {j.location}</Text>}
            <Text style={ui.listSub}>Assigned by {j.assignedBy}  {fmt(j.assignedAt)}</Text>
          </Pressable>

          {openId === j.id && (
            <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, gap: 4 }}>
              <View style={{ gap: 3 }}>
                {[['Assigned', j.assignedAt], ['On my way', j.onMyWayAt], ['Started', j.startedAt], ['Completed', j.completedAt]].map(([label, ts]) => (
                  <View key={label as string} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, color: ts ? '#1a8f4c' : '#bbb' }}>{label as string}</Text>
                    <Text style={{ fontSize: 12, color: '#999' }}>{ts ? fmt(ts as string) : 'pending'}</Text>
                  </View>
                ))}
              </View>
              {!!j.note && <Text style={{ fontSize: 13, marginTop: 4 }}>Note: {j.note}</Text>}
              {Array.isArray(j.photos) && j.photos.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  {j.photos.map((uri, i) => (
                    <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
                      <RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Responding unit: {j.truck || '—'}</Text>
            </View>
          )}
        </View>
      ))}
      <View style={{ height: 40 }} />
      <PhotoViewer uri={viewer} onClose={() => setViewer(null)} />
    </ScrollView>
  );
}
