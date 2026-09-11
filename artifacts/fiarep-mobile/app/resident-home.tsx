import { Text, Pressable, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { clearAppMode } from '../lib/store';
import { useAppMode } from './_layout';
import { ui } from '../lib/ui';

export default function ResidentHome() {
  const router = useRouter();
  const { refresh } = useAppMode();

  async function onExit() {
    await clearAppMode();
    refresh();
  }

  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 40 }]}>
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
        Resident Services
      </Text>
      <Text style={[ui.label, { textAlign: 'center', marginBottom: 24 }]}>
        Report an issue or check the status of a report.
      </Text>

      <Pressable style={ui.btn} onPress={() => router.push('/resident')}>
        <Text style={ui.btnText}>Report an Issue</Text>
      </Pressable>

      <Pressable style={ui.btnOutline} onPress={() => router.push('/resident-lookup')}>
        <Text style={ui.btnOutlineText}>Check Report Status</Text>
      </Pressable>
      <Pressable style={[ui.btnOutline, { marginTop: 24 }]} onPress={onExit}>
        <Text style={ui.btnOutlineText}>Exit</Text>
      </Pressable>
    </ScrollView>
  );
}
