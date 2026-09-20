import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getCurrentActor,
  listRouteAssignments,
  setRouteStopStatus,
  finishRouteDay,
  type RouteAssignment,
  type RouteStop,
  type RouteStopStatus,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

const STATUS_COLOR: Record<RouteStopStatus, string> = { pending: '#4A5560', reached: '#1E7D4F', not_reached: '#C0392B' };
const STATUS_LABEL: Record<RouteStopStatus, string> = { pending: 'Pending', reached: 'Reached', not_reached: 'Not reached' };

export default function InspectorRoutes() {
  const router = useRouter();
  const [me, setMe] = useState('');
  const [routes, setRoutes] = useState<RouteAssignment[]>([]);

  const load = useCallback(() => {
    getCurrentActor().then(async (a) => {
      const nm = (a && a.name) || '';
      setMe(nm);
      if (nm) setRoutes(await listRouteAssignments(nm, a.id));
    });
  }, []);
  useFocusEffect(load);

  async function mark(assignmentId: string, stop: RouteStop, status: RouteStopStatus) {
    await setRouteStopStatus(assignmentId, stop.id, status);
    load();
  }

  function doneForDay(r: RouteAssignment) {
    const pending = r.stops.filter(s => s.status === 'pending').length;
    Alert.alert('Done for the day?', pending > 0
      ? pending + ' stop' + (pending === 1 ? '' : 's') + ' still pending will be marked "Not reached" and moved to the top.'
      : 'Wrap up this route for today.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Done', onPress: async () => { await finishRouteDay(r.id); load(); } },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>My Routes</Text>
      <Text style={ui.label}>Mark each stop as you go. Tap "Done for the day" to wrap up — anything not reached moves to the top.</Text>

      {routes.length === 0 && <Text style={ui.empty}>No routes assigned to you.</Text>}

      {routes.map((r) => {
        const reached = r.stops.filter(s => s.status === 'reached').length;
        return (
          <View key={r.id} style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700' }}>{r.fileName || 'Route'}</Text>
              <Text style={ui.listSub}>{reached}/{r.stops.length} reached</Text>
            </View>
            <Text style={ui.listSub}>From {r.assignedBy || 'supervisor'}  {fmt(r.assignedAt)}</Text>

            {r.stops.map((s) => (
              <View key={s.id} style={[ui.card, { gap: 6, marginTop: 8, borderColor: s.status === 'not_reached' ? '#C0392B' : '#e0e0e0', borderWidth: s.status === 'not_reached' ? 2 : 1 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ flex: 1, fontWeight: '600' }}>{s.address}</Text>
                  <View style={{ backgroundColor: STATUS_COLOR[s.status], borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{STATUS_LABEL[s.status]}</Text>
                  </View>
                </View>
                {r.assignmentKind === 'violation-inspection' && (
                  <Pressable style={ui.btn} onPress={() => router.push('/inspector-violations?routeAssignmentId=' + encodeURIComponent(r.id) + '&preBuilding=' + encodeURIComponent(r.location || s.address) + '&preDevelopment=' + encodeURIComponent(r.development || '') + '&preNote=' + encodeURIComponent(r.instructions || ''))}>
                    <Text style={ui.btnText}>Open inspector violation</Text>
                  </Pressable>
                )}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => mark(r.id, s, 'reached')} style={{ flex: 1, borderWidth: 1.5, borderColor: '#1E7D4F', borderRadius: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: s.status === 'reached' ? '#1E7D4F' : '#fff' }}>
                    <Text style={{ fontWeight: '700', color: s.status === 'reached' ? '#fff' : '#1E7D4F' }}>Reached</Text>
                  </Pressable>
                  <Pressable onPress={() => mark(r.id, s, 'not_reached')} style={{ flex: 1, borderWidth: 1.5, borderColor: '#C0392B', borderRadius: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: s.status === 'not_reached' ? '#C0392B' : '#fff' }}>
                    <Text style={{ fontWeight: '700', color: s.status === 'not_reached' ? '#fff' : '#C0392B' }}>Not reached</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            <Pressable style={[ui.btn, { marginTop: 10 }]} onPress={() => doneForDay(r)}>
              <Text style={ui.btnText}>Done for the day</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}
