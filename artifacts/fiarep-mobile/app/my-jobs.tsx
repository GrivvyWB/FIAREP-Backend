import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getCurrentActor, listRoutedInspectionsFor, completeRoutedViolation, listResidentReports, developmentsForStaff, deleteBuildingViolation, deleteResidentReport, type BuildingViolation, type ResidentReport } from '../lib/store';
import { takePhotoWithGeo, pickPhotoWithGeo, type PhotoEvidence } from '../lib/photos';
import { captureGeo } from '../lib/geo';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
const classColor = (c: string) => c === 'C' ? '#c0392b' : c === 'B' ? '#B4741A' : '#1a8f4c';

export default function MyJobs() {
  const router = useRouter();
  const [jobs, setJobs] = useState<BuildingViolation[]>([]);
  const [resJobs, setResJobs] = useState<ResidentReport[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<PhotoEvidence[]>([]);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getCurrentActor().then(async (a) => {
      const nm = (a && a.name) || '';
      if (!nm) return;
      setJobs(await listRoutedInspectionsFor(nm));
      // Lenient development filter: show jobs in my assigned developments PLUS
      // any untagged job (no development) so nothing assigned to me vanishes.
      const myDevs = (await developmentsForStaff(a.name || '').catch(() => [])).map((d) => (d || '').trim().toLowerCase()).filter(Boolean);
      const inMyDevs = (dev?: string) => { const d = (dev || '').trim().toLowerCase(); return !d || myDevs.length === 0 || myDevs.includes(d); };
      const all = await listResidentReports();
      setResJobs(all.filter((r) => r.status !== 'resolved' && (r.assignedTo || '').trim().toLowerCase() === nm.toLowerCase() && inMyDevs(r.development)));
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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>My Jobs</Text>
      <Text style={ui.label}>Repairs assigned to you. Open one, do the repair, then mark it done with a note and a photo.</Text>

      {resJobs.length > 0 && (
        <>
          <Text style={[ui.label, { marginTop: 12, fontWeight: '700' }]}>Resident requests ({resJobs.length})</Text>
          {resJobs.map((r) => (
            <View key={r.id} style={[ui.card, { gap: 4, marginTop: 8 }]}>
              <Pressable onPress={() => router.push('/report-detail?id=' + encodeURIComponent(r.id))}>
                <Text style={{ fontSize: 15, fontWeight: '600' }}>{r.location || r.unit || r.address || 'Request'}</Text>
                {!!r.description && <Text style={ui.listSub} numberOfLines={2}>{r.description}</Text>}
                <Text style={{ fontSize: 12, color: ACCENT, fontWeight: '600' }}>Open to complete \u203a</Text>
              </Pressable>
              {r.clearedByMgmt && (
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
          {v.clearedByMgmt && (
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
