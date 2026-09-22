import { Text, Pressable, ScrollView } from 'react-native';
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
import { ui } from '../lib/ui';

export default function WorkerHome() {
  const router = useRouter();
  const { refresh } = useAppMode();
  const [jobCount, setJobCount] = useState(0);
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
          listRoutedInspectionsFor(actor.name),
          listResidentReports(),
          listManpowerRequests(),
        ]);
        const residentJobs = reports.filter((report) =>
          report.status !== 'resolved' &&
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

  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 40 }]}>
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>{position === 'Elevator Service' ? 'Elevator Mechanic' : displayStaffPosition(position || 'Worker')}</Text>
      <Text style={[ui.label, { textAlign: 'center', marginBottom: 24 }]}>
        View your assigned jobs and check report status.
      </Text>

      <Pressable style={ui.btn} onPress={() => router.push('/my-jobs')}>
        <Text style={ui.btnText}>My Jobs{jobCount > 0 ? ' (' + jobCount + ')' : ''}</Text>
      </Pressable>
      {(position || '').trim().toUpperCase() === 'CPM' && (
        <Pressable style={ui.btn} onPress={() => router.push('/?new=1')}>
          <Text style={ui.btnText}>+ New Project</Text>
        </Pressable>
      )}
      {position === 'Elevator Service' && (
        <Pressable style={ui.btn} onPress={() => router.push('/elevator-jobs')}>
          <Text style={ui.btnText}>Elevator Jobs</Text>
        </Pressable>
      )}
      <Pressable style={ui.btnOutline} onPress={() => router.push('/notifications')}>
        <Text style={ui.btnOutlineText}>Inbox</Text>
      </Pressable>
      {isEmergencyMaintenance && (
        <Pressable style={ui.btnOutline} onPress={() => router.push('/emergency-units')}>
          <Text style={ui.btnOutlineText}>Emergency Units</Text>
        </Pressable>
      )}
      <Pressable style={ui.btnOutline} onPress={() => router.push('/attendance')}>
        <Text style={ui.btnOutlineText}>Attendance</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={() => router.push('/worker-change-order')}>
        <Text style={ui.btnOutlineText}>Change Work Order</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={() => router.push('/leave-request')}>
        <Text style={ui.btnOutlineText}>Request Time Off</Text>
      </Pressable>
      {!isTradeWorker && <Pressable style={ui.btnOutline} onPress={() => router.push('/resident-lookup')}>
        <Text style={ui.btnOutlineText}>Check Report Status</Text>
      </Pressable>}

      <Pressable style={[ui.btnOutline, { marginTop: 24 }]} onPress={onSignOut}>
        <Text style={ui.btnOutlineText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
