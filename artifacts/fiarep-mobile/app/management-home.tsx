import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { clearAppMode, logout, getCurrentPosition } from '../lib/store';
import { useAppMode } from './_layout';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { unreadCount, getCurrentActor, displayStaffPosition } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import AlertBanner from '../components/AlertBanner';
import UpperManagementMuteToggle from '../components/UpperManagementMuteToggle';
import { useModuleAccess, moduleForTile } from '../lib/module-access';

type Tone = 'solid' | 'outline' | 'tint';
type Tile = { label: string; onPress: () => void; tone: Tone };
type Section = { heading: string; color: string; tiles: Tile[] };

export default function ManagementHome() {
  const router = useRouter();
  const { mode, refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  const [position, setPosition] = useState('');
  const modules = useModuleAccess();
  const enabledTiles = (tiles: Tile[]) => tiles.filter((tile) => {
    const module = moduleForTile(tile.label);
    return !module || modules[module];
  });
  const _pos = (position || '').trim().toLowerCase();
  const isSup = _pos.includes('supervisor') || _pos === 'superintendent';
  const coverageEligible = _pos.includes('supervisor') || _pos.startsWith('superintendent');
  // Elevated roles see every module. Regular supervisors are restricted.
  const isElevated = mode === 'administrator'
    || _pos === 'regional director' || _pos === 'borough director' || _pos === 'superintendent'
    || (mode === 'management' && !isSup);  // plain management (no supervisor position) keeps full view
  const restricted = !isElevated;
  // Emergency truck admin: ONLY administrator / Borough Director / Regional Director
  // may assign emergencies and register trucks. Everyone else (mgmt/supervisors)
  // gets a read-only Emergency Activity view for their development.
  const emergencyAdmin = mode === 'administrator' || _pos === 'borough director' || _pos === 'regional director';
  const supervisorInspector = _pos === 'supervisor inspector';
  const canReviewInspections = supervisorInspector;
  const cpmSupervisor = _pos === 'cpm supervisor';
  const tradeSupervisor = /^(plumber|electric|electrician|elevator|painter|carpenter|roofer|heating|general construction|cctv installation)( service)? supervisor$/.test(_pos)
    || ['plumbing supervisor', 'electrical supervisor', 'electrician supervisor', 'elevator service supervisor'].includes(_pos);
  const director = _pos === 'borough director' || _pos === 'regional director';
  useFocusEffect(useCallback(() => { (async () => { const a = await getCurrentActor(); let c = isElevated ? await unreadCount('management') : 0; if (a.id) c += await unreadCount(a.id); if (a.name) c += await unreadCount(a.name); setUnread(c); try { setPosition(await getCurrentPosition()); } catch (e) {} })(); }, [isElevated]));

  async function onSignOut() {
    await logout();
    await clearAppMode();
    refresh();
  }

  // These positions are deliberately allow-listed.  Do not let the broad
  // management sections leak into a supervisor's mobile home.
  const personalTiles: Tile[] = [
    { label: unread > 0 ? 'Inbox (' + unread + ')' : 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' },
    { label: 'Request Time Off', onPress: () => router.push('/leave-request'), tone: 'tint' },
    { label: 'Attendance', onPress: () => router.push('/attendance'), tone: 'tint' },
  ];
  if (supervisorInspector) {
    return <ScrollView contentContainerStyle={ui.wrap}>
      <AlertBanner count={unread} /><Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 14 }}>Supervisor Inspector</Text>
      <Text style={{ color: '#1E7D4F', fontWeight: '700', fontSize: 12, textTransform: 'uppercase', marginBottom: 8 }}>Inspections & Compliance</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[
        { label: 'Send Violation', onPress: () => router.push('/violation-send'), tone: 'tint' as Tone },
        { label: 'Inspection Approvals', onPress: () => router.push('/inspection-approvals'), tone: 'tint' as Tone },
        ...personalTiles,
       ].filter((t) => { const m = moduleForTile(t.label); return !m || modules[m]; }).map((t, i) => <Pressable key={i} onPress={t.onPress} style={{ width: '31.5%', marginRight: (i % 3) === 2 ? 0 : '2.75%', minHeight: 68, marginBottom: 10, borderRadius: 30, borderWidth: t.tone === 'solid' ? 0 : 1.5, borderColor: '#1E7D4F', backgroundColor: t.tone === 'solid' ? '#1E7D4F' : '#1E7D4F33', alignItems: 'center', justifyContent: 'center', padding: 8 }}><Text style={{ color: t.tone === 'solid' ? '#fff' : '#1E7D4F', fontWeight: '600', fontSize: 13, textAlign: 'center' }}>{t.label}</Text></Pressable>)}</View>
      <Pressable onPress={onSignOut} style={{ marginTop: 12, padding: 12 }}><Text style={{ textAlign: 'center', color: '#4A5560', fontWeight: '600' }}>Sign out</Text></Pressable>
    </ScrollView>;
  }
  if (cpmSupervisor || tradeSupervisor) {
    const title = cpmSupervisor ? 'CPM Supervisor' : displayStaffPosition(position);
    const workflow: Tile[] = cpmSupervisor
      ? [{ label: 'CPM Supervisor Scope Review', onPress: () => router.push('/scope-review'), tone: 'solid' }]
      : [
        { label: 'In-house assignments', onPress: () => router.push('/in-house-assignments'), tone: 'tint' },
        { label: 'Assign a Job', onPress: () => router.push('/dispatch-job'), tone: 'solid' },
        ...(coverageEligible ? [{ label: 'Cover a Site', onPress: () => router.push('/cover-site'), tone: 'tint' as Tone }] : []),
      ];
    return <ScrollView contentContainerStyle={ui.wrap}>
      <AlertBanner count={unread} /><Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 14 }}>{title}</Text>
       <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{enabledTiles([...workflow, ...personalTiles]).map((t, i) => <Pressable key={i} onPress={t.onPress} style={{ width: '31.5%', marginRight: (i % 3) === 2 ? 0 : '2.75%', minHeight: 68, marginBottom: 10, borderRadius: 30, borderWidth: t.tone === 'solid' ? 0 : 1.5, borderColor: ACCENT, backgroundColor: t.tone === 'solid' ? ACCENT : '#1E7D4F22', alignItems: 'center', justifyContent: 'center', padding: 8 }}><Text style={{ color: t.tone === 'solid' ? '#fff' : ACCENT, fontWeight: '600', fontSize: 13, textAlign: 'center' }}>{t.label}</Text></Pressable>)}</View>
      <Pressable onPress={onSignOut} style={{ marginTop: 12, padding: 12 }}><Text style={{ textAlign: 'center', color: '#4A5560', fontWeight: '600' }}>Sign out</Text></Pressable>
    </ScrollView>;
  }
  const sections: Section[] = [
    {
      heading: 'Inspections & Compliance',
      color: '#1E7D4F',
      tiles: [
        ...(!restricted ? [
          { label: 'HUD Inspections', onPress: () => router.push('/hud-review'), tone: 'outline' as Tone },
        ] : []),
        ...(canReviewInspections ? [{ label: 'Send Violation', onPress: () => router.push('/violation-send'), tone: 'tint' as Tone }, { label: 'Inspection Approvals', onPress: () => router.push('/inspection-approvals'), tone: 'tint' as Tone }] : []),
      ],
    },
    {
      heading: 'Jobs',
      color: ACCENT,
      tiles: [
        ...(!restricted ? [{ label: '+ New Project', onPress: () => router.push('/?new=1'), tone: 'solid' as Tone }] : []),
        { label: 'Assign a Job', onPress: () => router.push('/dispatch-job'), tone: 'solid' },
        ...(coverageEligible ? [{ label: 'Cover a Site', onPress: () => router.push('/cover-site'), tone: 'tint' as Tone }] : []),
        ...(isSup && !cpmSupervisor ? [{ label: 'In-house assignments', onPress: () => router.push('/in-house-assignments'), tone: 'tint' as Tone }] : []),
        { label: 'Create Report', onPress: () => router.push('/create-report'), tone: 'outline' },
        ...(!restricted ? [{ label: 'Staff Member Jobs', onPress: () => router.push('/worker'), tone: 'tint' as Tone }] : []),
        ...(emergencyAdmin ? [{ label: 'Assign Emergency Unit', onPress: () => router.push('/assign-emergency'), tone: 'tint' as Tone }, { label: 'Manage Trucks', onPress: () => router.push('/manage-trucks'), tone: 'tint' as Tone }, { label: 'Truck Scores', onPress: () => router.push('/truck-scores'), tone: 'tint' as Tone }] : []),
        { label: 'Emergency Activity', onPress: () => router.push('/emergency-activity'), tone: 'tint' },
        ...(!restricted && _pos !== 'borough director' ? [{ label: 'Leave Calendar', onPress: () => router.push('/leave-dashboard'), tone: 'tint' as Tone }] : []),
         ...(!cpmSupervisor ? [{ label: 'Request Time Off', onPress: () => router.push('/leave-request'), tone: 'tint' as Tone }, { label: 'Attendance', onPress: () => router.push('/attendance'), tone: 'tint' as Tone }] : []),
        ...(cpmSupervisor ? [{ label: 'CPM Supervisor', onPress: () => router.push('/scope-review'), tone: 'solid' as Tone }] : []),
        ...(position === 'Elevator Supervisor' ? [{ label: 'Elevator Dashboard', onPress: () => router.push('/elevator-dashboard'), tone: 'tint' as Tone }] : []),
      ],
    },
    {
      heading: 'Purchasing',
      color: '#B4741A',
      tiles: restricted ? [] : [
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
        ...(mode === 'management' && isElevated ? [{ label: unread > 0 ? 'Manage All Requests (' + unread + ')' : 'Manage All Requests', onPress: () => router.push('/manage-requests'), tone: 'solid' as Tone }] : []),
        ...(director ? [{ label: unread > 0 ? 'Inbox (' + unread + ')' : 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' as Tone }] : []),
        ...(director ? [{ label: 'Audit Log', onPress: () => router.push('/audit-log'), tone: 'outline' as Tone }] : []),
        ...(!restricted ? [{ label: 'Default rates', onPress: () => router.push('/settings'), tone: 'tint' as Tone }] : []),
        { label: 'Sign out', onPress: onSignOut, tone: 'outline' },
      ],
    },
  ];

  const isSupervisor = /supervisor/i.test((position || '').trim()) || /superintendent/i.test((position || '').trim());
  const heading = position === 'Borough Director' ? 'Borough Director' : isSupervisor ? displayStaffPosition(position) : 'Management';

  const filteredSections = sections.map((section) => ({ ...section, tiles: enabledTiles(section.tiles) })).filter((section) => section.tiles.length > 0);
  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <AlertBanner count={unread} />
      <UpperManagementMuteToggle />
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 14 }}>{heading}</Text>
      {filteredSections.map((sec, si) => (
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
