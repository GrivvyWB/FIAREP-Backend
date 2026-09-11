import { Text, Pressable, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { clearAppMode, clearRememberedStaff, clearCurrentActor } from '../lib/store';
import { useAppMode } from './_layout';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { unreadCount, getCurrentActor, getCurrentPosition } from '../lib/store';
import { ui } from '../lib/ui';
import AlertBanner from '../components/AlertBanner';

export default function WorkerHome() {
  const router = useRouter();
  const { mode, refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  const [position, setPosition] = useState('');
  useFocusEffect(useCallback(() => { (async () => { const a = await getCurrentActor(); let c = a.name ? await unreadCount(a.name) : 0; setUnread(c); try { setPosition(await getCurrentPosition()); } catch (e) {} })(); }, [])); 

  function onSwitchRole() {
    Alert.alert('Switch role?', 'Return to the role selection screen.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch', style: 'destructive', onPress: async () => { if (mode === 'worker' || mode === 'inspector') await clearRememberedStaff(mode); await clearCurrentActor(); await clearAppMode(); refresh(); } },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 40 }]}>
      <AlertBanner count={unread} />
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>{position === 'Elevator Service' ? 'Elevator Mechanic' : (position || 'Worker')}</Text>
      <Text style={[ui.label, { textAlign: 'center', marginBottom: 24 }]}>
        View your assigned jobs and check report status.
      </Text>

      <Pressable style={ui.btn} onPress={() => router.push('/my-jobs')}>
        <Text style={ui.btnText}>My Jobs</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={() => router.push('/worker-change-order')}>
        <Text style={ui.btnOutlineText}>Change Work Order</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={() => router.push('/leave-request')}>
        <Text style={ui.btnOutlineText}>Request Time Off</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={() => router.push('/notifications')}>
        <Text style={ui.btnOutlineText}>Inbox{unread > 0 ? '  (' + unread + ')' : ''}</Text>
      </Pressable>

      <Pressable style={ui.btnOutline} onPress={() => router.push('/resident-lookup')}>
        <Text style={ui.btnOutlineText}>Check Report Status</Text>
      </Pressable>

      <Pressable style={[ui.btnOutline, { marginTop: 24 }]} onPress={onSwitchRole}>
        <Text style={ui.btnOutlineText}>Switch role</Text>
      </Pressable>
    </ScrollView>
  );
}
