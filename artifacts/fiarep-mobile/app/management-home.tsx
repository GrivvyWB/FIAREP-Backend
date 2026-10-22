import { useAppReadOnly } from '../lib/useAppReadOnly';
import { ReadOnlyBanner } from '../components/ReadOnlyBanner';
import { isCpmSupervisorTitle, isInspectionSupervisorTitle, isOfficeTradeSupervisorTitle, supervisedTradeForPosition } from '../lib/titles';
import { View } from 'react-native';
import FieldHome, { type HomeSection, type HomeTab } from '../components/FieldHome';
import { useRouter } from 'expo-router';
import { clearAppMode, logout, getCurrentPosition } from '../lib/store';
import { useAppMode } from './_layout';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { unreadCount, getCurrentActor, displayStaffPosition } from '../lib/store';
import { ACCENT } from '../lib/ui';
import AlertBanner from '../components/AlertBanner';
import UpperManagementMuteToggle from '../components/UpperManagementMuteToggle';
import PhoneComplaintsToggle from '../components/PhoneComplaintsToggle';
import { useBaselineWaiting, COMPLAINT_TILES } from '../lib/baseline';
import BaselineWaitingBanner from '../components/BaselineWaitingBanner';
import { useModuleAccess, moduleForTile, useRawModules, tileEnabled } from '../lib/module-access';
import MessagesBar from '../components/MessagesBar';
import { useMessagingOpen } from '../lib/fiarep-messaging';
import { getSessionIdentity as getIdentityForMessages } from '../lib/store';

type Tone = 'solid' | 'outline' | 'tint';
type Tile = { label: string; onPress: () => void; tone: Tone };
type Section = { heading: string; color: string; tiles: Tile[] };

export default function ManagementHome() {
  const router = useRouter();
  const { mode, refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  const [position, setPosition] = useState('');
  const modules = useModuleAccess();
  const rawModules = useRawModules();
  // Messaging FIAREP, at the top: a client company on the plan writes to
  // FIAREP Services or FIAREP's administrator.
  const messagingOpen = useMessagingOpen();
  const [tenantId, setTenantId] = useState('default');
  useFocusEffect(useCallback(() => { getIdentityForMessages().then((i) => setTenantId(i?.tenantId || 'default')).catch(() => undefined); }, []));
  const showMessages = messagingOpen === true && tenantId !== 'default' && rawModules['fiarepMessaging'] !== false && tileEnabled('management', 'Message FIAREP', rawModules);
  // View-only on the app: action tiles live on fiarep.com.
  const readOnlyState = useAppReadOnly();
  const readOnly = readOnlyState === true;
  const [positionLoaded, setPositionLoaded] = useState(false);
  const actionTiles = new Set(['Send Violation', 'Inspection Approvals', 'HUD Inspections', 'In-house assignments', 'Assign a Job', 'Cover a Site', 'Create Report', '+ New Project', 'Manage Trucks', 'Add Job for Mgmt', 'Assign Route', 'Assign Emergency Unit', 'Staff Member Jobs', 'Review Reports', 'CPM Supervisor Scope Review', 'CPM Supervisor', 'Default rates']);
  const baselineWaiting = useBaselineWaiting();
  const enabledTiles = (tiles: Tile[]) => tiles.filter((tile) => {
    if (baselineWaiting && COMPLAINT_TILES.has(tile.label.replace(/\s*\(\d+\)\s*$/, ''))) return false;
    if (!tileEnabled('management', tile.label, rawModules)) return false;
    if (readOnly && actionTiles.has(tile.label)) return false;
    const module = moduleForTile(tile.label);
    return !module || modules[module];
  });
  const _pos = (position || '').trim().toLowerCase();
  const isSup = _pos.includes('supervisor') || _pos === 'superintendent';
  // Cover a site: a client only has it once it is switched on in Platform Control.
  const coverageEligible = (_pos.includes('supervisor') || _pos.startsWith('superintendent')) && (tenantId === 'default' || rawModules['cover-site'] === true);
  // Elevated roles see every module. Regular supervisors are restricted.
  const isElevated = mode === 'administrator'
    || _pos === 'regional director' || _pos === 'borough director' || _pos === 'superintendent'
    || (mode === 'management' && !isSup);  // plain management (no supervisor position) keeps full view
  const restricted = !isElevated;
  // Emergency truck admin: ONLY administrator / Borough Director / Regional Director
  // may assign emergencies and register trucks. Everyone else (mgmt/supervisors)
  // gets a read-only Emergency Activity view for their development.
  const emergencyAdmin = mode === 'administrator' || _pos === 'borough director' || _pos === 'regional director';
  const supervisorInspector = isInspectionSupervisorTitle(_pos);
  const canReviewInspections = supervisorInspector;
  const cpmSupervisor = isCpmSupervisorTitle(_pos);
  // Any office trade supervisor title — including new ones — gets this home.
  const tradeSupervisor = !cpmSupervisor && isOfficeTradeSupervisorTitle(_pos);
  const director = _pos === 'borough director' || _pos === 'regional director';
  useFocusEffect(useCallback(() => { (async () => { const a = await getCurrentActor(); let c = isElevated ? await unreadCount('management') : 0; if (a.id) c += await unreadCount(a.id); if (a.name) c += await unreadCount(a.name); setUnread(c); try { setPosition(await getCurrentPosition()); } catch (e) {} finally { setPositionLoaded(true); } })(); }, [isElevated]));

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

  // Draw a set of tiles in the shared home look. Attendance is the clock
  // card; Sign out and the lookup / translator tools go under System.
  const renderHome = (title: string, secs: HomeSection[], extraSystem: { label: string; onPress: () => void }[] = []) => {
    const strip = (tiles: { label: string; onPress: () => void }[]) => tiles.filter((t) => t.label !== 'Attendance');
    const all = secs.map((sec) => ({ ...sec, tiles: strip(sec.tiles) }));
    // Every button has its switch (Platform Control → App tabs), the lookup / translator ones too.
    extraSystem = extraSystem.filter((t) => tileEnabled('management', t.label, rawModules));
    const hasAttendance = secs.some((sec) => sec.tiles.some((t) => t.label === 'Attendance'));
    const system = all.find((sec) => sec.heading === 'System');
    if (system) system.tiles = [...system.tiles.filter((t) => t.label !== 'Sign out'), ...extraSystem, ...system.tiles.filter((t) => t.label === 'Sign out')];
    else all.push({ heading: 'System', tiles: [...extraSystem, { label: 'Sign out', onPress: onSignOut }] });
    const tabs: HomeTab[] = [
      ...(all.some((sec) => sec.tiles.some((t) => t.label.startsWith('Inbox'))) ? [{ label: 'Inbox', icon: 'mail-outline', onPress: () => router.push('/notifications') }] : []),
      ...(all.some((sec) => sec.tiles.some((t) => t.label.startsWith('Manage All Requests'))) ? [{ label: 'Requests', icon: 'file-tray-full-outline', onPress: () => router.push('/manage-requests') }] : []),
      ...(all.some((sec) => sec.tiles.some((t) => t.label === 'Review Reports')) ? [{ label: 'Reports', icon: 'document-text-outline', onPress: () => router.push('/management') }] : []),
      ...(all.some((sec) => sec.tiles.some((t) => t.label === 'Request Time Off')) ? [{ label: 'Time Off', icon: 'time-outline', onPress: () => router.push('/leave-request') }] : []),
    ].slice(0, 3);
    return (
      <FieldHome
        title={title}
        banner={<>{showMessages ? <MessagesBar dark label="Message FIAREP" sub="FIAREP Services or the administrator" onPress={() => router.push('/client-messages')} /> : null}{unread > 0 ? <AlertBanner count={unread} /> : null}{readOnly ? <ReadOnlyBanner /> : null}{!restricted && !supervisorInspector && !cpmSupervisor && !tradeSupervisor ? <UpperManagementMuteToggle /> : null}{baselineWaiting ? <BaselineWaitingBanner /> : null}<PhoneComplaintsToggle dark /></>}
        clock={hasAttendance ? { onPress: () => router.push('/attendance'), label: 'Attendance' } : undefined}
        sections={all}
        tabs={tabs}
      />
    );
  };
  if (supervisorInspector) {
    const tiles = [
      { label: 'Send Violation', onPress: () => router.push('/violation-send'), tone: 'tint' as Tone },
      { label: 'Inspection Approvals', onPress: () => router.push('/inspection-approvals'), tone: 'tint' as Tone },
      { label: 'In-house assignments', onPress: () => router.push('/in-house-assignments'), tone: 'tint' as Tone },
      ...personalTiles,
    ].filter((t) => { if (!tileEnabled('management', t.label, rawModules)) return false; if (readOnly && actionTiles.has(t.label)) return false; const m = moduleForTile(t.label); return !m || modules[m]; });
    return renderHome('Supervisor Inspector', [
      { heading: 'Inspections & Compliance', tiles: tiles.filter((t) => !t.label.startsWith('Inbox') && t.label !== 'Request Time Off' && t.label !== 'Attendance') },
      { heading: 'System', tiles: tiles.filter((t) => t.label.startsWith('Inbox') || t.label === 'Request Time Off' || t.label === 'Attendance') },
    ], [
      ...(modules['property-lookup'] ? [{ label: 'Check HPD / DOB', onPress: () => router.push('/inspector-violations?lookup=1') }] : []),
      ...(modules['translator'] ? [{ label: 'Translator', onPress: () => router.push('/translator') }] : []),
    ]);
  }
  if (cpmSupervisor || tradeSupervisor) {
    const title = cpmSupervisor ? 'CPM Supervisor' : displayStaffPosition(position);
    const workflow: Tile[] = cpmSupervisor
      ? [
        { label: 'CPM Supervisor Scope Review', onPress: () => router.push('/scope-review'), tone: 'solid' },
        { label: 'In-house assignments', onPress: () => router.push('/in-house-assignments'), tone: 'tint' },
      ]
      : [
        { label: 'In-house assignments', onPress: () => router.push('/in-house-assignments'), tone: 'tint' },
        { label: 'Assign a Job', onPress: () => router.push('/dispatch-job'), tone: 'solid' },
        ...(coverageEligible ? [{ label: 'Cover a Site', onPress: () => router.push('/cover-site'), tone: 'tint' as Tone }] : []),
      ];
    return renderHome(title, [
      { heading: 'Supervisor', tiles: enabledTiles(workflow) },
      { heading: 'System', tiles: enabledTiles(personalTiles) },
    ]);
  }
  const sections: Section[] = [
    {
      heading: 'Inspections & Compliance',
      color: '#1F5C45',
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
        ...(supervisedTradeForPosition(position) === 'Elevator Service' ? [{ label: 'Elevator Dashboard', onPress: () => router.push('/elevator-dashboard'), tone: 'tint' as Tone }] : []),
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
        { label: 'Building Check-In', onPress: () => router.push('/site-checkin'), tone: 'tint' as Tone },
        { label: 'Smart Repair', onPress: () => router.push('/smart-repair'), tone: 'tint' as Tone },
        ...(!restricted ? [{ label: 'Priority Queue', onPress: () => router.push('/priority-queue'), tone: 'solid' as Tone }] : []),
        { label: 'Building Baseline', onPress: () => router.push('/baseline'), tone: 'tint' as Tone },
      ],
    },
    {
      heading: 'System',
      color: '#4A5560',
      tiles: [
        ...(mode === 'management' && isElevated ? [{ label: unread > 0 ? 'Manage All Requests (' + unread + ')' : 'Manage All Requests', onPress: () => router.push('/manage-requests'), tone: 'solid' as Tone }] : []),
        ...(director ? [{ label: unread > 0 ? 'Inbox (' + unread + ')' : 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' as Tone }] : []),
        ...(!restricted ? [{ label: 'Default rates', onPress: () => router.push('/settings'), tone: 'tint' as Tone }] : []),
        { label: 'Sign out', onPress: onSignOut, tone: 'outline' },
      ],
    },
  ];

  const isSupervisor = /supervisor/i.test((position || '').trim()) || /superintendent/i.test((position || '').trim());
  const heading = position === 'Borough Director' ? 'Borough Director' : isSupervisor ? displayStaffPosition(position) : 'Management';

  const filteredSections = sections.map((section) => ({ heading: section.heading, tiles: enabledTiles(section.tiles) })).filter((section) => section.tiles.length > 0);
  // Don't flash the full Management home before we know who this is.
  if (!positionLoaded || readOnlyState === null) return <View style={{ flex: 1, backgroundColor: '#070B16' }} />;
  return renderHome(heading, filteredSections);
}
