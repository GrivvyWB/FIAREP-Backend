import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { clearAppMode, logout, getCurrentPosition } from '../lib/store';
import { useAppMode } from './_layout';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { unreadCount, getCurrentActor } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import AlertBanner from '../components/AlertBanner';
import UpperManagementMuteToggle from '../components/UpperManagementMuteToggle';

type Tone = 'solid' | 'outline' | 'tint';
type Tile = { label: string; onPress: () => void; tone: Tone };
type Section = { heading: string; color: string; tiles: Tile[] };

export default function ManagementHome() {
  const router = useRouter();
  const { mode, refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  const [position, setPosition] = useState('');
  const _pos = (position || '').trim().toLowerCase();
  const isSup = /supervisor$/.test(_pos) || _pos === 'superintendent';
  // Elevated roles see every module. Regular supervisors are restricted.
  const isElevated = mode === 'administrator'
    || _pos === 'regional director' || _pos === 'borough director' || _pos === 'superintendent'
    || (mode === 'management' && !isSup);  // plain management (no supervisor position) keeps full view
  const restricted = !isElevated;
  // Emergency truck admin: ONLY administrator / Borough Director / Regional Director
  // may assign emergencies and register trucks. Everyone else (mgmt/supervisors)
  // gets a read-only Emergency Activity view for their development.
  const emergencyAdmin = mode === 'administrator' || _pos === 'borough director' || _pos === 'regional director';
  const ordinaryManagement = mode === 'management' &&
    !['borough director', 'regional director', 'superintendent'].includes(_pos);
  useFocusEffect(useCallback(() => { (async () => { const a = await getCurrentActor(); let c = await unreadCount('management'); if (a.name) c += await unreadCount(a.name); setUnread(c); try { setPosition(await getCurrentPosition()); } catch (e) {} })(); }, []));

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
        ...(!restricted ? [
          { label: 'HUD Inspections', onPress: () => router.push('/hud-review'), tone: 'outline' as Tone },
        ] : []),
        { label: 'Send Violation', onPress: () => router.push('/violation-send'), tone: 'tint' },
        { label: 'Inspection Approvals', onPress: () => router.push('/inspection-approvals'), tone: 'tint' },
        { label: 'Assign Route', onPress: () => router.push('/assign-route'), tone: 'tint' },
      ],
    },
    {
      heading: 'Jobs',
      color: ACCENT,
      tiles: [
        ...(!restricted ? [{ label: '+ New Project', onPress: () => router.push('/?new=1'), tone: 'solid' as Tone }] : []),
        { label: 'Assign a Job', onPress: () => router.push('/dispatch-job'), tone: 'solid' },
        { label: 'Create Report', onPress: () => router.push('/create-report'), tone: 'outline' },
        { label: 'Staff Member Jobs', onPress: () => router.push('/worker'), tone: 'tint' },
        ...(emergencyAdmin ? [{ label: 'Assign Emergency Unit', onPress: () => router.push('/assign-emergency'), tone: 'tint' as Tone }, { label: 'Manage Trucks', onPress: () => router.push('/manage-trucks'), tone: 'tint' as Tone }, { label: 'Truck Scores', onPress: () => router.push('/truck-scores'), tone: 'tint' as Tone }] : []),
        { label: 'Emergency Activity', onPress: () => router.push('/emergency-activity'), tone: 'tint' },
        { label: 'Leave Calendar', onPress: () => router.push('/leave-dashboard'), tone: 'tint' },
        { label: 'Request Time Off', onPress: () => router.push('/leave-request'), tone: 'tint' },
        ...(position === 'Elevator Supervisor' ? [{ label: 'Elevator Dashboard', onPress: () => router.push('/elevator-dashboard'), tone: 'tint' as Tone }] : []),
      ],
    },
    {
      heading: 'Purchasing',
      color: '#B4741A',
      tiles: restricted ? [] : [
        ...(ordinaryManagement ? [{ label: 'Scope Review', onPress: () => router.push('/scope-review'), tone: 'solid' as Tone }] : []),
        { label: 'Change Orders', onPress: () => router.push('/change-orders'), tone: 'outline' as Tone },
        { label: 'Vendor Score', onPress: () => router.push('/contractor-scores'), tone: 'tint' as Tone },
        { label: 'Development Scores', onPress: () => router.push('/dev-scores'), tone: 'tint' as Tone },
        { label: 'Building & Residential Scores', onPress: () => router.push('/property-scores'), tone: 'tint' as Tone },
      ],
    },
    {
      heading: 'Requests',
      color: '#C0392B',
      tiles: [
        ...(!restricted ? [{ label: 'Review Reports', onPress: () => router.push('/management'), tone: 'solid' as Tone }] : []),
      ],
    },
    {
      heading: 'System',
      color: '#4A5560',
      tiles: [
        { label: unread > 0 ? 'Inbox (' + unread + ')' : 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' },
        ...(!restricted ? [{ label: 'Audit Log', onPress: () => router.push('/audit-log'), tone: 'outline' as Tone }, { label: 'Default rates', onPress: () => router.push('/settings'), tone: 'tint' as Tone }] : []),
        { label: 'Sign out', onPress: onSignOut, tone: 'outline' },
      ],
    },
  ];

  const isSupervisor = /supervisor$/i.test((position || '').trim()) || /superintendent/i.test((position || '').trim());
  const heading = position === 'Borough Director' ? 'Borough Director' : isSupervisor ? position : 'Management';

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <AlertBanner count={unread} />
      <UpperManagementMuteToggle />
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 14 }}>{heading}</Text>
      {sections.filter((sec) => sec.tiles.length > 0).map((sec, si) => (
        <View key={si} style={{ marginBottom: 18 }}>
          <Text
            style={{
              color: sec.color,
              fontWeight: '700',
              fontSize: 12,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
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
                  <Text
                    style={{
                      color: solid ? '#fff' : sec.color,
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
    </ScrollView>
  );
}
