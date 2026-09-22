import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAppMode } from './_layout';
import { addResidentUpdate, getResidentReport, type ResidentReport, getCurrentPosition, getCurrentActor, listResidentReportPhotoUrls } from '../lib/store';
import { takePhotoWithGeo, pickPhotoWithGeo, type PhotoEvidence } from '../lib/photos';
import { captureGeo } from '../lib/geo';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';
import { syncAllEntities } from '../lib/sync';

const STATUS_LABEL: Record<ResidentReport['status'], string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
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
  const [actorId, setActorId] = useState('');
  const [actorName, setActorName] = useState('');
  const [completionNote, setCompletionNote] = useState('');
  const [completionPhotos, setCompletionPhotos] = useState<PhotoEvidence[]>([]);
  const [completionBusy, setCompletionBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const actor = await getCurrentActor().catch(() => null);
        if (active) {
          setActorId(actor?.id || '');
          setActorName(actor?.name || '');
        }
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

  const addCompletionPhoto = async (source: 'camera' | 'library') => {
    try {
      const photo = source === 'camera' ? await takePhotoWithGeo() : await pickPhotoWithGeo();
      if (photo) setCompletionPhotos((current) => [...current, photo]);
    } catch (error) {
      Alert.alert(source === 'camera' ? 'Camera' : 'Photos', error instanceof Error ? error.message : String(error));
    }
  };

  const completeWork = async () => {
    if (!r || !actorId || completionPhotos.length === 0) return;
    setCompletionBusy(true);
    try {
      await addResidentUpdate(
        r.id,
        'resolved',
        completionNote,
        actorName,
        completionPhotos,
        await captureGeo(),
      );
      setCompletionNote('');
      setCompletionPhotos([]);
      load();
      Alert.alert('Completed', 'The completed-work photo was sent to the supervisor.');
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : String(error));
    } finally {
      setCompletionBusy(false);
    }
  };

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

  const norm = (v?: string) => (v || '').trim().toLowerCase();
  const isMine = !!r && (
    (r.assignedStaffId && r.assignedStaffId === actorId) ||
    (!!actorName && norm(r.assignedTo) === norm(actorName)) ||
    (!!actorName && norm((r as any).assignedStaffName) === norm(actorName))
  );
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
            + '&preReportId=' + encodeURIComponent(r.id)
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
        {isMine && r.status === 'assigned' && (
          <Pressable
            disabled={completionBusy}
            style={[ui.btn, { marginTop: 10 }, completionBusy && { opacity: 0.45 }]}
            onPress={async () => {
              setCompletionBusy(true);
              try {
                await addResidentUpdate(
                  r.id,
                  'in_progress',
                  'Started job',
                  actorName,
                  [],
                  await captureGeo(),
                );
                load();
              } catch (error) {
                Alert.alert('Error', error instanceof Error ? error.message : String(error));
              } finally {
                setCompletionBusy(false);
              }
            }}
          >
            <Text style={ui.btnText}>Start job</Text>
          </Pressable>
        )}
        {mode === 'inspector' && (
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
        {isMine && r.status === 'in_progress' && (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }}>
            <Text style={ui.label}>Completed work</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {completionPhotos.map((photo, index) => (
                <Pressable key={`${photo.uri}-${index}`} onPress={() => setViewerUri(photo.uri)}>
                  <RemotePhoto localUri={photo.uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => addCompletionPhoto('camera')}>
                <Text style={ui.btnOutlineText}>Take photo</Text>
              </Pressable>
              <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => addCompletionPhoto('library')}>
                <Text style={ui.btnOutlineText}>Add photo</Text>
              </Pressable>
            </View>
            <TextInput
              style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]}
              value={completionNote}
              onChangeText={setCompletionNote}
              multiline
            />
            <Pressable
              style={[ui.btn, (completionBusy || completionPhotos.length === 0 || !completionNote.trim()) && { opacity: 0.45 }]}
              disabled={completionBusy || completionPhotos.length === 0 || !completionNote.trim()}
              onPress={completeWork}
            >
              <Text style={ui.btnText}>Complete</Text>
            </Pressable>
          </View>
        )}
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
