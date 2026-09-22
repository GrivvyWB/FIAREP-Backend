import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getCurrentActor, getCurrentPosition, listRoutedInspectionsFor, completeRoutedViolation, releaseRoutedViolation, releaseResidentReport, listResidentReports, developmentsForStaff, deleteBuildingViolation, deleteResidentReport, listManpowerRequests, performEntityAction, markReportSeen, getSeenReportIds, type BuildingViolation, type ResidentReport, type ManpowerRequest } from '../lib/store';
import { takePhotoWithGeo, pickPhotoWithGeo, uploadPhoto, type PhotoEvidence } from '../lib/photos';
import { captureGeo } from '../lib/geo';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
const classColor = (c: string) => c === 'C' ? '#c0392b' : c === 'B' ? '#B4741A' : '#1a8f4c';

export default function MyJobs() {
  const router = useRouter();
  const [jobs, setJobs] = useState<BuildingViolation[]>([]);
  const [resJobs, setResJobs] = useState<ResidentReport[]>([]);
  const [inHouseJobs, setInHouseJobs] = useState<ManpowerRequest[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [inHouseOpenId, setInHouseOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<PhotoEvidence[]>([]);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [position, setPosition] = useState('');
  const [releaseOpenId, setReleaseOpenId] = useState<string | null>(null);
  const [releaseNote, setReleaseNote] = useState('');
  const canDelete = useDeletionPolicy();

  useFocusEffect(useCallback(() => {
    getCurrentActor().then((actor) => {
      const allowed = actor.role === 'worker' || actor.role === 'inspector' || actor.role === 'emergency';
      if (!allowed) { router.replace('/worker-home'); return; }
      setAuthorized(true);
    }).catch(() => router.replace('/worker-home'));
    getCurrentPosition().then(setPosition).catch(() => setPosition(''));
  }, [router]));

  const load = useCallback(() => {
    getCurrentActor().then(async (a) => {
       const nm = (a && a.name) || '';
       if (!nm || !a?.id) return;
       setJobs(await listRoutedInspectionsFor(nm, a.id));
      // Lenient development filter: show jobs in my assigned developments PLUS
      // any untagged job (no development) so nothing assigned to me vanishes.
      const myDevs = (await developmentsForStaff(a.name || '').catch(() => [])).map((d) => (d || '').trim().toLowerCase()).filter(Boolean);
      const inMyDevs = (dev?: string) => { const d = (dev || '').trim().toLowerCase(); return !d || myDevs.length === 0 || myDevs.includes(d); };
      const seen = await getSeenReportIds();
      const all = await listResidentReports();
       setResJobs(all.filter((r) => r.status !== 'resolved' && r.assignedStaffId === a.id && inMyDevs(r.development) && !seen.has(r.id)));
       setInHouseJobs((await listManpowerRequests()).filter((r) => r.assignedStaffId === a.id && ['dispatched', 'in_progress'].includes(r.status) && inMyDevs(r.development)));
    });
  }, []);
  useFocusEffect(load);

  function openJob(v: BuildingViolation) {
    setOpenId(v.id); setNote(''); setPhotos([]);
  }
  async function addTake() {
    try { const photo = await takePhotoWithGeo(); if (photo) setPhotos((p) => [...p, photo]); } catch (e: any) { Alert.alert('Camera', String(e && e.message ? e.message : e)); }
  }
  async function addPick() {
    try { const photo = await pickPhotoWithGeo(); if (photo) setPhotos((p) => [...p, photo]); } catch (e: any) { Alert.alert('Photos', String(e && e.message ? e.message : e)); }
  }
  async function markDone(v: BuildingViolation) {
    if (!note.trim() && photos.length === 0) {
      Alert.alert('Add detail', 'Add a completion note or a photo of the finished repair before marking done.');
      return;
    }
    setBusy(true);
    try {
      const completionGeo = await captureGeo();
      await completeRoutedViolation(v.id, note.trim(), photos, completionGeo);
      setOpenId(null); setNote(''); setPhotos([]);
      load();
      Alert.alert('Marked complete', 'Management has been notified the repair is complete.');
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    } finally { setBusy(false); }
  }
  async function releaseViolation(v: BuildingViolation) {
    if (!releaseNote.trim()) {
      Alert.alert('Add update', 'Provide an update before releasing this assignment.');
      return;
    }
    setBusy(true);
    try {
      await releaseRoutedViolation(v.id, releaseNote);
      setReleaseOpenId(null); setReleaseNote(''); load();
      Alert.alert('Assignment released', 'The violation is available for reassignment.');
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    } finally { setBusy(false); }
  }
  async function releaseResident(id: string) {
    if (!releaseNote.trim()) {
      Alert.alert('Add update', 'Provide an update before releasing this assignment.');
      return;
    }
    setBusy(true);
    try {
      await releaseResidentReport(id, releaseNote);
      setReleaseOpenId(null); setReleaseNote(''); load();
      Alert.alert('Assignment released', 'The request is available for reassignment.');
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    } finally { setBusy(false); }
  }

  if (!authorized) return null;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>My Jobs</Text>
       <Text style={ui.label}>Repairs assigned to you. Open one, do the repair, then mark it done with a note and a photo.</Text>
       {inHouseJobs.length > 0 && <>
         <Text style={[ui.label, { marginTop: 12, fontWeight: '700' }]}>Assigned trade work ({inHouseJobs.length})</Text>
         {inHouseJobs.map((job) => <View key={job.id} style={[ui.card, { gap: 7, marginTop: 8 }]}>
           <Text style={{ fontWeight: '700' }}>{job.requestedTrade} · {job.sourceTitle || 'Assigned work'}</Text>
           {(!!job.address || !!job.unit) && <Text style={{ fontSize: 14 }}>{[job.address, job.unit].filter(Boolean).join(' · ')}</Text>}
           {!!job.location && <Text style={ui.listSub}>Location: {job.location}</Text>}
           {!!job.sourceDetails && <Text style={{ fontSize: 14, color: '#333' }}>{job.sourceDetails}</Text>}
           <Text style={ui.listSub}>{job.development || 'Development not specified'} · {job.status}</Text>
           {job.status === 'dispatched' && <Pressable style={ui.btn} onPress={async () => {
             try { await performEntityAction('manpower-requests', job.id, 'start', {}); load(); }
             catch (e: any) { Alert.alert('Could not start', e?.message || 'The server did not accept this action.'); }
           }}><Text style={ui.btnText}>Start work</Text></Pressable>}
           {job.status === 'in_progress' && inHouseOpenId !== job.id && <Pressable style={ui.btn} onPress={() => { setInHouseOpenId(job.id); setNote(''); setPhotos([]); }}>
             <Text style={ui.btnText}>Complete work</Text>
           </Pressable>}
           {job.status === 'in_progress' && inHouseOpenId === job.id && <View style={{ gap: 8 }}>
             <Text style={ui.label}>Completion note</Text>
             <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} value={note} onChangeText={setNote} placeholder="What was completed" multiline />
             <Text style={ui.label}>Photo evidence of finished work</Text>
             <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
               {photos.map((photo, i) => <TouchableOpacity key={`${photo.uri}-${i}`} onPress={() => setViewerUri(photo.uri)}>
                 <RemotePhoto localUri={photo.uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
               </TouchableOpacity>)}
             </View>
             <View style={{ flexDirection: 'row', gap: 8 }}>
               <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={addTake}><Text style={ui.btnOutlineText}>Take photo</Text></Pressable>
               <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={addPick}><Text style={ui.btnOutlineText}>Add from library</Text></Pressable>
             </View>
             <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={async () => {
               if (!note.trim() || photos.length === 0) {
                 Alert.alert('Evidence required', 'Add a completion note and at least one actual photo before completing this work.');
                 return;
               }
               setBusy(true);
               try {
                 // Upload first; an offline/device upload failure must not be
                 // presented as a successful completion.
                  const uploaded = await Promise.all(photos.map((photo) => uploadPhoto(photo.uri, 'completion-photo', { entity: 'manpower-requests', recordId: job.id }, { capturedAt: photo.capturedAt, geo: photo.geo })));
                  const photoEvidence = uploaded.map((file, index) => ({
                    uri: file.objectPath,
                    objectPath: file.objectPath,
                    id: file.id,
                    name: file.name,
                    contentType: file.contentType,
                    capturedAt: photos[index].capturedAt,
                    geo: photos[index].geo,
                  }));
                  await performEntityAction('manpower-requests', job.id, 'complete', { completionNote: note.trim(), photoEvidence });
                 setInHouseOpenId(null); setNote(''); setPhotos([]); load();
                 Alert.alert('Completed', 'The server accepted the completion and evidence.');
               } catch (e: any) {
                 Alert.alert('Could not complete', e?.message || 'The completion or evidence upload was not accepted.');
               } finally { setBusy(false); }
             }}><Text style={ui.btnText}>Submit completion</Text></Pressable>
             <Pressable onPress={() => { setInHouseOpenId(null); setNote(''); setPhotos([]); }}><Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>Cancel</Text></Pressable>
           </View>}
         </View>)}
       </>}

      {resJobs.length > 0 && (
        <>
          <Text style={[ui.label, { marginTop: 12, fontWeight: '700' }]}>Resident requests ({resJobs.length})</Text>
          {resJobs.map((r) => (
            <View key={r.id} style={[ui.card, { gap: 4, marginTop: 8 }]}>
              <Pressable onPress={() => { markReportSeen(r.id).catch(() => undefined); router.push('/report-detail?id=' + encodeURIComponent(r.id)); }}>
                <Text style={{ fontSize: 15, fontWeight: '600' }}>{r.location || r.unit || r.address || 'Request'}</Text>
                {!!r.address && <Text style={ui.listSub}>{r.address}{r.unit ? ' \u00b7 ' + r.unit : ''}</Text>}
                {!!r.description && <Text style={ui.listSub} numberOfLines={2}>{r.description}</Text>}
              </Pressable>
              {position !== 'Elevator Service' && (
                <Pressable style={[ui.btn, { marginTop: 6 }]} onPress={() => { markReportSeen(r.id).catch(() => undefined); router.push('/report-detail?id=' + encodeURIComponent(r.id)); }}>
                  <Text style={ui.btnText}>{r.status === 'in_progress' ? 'Continue \u2014 add photo & complete' : 'Open job \u2014 start, photo, complete'}</Text>
                </Pressable>
              )}
              {r.clearedByMgmt && canDelete && (
                <Pressable onPress={() => Alert.alert('Remove this job?', 'Management cleared it. Remove it from your list?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await deleteResidentReport(r.id); load(); } }])} style={{ marginTop: 4 }}>
                  <Text style={{ color: '#c0392b', fontWeight: '600', fontSize: 13 }}>Remove (cleared by management)</Text>
                </Pressable>
              )}
            </View>
          ))}
          <Text style={[ui.label, { marginTop: 16, fontWeight: '700' }]}>Inspection repairs</Text>
        </>
      )}

      {jobs.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No jobs assigned right now.</Text>}

      {jobs.map((v) => (
        <View key={v.id} style={[ui.card, { gap: 6, marginTop: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{v.violationNo || '(no number)'}</Text>
            <Text style={{ fontSize: 13, fontWeight: '800', color: classColor(v.hazardClass) }}>Class {v.hazardClass}</Text>
          </View>
          <Text style={{ fontSize: 15 }}>{v.building}</Text>
          {!!v.code && <Text style={ui.listSub}>Code {v.code}{v.codeDesc ? ' \u00b7 ' + v.codeDesc : ''}</Text>}
          {!!v.notes && <Text style={{ fontSize: 14 }}>{v.notes}</Text>}
          <Text style={ui.listSub}>Assigned by {v.approvedBy || 'management'}  {fmt(v.routedAt || '')}</Text>
          {position !== 'Elevator Service' && (releaseOpenId === v.id ? (
            <View style={{ gap: 8, marginTop: 6 }}>
              <Text style={ui.label}>Update before release</Text>
              <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} value={releaseNote} onChangeText={setReleaseNote} placeholder="What is the current update?" multiline />
              <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} onPress={() => releaseViolation(v)} disabled={busy}><Text style={ui.btnText}>Release assignment</Text></Pressable>
              <Pressable onPress={() => { setReleaseOpenId(null); setReleaseNote(''); }}><Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>Cancel</Text></Pressable>
            </View>
          ) : (
            <Pressable style={ui.btnOutline} onPress={() => { setReleaseOpenId(v.id); setReleaseNote(''); }}><Text style={ui.btnOutlineText}>Release with update</Text></Pressable>
          ))}
          {v.clearedByMgmt && canDelete && (
            <Pressable onPress={() => Alert.alert('Remove this job?', 'Management cleared it. Remove it from your list?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await deleteBuildingViolation(v.id); load(); } }])}>
              <Text style={{ color: '#c0392b', fontWeight: '600', fontSize: 13 }}>Remove (cleared by management)</Text>
            </Pressable>
          )}

          {openId !== v.id ? (
            <Pressable style={[ui.btn, { marginTop: 4 }]} onPress={() => openJob(v)}>
              <Text style={ui.btnText}>Mark repair done</Text>
            </Pressable>
          ) : (
            <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, gap: 8 }}>
              <Text style={ui.label}>Completion note</Text>
              <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} value={note} onChangeText={setNote} placeholder="What was repaired" multiline />
              <Text style={ui.label}>Photos of the finished work</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {photos.map((photo, i) => (
                  <TouchableOpacity key={`${photo.uri}-${i}`} onPress={() => setViewerUri(photo.uri)}>
                    <RemotePhoto localUri={photo.uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={addTake}><Text style={ui.btnOutlineText}>Take photo</Text></Pressable>
                <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={addPick}><Text style={ui.btnOutlineText}>Add from library</Text></Pressable>
              </View>
              <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} onPress={() => markDone(v)} disabled={busy}>
                <Text style={ui.btnText}>Submit completion</Text>
              </Pressable>
              <Pressable onPress={() => setOpenId(null)}><Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>Cancel</Text></Pressable>
            </View>
          )}
        </View>
      ))}
      <View style={{ height: 40 }} />

      <PhotoViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
