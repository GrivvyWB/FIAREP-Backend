import { useAppReadOnly } from '../lib/useAppReadOnly';
import { ReadOnlyBanner } from '../components/ReadOnlyBanner';
import FieldHome from '../components/FieldHome';
import { useRouter, useNavigation } from 'expo-router';
import { clearAppMode, logout } from '../lib/store';
import { useAppMode } from './_layout';
import { useState, useCallback, useLayoutEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { unreadCount, getCurrentActor, getCurrentPosition, getSessionIdentity, isFiarepAdministrator } from '../lib/store';
import MessagesBar from '../components/MessagesBar';
import { useMessagingOpen } from '../lib/fiarep-messaging';
import { hasAnyMeasurementAccess } from '../lib/measurement-access';
import { ACCENT } from '../lib/ui';
import AlertBanner from '../components/AlertBanner';
import UpperManagementMuteToggle from '../components/UpperManagementMuteToggle';
import { useModuleAccess, moduleForTile, useRawModules, tileEnabled } from '../lib/module-access';

type Tone = 'solid' | 'outline' | 'tint';
type Tile = { label: string; onPress: () => void; tone: Tone };
type Section = { heading: string; color: string; tiles: Tile[] };

export default function AdminHome() {
  const router = useRouter();
  // View-only on the app: action tiles live on fiarep.com.
  const readOnly = useAppReadOnly() === true;
  const actionTiles = new Set(['Send Violation', 'In-house assignments', 'Assign a Job', 'Cover a Site', 'Create Report', '+ New Project', 'Manage Trucks', 'Add Job for Mgmt', 'Assign Route', 'CPM Supervisor Scope Review', 'CPM Supervisor']);
  const navigation = useNavigation();
  useLayoutEffect(() => {
    (async () => {
      let pos = '';
      try { pos = (await getCurrentPosition()) || ''; } catch (e) {}
      const p = pos.trim();
      // Directors/management titles show their exact title in the header bar;
      // a true administrator keeps 'Administrator'.
      const titled = /director$|manager$|superintendent$/i.test(p);
      navigation.setOptions({ title: titled ? p : 'Administrator', headerShown: false });
      setTitle(titled ? p : 'Administrator');
    })();
  }, [navigation]);
  const { refresh } = useAppMode();
  const [unread, setUnread] = useState(0);
  const [title, setTitle] = useState('Administrator');
  // No Inbox tile here: nothing in the system is ever addressed to an
  // administrator or Borough Director on the app (alerts go to the people
  // who act: supervisors, CPMs, HR, Procurement). Dead button removed.
  const modules = useModuleAccess();
  const rawModules = useRawModules();
  // FIAREP's own administrators (Timothy Winn, Emily Winn) also work in the
  // field: they get every technician tool here, and every request inside
  // FIAREP comes to them, so they get an Inbox too.
  const [fiarepAdmin, setFiarepAdmin] = useState(false);
  const [tenant, setTenant] = useState('default');
  // Messaging FIAREP, at the top of the home screen: FIAREP's administrators
  // read their own conversations; a client company on the plan writes to
  // FIAREP Services or the administrator.
  const messagingOpen = useMessagingOpen();
  const clientPlan = tenant !== 'default' && rawModules['fiarepMessaging'] === true;
  const showMessages = messagingOpen === true && (fiarepAdmin || clientPlan) && tileEnabled('admin', 'Messages', rawModules);
  const [position, setPosition] = useState('');
  useFocusEffect(useCallback(() => { (async () => {
    const a = await getCurrentActor(); let c = await unreadCount('administrator'); if (a.name) c += await unreadCount(a.name); if (a.id) c += await unreadCount(a.id).catch(() => 0); setUnread(c);
    setFiarepAdmin(await isFiarepAdministrator().catch(() => false));
    setTenant(((await getSessionIdentity().catch(() => null))?.tenantId) || 'default');
    setPosition((await getCurrentPosition().catch(() => '')) || '');
  })(); }, []));

  async function onSignOut() {
    await logout();
    await clearAppMode();
    refresh();
  }

  const fieldSection: Section[] = fiarepAdmin ? [{
    heading: 'My Work',
    color: '#185FA5',
    tiles: [
      { label: 'My Jobs', onPress: () => router.push('/my-jobs'), tone: 'solid' },
      { label: 'Quick Quote', onPress: () => router.push('/quick-quote'), tone: 'solid' },
      { label: 'Past quotes', onPress: () => router.push('/quick-quote?past=1'), tone: 'outline' },
      { label: 'Price Quote', onPress: () => router.push('/price-quote'), tone: 'solid' },
      { label: 'Projects', onPress: () => router.push('/?list=1'), tone: 'outline' },
      { label: '+ New Project', onPress: () => router.push('/?new=1'), tone: 'solid' },
      { label: 'Log Violations', onPress: () => router.push('/inspector-violations'), tone: 'outline' },
      { label: 'FIAREP Vision (AI)', onPress: () => router.push('/fiarep-vision'), tone: 'outline' },
      { label: 'My Routes', onPress: () => router.push('/inspector-routes'), tone: 'outline' },
      { label: 'My Inspections', onPress: () => router.push('/my-inspections'), tone: 'outline' },
      { label: 'Create Report', onPress: () => router.push('/create-report'), tone: 'outline' },
      ...(hasAnyMeasurementAccess(position, rawModules) ? [
        { label: 'Measurement', onPress: () => router.push('/measurement'), tone: 'outline' as Tone },
        { label: 'Saved Measurements', onPress: () => router.push('/saved-measurements'), tone: 'outline' as Tone },
      ] : []),
      { label: 'Submit Scope', onPress: () => router.push('/scope-submit'), tone: 'solid' },
      { label: 'CPM Supervisor Scope Review', onPress: () => router.push('/scope-review'), tone: 'outline' },
      { label: 'FIAREP Services', onPress: () => router.push('/community-home'), tone: 'outline' },
      { label: 'Change Work Order', onPress: () => router.push('/cpm-change-order'), tone: 'outline' },
      { label: 'Request Time Off', onPress: () => router.push('/leave-request'), tone: 'outline' },
      { label: 'Inbox', onPress: () => router.push('/notifications'), tone: 'solid' },
    ],
  }] : [];

  const sections: Section[] = [
    ...fieldSection,
    {
      heading: 'Inspections & Compliance',
      color: '#1F5C45',
      tiles: [
        { label: 'HUD Inspections', onPress: () => router.push(fiarepAdmin ? '/hud-inspections' : '/hud-review'), tone: 'solid' },
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
        { label: 'Attendance', onPress: () => router.push('/attendance'), tone: 'tint' },
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
        { label: 'Audit Log', onPress: () => router.push('/audit-log'), tone: 'outline' },
        ...(modules['property-lookup'] ? [{ label: '🏢 Check HPD / DOB', onPress: () => router.push('/inspector-violations?lookup=1'), tone: 'outline' as const }] : []),
        ...(modules['translator'] ? [{ label: '🌐 Translator', onPress: () => router.push('/translator'), tone: 'outline' as const }] : []),
        { label: 'Sign out', onPress: onSignOut, tone: 'tint' },
      ],
    },
  ];

  const keep = (t: Tile) => { if (!tileEnabled('admin', t.label, rawModules)) return false; if (readOnly && !fiarepAdmin && actionTiles.has(t.label)) return false; const m = moduleForTile(t.label); return !m || modules[m]; };
  const homeSections = sections.map((sec) => ({ heading: sec.heading, tiles: sec.tiles.filter(keep).filter((t) => t.label !== 'Attendance').map((t) => ({ label: t.label, onPress: t.onPress })) }));
  const hasAttendance = sections.some((sec) => sec.tiles.filter(keep).some((t) => t.label === 'Attendance'));
  const has = (label: string) => sections.some((sec) => sec.tiles.filter(keep).some((t) => t.label === label));
  const tabs = [
    ...(has('Manage All Requests') ? [{ label: 'Requests', icon: 'file-tray-full-outline', onPress: () => router.push('/manage-requests') }] : []),
    ...(has('Resident Reports') ? [{ label: 'Reports', icon: 'document-text-outline', onPress: () => router.push('/management') }] : []),
    ...(has('Audit Log') ? [{ label: 'Audit', icon: 'list-outline', onPress: () => router.push('/audit-log') }] : []),
  ];
  return (
    <FieldHome
      title={title}
      banner={<>{showMessages ? <MessagesBar dark label={fiarepAdmin ? 'Messages' : 'Message FIAREP'} sub={fiarepAdmin ? 'Clients writing to you, and the codes you hand out' : 'FIAREP Services or the administrator'} onPress={() => router.push(fiarepAdmin ? '/fiarep-messages' : '/client-messages')} /> : null}{unread > 0 ? <AlertBanner count={unread} /> : null}{readOnly && !fiarepAdmin ? <ReadOnlyBanner /> : null}<UpperManagementMuteToggle /></>}
      clock={hasAttendance ? { onPress: () => router.push('/attendance'), label: 'Attendance' } : undefined}
      sections={homeSections}
      tabs={tabs}
    />
  );
}
