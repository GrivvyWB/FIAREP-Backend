import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAppMode } from './_layout';
import { getResidentReport, type ResidentReport, getCurrentPosition, getCurrentActor, listElevatorJobsForMechanic, listResidentReportPhotoUrls } from '../lib/store';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';
import { syncAllEntities } from '../lib/sync';

const STATUS_LABEL: Record<ResidentReport['status'], string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { mode } = useAppMode();
  const [position, setPosition] = useState('');
  useFocusEffect(useCallback(() => { getCurrentPosition().then(setPosition).catch(() => {}); }, []));
  const [r, setR] = useState<ResidentReport | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [remotePhotoUris, setRemotePhotoUris] = useState<string[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        let report = await getResidentReport(String(id));
        if (!report) {
          await syncAllEntities().catch(() => undefined);
          report = await getResidentReport(String(id));
        }
        if (!active) return;
        setR(report);
        setRemotePhotoUris([]);
        setPhotosError(false);
        if (!report) return;
        setPhotosLoading(true);
        try {
          // Resident report photos must use the report-scoped authorized endpoint.
          const urls = await listResidentReportPhotoUrls(String(id));
          if (active) setRemotePhotoUris(urls);
        } catch {
          if (active) setPhotosError(true);
        } finally {
          if (active) setPhotosLoading(false);
        }
      } catch {
        if (active) setR(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);
  useFocusEffect(load);

  if (loading) {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.empty}>Loading report…</Text>
      </ScrollView>
    );
  }

  if (!r) {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.empty}>Report not found.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={ui.h}>Job Details</Text>
        <Pressable onPress={() => router.back()} style={{ padding: 8 }}><Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>Done</Text></Pressable>
      </View>

      <View style={[ui.card, { gap: 8 }]}>
        {!!r.complaintNo && <View style={ui.line}><Text style={ui.lineK}>Complaint #</Text><Text style={[ui.lineV, { color: ACCENT, fontWeight: '700' }]}>{r.complaintNo}</Text></View>}
        <View style={ui.line}><Text style={ui.lineK}>Resident</Text><Text style={ui.lineV}>{r.residentName || 'Anonymous'}</Text></View>
        {!!r.contact && <View style={ui.line}><Text style={ui.lineK}>Contact</Text><Text style={ui.lineV}>{r.contact}</Text></View>}
        {!!r.location && <View style={ui.line}><Text style={ui.lineK}>Location</Text><Text style={ui.lineV}>{r.location}</Text></View>}
        <View style={ui.line}><Text style={ui.lineK}>Unit</Text><Text style={ui.lineV}>{r.unit || '—'}</Text></View>
        <View style={ui.line}><Text style={ui.lineK}>Address</Text><Text style={ui.lineV}>{r.address || '—'}</Text></View>
        <View style={ui.line}><Text style={ui.lineK}>Development</Text><Text style={ui.lineV}>{r.development || 'Untagged'}</Text></View>
        <View style={ui.line}><Text style={ui.lineK}>Status</Text><Text style={[ui.lineV, { color: ACCENT }]}>{STATUS_LABEL[r.status]}</Text></View>
        {!!r.assignedTo && <View style={ui.line}><Text style={ui.lineK}>Assigned to</Text><Text style={ui.lineV}>{r.assignedTo}</Text></View>}
        <View style={{ paddingVertical: 4 }}>
          <Text style={ui.label}>Issue</Text>
          <Text>{r.description}</Text>
        </View>
        <Text style={ui.listSub}>Submitted {fmt(r.createdAt)}</Text>
        {(mode === 'management' || mode === 'administrator') && r.status !== 'resolved' && (() => {
          const base = 'preAddress=' + encodeURIComponent(r.address || '')
            + '&preUnit=' + encodeURIComponent(r.unit || '')
            + '&preNote=' + encodeURIComponent(r.description || '')
            + '&preComplaintNo=' + encodeURIComponent(r.complaintNo || '')
            + '&preResident=' + encodeURIComponent(r.residentName || '')
            + '&preDevelopment=' + encodeURIComponent(r.development || '');
          return (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => router.push('/violation-send?' + base + '&filter=worker')}>
                <Text style={ui.btnText}>Send as Complaint</Text>
              </Pressable>
              <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => router.push('/violation-send?' + base + '&filter=inspector')}>
                <Text style={ui.btnText}>Send as Inspection</Text>
              </Pressable>
            </View>
          );
        })()}
        {(position === 'Inspector' || position === 'CPM') && (
          <Pressable
            style={[ui.btn, { marginTop: 10 }]}
            onPress={() => router.push('/inspector-violations?preBuilding=' + encodeURIComponent(r.address || '')
              + '&preUnit=' + encodeURIComponent(r.unit || '')
              + '&preViolationNo=' + encodeURIComponent(r.complaintNo || '')
              + '&preNote=' + encodeURIComponent((r.description || '') + (r.residentName ? '  \u2014 ' + r.residentName : '')))}
          >
            <Text style={ui.btnText}>View DOB / HPD for this address</Text>
          </Pressable>
        )}
        {position === 'Elevator Service' && (
          <Pressable
            style={[ui.btn, { marginTop: 10 }]}
            onPress={async () => {
              const act = await getCurrentActor();
              const me = (act && act.name) || '';
              const jobs = await listElevatorJobsForMechanic(me, act?.id).catch(() => []);
              let match = jobs.find((j) => (j.address || '').trim().toLowerCase() === (r.address || '').trim().toLowerCase());
              if (match) {
                router.push('/project/elevator?projectId=' + encodeURIComponent(match.id));
              } else {
                Alert.alert(
                  'Elevator job not dispatched',
                  'This report has no supervisor-dispatched elevator job. Authorized management must assign the job before Elevator Service can begin work.',
                );
              }
            }}
          >
            <Text style={ui.btnText}>Open Elevator Services</Text>
          </Pressable>
        )}
        {(mode === 'worker' || mode === 'inspector') && (
          <Pressable
            style={[ui.btnOutline, { marginTop: 10 }]}
            onPress={() => router.push('/fiarep-vision?preBuilding=' + encodeURIComponent((r.address || '') + (r.unit ? '  Unit ' + r.unit : '')))}
          >
            <Text style={ui.btnOutlineText}>FIAREP Vision (AI photo)</Text>
          </Pressable>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {r.photos.map((uri, i) => (
              <Pressable key={`${uri}-${i}`} onPress={() => setViewerUri(uri)}>
                <RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
              </Pressable>
            ))}
            {remotePhotoUris.map((uri, i) => (
              <Pressable key={`remote-${uri}-${i}`} onPress={() => setViewerUri(uri)}>
                <RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
              </Pressable>
            ))}
            {photosLoading && <Text style={ui.listSub}>Loading photos…</Text>}
            {!photosLoading && photosError && <Text style={ui.listSub}>Photos could not be loaded.</Text>}
            {!photosLoading && !photosError && r.photos.length === 0 && remotePhotoUris.length === 0 && (
              <Text style={ui.listSub}>No photos attached.</Text>
            )}
        </View>
      </View>

      {r.updates.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={ui.label}>History</Text>
          {r.updates.slice().reverse().map((u, i) => (
            <View key={i} style={{ paddingVertical: 3 }}>
              <Text style={ui.lineV}>{STATUS_LABEL[u.status]}{u.note ? ` — ${u.note}` : ''}</Text>
              <Text style={ui.listSub}>{fmt(u.at)}{u.by ? ` · ${u.by}` : ''}</Text>
            </View>
          ))}
        </View>
      )}

      <PhotoViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </ScrollView>
  );
}
