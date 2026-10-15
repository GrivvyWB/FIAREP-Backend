import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

/** Shown to a client while its complaint tools wait for FIAREP's baseline walk-through. */
export default function BaselineWaitingBanner() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push('/baseline' as any)} style={{ borderWidth: 1, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <Text style={{ color: '#fbbf24', fontWeight: '800', fontSize: 14 }}>Building baseline assessment not done yet</Text>
      <Text style={{ color: '#e2e8f0', fontSize: 12, marginTop: 2 }}>Complaint and violation management starts once FIAREP completes the walk-through of your building. Residents can still send complaints.</Text>
    </Pressable>
  );
}
