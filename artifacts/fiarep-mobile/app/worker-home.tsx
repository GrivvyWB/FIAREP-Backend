import FieldHome from '../components/FieldHome';
import { useRouter } from 'expo-router';
import { clearAppMode, logout } from '../lib/store';
import { useAppMode } from './_layout';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  developmentsForStaff,
  getCurrentActor,
  getCurrentPosition,
  listResidentReports,
  listRoutedInspectionsFor,
  displayStaffPosition,
  listManpowerRequests,
} from '../lib/store';
import { useModuleAccess, useRawModules, tileEnabled, personTileOn } from '../lib/module-access';
import { useMessagingOpen } from '../lib/fiarep-messaging';
import { getSessionIdentity as getIdentityForMessages } from '../lib/store';
import { hasAnyMeasurementAccess, tradeKeyForPosition } from '../lib/measurement-access';
import { catalogForTrade } from '../lib/trade-catalogs';

// A staff member can start a construction-PM project when the org has the
// Projects module enabled (controlled from Platform -> Module Management) AND
// their position is one the company assigns to project work. CPM is the
// primary one; construction/PM supervisor positions also qualify.
const PROJECT_POSITIONS = new Set([
  'CPM',
  'CONSTRUCTION PROJECT MANAGER',
  'PROJECT MANAGER',
  'CONSTRUCTION SUPERVISOR',
  'CPM SUPERVISOR',
]);
function canStartProject(position: string): boolean {
  return PROJECT_POSITIONS.has((position || '').trim().toUpperCase());
}

export default function WorkerHome() {
  const router = useRouter();
  const { refresh } = useAppMode();
  const modules = useModuleAccess();
  const rawModules = useRawModules();
  const [jobCount, setJobCount] = useState(0);
  const messagingOpen = useMessagingOpen();
  const [msgTenant, setMsgTenant] = useState('default');
  useFocusEffect(useCallback(() => { getIdentityForMessages().then((i) => setMsgTenant(i?.tenantId || 'default')).catch(() => undefined); }, []));
  const [position, setPosition] = useState('');
  const [isEmergencyMaintenance, setIsEmergencyMaintenance] = useState(false);
  const isTradeWorker = /^(plumber|electrician|electric|elevator service|painter|carpenter|roofer|heating service|heat plant|bricklayer|brick layer|mason|general construction|cctv installation)$/.test((position || '').trim().toLowerCase());
  useFocusEffect(useCallback(() => {
    void (async () => {
      const actor = await getCurrentActor();
      const currentPosition = await getCurrentPosition().catch(() => '');
      setPosition(currentPosition);
      // Any emergency-role member gets the Emergency Units tools, regardless of
      // their position title (some are 'Maintenance Worker', others are not).
      setIsEmergencyMaintenance(actor.role === 'emergency');
      if (actor.name && actor.id) {
        const developments = (await developmentsForStaff(actor.name).catch(() => []))
          .map((development) => development.trim().toLowerCase())
          .filter(Boolean);
        const inAssignedDevelopment = (development?: string) => {
          const value = (development || '').trim().toLowerCase();
          return !value || developments.length === 0 || developments.includes(value);
        };
        const [repairs, reports, inHouse] = await Promise.all([
          listRoutedInspectionsFor(actor.name, actor.id),
          listResidentReports(),
          listManpowerRequests(),
        ]);
        // Only work still waiting on this worker. Completed ('done' ->
        // 'completed'), approved and resolved complaints drop off the badge;
        // a sent-back complaint returns to in_progress and counts again.
        const residentJobs = reports.filter((report) =>
          (report.status === 'assigned' || report.status === 'in_progress') &&
          report.assignedStaffId === actor.id &&
          inAssignedDevelopment(report.development)
        );
        const manpowerJobs = inHouse.filter((job) => job.assignedStaffId === actor.id && ['dispatched', 'in_progress'].includes(job.status) && inAssignedDevelopment(job.development));
        setJobCount(repairs.length + residentJobs.length + manpowerJobs.length);
      } else {
        setJobCount(0);
      }
    })();
  }, []));

  async function onSignOut() {
    await logout();
    await clearAppMode();
    refresh();
  }

  const title = position === 'Elevator Service' ? 'Elevator Mechanic' : displayStaffPosition(position);
  const on = (label: string) => tileEnabled('worker', label, rawModules);
  const measurementOk = hasAnyMeasurementAccess(position, rawModules) || (modules['measurement'] && !!catalogForTrade(tradeKeyForPosition(position)));
  const sections = [
    {
      heading: 'Jobs',
      tiles: [
        ...(modules['proj-new'] && canStartProject(position) && on('+ New Project') ? [{ label: '+ New Project', onPress: () => router.push('/?new=1') }] : []),
        ...(position === 'Elevator Service' && on('Elevator Jobs') ? [{ label: 'Elevator Jobs', onPress: () => router.push('/elevator-jobs') }] : []),
        ...(isEmergencyMaintenance && on('Emergency Units') ? [{ label: 'Emergency Units', onPress: () => router.push('/emergency-units') }] : []),
        ...(on('Door Visit') ? [{ label: 'Door Visit', onPress: () => router.push('/door-visit') }] : []),
        ...(on('Building Check-In') ? [{ label: 'Building Check-In', onPress: () => router.push('/site-checkin') }] : []),
        ...(on('Smart Repair') ? [{ label: 'Smart Repair', onPress: () => router.push('/smart-repair') }] : []),
        ...(on('Change Work Order') ? [{ label: 'Change Work Order', onPress: () => router.push('/worker-change-order') }] : []),
        ...(on('Request Time Off') ? [{ label: 'Request Time Off', onPress: () => router.push('/leave-request') }] : []),
      ],
    },
    {
      heading: 'Scope',
      tiles: measurementOk ? [
        ...(on('Measurement') ? [{ label: 'Measurement', onPress: () => router.push('/measurement') }] : []),
        ...(on('Saved Measurements') ? [{ label: 'Saved Measurements', onPress: () => router.push('/saved-measurements') }] : []),
      ] : [],
    },
    {
      heading: 'System',
      tiles: [
        ...(on('Inbox') ? [{ label: 'Inbox', onPress: () => router.push('/notifications') }] : []),
        ...(on('Messages') && messagingOpen === true && (msgTenant === 'default' || rawModules['fiarepMessaging'] !== false) ? [{ label: 'Messages', onPress: () => router.push('/client-messages?member=1') }] : []),
        ...(!isTradeWorker && on('Check Report Status') ? [{ label: 'Check Report Status', onPress: () => router.push('/resident-lookup') }] : []),
        ...(modules['property-lookup'] && on('Check HPD / DOB') ? [{ label: 'Check HPD / DOB', onPress: () => router.push('/inspector-violations?lookup=1') }] : []),
        ...((modules['translator'] || personTileOn('worker', 'Translator', rawModules)) && on('Translator') ? [{ label: 'Translator', onPress: () => router.push('/translator') }] : []),
        { label: 'Sign out', onPress: onSignOut },
      ],
    },
  ];
  const tabs = [
    ...(on('My Jobs') ? [{ label: 'My Work', icon: 'clipboard-outline', onPress: () => router.push('/my-jobs') }] : []),
    ...(on('Inbox') ? [{ label: 'Inbox', icon: 'mail-outline', onPress: () => router.push('/notifications') }] : []),
    ...(on('Request Time Off') ? [{ label: 'Time Off', icon: 'time-outline', onPress: () => router.push('/leave-request') }] : []),
  ];

  return (
    <FieldHome
      title={title}
      hero={on('My Jobs') ? { label: 'My Jobs', onPress: () => router.push('/my-jobs'), badge: jobCount } : undefined}
      clock={on('Attendance') ? { onPress: () => router.push('/attendance'), label: 'Attendance' } : undefined}
      sections={sections}
      tabs={tabs}
    />
  );
}
