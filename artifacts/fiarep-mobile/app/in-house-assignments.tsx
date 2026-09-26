import { useAppReadOnly } from '../lib/useAppReadOnly';
import { ReadOnlyScreen } from '../components/ReadOnlyBanner';
import { isCrewForTrade, isSupervisorTitle } from '../lib/titles';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getCurrentActor, getCurrentPosition, listManpowerRequests, listStaffAccounts, performEntityAction, type ManpowerRequest, type StaffAccount } from '../lib/store';
import { ui } from '../lib/ui';


function InHouseAssignmentsScreen() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [requests, setRequests] = useState<ManpowerRequest[]>([]);
  const [people, setPeople] = useState<StaffAccount[]>([]);
  const load = useCallback(async () => {
    const actor = await getCurrentActor();
    const all = await listManpowerRequests().catch(() => []);
    setRequests(all.filter((r) => r.receiverSupervisorId === actor.id && ['pending', 'assigned', 'dispatched'].includes(r.status)));
    setPeople((await listStaffAccounts('approved')).filter((p) => p.role === 'worker' || p.role === 'inspector' || p.role === 'emergency'));
  }, []);
  useFocusEffect(useCallback(() => {
    void Promise.all([getCurrentActor(), getCurrentPosition()]).then(([actor, position]) => {
      const p = position.trim().toLowerCase();
      // Any receiving supervisor (incl. CPM Supervisor). The list below only
      // shows requests addressed to this account; the server enforces the rest.
      const allowed = actor.role === 'management' && isSupervisorTitle(p);
      if (!allowed) { router.replace('/management-home'); return; }
      setAuthorized(true);
      void load();
    }).catch(() => router.replace('/management-home'));
  }, [load, router]));

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

  if (!authorized) return null;
  return <ScrollView contentContainerStyle={ui.wrap}>
    <Text style={ui.h}>In-house assignments</Text>
    <Text style={ui.label}>Requests addressed to your receiving trade supervisor account.</Text>
    {requests.length === 0 && <Text style={ui.empty}>No in-house manpower requests.</Text>}
    {requests.map((r) => {
      // Crew of the requested trade, by title (works for any trade).
      const eligible = people.filter((p) => isCrewForTrade(p.position, r.requestedTrade) &&
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

// Supervisors/managers are view-only on the app; this screen only takes action.
export default function InHouseAssignments() {
  const readOnly = useAppReadOnly();
  if (readOnly === null) return null;
  if (readOnly) return <ReadOnlyScreen title="In-house assignments" />;
  return <InHouseAssignmentsScreen />;
}
