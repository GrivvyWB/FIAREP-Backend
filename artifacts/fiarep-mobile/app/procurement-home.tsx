import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { clearAppMode, clearRememberedStaff, logout, unreadCount, getCurrentActor } from '../lib/store';
import { useAppMode } from './_layout';
import { ui } from '../lib/ui';

type Tone = 'solid' | 'outline' | 'tint';
type Tile = { label: string; onPress: () => void; tone: Tone };
type Section = { heading: string; color: string; tiles: Tile[] };

export default function ProcurementHome() {
  const router = useRouter();
  const { refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  useFocusEffect(useCallback(() => { (async () => { const a = await getCurrentActor(); let c = await unreadCount('procurement'); if (a.name) c += await unreadCount(a.name); setUnread(c); })(); }, []));

  function onSwitchRole() {
    Alert.alert('Switch role?', 'Return to the role selection screen.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch', style: 'destructive', onPress: async () => { await clearRememberedStaff('procurement'); await logout(); await clearAppMode(); refresh(); } },
    ]);
  }

  const sections: Section[] = [
    {
      heading: 'Purchasing',
      color: '#B4741A',
      tiles: [
        { label: 'Procurement', onPress: () => router.push('/procurement'), tone: 'solid' },
        { label: 'Vendor Contacts', onPress: () => router.push('/vendor-contacts'), tone: 'outline' },
        { label: 'Change Orders', onPress: () => router.push('/change-orders'), tone: 'outline' },
        { label: 'Vendor Score', onPress: () => router.push('/contractor-scores'), tone: 'outline' },
        { label: 'Development Scores', onPress: () => router.push('/dev-scores'), tone: 'outline' },
      ],
    },
    {
      heading: 'System',
      color: '#4A5560',
      tiles: [
        { label: unread > 0 ? 'Inbox (' + unread + ')' : 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' },
        { label: 'Switch role', onPress: onSwitchRole, tone: 'outline' },
      ],
    },
  ];

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
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
