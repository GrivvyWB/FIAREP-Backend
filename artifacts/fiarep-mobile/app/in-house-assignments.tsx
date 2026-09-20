import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getCurrentActor, listManpowerRequests, listStaffAccounts, performEntityAction, type ManpowerRequest, type StaffAccount } from '../lib/store';
import { ui } from '../lib/ui';

const workerPositions: Record<string, string[]> = {
  Inspector: ['Inspector'], CPM: ['CPM'], Plumber: ['Plumber'], Carpenter: ['Carpenter'],
  Electrician: ['Electrician'], 'Elevator Service': ['Elevator Service'],
};

export default function InHouseAssignments() {
  const [requests, setRequests] = useState<ManpowerRequest[]>([]);
  const [people, setPeople] = useState<StaffAccount[]>([]);
  const load = useCallback(async () => {
    const actor = await getCurrentActor();
    const all = await listManpowerRequests().catch(() => []);
    setRequests(all.filter((r) => r.receiverSupervisorId === actor.id && ['pending', 'assigned', 'dispatched'].includes(r.status)));
    setPeople((await listStaffAccounts('approved')).filter((p) => p.role === 'worker' || p.role === 'inspector'));
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function act(request: ManpowerRequest, action: 'assign' | 'dispatch', assignedStaffId?: string) {
    try {
      const body = assignedStaffId ? { assignedStaffId } : {};
      await performEntityAction('manpower-requests', request.id, action, body);
      await load();
      Alert.alert(action === 'assign' ? 'Assigned' : 'Dispatched', 'The server accepted the action.');
    } catch (e: any) {
      Alert.alert('Action failed', e?.message || 'The server did not accept this action.');
    }
  }

  return <ScrollView contentContainerStyle={ui.wrap}>
    <Text style={ui.h}>In-house assignments</Text>
    <Text style={ui.label}>Requests addressed to your receiving trade supervisor account.</Text>
    {requests.length === 0 && <Text style={ui.empty}>No in-house manpower requests.</Text>}
    {requests.map((r) => {
      const eligible = people.filter((p) => (workerPositions[r.requestedTrade] || []).includes(p.position || '') &&
        (!r.development || (p.developments || []).some((d) => d.toLowerCase() === r.development!.toLowerCase())));
      return <View key={r.id} style={[ui.card, { gap: 7, marginTop: 10 }]}>
        <Text style={{ fontWeight: '700' }}>{r.requestedTrade} · {r.sourceTitle || 'In-house work'}</Text>
        <Text style={ui.listSub}>{r.development || 'Development not specified'} · {r.status}</Text>
        {r.assignedTo && <Text>Assigned to {r.assignedTo}</Text>}
        {r.status === 'pending' && eligible.map((p) =>
          <Pressable key={p.id} style={ui.btnOutline} onPress={() => act(r, 'assign', p.id)}>
            <Text style={ui.btnOutlineText}>Assign {p.name}</Text>
          </Pressable>
        )}
        {r.status === 'assigned' && <Pressable style={ui.btn} onPress={() => act(r, 'dispatch')}>
          <Text style={ui.btnText}>Dispatch</Text>
        </Pressable>}
        {r.status === 'pending' && eligible.length === 0 && <Text style={ui.empty}>No eligible subordinate is available for this request.</Text>}
      </View>;
    })}
  </ScrollView>;
}