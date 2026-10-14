import { isCpmSupervisorTitle } from '../lib/titles';
import { useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { useState, useCallback } from 'react';
import { syncAllEntities } from '../lib/sync';
import { clearAppMode, logout, unreadCount, getCurrentActor, getCurrentPosition, getSessionIdentity, listResidentReports, listRoutedInspectionsFor, listManpowerRequests } from '../lib/store';
import { useAppMode } from './_layout';
import { useModuleAccess, useRawModules, tileEnabled } from '../lib/module-access';
import { hasAnyMeasurementAccess } from '../lib/measurement-access';
import AlertBanner from '../components/AlertBanner';
import FieldHome from '../components/FieldHome';
import { getAttendanceStatus } from '../lib/store';

type Tone = 'solid' | 'outline' | 'tint';
type Tile = { label: string; onPress: () => void; tone: Tone };
type Section = { heading: string; color: string; tiles: Tile[] };

export default function CpmHome() {
  const router = useRouter();
  const modules = useModuleAccess();
  const rawModules = useRawModules();
  const { mode, refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  const [jobCount, setJobCount] = useState(0);
  const [position, setPosition] = useState('');
  // FIAREP's own crew (tenant "default") are technicians: same tools, named for what they do.
  const [isTechnician, setIsTechnician] = useState(false);
  const [clockedIn, setClockedIn] = useState(false);
  const navigation = useNavigation();
  useFocusEffect(useCallback(() => {
    let active = true;
    // Work assigned to me that is still open: complaints, violations and
    // in-house jobs. Refreshed every 30 seconds while this screen is open.
    const countJobs = async () => {
      const a = await getCurrentActor();
      if (!a?.id) return;
      const [reports, routed, inHouse] = await Promise.all([
        listResidentReports().catch(() => []),
        listRoutedInspectionsFor(a.name || '', a.id).catch(() => []),
        listManpowerRequests().catch(() => []),
      ]);
      const open = reports.filter((r) => r.assignedStaffId === a.id && (r.status === 'assigned' || r.status === 'in_progress')).length +
        routed.length +
        inHouse.filter((j) => j.assignedStaffId === a.id && ['dispatched', 'in_progress'].includes(j.status)).length;
      if (active) setJobCount(open);
    };
    const refreshCounts = async () => {
      const a = await getCurrentActor();
      const normalized = ((await getCurrentPosition()) || '').trim().toLowerCase();
      let c = isCpmSupervisorTitle(normalized) ? 0 : await unreadCount('inspector').catch(() => 0);
      if (a?.id) c += await unreadCount(a.id).catch(() => 0);
      if (a?.name) c += await unreadCount(a.name).catch(() => 0);
      if (active) setUnread(c);
      await countJobs().catch(() => undefined);
    };
    const timer = setInterval(() => {
      syncAllEntities().catch(() => undefined).finally(() => { void refreshCounts().catch(() => undefined); });
    }, 30_000);
    void countJobs().catch(() => undefined);
    (async () => {
      try {
        const a = await getCurrentActor();
        const nextPosition = (await getCurrentPosition()) || '';
        const normalized = nextPosition.trim().toLowerCase();
        let c = isCpmSupervisorTitle(normalized) ? 0 : await unreadCount('inspector').catch(() => 0);
        if (a?.id) c += await unreadCount(a.id).catch(() => 0);
        if (a?.name) c += await unreadCount(a.name).catch(() => 0);
        setUnread(c);
        if (isCpmSupervisorTitle(normalized)) {
          router.replace('/management-home');
          return;
        }
        const identity = await getSessionIdentity();
        // Who belongs on this screen. The rest of the app decides this by what
        // a title CONTAINS (module-access, measurement-access); this one check
        // used to demand the title be exactly "cpm" or "inspector", so a
        // Technician, a Senior Inspector or a CPM Technician was thrown to the
        // Projects screen — and the Home button there sends them straight back
        // here, which is the bounce. Matched to the rest of the app.
        const belongsHere =
          normalized.includes('cpm') ||
          normalized.includes('inspector') ||
          normalized.includes('technician') ||
          normalized === 'tech' ||
          // FIAREP's own crew are technicians whatever their title reads.
          (identity?.tenantId || 'default') === 'default';
        if (!belongsHere) {
          router.replace(mode === 'management' ? '/management-home' : '/');
          return;
        }
        setPosition(nextPosition);
        const tech = (identity?.tenantId || 'default') === 'default';
        setIsTechnician(tech);
        navigation.setOptions({ headerShown: false });
        getAttendanceStatus().then((st) => setClockedIn(st?.current?.direction === 'in')).catch(() => undefined);
      } catch (e) {
        // Data not ready / offline — keep the screen usable rather than blank.
      }
    })();
    return () => { active = false; clearInterval(timer); };
  }, [mode, router, navigation]));
  const normalizedPosition = position.trim().toLowerCase();
  const isCpmSupervisor = isCpmSupervisorTitle(normalizedPosition);
  // What this person does, decided the way the rest of the app decides it: by
  // what the title CONTAINS. These gates used to demand the title be exactly
  // "cpm" or "Inspector" (capital I, case-sensitive, in four places), so a
  // Senior Inspector or a CPM Technician lost nearly every tile on the screen.
  //
  // FIAREP's own crew see all of it. Nothing on this screen is hidden by
  // judgement: Module Management is the only off switch, and tileEnabled()
  // below has the last word on every tile.
  const isCpmRole = normalizedPosition.includes('cpm') || isTechnician;
  const isInspectorRole = normalizedPosition.includes('inspector') || isTechnician;

  async function onSignOut() {
    await logout();
    await clearAppMode();
    refresh();
  }

  const sections: Section[] = [
    {
      heading: 'My Work',
      color: '#185FA5',
      tiles: [
        { label: jobCount > 0 ? 'My Jobs (' + jobCount + ')' : 'My Jobs', onPress: () => router.push('/my-jobs'), tone: 'solid' as Tone },
        // FIAREP's own technicians always get the punch clock here, whatever Module Management says.
        ...(isTechnician ? [{ label: 'Time Clock', onPress: () => router.push('/attendance'), tone: 'solid' as Tone }] : []),
      ],
    },
    {
      heading: 'Inspections',
      color: '#1E7D4F',
      tiles: [
        ...(isInspectorRole ? [{ label: 'HUD Inspections', onPress: () => router.push('/hud-inspections'), tone: 'solid' as Tone }] : []),
        ...(isCpmRole ? [{ label: 'Projects', onPress: () => router.push('/?list=1'), tone: 'outline' as Tone }] : []),
        ...(isCpmRole ? [{ label: '+ New Project', onPress: () => router.push('/?new=1'), tone: 'solid' as Tone }] : []),
        // Standing in the apartment: what the job needs bought, priced off the
        // book and sent to the client to approve. FIAREP's own crew only -
        // nobody else has a client to send a price to.
        ...(isTechnician ? [{ label: 'Price Quote', onPress: () => router.push('/price-quote'), tone: 'solid' as Tone }] : []),
        // Walk a building and price it on the spot, with no complaint behind it.
        ...(isTechnician ? [{ label: 'Quick Quote', onPress: () => router.push('/quick-quote'), tone: 'solid' as Tone }] : []),
        ...(isInspectorRole ? [{ label: 'Log Violations', onPress: () => router.push('/inspector-violations'), tone: 'outline' as Tone }] : []),
        ...(isInspectorRole ? [{ label: 'FIAREP Vision (AI)', onPress: () => router.push('/fiarep-vision'), tone: 'outline' as Tone }] : []),
        ...(isInspectorRole ? [{ label: 'My Routes', onPress: () => router.push('/inspector-routes'), tone: 'outline' as Tone }] : []),
        ...(isInspectorRole ? [{ label: 'My Inspections', onPress: () => router.push('/my-inspections'), tone: 'outline' as Tone }] : []),
        ...(isInspectorRole ? [{ label: 'Create Report', onPress: () => router.push('/create-report'), tone: 'outline' as Tone }] : []),
        ...(isInspectorRole && hasAnyMeasurementAccess(position, rawModules) ? [{ label: 'Measurement', onPress: () => router.push('/measurement'), tone: 'outline' as Tone }, { label: 'Saved Measurements', onPress: () => router.push('/saved-measurements'), tone: 'outline' as Tone }] : []),
        { label: 'Request Time Off', onPress: () => router.push('/leave-request'), tone: 'outline' as Tone },
        ...(isTechnician ? [] : [{ label: 'Attendance', onPress: () => router.push('/attendance'), tone: 'outline' as Tone }]),
      ],
    },
    ...(isCpmRole ? [{
      heading: 'Scope',
      color: '#B4741A',
      tiles: [
        { label: 'Submit Scope', onPress: () => router.push('/scope-submit'), tone: 'solid' as Tone },
        { label: 'Change Work Order', onPress: () => router.push('/cpm-change-order'), tone: 'outline' as Tone },
        ...(hasAnyMeasurementAccess(position, rawModules) ? [{ label: 'Measurement', onPress: () => router.push('/measurement'), tone: 'outline' as Tone }, { label: 'Saved Measurements', onPress: () => router.push('/saved-measurements'), tone: 'outline' as Tone }] : []),
      ],
    }] : []),
    {
      heading: 'System',
      color: '#4A5560',
      tiles: [
        { label: unread > 0 ? 'Inbox (' + unread + ')' : 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' },
        ...(modules['property-lookup'] ? [{ label: '🏢 Check HPD / DOB', onPress: () => router.push('/inspector-violations?lookup=1'), tone: 'outline' as const }] : []),
        ...(modules['translator'] ? [{ label: '🌐 Translator', onPress: () => router.push('/translator'), tone: 'outline' as const }] : []),
        { label: 'Sign out', onPress: onSignOut, tone: 'outline' },
      ],
    },
  ];

  const roleTitle = isTechnician ? 'Technician' : isCpmSupervisor ? 'CPM Supervisor' : normalizedPosition.includes('cpm') ? 'CPM' : normalizedPosition.includes('inspector') ? 'Inspector' : 'Tech';

  // Same gates as always; the look is FieldHome's. My Jobs is the hero card,
  // Attendance / Time Clock is the clock card, the rest are tiles.
  const enabled = (label: string) => (isTechnician && label === 'Time Clock') || tileEnabled('cpm', label, rawModules);
  const homeSections = sections
    .filter((sec) => sec.heading !== 'My Work')
    .map((sec) => ({ heading: sec.heading, tiles: sec.tiles.filter((t) => enabled(t.label) && t.label !== 'Attendance').map((t) => ({ label: t.label, onPress: t.onPress })) }));
  const showJobs = enabled('My Jobs');
  const showClock = isTechnician || enabled('Attendance');
  const tabs = [
    ...(showJobs ? [{ label: 'My Work', icon: 'clipboard-outline', onPress: () => router.push('/my-jobs') }] : []),
    ...(enabled('Inbox') ? [{ label: 'Inbox', icon: 'mail-outline', onPress: () => router.push('/notifications') }] : []),
    { label: 'Settings', icon: 'settings-outline', onPress: () => router.push('/settings') },
  ];

  return (
    <FieldHome
      title={roleTitle}
      banner={unread > 0 ? <AlertBanner count={unread} /> : null}
      hero={showJobs ? { label: 'My Jobs', onPress: () => router.push('/my-jobs'), badge: jobCount } : undefined}
      clock={showClock ? { onPress: () => router.push('/attendance'), clockedIn, label: isTechnician ? 'Time Clock' : 'Attendance' } : undefined}
      sections={homeSections}
      tabs={tabs}
    />
  );
}
