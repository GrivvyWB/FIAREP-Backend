import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getCurrentActor,
  listElevatorJobsForMechanic,
  setElevatorProgress,
  type ElevatorJob,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso?: string): string {
  try { return iso ? new Date(iso).toLocaleString() : ''; } catch { return iso || ''; }
}

// Mechanic-facing list of the elevator jobs assigned to the signed-in
// Elevator Service worker. Each job opens the (no-pricing) Elevator Services
// inspection form keyed to that job, and carries the On my way / Started
// progress stamps the Elevator Supervisor and management see.
export default function ElevatorJobs() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ElevatorJob[]>([]);

  const load = useCallback(() => {
    void (async () => {
      const actor = await getCurrentActor().catch(() => null);
      if (!actor) { setJobs([]); return; }
      const list = await listElevatorJobsForMechanic(actor.name || '', actor.id).catch(() => []);
      setJobs(list);
    })();
  }, []);
  useFocusEffect(load);

  const active = jobs.filter((j) => j.status !== 'done');

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>My Elevator Jobs</Text>
      <Text style={ui.label}>Jobs assigned to you. Open one to fill the Elevator Services report, add photos, and mark it complete.</Text>

      {active.length > 0 && (
        <View style={{ backgroundColor: '#B4741A', borderRadius: 10, padding: 12, marginTop: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{active.length} ACTIVE ELEVATOR JOB{active.length > 1 ? 'S' : ''}</Text>
          <Text style={{ color: '#fff', fontSize: 12, marginTop: 2 }}>Complete each job's report to close it out.</Text>
        </View>
      )}

      {jobs.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No elevator jobs assigned to you yet.</Text>}

      {jobs.map((j) => (
        <View key={j.id} style={[ui.card, { gap: 6, marginTop: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{j.elId}</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: j.status === 'done' ? '#1a8f4c' : '#B4741A' }}>{j.status === 'done' ? 'Done' : 'ACTIVE'}</Text>
          </View>
          <Text style={{ fontSize: 15 }}>{j.address}{j.unit ? ' · ' + j.unit : ''}</Text>
          {!!j.issue && <Text style={ui.listSub}>Issue: {j.issue}</Text>}
          {!!j.refNum && <Text style={ui.listSub}>Ref: {j.refNum}</Text>}
          <Text style={ui.listSub}>Assigned by {j.assignedBy}  {fmt(j.assignedAt)}</Text>

          <View style={{ gap: 3, marginTop: 4 }}>
            {([['Assigned', j.assignedAt], ['On my way', j.onMyWayAt], ['Started', j.startedAt], ['Completed', j.completedAt]] as Array<[string, string | undefined]>).map(([label, ts]) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, color: ts ? '#1a8f4c' : '#bbb' }}>{ts ? '✓ ' : '○ '}{label}</Text>
                <Text style={{ fontSize: 12, color: '#999' }}>{ts ? fmt(ts) : 'pending'}</Text>
              </View>
            ))}
          </View>

          {j.status !== 'done' && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Pressable disabled={!!j.onMyWayAt} style={[ui.btnOutline, { flex: 1 }, j.onMyWayAt && { opacity: 0.45 }]} onPress={async () => { await setElevatorProgress(j.id, 'onMyWay'); load(); }}><Text style={ui.btnOutlineText}>{j.onMyWayAt ? 'On my way ✓' : 'On my way'}</Text></Pressable>
              <Pressable disabled={!!j.startedAt} style={[ui.btnOutline, { flex: 1 }, j.startedAt && { opacity: 0.45 }]} onPress={async () => { await setElevatorProgress(j.id, 'started'); load(); }}><Text style={ui.btnOutlineText}>{j.startedAt ? 'Started ✓' : 'Started'}</Text></Pressable>
            </View>
          )}

          <Pressable style={[ui.btn, { marginTop: 6 }]} onPress={() => router.push('/project/elevator?projectId=' + encodeURIComponent(j.id))}>
            <Text style={ui.btnText}>{j.status === 'done' ? 'View report' : 'Open Elevator Services report'}</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
