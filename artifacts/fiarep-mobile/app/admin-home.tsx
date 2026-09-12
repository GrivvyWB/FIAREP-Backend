import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { clearAppMode, logout } from '../lib/store';
import { useAppMode } from './_layout';
import { useState, useCallback, useLayoutEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { unreadCount, getCurrentActor, getCurrentPosition } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import AlertBanner from '../components/AlertBanner';
import UpperManagementMuteToggle from '../components/UpperManagementMuteToggle';

type Tone = 'solid' | 'outline' | 'tint';
type Tile = { label: string; onPress: () => void; tone: Tone };
type Section = { heading: string; color: string; tiles: Tile[] };

export default function AdminHome() {
  const router = useRouter();
  const navigation = useNavigation();
  useLayoutEffect(() => {
    (async () => {
      let pos = '';
      try { pos = (await getCurrentPosition()) || ''; } catch (e) {}
      const p = pos.trim();
      // Directors/management titles show their exact title in the header bar;
      // a true administrator keeps 'Administrator'.
      const titled = /director$|manager$|superintendent$/i.test(p);
      navigation.setOptions({ title: titled ? p : 'Administrator' });
    })();
  }, [navigation]);
  const { refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  useFocusEffect(useCallback(() => { (async () => { const a = await getCurrentActor(); let c = await unreadCount('administrator'); if (a.name) c += await unreadCount(a.name); setUnread(c); })(); }, []));

  async function onSignOut() {
    await logout();
    await clearAppMode();
    refresh();
  }

  const sections: Section[] = [
    {
      heading: 'Inspections & Compliance',
      color: '#1E7D4F',
      tiles: [
        { label: 'HUD Inspections', onPress: () => router.push('/hud-review'), tone: 'solid' },
        { label: 'Projects / Inspections', onPress: () => router.push('/'), tone: 'outline' },
        { label: 'Send Violation', onPress: () => router.push('/violation-send'), tone: 'tint' },
        { label: 'Assign Route', onPress: () => router.push('/assign-route'), tone: 'tint' },
      ],
    },
    {
      heading: 'Jobs',
      color: ACCENT,
      tiles: [
        { label: 'Add Job for Mgmt', onPress: () => router.push('/admin-job'), tone: 'solid' },
        { label: 'Assign a Job', onPress: () => router.push('/dispatch-job'), tone: 'outline' },
        { label: 'Staff Member Jobs', onPress: () => router.push('/worker'), tone: 'tint' },
        { label: 'Assign Emergency Unit', onPress: () => router.push('/assign-emergency'), tone: 'tint' },
        { label: 'Manage Trucks', onPress: () => router.push('/manage-trucks'), tone: 'tint' },
        { label: 'Truck Scores', onPress: () => router.push('/truck-scores'), tone: 'tint' },
        { label: 'Emergency Activity', onPress: () => router.push('/emergency-activity'), tone: 'tint' },
        { label: 'Leave Calendar', onPress: () => router.push('/leave-dashboard'), tone: 'tint' },
      ],
    },
    {
      heading: 'Purchasing',
      color: '#B4741A',
      tiles: [
        { label: 'Change Orders', onPress: () => router.push('/change-orders'), tone: 'outline' },
        { label: 'Vendor Score', onPress: () => router.push('/contractor-scores'), tone: 'tint' },
        { label: 'Development Scores', onPress: () => router.push('/dev-scores'), tone: 'tint' },
        { label: 'Building & Residential Scores', onPress: () => router.push('/property-scores'), tone: 'tint' },
      ],
    },
    {
      heading: 'Requests',
      color: '#C0392B',
      tiles: [
        { label: 'Manage All Requests', onPress: () => router.push('/manage-requests'), tone: 'solid' },
        { label: 'Resident Reports', onPress: () => router.push('/management'), tone: 'outline' },
      ],
    },
    {
      heading: 'System',
      color: '#4A5560',
      tiles: [
        { label: unread > 0 ? 'Inbox (' + unread + ')' : 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' },
        { label: 'Audit Log', onPress: () => router.push('/audit-log'), tone: 'outline' },
        { label: 'Sign out', onPress: onSignOut, tone: 'tint' },
      ],
    },
  ];

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <AlertBanner count={unread} />
      <UpperManagementMuteToggle />
      {sections.map((s, si) => (
        <View key={si} style={{ marginBottom: 18 }}>
          <Text
            style={{
              color: s.color,
              fontWeight: '700',
              fontSize: 12,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            {s.heading}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {s.tiles.map((t, i) => {
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
                    borderColor: s.color,
                    backgroundColor: solid ? s.color : tint ? s.color + '33' : '#fff',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 8,
                    paddingVertical: 10,
                  }}
                >
                  <Text
                    style={{
                      color: solid ? '#fff' : s.color,
                      fontWeight: '600',
                      fontSize: 13,
                      textAlign: 'center',
                    }}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <Text style={ui.label}>Administrator has full access. Issues Management accounts; Management issues Staff Member and Inspection accounts.</Text>
    </ScrollView>
  );
}
