import { View, Text, Pressable, Linking, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { READ_ONLY_NOTE } from '../lib/useAppReadOnly';
import { ui } from '../lib/ui';

/** Small notice at the top of screens a supervisor/manager can view but not act on. */
export function ReadOnlyBanner() {
  return (
    <View style={{ borderWidth: 1, borderColor: '#c9d7ea', backgroundColor: '#eef4fb', borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <Text style={{ color: '#1c3d66', fontSize: 13 }}>{READ_ONLY_NOTE}</Text>
      <Pressable onPress={() => Linking.openURL('https://fiarep.com').catch(() => undefined)}>
        <Text style={{ color: '#185FA5', fontWeight: '700', marginTop: 4 }}>Open fiarep.com</Text>
      </Pressable>
    </View>
  );
}

/** Full-screen notice for screens that exist only to take action. */
export function ReadOnlyScreen({ title }: { title: string }) {
  const router = useRouter();
  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>{title}</Text>
      <ReadOnlyBanner />
      <Pressable style={ui.btnOutline} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
        <Text style={ui.btnOutlineText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}
