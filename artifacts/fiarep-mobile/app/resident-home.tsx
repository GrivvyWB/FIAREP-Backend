import { Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { ui } from '../lib/ui';

export default function ResidentHome() {
  const router = useRouter();

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
    </ScrollView>
  );
}
