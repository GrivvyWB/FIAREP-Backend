// The Messages button, at the very top of a home screen where it is easy to
// find and read.
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function MessagesBar({ label = 'Messages', sub, onPress, dark }: { label?: string; sub?: string; onPress: () => void; dark?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
        backgroundColor: dark ? '#123A8F' : '#185FA5', opacity: pressed ? 0.85 : 1,
        borderWidth: dark ? 1.5 : 0, borderColor: '#3B9BFF',
      })}>
      <Ionicons name="chatbubbles-outline" size={28} color="#fff" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{label}</Text>
        {!!sub && <Text style={{ color: '#DBEAFE', fontSize: 13, marginTop: 2 }}>{sub}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={22} color="#fff" />
    </Pressable>
  );
}
