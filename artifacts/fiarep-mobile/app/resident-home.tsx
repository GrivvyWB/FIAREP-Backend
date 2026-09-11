import { Text, Pressable, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { clearAppMode } from '../lib/store';
import { useAppMode } from './_layout';
import { ui } from '../lib/ui';

export default function ResidentHome() {
  const router = useRouter();
  const { refresh } = useAppMode();

  // Hidden escape hatch: long-press the title -> confirm -> return to role picker.
  function onTitleLongPress() {
    Alert.alert(
      'Exit resident mode?',
      'This will return to the role selection screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: async () => {
            try { await clearAppMode(); refresh(); }
            catch (e: any) { Alert.alert('Error', e?.message ?? 'Could not switch.'); }
          },
        },
      ]
    );
  }

  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 40 }]}>
      <Pressable onLongPress={onTitleLongPress} delayLongPress={1200}>
        <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
          Resident Services
        </Text>
      </Pressable>
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
