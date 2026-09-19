import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getCurrentActor, listNotifications, markNotificationRead, findReportByRef, getResidentReport, outstandingPriorityFor, acknowledgePriorityViolation, getViolationLookup, getBuildingViolation, getCurrentPosition, deleteNotification, type Notification, type PriorityViolation, listElevatorJobsForMechanic } from '../lib/store';
import { syncAllEntities } from '../lib/sync';
import { Alert } from 'react-native';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';
import { clearBadge } from '../lib/push';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function Notifications() {
  const { mode } = useAppMode();
  const [position, setPosition] = useState('');
  const router = useRouter();
  async function openFor(n: Notification) {
    const msg = (n.message || '').toLowerCase();
    if (msg.includes('new resident report') && n.reportId) {
      let report = await getResidentReport(n.reportId);
      if (!report) {
        await syncAllEntities().catch(() => undefined);
        report = await getResidentReport(n.reportId);
      }
      if (report) {
        await markNotificationRead(n.id);
        router.push('/report-detail?id=' + encodeURIComponent(report.id));
      } else {
        Alert.alert('Report unavailable', 'This report is not assigned to one of your developments.');
      }
      return;
    }
    await markNotificationRead(n.id);
    if (n.reportId && n.reportId.startsWith('hud:')) { router.push('/hud-view?id=' + n.reportId.slice(4)); return; }
    if (n.reportId && n.reportId.startsWith('proj:')) { router.push('/project/' + n.reportId.slice(5)); return; }
    // Scope-flow notifications carry the procurement id (no prefix).
    // Route supervisor/CPM actions without exposing the procurement worker UI.
    if (msg.includes('approved inspection') || msg.includes('work assignment') || msg.includes('build scope')) {
      const bv = n.reportId ? await getBuildingViolation(n.reportId) : null;
      const addr = bv ? String(bv.building || '') : '';
      const seed = bv ? [bv.violationNo ? ('Violation ' + bv.violationNo) : '', bv.code ? ('Code ' + bv.code) : '', bv.notes || ''].filter(Boolean).join(' \u2014 ') : '';
      const body = bv
        ? 'Violation: ' + (bv.violationNo || '') + '\nAddress: ' + addr + '  (Class ' + bv.hazardClass + ')' + (bv.notes ? '\nNote: ' + bv.notes : '')
        : (n.detail || 'No further details.');
      const isCpm = (position || '').trim().toLowerCase() === 'cpm';
      const buttons: any[] = [{ text: 'Close', style: 'cancel' }];
      // CPM builds a scope from the approved inspection (pre-filled). A trade
      // just reads the assignment detail and does the work.
      if (isCpm) buttons.push({ text: 'Build scope', onPress: () => router.push('/scope-submit?preAddress=' + encodeURIComponent(addr) + '&preScope=' + encodeURIComponent(seed)) });
      else buttons.push({ text: 'Open in My Jobs', onPress: () => router.push('/my-jobs') });
      Alert.alert(n.message, body, buttons);
      return;
    }
    if (msg.includes('violation to look up')) {
      const v = n.reportId ? await getViolationLookup(n.reportId) : null;
      const address = v ? v.address : '';
      const unit = v?.unit || '';
      const addr = address + (unit ? '  Unit ' + unit : '');
      const body = v
        ? 'Violation: ' + v.violationNumber + '\nAddress: ' + addr + (v.note ? '\nNote: ' + v.note : '')
        : (n.detail || 'No further details.');
      const scopeSeed = v ? (v.note ? v.note : '') : '';
      // Fetch position fresh at tap time (the state may not have loaded yet).
      let pos = (position || '').trim().toLowerCase();
      if (!pos) { try { pos = ((await getCurrentPosition()) || '').trim().toLowerCase(); } catch (e) {} }
      const isCpm = pos === 'cpm';



      const buttons: any[] = [{ text: 'Close', style: 'cancel' }];
      if (isCpm) {
        buttons.push({ text: 'Create scope', onPress: () => router.push('/scope-submit?preAddress=' + encodeURIComponent(addr) + '&preScope=' + encodeURIComponent(scopeSeed)) });
        buttons.push({ text: 'View DOB / HPD', onPress: () => router.push('/inspector-violations?preBuilding=' + encodeURIComponent(address) + '&preUnit=' + encodeURIComponent(unit) + '&preViolationNo=' + encodeURIComponent(v ? v.violationNumber : '') + '&preNote=' + encodeURIComponent(v && v.note ? v.note : '')) });
      }
      // Inspectors log the violation (code + A/B/C class).
      if (pos === 'inspector' || pos === '') {
        buttons.push({ text: 'View DOB / HPD', onPress: () => router.push('/inspector-violations?preBuilding=' + encodeURIComponent(address) + '&preUnit=' + encodeURIComponent(unit) + '&preViolationNo=' + encodeURIComponent(v ? v.violationNumber : '') + '&preNote=' + encodeURIComponent(v && v.note ? v.note : '')) });
      }
      // Elevator mechanic: open Elevator Services keyed to their elevator job.
      if (pos === 'elevator service') {
        const act = await getCurrentActor();
        const jobs = await listElevatorJobsForMechanic((act && act.name) || '', act?.id).catch(() => []);
        const match = jobs.find((j) => (j.address || '').trim().toLowerCase() === (v ? (v.address || '') : '').trim().toLowerCase()) || jobs[0];
        if (match) buttons.push({ text: 'Open Elevator Services', onPress: () => router.push('/project/elevator?projectId=' + encodeURIComponent(match.id)) });
      }
      // ANYONE sent a complaint (except a CPM building a scope) can take a photo
      // of the condition with FIAREP Vision — workers, inspectors, elevator, etc.
      if (!isCpm) {
        buttons.push({ text: 'FIAREP Vision', onPress: () => router.push('/fiarep-vision?preBuilding=' + encodeURIComponent(addr)) });
      }
      Alert.alert(n.message, body, buttons);
      return;
    }
    if (msg === 'leave request' || msg.includes('leave requests') || msg.startsWith('leave ')) {
      if (mode === 'management' || mode === 'administrator') {
        router.push('/leave-dashboard');
      } else {
        router.push('/leave-request');
      }
      return;
    }
    if (msg.includes('returned for revision')) { router.push('/scope-submit' + (n.reportId ? '?openId=' + n.reportId : '')); return; }
    if (msg.includes('scope') || msg.includes('bid') || msg.includes('procurement') || msg.includes('vendor') || msg.includes('won') || msg.includes('job closed') || msg.includes('job open')) {
      if (mode === 'vendor') { router.push('/vendor-home'); return; }
      if (msg.includes('scope')) { router.push('/scope-submit'); return; }
      if (msg.includes('bid') && n.reportId) { router.push('/scope-review?id=' + encodeURIComponent(n.reportId)); return; }
      return;
    }
    if (msg.includes('repair complete')) {
      const bv = n.reportId ? await getBuildingViolation(n.reportId) : null;
      if (bv) {
        const nphotos = (bv.completionPhotos && bv.completionPhotos.length) ? bv.completionPhotos.length : 0;
        const body = 'Violation: ' + (bv.violationNo || '') + '\nAddress: ' + (bv.building || '') + '  (Class ' + bv.hazardClass + ')'
          + '\nCompleted by: ' + (bv.completedBy || '') + (bv.completedAt ? '  ' + fmt(bv.completedAt) : '')
          + (bv.completionNote ? '\nNote: ' + bv.completionNote : '')
          + (nphotos ? '\nPhotos attached: ' + nphotos : '');
        Alert.alert('Repair complete', body, [{ text: 'Close', style: 'cancel' }]);
      } else {
        Alert.alert('Repair complete', n.detail || 'No further details.', [{ text: 'Close', style: 'cancel' }]);
      }
      return;
    }
    if (msg.includes('inspection logged') || msg.includes('awaiting approval') || msg.includes('awaiting review')) { router.push('/inspection-approvals'); return; }
    if (msg.includes('change work order') || msg.includes('change order')) { router.push('/change-orders'); return; }
    if (msg.includes('elevator update') || msg.includes('elevator job')) { router.push('/elevator-dashboard'); return; }
    if (msg.includes('emergency update') || msg.includes('emergency job') || msg.includes('emergency unit')) { router.push('/emergency-units'); return; }
    if (msg.includes('new job assigned')) { router.push('/my-jobs'); return; }
    if (msg.includes('new route assigned')) { router.push('/worker'); return; }
    if (n.reportId) { router.push('/report-detail?id=' + n.reportId); return; }
    // Fallback for older notifications without a stored reportId: match by detail text.
    if (msg.includes('report') || msg.includes('job')) {
      const r = await findReportByRef(n.detail || '');
      if (r) { router.push('/report-detail?id=' + r.id); return; }
    }
    if (mode === 'worker' || mode === 'inspector') { router.push('/worker'); return; }
    if (mode === 'management' || mode === 'administrator') { router.push('/management'); return; }
  }
  const [items, setItems] = useState<Notification[]>([]);
  const [priority, setPriority] = useState<PriorityViolation[]>([]);
  const [myName, setMyName] = useState('');

  const load = useCallback(() => {
    (async () => {
      const actor = await getCurrentActor();
      try { setPosition(await getCurrentPosition()); } catch (e) { setPosition(''); }
      const targets: string[] = [];
      if (mode) targets.push(mode);
      if (actor.id) targets.push(actor.id);
      if (actor.name) targets.push(actor.name);
      const seen: Record<string, boolean> = {};
      const seenWork: Record<string, boolean> = {};
      const all: Notification[] = [];
      for (const t of targets) {
        const list = await listNotifications(t);
        for (const n of list) {
          if (seen[n.id]) continue;
          seen[n.id] = true;
          const workKey = `${(n.message || '').trim().toLowerCase()}|${(n.reportId || n.detail || '').trim().toLowerCase()}`;
          if (seenWork[workKey]) continue;
          seenWork[workKey] = true;
          all.push(n);
        }
      }
      all.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
      setItems(all);
      await clearBadge();
      setMyName(actor.name || '');
      // Priority items are a supervisor concern. A supervisor viewing as a
      // worker should see the worker inbox, not the pinned red card.
      const supervisorView = mode === 'management' || mode === 'administrator';
      try {
        setPriority(supervisorView ? await outstandingPriorityFor(actor.name || '') : []);
      } catch (e) {
        setPriority([]);
      }
    })();
  }, [mode]);
  useFocusEffect(load);

  function daysSince(iso: string): number {
    try { return (Date.now() - new Date(iso).getTime()) / 86400000; } catch { return 0; }
  }
  // Escalation by age of an UNANSWERED job (independent of read-state): 2 = urgent (>=5d), 1 = red (>=3d), 0 = normal.
  // Opening a card marks it read but does not mean the job was actioned, so read-state must NOT clear the alert.
  function escalation(n: Notification): number {
    const message = (n.message || '').toLowerCase();
    // Operational alerts must be red immediately; age-based escalation is only
    // for ordinary unread work.
    if (/emergency|priority|new resident report|new job assigned|elevator down/.test(message)) return 2;
    if (message.includes('returned for revision')) return 1;
    const d = daysSince(n.at);
    if (d >= 5) return 2;
    if (d >= 3) return 1;
    return 0;
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={ui.h}>Inbox</Text>
        <Pressable onPress={() => router.back()} style={{ padding: 8 }}>
          <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      {priority.map((v) => (
        <View
          key={v.id}
          style={[ui.card, { gap: 6, borderColor: '#c0392b', borderWidth: 2, backgroundColor: '#fdecea' }]}
        >
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#c0392b', letterSpacing: 1 }}>
            PRIORITY — NOT PICKED UP
          </Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#c0392b' }}>{v.finding}</Text>
          <Text style={{ fontSize: 14, color: '#333' }}>
            {v.address}{v.unit ? '  Unit ' + v.unit : ''}
          </Text>
          {!!v.development && <Text style={{ fontSize: 13, color: '#666' }}>{v.development}</Text>}
          <Text style={{ fontSize: 12, color: '#666' }}>
            Raised by {v.raisedBy || 'unknown'}  {fmt(v.raisedAt)}
          </Text>
          {v.unrouted && (
            <Text style={{ fontSize: 12, color: '#c0392b' }}>
              No supervisor was assigned to this development.
            </Text>
          )}
          <Pressable
            style={[ui.btn, { backgroundColor: '#c0392b' }]}
            onPress={() => {
              Alert.alert(
                'Pick up this priority item?',
                v.finding + '\n\nThis records that you have taken responsibility for it.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Pick up',
                    onPress: async () => {
                      await acknowledgePriorityViolation(v.id, myName);
                      load();
                    },
                  },
                ]
              );
            }}
          >
            <Text style={ui.btnText}>Pick up</Text>
          </Pressable>
        </View>
      ))}

      {items.length === 0 && priority.length === 0 && <Text style={ui.empty}>No notifications.</Text>}
      {items.map((n) => {
        const esc = escalation(n);
        const urgent = esc === 2;
        const redText = esc >= 1;
        return (
          <Pressable
            key={n.id}
            style={[ui.card, { gap: 4 }, urgent && { borderColor: '#c0392b', borderWidth: 2, backgroundColor: '#fdecea' }]}
            onPress={() => openFor(n)}
            onLongPress={() => {
              // Only management/admin can delete notifications. Everyone else
              // (workers, trades, inspectors, CPMs, procurement, vendors) cannot.
              if (mode !== 'management' && mode !== 'administrator') {
                Alert.alert('Can\'t remove this', 'Only management can clear notifications.');
                return;
              }
              Alert.alert('Delete notification?', n.message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteNotification(n.id); load(); } }]);
            }}
          >
            {urgent && <Text style={{ fontSize: 12, fontWeight: '800', color: '#c0392b', letterSpacing: 1 }}>URGENT REQUEST</Text>}
            <Text style={{ fontSize: 15, fontWeight: '600', color: redText ? '#c0392b' : ACCENT }}>{n.message}</Text>
            {!!n.detail && <Text style={{ fontSize: 14, color: redText ? '#c0392b' : '#333' }}>{n.detail}</Text>}
            <Text style={{ fontSize: 12, color: redText ? '#c0392b' : '#999' }}>{fmt(n.at)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
