// The Command Center's talk button: a glowing orb of soft colours that moves like a wave.
// Calm and blue while it waits, wiggles with your voice while it hears you (the louder, the
// bigger), turns while it works, and pulses purple while it answers. Press it to talk / stop.
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export type OrbPhase = 'off' | 'waiting' | 'hearing' | 'thinking' | 'speaking';

const COLORS: Record<OrbPhase, [string, string][]> = {
  off: [['#2F6FD6', '#185FA5'], ['#38BDF8', '#2563EB'], ['#818CF8', '#3B82F6']],
  waiting: [['#22D3EE', '#2563EB'], ['#34D399', '#0EA5E9'], ['#818CF8', '#06B6D4']],
  hearing: [['#FF3B6B', '#F97316'], ['#A855F7', '#EC4899'], ['#F59E0B', '#EF4444']],
  thinking: [['#3B82F6', '#6366F1'], ['#06B6D4', '#3B82F6'], ['#8B5CF6', '#0EA5E9']],
  speaking: [['#8B5CF6', '#EC4899'], ['#6366F1', '#A855F7'], ['#22D3EE', '#8B5CF6']],
};
const ICON: Record<OrbPhase, string> = { off: '🎙', waiting: '', hearing: '■', thinking: '', speaking: '■' };

/** level: 0 (quiet) to 1 (loud), updated while it hears you. */
export default function VoiceOrb({ phase, level, onPress, disabled, size = 92 }: { phase: OrbPhase; level: Animated.Value; onPress: () => void; disabled?: boolean; size?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const speed = phase === 'hearing' ? 1400 : phase === 'speaking' ? 1800 : phase === 'thinking' ? 1600 : 3200;
    t.setValue(0);
    const a = Animated.loop(Animated.timing(t, { toValue: 1, duration: speed, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.timing(spin, { toValue: 1, duration: phase === 'thinking' ? 1400 : 6000, easing: Easing.linear, useNativeDriver: true }));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [phase, t, spin]);

  // How far the colours wander: a little while waiting, a lot with a loud voice.
  const amp = phase === 'off' ? 2 : phase === 'waiting' ? 5 : phase === 'thinking' ? 6 : 8;
  const loud = phase === 'hearing' ? level : phase === 'speaking' ? Animated.multiply(t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.25, 0.7, 0.25] }), 1) : new Animated.Value(0);
  const blob = (i: number) => {
    const ph = i / 3;
    const wave = (k: number) => t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 1, 0, -1, 0].map((_, j, arr) => arr[(j + Math.round(ph * 4) + k) % 4]! * amp) });
    const scale = Animated.add(0.86 + i * 0.03, Animated.multiply(loud, 0.32 - i * 0.06));
    return (
      <Animated.View key={i} style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2, overflow: 'hidden', opacity: 0.72,
        transform: [{ translateX: wave(0) }, { translateY: wave(1) }, { scale }, { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: [`${i * 120}deg`, `${i * 120 + (i % 2 ? -360 : 360)}deg`] }) }],
      }}>
        <LinearGradient colors={COLORS[phase][i]!} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: size / 2 }} />
      </Animated.View>
    );
  };
  // The glow behind it, breathing with the voice.
  const glow = Animated.add(1.05, Animated.multiply(loud, 0.35));
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={phase === 'off' ? 'Talk' : phase === 'speaking' ? 'Stop the answer' : 'Done talking'}
      style={{ width: size * 1.5, height: size * 1.5, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      <Animated.View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS[phase][0]![0], opacity: phase === 'off' ? 0.15 : 0.28, transform: [{ scale: glow }] }} />
      {[0, 1, 2].map(blob)}
      <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: size * 0.21, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }}>
        {phase === 'thinking' || phase === 'waiting'
          ? <View style={{ flexDirection: 'row', gap: 3 }}>{[0, 1, 2].map((i) => <Animated.View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#334155', opacity: t.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0.3, i === 0 ? 1 : 0.3, i === 1 ? 1 : 0.3, i === 2 ? 1 : 0.3] }) }} />)}</View>
          : <Text style={{ fontSize: phase === 'off' ? size * 0.2 : size * 0.16, color: '#0f172a' }}>{ICON[phase]}</Text>}
      </View>
    </Pressable>
  );
}
