import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  getNotification, getResidentReport, getBuildingViolation, getProcurementRequest,
  listChangeOrders, listManpowerRequests, getLeaveRequest, getEmergencyJob, getElevatorJob,
  type Notification, type ResidentReport, type BuildingViolation,
} from '../lib/store';
import { syncAllEntities } from '../lib/sync';
import { openWebsiteSignedIn } from '../lib/webHandoff';
import { ui, ACCENT } from '../lib/ui';

// Read-only "open the email" screen for supervisors / management. Everything
// the alert refers to (the complaint, the inspection, the scope, the change
// order ...) is shown in full from the copy already on this device, so it
// reads even with poor service. Acting on it still happens on fiarep.com.

function fmt(iso?: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function words(s?: string): string {
  return String(s || '').replace(/_/g, ' ');
}

type Linked =
  | { kind: 'complaint'; record: ResidentReport }
  | { kind: 'inspection'; record: BuildingViolation }
  | { kind: 'scope'; record: any }
  | { kind: 'change-order'; record: any }
  | { kind: 'trade-request'; record: any }
  | { kind: 'time-off'; record: any }
  | { kind: 'emergency'; record: any }
  | { kind: 'elevator'; record: any }
  | { kind: 'hud'; id: string }
  | { kind: 'project'; id: string }
  | null;

async function findLinked(reportId: string): Promise<Linked> {
  const id = (reportId || '').trim();
  if (!id) return null;
  if (id.startsWith('hud:')) return { kind: 'hud', id: id.slice(4) };
  if (id.startsWith('proj:')) return { kind: 'project', id: id.slice(5) };
  const complaint = await getResidentReport(id).catch(() => null);
  if (complaint) return { kind: 'complaint', record: complaint };
  const inspection = await getBuildingViolation(id).catch(() => null);
  if (inspection) return { kind: 'inspection', record: inspection };
  const scope = await getProcurementRequest(id).catch(() => null);
  if (scope) return { kind: 'scope', record: scope };
  const co = (await listChangeOrders().catch(() => [])).find((c) => c.id === id);
  if (co) return { kind: 'change-order', record: co };
  const mp = (await listManpowerRequests().catch(() => [])).find((m) => m.id === id);
  if (mp) return { kind: 'trade-request', record: mp };
  const leave = await getLeaveRequest(id).catch(() => null);
  if (leave) return { kind: 'time-off', record: leave };
  const em = await getEmergencyJob(id).catch(() => null);
  if (em) return { kind: 'emergency', record: em };
  const el = await getElevatorJob(id).catch(() => null);
  if (el) return { kind: 'elevator', record: el };
  return null;
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) return null;
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={ui.label}>{label}</Text>
      <Text style={{ fontSize: 15, color: '#111' }}>{text}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <View style={ui.card}>
      <Text style={ui.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function Message() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [n, setN] = useState<Notification | null>(null);
  const [linked, setLinked] = useState<Linked>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const note = id ? await getNotification(String(id)).catch(() => null) : null;
      if (!active) return;
      setN(note);
      let found = note?.reportId ? await findLinked(note.reportId) : null;
      if (!found && note?.reportId) {
        // Not on this device yet: pull once if we have service, else read what
        // the alert itself carries and try again later.
        const ok = await syncAllEntities().catch(() => false);
        if (!ok) setOffline(true);
        found = await findLinked(note.reportId);
      }
      if (!active) return;
      setLinked(found);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]);
  useFocusEffect(load);

  if (loading) {
    return <ScrollView contentContainerStyle={ui.wrap}><Text style={ui.empty}>Opening…</Text></ScrollView>;
  }
  if (!n) {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.empty}>This message is no longer in your inbox.</Text>
        <Pressable style={ui.btnOutline} onPress={() => router.back()}><Text style={ui.btnOutlineText}>Back to inbox</Text></Pressable>
      </ScrollView>
    );
  }

  const c = linked?.kind === 'complaint' ? linked.record : null;
  const v = linked?.kind === 'inspection' ? linked.record : null;
  const r: any = linked && 'record' in linked ? linked.record : null;

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <View style={ui.card}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1c3d66' }}>{words(n.message)}</Text>
        {!!n.detail && <Text style={{ fontSize: 15, marginTop: 6 }}>{n.detail}</Text>}
        <Text style={{ color: '#777', marginTop: 8 }}>Received {fmt(n.at)}</Text>
      </View>

      {!linked && !!n.reportId && (
        <View style={{ borderWidth: 1, borderColor: '#f0d9a8', backgroundColor: '#fff8e8', borderRadius: 8, padding: 10 }}>
          <Text style={{ color: '#7a5200', fontSize: 13 }}>
            {offline
              ? 'No service right now. The full details will load the next time this phone is online — pull to open again.'
              : 'The full details are not on this phone yet. Open the message again in a moment.'}
          </Text>
        </View>
      )}

      {c && (
        <Section title={'Complaint' + (c.complaintNo ? ' ' + c.complaintNo : '')}>
          <Row label="Status" value={words(c.reviewStatus === 'done' ? 'completed — awaiting review' : c.status)} />
          <Row label="Development" value={c.development} />
          <Row label="Address" value={[c.address, c.unit ? 'Unit ' + c.unit : ''].filter(Boolean).join('  ')} />
          <Row label="Location" value={c.location} />
          <Row label="Description" value={c.description} />
          <Row label="Reported by" value={[c.residentName, c.contact].filter(Boolean).join(' · ')} />
          <Row label="Submitted" value={fmt(c.createdAt)} />
          <Row label="Assigned to" value={c.assignedTo} />
          <Row label="Arrived" value={fmt(c.arrivalAt)} />
          <Row label="Completed" value={[c.completedBy, fmt(c.completedAt)].filter(Boolean).join(' · ')} />
          <Row label="Completion note" value={c.completionNote} />
          <Row label="Sent back" value={[c.reworkByStaffName, fmt(c.reworkAt), c.reworkNote].filter(Boolean).join(' · ')} />
          <Row label="Resolved" value={fmt(c.resolvedAt)} />
          <Row label="Photos" value={(c.photos?.length || 0) + (c.completionPhotos?.length || 0) ? `${(c.photos?.length || 0) + (c.completionPhotos?.length || 0)} attached — open the complaint below to view` : ''} />
          {!!(c.updates && c.updates.length) && (
            <View style={{ marginTop: 6 }}>
              <Text style={ui.label}>History</Text>
              {c.updates.map((u, i) => (
                <Text key={i} style={{ fontSize: 14, color: '#333', marginBottom: 4 }}>
                  {fmt(u.at)} — {words(u.status)}{u.by ? ' by ' + u.by : ''}{u.note ? ': ' + u.note : ''}
                </Text>
              ))}
            </View>
          )}
          <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={() => router.push('/report-detail?id=' + encodeURIComponent(c.id))}>
            <Text style={ui.btnOutlineText}>Open the complaint (photos)</Text>
          </Pressable>
        </Section>
      )}

      {v && (
        <Section title={'Inspection' + (v.violationNo ? ' ' + v.violationNo : '')}>
          <Row label="Status" value={words(v.status || 'logged')} />
          <Row label="Development" value={v.development} />
          <Row label="Building" value={v.building} />
          <Row label="Code" value={[v.code, v.codeDesc].filter(Boolean).join(' — ')} />
          <Row label="Hazard class" value={v.hazardClass} />
          <Row label="Inspector's notes" value={v.notes} />
          <Row label="Logged by" value={[v.loggedBy, fmt(v.loggedAt)].filter(Boolean).join(' · ')} />
          <Row label="Approved by" value={[v.approvedBy, fmt(v.approvedAt)].filter(Boolean).join(' · ')} />
          <Row label="Sent to" value={[v.routedTo || v.handoffTargetName, v.routedToPosition, fmt(v.routedAt)].filter(Boolean).join(' · ')} />
          <Row label="Completed" value={[v.completedBy, fmt(v.completedAt)].filter(Boolean).join(' · ')} />
          <Row label="Completion note" value={v.completionNote} />
          <Row label="Denied" value={[(v as any).deniedByName, fmt((v as any).deniedAt), (v as any).denyReason].filter(Boolean).join(' · ')} />
          <Row label="Photos" value={(v.photos?.length || 0) + (v.completionPhotos?.length || 0) ? `${(v.photos?.length || 0) + (v.completionPhotos?.length || 0)} attached` : ''} />
          <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={() => router.push('/inspection-approvals')}>
            <Text style={ui.btnOutlineText}>Open Inspection Approvals</Text>
          </Pressable>
        </Section>
      )}

      {linked?.kind === 'scope' && r && (
        <Section title={'Scope' + (r.trackingId ? ' ' + r.trackingId : '')}>
          <Row label="Status" value={words(r.status)} />
          <Row label="Development" value={r.development} />
          <Row label="Address" value={r.address} />
          <Row label="Scope of work" value={r.scope} />
          <Row label="CPM notes" value={r.cpmNotes} />
          <Row label="Requested by" value={[r.requestedBy, fmt(r.requestedAt)].filter(Boolean).join(' · ')} />
          <Row label="Approved by" value={[r.approvedBy, fmt(r.approvedAt)].filter(Boolean).join(' · ')} />
          <Row label="Returned" value={[fmt(r.returnedAt), r.returnNote].filter(Boolean).join(' · ')} />
          <Row label="Review note" value={r.reviewNote} />
          <Row label="Vendor" value={[r.vendor, r.vendorNote].filter(Boolean).join(' · ')} />
        </Section>
      )}

      {linked?.kind === 'change-order' && r && (
        <Section title="Change work order">
          <Row label="Status" value={words(r.status)} />
          <Row label="Job" value={r.reportRef} />
          <Row label="Description" value={r.description} />
          <Row label="Cost" value={r.isWorkerCO ? '' : '$' + Number(r.cost || 0).toFixed(2)} />
          <Row label="Written by" value={[r.createdByName, fmt(r.createdAt)].filter(Boolean).join(' · ')} />
          <Row label="For" value={r.targetName || r.targetPosition} />
          <Row label="Reviewed by" value={[r.respondedByName, fmt(r.respondedAt)].filter(Boolean).join(' · ')} />
          <Row label="Reason" value={r.reason} />
        </Section>
      )}

      {linked?.kind === 'trade-request' && r && (
        <Section title="Trade request">
          <Row label="Status" value={words(r.status)} />
          <Row label="Trade" value={r.requestedTrade} />
          <Row label="Development" value={r.development} />
          <Row label="For" value={r.sourceTitle} />
          <Row label="Assigned to" value={r.assignedTo} />
          <Row label="Note" value={r.note || r.notes} />
        </Section>
      )}

      {linked?.kind === 'time-off' && r && (
        <Section title="Time-off request">
          <Row label="Status" value={words(r.status)} />
          <Row label="Staff" value={[r.employee, r.title].filter(Boolean).join(' · ')} />
          <Row label="Development" value={r.development} />
          <Row label="Type" value={words(r.type)} />
          <Row label="From" value={r.startDate} />
          <Row label="To" value={r.endDate} />
          <Row label="Days" value={r.days ? String(r.days) + (r.hours ? ` (${r.hours}h)` : '') : ''} />
          <Row label="Reason" value={r.reason} />
        </Section>
      )}

      {(linked?.kind === 'emergency' || linked?.kind === 'elevator') && r && (
        <Section title={linked.kind === 'emergency' ? 'Emergency job' : 'Elevator job'}>
          <Row label="Status" value={words(r.status)} />
          <Row label="Development" value={r.development} />
          <Row label="Address" value={[r.address || r.building, r.unit ? 'Unit ' + r.unit : ''].filter(Boolean).join('  ')} />
          <Row label="Description" value={r.description || r.issue || r.notes} />
          <Row label="Assigned to" value={r.assignedTo || r.mechanic || r.unitName} />
          <Row label="Created" value={fmt(r.createdAt)} />
        </Section>
      )}

      {linked?.kind === 'hud' && (
        <Pressable style={ui.btnOutline} onPress={() => router.push('/hud-view?id=' + linked.id)}>
          <Text style={ui.btnOutlineText}>Open the HUD inspection</Text>
        </Pressable>
      )}
      {linked?.kind === 'project' && (
        <Pressable style={ui.btnOutline} onPress={() => router.push('/project/' + linked.id)}>
          <Text style={ui.btnOutlineText}>Open the project</Text>
        </Pressable>
      )}

      <View style={{ borderWidth: 1, borderColor: '#c9d7ea', backgroundColor: '#eef4fb', borderRadius: 8, padding: 10 }}>
        <Text style={{ color: '#1c3d66', fontSize: 13 }}>Reading only. To assign, send, approve or reply, use fiarep.com.</Text>
        <Pressable onPress={() => { openWebsiteSignedIn().catch(() => undefined); }}>
          <Text style={{ color: ACCENT, fontWeight: '700', marginTop: 4 }}>Open fiarep.com (signed in)</Text>
        </Pressable>
      </View>
      <Pressable style={ui.btnOutline} onPress={() => router.back()}>
        <Text style={ui.btnOutlineText}>Back to inbox</Text>
      </Pressable>
    </ScrollView>
  );
}
