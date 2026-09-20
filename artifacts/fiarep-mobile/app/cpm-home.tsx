import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { clearAppMode, logout, unreadCount, getCurrentActor, getCurrentPosition } from '../lib/store';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';
import AlertBanner from '../components/AlertBanner';

type Tone = 'solid' | 'outline' | 'tint';
type Tile = { label: string; onPress: () => void; tone: Tone };
type Section = { heading: string; color: string; tiles: Tile[] };

export default function CpmHome() {
  const router = useRouter();
  const { mode, refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  const [position, setPosition] = useState('');
  useFocusEffect(useCallback(() => {
    (async () => {
      const a = await getCurrentActor();
      const nextPosition = await getCurrentPosition();
      const normalized = nextPosition.trim().toLowerCase();
      let c = normalized === 'cpm supervisor' ? 0 : await unreadCount('inspector');
      if (a.id) c += await unreadCount(a.id);
      if (a.name) c += await unreadCount(a.name);
      setUnread(c);
      if (normalized !== 'cpm' && normalized !== 'cpm supervisor' && normalized !== 'inspector') {
        router.replace(mode === 'management' ? '/management-home' : '/');
        return;
      }
      setPosition(nextPosition);
    })();
  }, [mode, router]));
  const normalizedPosition = position.trim().toLowerCase();
  const isCpmSupervisor = normalizedPosition === 'cpm supervisor';

  async function onSignOut() {
    await logout();
    await clearAppMode();
    refresh();
  }

  const sections: Section[] = [
    {
      heading: 'Inspections',
      color: '#1E7D4F',
      tiles: [
        ...(!isCpmSupervisor ? [{ label: 'HUD Inspections', onPress: () => router.push('/hud-inspections'), tone: 'solid' as Tone }] : []),
        { label: 'Projects', onPress: () => router.push('/'), tone: 'outline' as Tone },
        ...(normalizedPosition === 'cpm' ? [{ label: '+ New Project', onPress: () => router.push('/?new=1'), tone: 'solid' as Tone }] : []),
        ...(position === 'Inspector' ? [{ label: 'Log Violations', onPress: () => router.push('/inspector-violations'), tone: 'outline' as Tone }] : []),
        ...(position === 'Inspector' ? [{ label: 'FIAREP Vision (AI)', onPress: () => router.push('/fiarep-vision'), tone: 'outline' as Tone }] : []),
        ...(position === 'Inspector' ? [{ label: 'My Routes', onPress: () => router.push('/inspector-routes'), tone: 'outline' as Tone }] : []),
        { label: 'Create Report', onPress: () => router.push('/create-report'), tone: 'outline' as Tone },
        ...(!isCpmSupervisor ? [{ label: 'Leave Calendar', onPress: () => router.push('/leave-dashboard'), tone: 'outline' as Tone }] : []),
         ...(!isCpmSupervisor ? [{ label: 'Request Time Off', onPress: () => router.push('/leave-request'), tone: 'outline' as Tone }, { label: 'Attendance', onPress: () => router.push('/attendance'), tone: 'outline' as Tone }] : []),
      ],
    },
    ...(normalizedPosition === 'cpm' ? [{
      heading: 'Scope',
      color: '#B4741A',
      tiles: [
        { label: 'Submit Scope', onPress: () => router.push('/scope-submit'), tone: 'solid' as Tone },
        { label: 'Change Work Order', onPress: () => router.push('/cpm-change-order'), tone: 'outline' as Tone },
      ],
    }] : []),
    {
      heading: 'System',
      color: '#4A5560',
      tiles: [
        { label: unread > 0 ? 'Inbox (' + unread + ')' : 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' },
        { label: 'Sign out', onPress: onSignOut, tone: 'outline' },
      ],
    },
  ];

  const roleTitle = normalizedPosition === 'cpm' ? 'CPM' : normalizedPosition === 'cpm supervisor' ? 'CPM Supervisor' : normalizedPosition === 'inspector' ? 'Inspector' : 'CPM / Inspector';

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <AlertBanner count={unread} />
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 14 }}>{roleTitle}</Text>
      {sections.map((sec, si) => (
        <View key={si} style={{ marginBottom: 18 }}>
          <Text style={{ color: sec.color, fontWeight: '700', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>
            {sec.heading}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {sec.tiles.map((t, i) => {
              const solid = t.tone === 'solid';
              const tint = t.tone === 'tint';
              return (
                <Pressable
                  key={i}
                  onPress={t.onPress}
                  style={{
                    width: '31.5%',
                    marginRight: (i % 3) === 2 ? 0 : '2.75%',
                    minHeight: 68,
                    marginBottom: 10,
                    borderRadius: 30,
                    borderWidth: solid ? 0 : 1.5,
                    borderColor: sec.color,
                    backgroundColor: solid ? sec.color : tint ? sec.color + '33' : '#fff',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 8,
                    paddingVertical: 10,
                  }}
                >
                  <Text style={{ color: solid ? '#fff' : sec.color, fontWeight: '600', fontSize: 13, textAlign: 'center' }}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
