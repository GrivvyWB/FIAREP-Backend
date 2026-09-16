import { useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { listEmergencyJobsForTruck, listEmergencyUnits, setEmergencyProgress, addEmergencyPhoto, completeEmergencyJob, type EmergencyJob, type EmergencyUnit } from '../lib/store';
import { takePhoto, pickPhoto, photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso?: string): string { try { return iso ? new Date(iso).toLocaleString() : ''; } catch { return iso || ''; } }

export default function EmergencyUnits() {
  const [units, setUnits] = useState<EmergencyUnit[]>([]);
  const [loadedTruck, setLoadedTruck] = useState('');
  const [jobs, setJobs] = useState<EmergencyJob[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const loadFor = useCallback(async (truckName: string) => {
    const list = await listEmergencyJobsForTruck(truckName).catch(() => []);
    setJobs(list); setLoadedTruck(truckName);
  }, []);
  useFocusEffect(useCallback(() => {
    listEmergencyUnits().then(setUnits).catch(() => setUnits([]));
    if (loadedTruck) loadFor(loadedTruck);
  }, [loadedTruck, loadFor]));

  async function refresh() { if (loadedTruck) await loadFor(loadedTruck); }

  const activeJobs = jobs.filter((j) => j.status !== 'done');
  const timerRef = useRef<any>(null);
  useEffect(() => {
    // While the loaded truck has an active emergency, pop an alert every 20s
    // until all its jobs are done. Banner stays up regardless (see below).
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (activeJobs.length > 0) {
      const fire = () => Alert.alert('Active emergency', activeJobs.length + ' emergency job' + (activeJobs.length > 1 ? 's' : '') + ' waiting for ' + loadedTruck + '. Respond now.');
      fire();
      timerRef.current = setInterval(fire, 20000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeJobs.length, loadedTruck]);

  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Emergency Units</Text>
      {activeJobs.length > 0 && (
        <View style={{ backgroundColor: '#c0392b', borderRadius: 10, padding: 12, marginTop: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{activeJobs.length} ACTIVE EMERGENCY{activeJobs.length > 1 ? ' JOBS' : ' JOB'}</Text>
          <Text style={{ color: '#fff', fontSize: 12, marginTop: 2 }}>Respond immediately. This stays until every job is marked complete.</Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {units.map((unit, index) => (
          <Pressable
            key={unit.id}
            style={[ui.btn, { minWidth: 104 }, loadedTruck === unit.name && { backgroundColor: '#c0392b' }]}
            onPress={() => loadFor(unit.name)}
          >
            <Text style={ui.btnText}>TRK-{index + 1}</Text>
          </Pressable>
        ))}
      </View>

      {!!loadedTruck && jobs.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No jobs for {loadedTruck}.</Text>}

      {jobs.map((j) => (
        <View key={j.id} style={[ui.card, { gap: 6, marginTop: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#c0392b' }}>{j.emId}</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: j.status === 'done' ? '#1a8f4c' : '#c0392b' }}>{j.status === 'done' ? 'Done' : 'ACTIVE'}</Text>
          </View>
          <Text style={{ fontSize: 15 }}>{j.development || j.address}</Text>
          {!!j.issue && <Text style={ui.listSub}>Emergency: {j.issue}</Text>}
          {!!j.location && <Text style={ui.listSub}>Location: {j.location}</Text>}
          <Text style={ui.listSub}>Assigned by {j.assignedBy}  {fmt(j.assignedAt)}</Text>

          <Pressable onPress={() => setOpenId(openId === j.id ? null : j.id)}>
            <Text style={{ color: ACCENT, fontWeight: '700', marginTop: 2 }}>{openId === j.id ? 'Hide' : 'Open / update'}</Text>
          </Pressable>

          {openId === j.id && (
            <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, gap: 8 }}>
              <View style={{ gap: 3 }}>
                {[['Assigned', j.assignedAt], ['On my way', j.onMyWayAt], ['Started', j.startedAt], ['Completed', j.completedAt]].map(([label, ts]) => (
                  <View key={label as string} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, color: ts ? '#1a8f4c' : '#bbb' }}>{ts ? '\u2713 ' : '\u25cb '}{label as string}</Text>
                    <Text style={{ fontSize: 12, color: '#999' }}>{ts ? fmt(ts as string) : 'pending'}</Text>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable disabled={!!j.onMyWayAt} style={[ui.btnOutline, { flex: 1 }, j.onMyWayAt && { opacity: 0.45 }]} onPress={async () => { await setEmergencyProgress(j.id, 'onMyWay'); refresh(); }}><Text style={ui.btnOutlineText}>{j.onMyWayAt ? 'On my way \u2713' : 'On my way'}</Text></Pressable>
                <Pressable disabled={!!j.startedAt} style={[ui.btnOutline, { flex: 1 }, j.startedAt && { opacity: 0.45 }]} onPress={async () => { await setEmergencyProgress(j.id, 'started'); refresh(); }}><Text style={ui.btnOutlineText}>{j.startedAt ? 'Started \u2713' : 'Started'}</Text></Pressable>
              </View>

              <Text style={ui.label}>Photos</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(j.photos || []).map((uri, i) => (
                  <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
                    <RemotePhoto localUri={uri} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#eee' }} />
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await takePhoto(); if (u) { await addEmergencyPhoto(j.id, u); refresh(); } } catch (e: any) { Alert.alert('Camera', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Take photo</Text></Pressable>
                <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await pickPhoto(); if (u) { await addEmergencyPhoto(j.id, u); refresh(); } } catch (e: any) { Alert.alert('Photos', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Add photo</Text></Pressable>
              </View>

              {j.status !== 'done' && (
                <>
                  <TextInput style={[ui.input, { minHeight: 50, textAlignVertical: 'top' }]} value={note} onChangeText={setNote} placeholder="Completion note (optional)" multiline />
                  <Pressable style={ui.btn} onPress={async () => { await completeEmergencyJob(j.id, note.trim()); setNote(''); setOpenId(null); refresh(); Alert.alert('Completed', 'Supervisor notified.'); }}>
                    <Text style={ui.btnText}>Mark complete</Text>
                  </Pressable>
                </>
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
