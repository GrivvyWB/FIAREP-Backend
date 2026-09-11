import { useEffect, useRef } from 'react';
import { Animated, Text, Pressable, Vibration } from 'react-native';
import { useRouter } from 'expo-router';

// A red alert banner that pulses (blinks) when there are unread alerts, so the
// user notices it the moment they land on their home screen. Taps to the Inbox.
export default function AlertBanner({ count }: { count: number }) {
  const router = useRouter();
  const pulse = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(0);

  useEffect(() => {
    if (count <= 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    // Buzz once when new alerts appear (count increased).
    if (count > prevCount.current) {
      try { Vibration.vibrate(400); } catch (e) {}
    }
    prevCount.current = count;
    loop.start();
    return () => loop.stop();
  }, [count, pulse]);

  if (count <= 0) return null;

  return (
    <Pressable onPress={() => router.push('/notifications')}>
      <Animated.View style={{ opacity: pulse, backgroundColor: '#c0392b', borderRadius: 12, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{count} new alert{count === 1 ? '' : 's'}</Text>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Tap to view ›</Text>
      </Animated.View>
    </Pressable>
  );
}
