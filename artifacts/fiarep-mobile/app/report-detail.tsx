import { useAppReadOnly } from '../lib/useAppReadOnly';
import { ReadOnlyBanner } from '../components/ReadOnlyBanner';
import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAppMode } from './_layout';
import { addResidentUpdate, approveResidentWork, rejectResidentWork, assessReportPhotos, getResidentReport, type ResidentReport, getCurrentPosition, getCurrentActor, listResidentReportPhotoUrls } from '../lib/store';
import { takePhotoWithGeo, pickPhotoWithGeo, type PhotoEvidence } from '../lib/photos';
import { captureGeo } from '../lib/geo';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';
import { syncAllEntities } from '../lib/sync';
import { requestFileDownloadUrl } from '@workspace/api-client-react';

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
  const readOnly = useAppReadOnly() === true;
  const [position, setPosition] = useState('');
  useFocusEffect(useCallback(() => { getCurrentPosition().then(setPosition).catch(() => {}); }, []));
  const [r, setR] = useState<ResidentReport | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [remotePhotoUris, setRemotePhotoUris] = useState<string[]>([]);
  const [completedPhotoUris, setCompletedPhotoUris] = useState<string[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actorId, setActorId] = useState('');
  const [actorName, setActorName] = useState('');
  const [assessing, setAssessing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
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
        setCompletedPhotoUris([]);
        setPhotosError(false);
        if (!report) return;
        // Auto-run the violation assessment for staff so the code is ready
        // without anyone pressing a button. Only when there are photos and no
        // assessment yet, and only for management/admin/inspector.
        try {
          const staff = mode === 'management' || mode === 'administrator' || mode === 'inspector';
          const already = (report as any).aiPhotoScans && Object.keys((report as any).aiPhotoScans).length > 0;
          const hasPhoto = (report.photos && report.photos.length > 0);
          if (staff && hasPhoto && !already) {
            assessReportPhotos(String(id)).then(async () => {
              const fresh = await getResidentReport(String(id));
              if (active && fresh) setR(fresh);
            }).catch(() => undefined);
          }
        } catch {}
        setPhotosLoading(true);
        try {
          // Resident report photos must use the report-scoped authorized endpoint.
          // Staff completion photos are separate, record-owned files and need
          // their own authorized download URLs.
          const completionPaths = [...new Set([
            ...(Array.isArray(report.remoteFiles) ? report.remoteFiles : [])
              .filter((file) => file.kind === 'completion-photo')
              .map((file) => file.objectPath),
            ...(Array.isArray(report.photoEvidence) ? report.photoEvidence : [])
              .map((photo) => (photo as { objectPath?: string }).objectPath),
            ...(Array.isArray(report.completionPhotoEvidence) ? report.completionPhotoEvidence : [])
              .map((photo) => (photo as { objectPath?: string }).objectPath),
          ].filter((path): path is string => typeof path === 'string' && path.length > 0))];
          const [residentPhotos, completionPhotos] = await Promise.all([
            listResidentReportPhotoUrls(String(id)).then(
              (urls) => ({ urls, failed: false }),
              () => ({ urls: [] as string[], failed: true }),
            ),
            Promise.allSettled(completionPaths.map((objectPath) => requestFileDownloadUrl({ objectPath }))),
          ]);
          if (active) {
            setRemotePhotoUris(residentPhotos.urls);
            setCompletedPhotoUris(completionPhotos.flatMap((result) =>
              result.status === 'fulfilled' ? [result.value.downloadUrl] : [],
            ));
            if (residentPhotos.failed || completionPhotos.some((result) => result.status === 'rejected')) setPhotosError(true);
          }
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
      const delivery = await addResidentUpdate(
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
      Alert.alert('Completed', delivery === 'sent'
        ? 'The completed-work photo was sent to the supervisor.'
        : 'Saved on this device. It will be uploaded and sent to the supervisor when you are back online.');
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
        <Text style={ui.empty}>This complaint hasn't synced to this device yet.</Text>
        <Pressable
          style={[ui.btn, { marginTop: 12 }]}
          onPress={async () => { setLoading(true); await syncAllEntities().catch(() => undefined); load(); }}
        >
          <Text style={ui.btnText}>Retry</Text>
        </Pressable>
        <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={() => router.back()}>
          <Text style={ui.btnOutlineText}>Back to inbox</Text>
        </Pressable>
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
      {readOnly && <ReadOnlyBanner />}

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
        {(mode === 'management' || mode === 'administrator' || mode === 'inspector') && (() => {
          const scans = (r as any).aiPhotoScans && typeof (r as any).aiPhotoScans === 'object' ? Object.values((r as any).aiPhotoScans) : [];
          const hasPhotos = (r.photos && r.photos.length > 0) || remotePhotoUris.length > 0;
          if (!scans.length) {
            if (!hasPhotos) return null;
            return (
              <View style={{ marginTop: 8, borderWidth: 1, borderColor: '#cdd9e6', backgroundColor: '#eef4fb', borderRadius: 8, padding: 10, gap: 8 }}>
                <Text style={{ fontWeight: '700', fontSize: 13, color: '#1C4E86' }}>Violation assessment (from photo) · staff only</Text>
                <Text style={ui.listSub}>Get a suggested HPD/DOB violation code and meaning from the resident's photo.</Text>
                <Pressable style={[ui.btn, assessing && { opacity: 0.5 }]} disabled={assessing} onPress={async () => {
                  setAssessing(true);
                  try {
                    const n = await assessReportPhotos(r.id);
                    const fresh = await getResidentReport(String(id));
                    if (fresh) setR(fresh);
                    if (!n) Alert.alert('No assessment', 'The photo could not be assessed. Photo analysis may be turned off for your organization, or the image format is unsupported.');
                  } catch (e: any) {
                    Alert.alert('Assessment failed', e?.message ?? 'Could not assess the photo.');
                  } finally { setAssessing(false); }
                }}>
                  <Text style={ui.btnText}>{assessing ? 'Assessing\u2026' : 'Assess photo \u2192 get code'}</Text>
                </Pressable>
              </View>
            );
          }
          return (
            <View style={{ marginTop: 8, borderWidth: 1, borderColor: '#cdd9e6', backgroundColor: '#eef4fb', borderRadius: 8, padding: 10, gap: 6 }}>
              <Text style={{ fontWeight: '700', fontSize: 13, color: '#1C4E86' }}>Violation assessment (from photo) · staff only</Text>
              {scans.map((sc: any, i: number) => (
                <View key={i} style={{ gap: 2, paddingTop: i ? 6 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: '#d5e0ec' }}>
                  <Text style={{ fontSize: 14 }}>
                    <Text style={{ fontWeight: '700', color: '#1C4E86' }}>Code {sc.hpCode || 'REVIEW REQUIRED'}</Text>
                    {sc.classification ? '  ·  Class ' + sc.classification : ''}
                    {sc.priority ? '  ·  ' + sc.priority + ' priority' : ''}
                  </Text>
                  {!!(sc.codeMeaning || sc.condition) && <Text style={{ fontSize: 13, color: '#333' }}>{sc.codeMeaning || sc.condition}</Text>}
                  {!!sc.codeOrderText && <Text style={ui.listSub} numberOfLines={3}>{sc.codeOrderText}</Text>}
                  {!!sc.trade && <Text style={ui.listSub}>Trade: {sc.trade}{typeof sc.confidence === 'number' ? '  ·  AI ' + sc.confidence + '%' : ''}</Text>}
                </View>
              ))}
            </View>
          );
        })()}
        {(mode === 'management' || mode === 'administrator') && r.status !== 'resolved' && (() => {
          const base = 'preAddress=' + encodeURIComponent(r.address || '')
            + '&preReportId=' + encodeURIComponent(r.id)
            + '&preUnit=' + encodeURIComponent(r.unit || '')
            + '&preNote=' + encodeURIComponent(r.description || '')
            + '&preComplaintNo=' + encodeURIComponent(r.complaintNo || '')
            + '&preResident=' + encodeURIComponent(r.residentName || '')
            + '&preDevelopment=' + encodeURIComponent(r.development || '');
          if (readOnly) return (
            <Pressable style={[ui.btn, { marginTop: 10, backgroundColor: '#b3261e' }]} onPress={() => router.push('/violation-send?' + base + '&filter=worker&emergency=1')}>
              <Text style={ui.btnText}>Send emergency request</Text>
            </Pressable>
          );
          return (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => router.push('/violation-send?' + base + '&filter=worker')}>
                <Text style={ui.btnText}>Send as Complaint</Text>
              </Pressable>
              <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => router.push('/violation-send?' + base + '&filter=inspector')}>
                <Text style={ui.btnText}>Send as Violation</Text>
              </Pressable>
            </View>
          );
        })()}
        {(mode === 'management' || mode === 'administrator') && !readOnly && (r as any).reviewStatus === 'done' && (
          <View style={{ marginTop: 12, borderWidth: 1, borderColor: '#e0d3b0', backgroundColor: '#fbf6e9', borderRadius: 8, padding: 10, gap: 8 }}>
            <Text style={{ fontWeight: '700', fontSize: 13 }}>Worker marked this complete — review the photo &amp; notes</Text>
            {reviewOpen ? (
              <View style={{ gap: 8 }}>
                <TextInput style={[ui.input, { minHeight: 56, textAlignVertical: 'top' }]} value={reviewReason} onChangeText={setReviewReason} placeholder="What needs fixing? (sent to the worker)" multiline />
                <Pressable style={[ui.btn, reviewBusy && { opacity: 0.5 }]} disabled={reviewBusy} onPress={async () => {
                  setReviewBusy(true);
                  try { await rejectResidentWork(r.id, reviewReason); const fresh = await getResidentReport(String(id)); if (fresh) setR(fresh); setReviewOpen(false); setReviewReason(''); }
                  catch (e: any) { Alert.alert('Could not send back', e?.message ?? 'Failed.'); }
                  finally { setReviewBusy(false); }
                }}><Text style={ui.btnText}>Send back to worker</Text></Pressable>
                <Pressable onPress={() => { setReviewOpen(false); setReviewReason(''); }}><Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>Cancel</Text></Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={[ui.btn, { flex: 1, backgroundColor: '#2e7d32' }, reviewBusy && { opacity: 0.5 }]} disabled={reviewBusy} onPress={async () => {
                  setReviewBusy(true);
                  try { await approveResidentWork(r.id); const fresh = await getResidentReport(String(id)); if (fresh) setR(fresh); }
                  catch (e: any) { Alert.alert('Could not approve', e?.message ?? 'Failed.'); }
                  finally { setReviewBusy(false); }
                }}><Text style={ui.btnText}>Approve</Text></Pressable>
                <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => { setReviewOpen(true); setReviewReason(''); }}><Text style={ui.btnOutlineText}>Send back</Text></Pressable>
              </View>
            )}
          </View>
        )}
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
        {position === 'CPM' && (
          <Pressable
            style={[ui.btnOutline, { marginTop: 10 }]}
            onPress={() => router.push('/?new=1'
              + '&preName=' + encodeURIComponent([r.complaintNo, r.address, r.unit ? 'Unit ' + r.unit : ''].filter(Boolean).join(' · '))
              + '&preDevelopment=' + encodeURIComponent(r.development || '')
              + '&preReportId=' + encodeURIComponent(r.id)
              + '&preComplaintNo=' + encodeURIComponent(r.complaintNo || '')
              + '&preAddress=' + encodeURIComponent(r.address || '')
              + '&preUnit=' + encodeURIComponent(r.unit || '')
              + '&preNote=' + encodeURIComponent(r.description || ''))}
          >
            <Text style={ui.btnOutlineText}>Start project / scope for {r.complaintNo || 'this complaint'}</Text>
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
            {r.photos.filter((uri) => !(Array.isArray(r.remoteFiles) ? r.remoteFiles : []).some((file) =>
              file.kind === 'completion-photo' && file.objectPath && file.localUri === uri,
            )).map((uri, i) => (
              <Pressable key={`${uri}-${i}`} onPress={() => setViewerUri(uri)}>
                <RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
              </Pressable>
            ))}
            {remotePhotoUris.map((uri, i) => (
              <Pressable key={`remote-${uri}-${i}`} onPress={() => setViewerUri(uri)}>
                <RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
              </Pressable>
            ))}
            {completedPhotoUris.map((uri, i) => (
              <Pressable key={`completion-${i}`} onPress={() => setViewerUri(uri)}>
                <RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
              </Pressable>
            ))}
            {photosLoading && <Text style={ui.listSub}>Loading photos…</Text>}
            {!photosLoading && photosError && <Text style={ui.listSub}>Photos could not be loaded.</Text>}
            {!photosLoading && !photosError && r.photos.length === 0 && remotePhotoUris.length === 0 && completedPhotoUris.length === 0 && (
              <Text style={ui.listSub}>No photos attached.</Text>
            )}
        </View>
        {isMine && r.status === 'in_progress' && (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }}>
            {!!r.reworkNote && (
              <View style={{ borderWidth: 1, borderColor: '#e0b4b4', backgroundColor: '#fdf1f1', borderRadius: 8, padding: 10, gap: 4 }}>
                <Text style={{ fontWeight: '700', color: '#a12b2b' }}>Sent back by {r.reworkByStaffName || 'supervisor'}{r.reworkAt ? ' · ' + fmt(r.reworkAt) : ''}</Text>
                <Text style={{ color: '#222' }}>{r.reworkNote}</Text>
              </View>
            )}
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
