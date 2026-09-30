import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';
import { listAttachableJobs, attachMeasurementToJob, listSupervisorOptions, type AttachableJob, type MeasurementAudience, type SupervisorOption } from '../lib/store';
import { ACCENT } from '../lib/ui';

// Every measurement and material list saved from the Measurement screen, with
// the picture it was taken from, so it can be looked at again later.

type Rec = { id: string; development?: string | null; createdAt?: string; state: any };

function fmt(iso?: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function SavedMeasurements() {
  const router = useRouter();
  const [items, setItems] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ measurementId: string; jobs: AttachableJob[] } | null>(null);
  const [job, setJob] = useState<AttachableJob | null>(null);
  const [supervisors, setSupervisors] = useState<SupervisorOption[] | null>(null);
  const [attaching, setAttaching] = useState(false);

  async function openPicker(measurementId: string) {
    const jobs = await listAttachableJobs().catch(() => [] as AttachableJob[]);
    if (!jobs.length) {
      Alert.alert('No jobs to attach to', 'You have no open complaint or inspection assigned to you on this phone. Sync first, or ask your supervisor to send you the job.');
      return;
    }
    setJob(null); setSupervisors(null);
    setPicker({ measurementId, jobs });
  }

  async function send(audience: MeasurementAudience, targetStaffId: string = '') {
    if (!picker || !job) return;
    setAttaching(true);
    try {
      const r = await attachMeasurementToJob(job.entity, job.id, picker.measurementId, audience, targetStaffId);
      setPicker(null); setJob(null);
      const who = audience === 'all' ? 'All supervisors and management' : audience === 'staff' ? 'That supervisor' : "The development's supervisors";
      Alert.alert('Sent', `Added to ${job.title}. ${who} ${r?.notified === 1 ? 'has' : 'have'} been alerted${r?.notified ? ` (${r.notified})` : ''}.`);
    } catch (e: any) {
      Alert.alert('Could not send', e?.data?.error || e?.message || 'Please try again.');
    } finally { setAttaching(false); }
  }

  async function showSupervisors() {
    try { setSupervisors(await listSupervisorOptions()); } catch { setSupervisors([]); }
  }

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const rows = await customFetch<Rec[]>('/api/v1/measurements', { responseType: 'json' });
        if (!active) return;
        const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.state);
        list.sort((x, y) => String(y.state?.createdAt || y.createdAt || '').localeCompare(String(x.state?.createdAt || x.createdAt || '')));
        setItems(list);
      } catch (e: any) {
        if (active) setError(e?.message ? String(e.message) : 'Could not load saved measurements.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []));

  const shown = items;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F7F6' }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={{ color: ACCENT, fontWeight: '600', fontSize: 16 }}>‹ Back</Text></Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 18, marginRight: 40 }}>Saved measurements</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text style={{ color: '#4A5560', marginBottom: 12, fontSize: 13 }}>Every measurement saved by your team, newest first. Open one to see the picture and send it to a supervisor.</Text>
        {loading && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color={ACCENT} /><Text style={{ color: '#4A5560' }}>Loading…</Text></View>}
        {!!error && <Text style={{ color: '#c00' }}>{error}</Text>}
        {!loading && !error && shown.length === 0 && (
          <Text style={{ color: '#8A928C', textAlign: 'center', marginTop: 40 }}>No saved measurements yet. Take a photo on the Measurement screen, enter or accept the size, and press Save.</Text>
        )}
        {shown.map((r) => {
          const st = r.state || {};
          const pic = st.photoDataUrl || st.photoLocalUri || '';
          const isOpen = open === r.id;
          const dims = st.material === 'materials'
            ? ''
            : [st.lengthFt ? `${st.lengthFt} ft` : '', st.widthFt ? `${st.widthFt} ft` : ''].filter(Boolean).join(' × ');
          return (
            <Pressable key={r.id} onPress={() => setOpen(isOpen ? null : r.id)} style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E4E9E6', padding: 12, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {pic ? <Image source={{ uri: pic }} style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: '#E4E9E6' }} resizeMode="cover" />
                     : <View style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: '#E4E9E6', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#8A928C', fontSize: 11 }}>no photo</Text></View>}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15 }}>{st.materialLabel || st.material || 'Measurement'}{dims ? ` · ${dims}` : ''}</Text>
                  {!!st.summary && <Text style={{ color: '#4A5560', marginTop: 2 }} numberOfLines={isOpen ? undefined : 2}>{st.summary}</Text>}
                  <Text style={{ color: '#8A928C', fontSize: 12, marginTop: 4 }}>{[st.development || r.development, st.by, fmt(st.createdAt || r.createdAt)].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
              {isOpen && (
                <View style={{ marginTop: 12 }}>
                  {!!pic && <Image source={{ uri: pic }} style={{ width: '100%', height: 240, borderRadius: 12, backgroundColor: '#E4E9E6', marginBottom: 10 }} resizeMode="contain" />}
                  {[
                    ['Area', st.areaSqFt ? `${st.areaSqFt} sq ft` : ''],
                    ['Thickness', st.thicknessIn ? `${st.thicknessIn} in` : ''],
                    ['Concrete', st.orderCubicYards ? `${st.orderCubicYards} cu yd to order (${st.cubicYards} exact)` : ''],
                    ['Sheets', st.sheets ? String(st.sheets) : ''],
                    ['Tiles', st.tiles ? `${st.tiles} (${st.tileWidthIn}×${st.tileHeightIn} in)` : ''],
                    ['Boxes', st.boxes ? String(st.boxes) : ''],
                    ['Paint', st.gallons ? `${st.gallons} gal (${st.coats} coats)` : ''],
                    ['Door size', st.doorSize || ''],
                    [st.material === 'ceiling' ? 'Rafters' : 'Joists', st.members ? `${st.members} @ ${st.spacingIn || 16}" OC${st.memberLengthFt ? ` × ${st.memberLengthFt} ft` : ''}` : ''],
                    ['Note', st.note || ''],
                  ].filter(([, v]) => v).map(([k, v]) => (
                    <View key={String(k)} style={{ flexDirection: 'row', marginBottom: 4 }}>
                      <Text style={{ width: 90, color: '#8A928C', fontSize: 13 }}>{k}</Text>
                      <Text style={{ flex: 1, color: '#1F2A24', fontSize: 13 }}>{String(v)}</Text>
                    </View>
                  ))}
                  {Array.isArray(st.items) && st.items.length > 0 && (
                    <View style={{ marginTop: 4 }}>
                      {st.items.map((it: any, i: number) => <Text key={i} style={{ color: '#1F2A24', fontSize: 13 }}>• {it.qty}× {it.name}</Text>)}
                    </View>
                  )}
                  <Pressable onPress={() => openPicker(r.id)} style={{ borderRadius: 12, backgroundColor: ACCENT, paddingVertical: 12, alignItems: 'center', marginTop: 10 }}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Send to a supervisor (attach to a job)</Text>
                  </Pressable>
                  <Text style={{ color: '#8A928C', fontSize: 12, marginTop: 6, textAlign: 'center' }}>Adds this picture and measurement to the job and alerts the supervisors you choose.</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <Modal visible={!!picker} animationType="slide" onRequestClose={() => setPicker(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F7F6' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
            <Pressable onPress={() => setPicker(null)} hitSlop={12}><Text style={{ color: ACCENT, fontWeight: '600', fontSize: 16 }}>Cancel</Text></Pressable>
            <Text style={{ flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 18, marginRight: 50 }}>Attach to…</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {!job && (<>
              <Text style={{ color: '#4A5560', marginBottom: 12 }}>Step 1 — pick the complaint or inspection this measurement belongs to.</Text>
              {(picker?.jobs || []).map((j) => (
                <Pressable key={j.entity + j.id} onPress={() => setJob(j)} style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E4E9E6', padding: 14, marginBottom: 10 }}>
                  <Text style={{ fontSize: 11, color: '#8A928C', marginBottom: 2 }}>{j.entity === 'resident-reports' ? 'COMPLAINT' : 'INSPECTION'}</Text>
                  <Text style={{ fontWeight: '700', fontSize: 15 }}>{j.title}</Text>
                  {!!j.subtitle && <Text style={{ color: '#4A5560', marginTop: 2 }} numberOfLines={2}>{j.subtitle}</Text>}
                </Pressable>
              ))}
            </>)}
            {job && !supervisors && (<>
              <Pressable onPress={() => setJob(null)} hitSlop={8}><Text style={{ color: ACCENT, fontWeight: '600', marginBottom: 8 }}>‹ {job.title}</Text></Pressable>
              <Text style={{ color: '#4A5560', marginBottom: 12 }}>Step 2 — who should see the picture and measurement?</Text>
              <Pressable disabled={attaching} onPress={() => send('development')} style={{ backgroundColor: ACCENT, borderRadius: 14, padding: 16, marginBottom: 10, opacity: attaching ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>This development's supervisors</Text>
                <Text style={{ color: '#E4F2EA', marginTop: 2, fontSize: 13 }}>Building management for the site and whoever sent you the job.</Text>
              </Pressable>
              <Pressable disabled={attaching} onPress={showSupervisors} style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: ACCENT, padding: 16, marginBottom: 10, opacity: attaching ? 0.6 : 1 }}>
                <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 15 }}>Just my supervisor…</Text>
                <Text style={{ color: '#4A5560', marginTop: 2, fontSize: 13 }}>Pick one supervisor or manager to send it to.</Text>
              </Pressable>
              <Pressable disabled={attaching} onPress={() => Alert.alert('Send to everyone?', 'All supervisors and management in the company will be alerted and can open the picture. Use this for an emergency.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Send to all', style: 'destructive', onPress: () => send('all') }])} style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#B42318', padding: 16, marginBottom: 10, opacity: attaching ? 0.6 : 1 }}>
                <Text style={{ color: '#B42318', fontWeight: '700', fontSize: 15 }}>EMERGENCY — all supervisors & management</Text>
                <Text style={{ color: '#4A5560', marginTop: 2, fontSize: 13 }}>Everyone in supervision and management sees it right away.</Text>
              </Pressable>
            </>)}
            {job && supervisors && (<>
              <Pressable onPress={() => setSupervisors(null)} hitSlop={8}><Text style={{ color: ACCENT, fontWeight: '600', marginBottom: 8 }}>‹ Who should see it</Text></Pressable>
              <Text style={{ color: '#4A5560', marginBottom: 12 }}>Pick the supervisor or manager.</Text>
              {supervisors.length === 0 && <Text style={{ color: '#8A928C' }}>No supervisors found.</Text>}
              {supervisors.map((sv) => (
                <Pressable key={sv.id} disabled={attaching} onPress={() => send('staff', sv.id)} style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E4E9E6', padding: 14, marginBottom: 8, opacity: attaching ? 0.6 : 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15 }}>{sv.name}</Text>
                  <Text style={{ color: '#4A5560', fontSize: 13 }}>{[sv.position, (sv.developments || []).slice(0, 3).join(', ')].filter(Boolean).join(' \u00b7 ')}</Text>
                </Pressable>
              ))}
            </>)}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
