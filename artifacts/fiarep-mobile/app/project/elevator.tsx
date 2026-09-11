import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, Alert, Image, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getElevator, setElevator, getCurrentPosition, getElevatorJob, completeElevatorJob, setElevatorProgress, type ElevatorJob } from '../../lib/store';
import { ELEVATOR_SECTIONS, ELEV_CONDITIONS, EMPTY_ELEVATOR, type ElevatorState } from '../../lib/elevator';
import { buildElevatorHTML } from '../../lib/elevatorReport';
import { ui, ACCENT } from '../../lib/ui';
import { takePhoto, pickPhoto, photoUri } from '../../lib/photos';
import PhotoViewer from '../../components/PhotoViewer';
import { useAppMode } from '../_layout';
import { captureGeo, geoLabel } from '../../lib/geo';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseNum = (v?: string) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };

export default function Elevator() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const { mode } = useAppMode();
  const readOnly = mode === 'administrator';
  const [s, setS] = useState<ElevatorState>(EMPTY_ELEVATOR);
  const [position, setPosition] = useState('');
  useFocusEffect(useCallback(() => { getCurrentPosition().then(setPosition).catch(() => {}); }, []));
  const WORKER_POSITIONS = ['Plumber', 'Electrician', 'Maintenance Worker', 'Carpenter', 'Staff Worker', 'Roofer', 'Elevator Service'];
  const hidePrice = position === 'Inspector' || WORKER_POSITIONS.includes(position);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [viewer, setViewer] = useState<string | null>(null);
  const [job, setJob] = useState<ElevatorJob | null>(null);

  const load = useCallback(() => {
    if (projectId) {
      (async () => {
        const v: any = await getElevator(projectId).catch(() => null);
        const job = await getElevatorJob(String(projectId)).catch(() => null);
        setJob(job);
        const base: ElevatorState = (v && v.items) ? v : EMPTY_ELEVATOR;
        if (job && (!base.header || !base.header.elevatorId)) {
          setS({ ...base, header: { ...(base.header || {}), elevatorId: job.elId } });
        } else {
          setS(base);
        }
      })();
    }
  }, [projectId]);
  useFocusEffect(load);

  const save = (next: ElevatorState) => { setS(next); if (projectId) setElevator(projectId, next); };
  const stampLocation = async () => {
    const geo = await captureGeo();
    save({ ...s, _geo: geo } as any);
    Alert.alert('Location stamped', geoLabel(geo) + (geo.source === 'none' ? '\n\n(GPS activates after the next app build; time recorded now.)' : ''));
  };
  const setHeader = (k: string, v: string) => save({ ...s, header: { ...s.header, [k]: v } });
  const setItem = (id: string, patch: any) => save({ ...s, items: { ...s.items, [id]: { ...(s.items[id] ?? {}), ...patch } } });
  const toggleSec = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const total = Object.values(s.items).reduce((sum, r: any) => sum + parseNum(r?.cost), 0);

  const generatePDF = async () => {
    try {
      const html = buildElevatorHTML(s);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Elevator Services' });
      else await Print.printAsync({ uri });
    } catch (e) {}
  };

  const condColor = (c?: string) => c === 'Repair' ? '#d68910' : c === 'Replace' ? '#c0392b' : c === 'Good' ? '#2e7d32' : '#888';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={[ui.wrap, { paddingBottom: 120 }]} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 17, fontWeight: '600' }}>Elevator Services</Text>
      {!hidePrice && <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={generatePDF}><Text style={ui.btnOutlineText}>Generate PDF</Text></Pressable>}
      <Pressable style={[ui.btnOutline, { marginTop: 6 }]} onPress={stampLocation}><Text style={ui.btnOutlineText}>{(s as any)._geo ? 'Location Stamped \u2713' : 'Stamp Location & Time'}</Text></Pressable>

      <View style={ui.card}>
        <Text style={ui.cardTitle}>Elevator Info</Text>
        {[['Elevator ID', 'elevatorId'], ['Type (traction/hydraulic)', 'type'], ['Location', 'location'], ['Date', 'date']].map(([lbl, k]) => (
          <View key={k} style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>{lbl}</Text>
            <TextInput editable={!readOnly} value={(s.header as any)[k] ?? ''} onChangeText={t => setHeader(k, t)} placeholder={lbl} placeholderTextColor="#999" style={ui.input} />
          </View>
        ))}
      </View>

      {ELEVATOR_SECTIONS.map(sec => {
        const isOpen = open[sec.id] ?? false;
        return (
          <View key={sec.id} style={ui.card}>
            <Pressable onPress={() => toggleSec(sec.id)}><Text style={ui.cardTitle}>{sec.icon}  {sec.title}  {isOpen ? '\u25be' : '\u25b8'}</Text></Pressable>
            {isOpen && sec.components.map(c => {
              const rec = s.items[c.id] ?? {};
              return (
                <View key={c.id} style={{ marginBottom: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
                  <Text style={{ fontSize: 14, fontWeight: '500' }}>{c.label}</Text>
                  {c.note && <Text style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{c.note}</Text>}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {ELEV_CONDITIONS.map(cond => {
                      const sel = rec.condition === cond;
                      return (
                        <Pressable key={cond} onPress={() => { if (readOnly) return; setItem(c.id, { condition: sel ? undefined : cond }); }}
                          style={{ borderWidth: 1, borderColor: sel ? condColor(cond) : '#ccc', backgroundColor: sel ? condColor(cond) : '#fff', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 12 }}>
                          <Text style={{ color: sel ? '#fff' : '#333', fontSize: 12 }}>{cond}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {!hidePrice && (rec.condition === 'Repair' || rec.condition === 'Replace') && (
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Cost</Text>
                        <TextInput editable={!readOnly} value={rec.cost ?? ''} onChangeText={t => setItem(c.id, { cost: t })} placeholder="$" placeholderTextColor="#999" keyboardType="numeric" style={ui.input} />
                      </View>
                    </View>
                  )}
                  <TextInput editable={!readOnly} value={rec.note ?? ''} onChangeText={t => setItem(c.id, { note: t })} placeholder="Notes…" placeholderTextColor="#999" style={[ui.input, { minHeight: 36 }]} multiline />
                </View>
              );
            })}
          </View>
        );
      })}

      {!hidePrice && (
      <View style={[ui.card, { borderColor: '#185FA5', marginTop: 12 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 16, fontWeight: '700' }}>Estimated Total</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#185FA5' }}>{money(total)}</Text>
        </View>
      </View>
      )}
      <View style={ui.card}>
        <Text style={ui.cardTitle}>Photos</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(s.photos || []).map((uri, i) => (
            <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
              <Image source={{ uri: photoUri(uri) }} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
            </TouchableOpacity>
          ))}
        </View>
        {!readOnly && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await takePhoto(); if (u) save({ ...s, photos: [...(s.photos || []), u] }); } catch (e: any) { Alert.alert('Camera', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Take Photo</Text></Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await pickPhoto(); if (u) save({ ...s, photos: [...(s.photos || []), u] }); } catch (e: any) { Alert.alert('Photos', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Choose Photo</Text></Pressable>
          </View>
        )}
      </View>
      {position === 'Elevator Service' && (
        <View style={{ gap: 8, marginTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              disabled={!!(job && job.onMyWayAt)}
              style={[ui.btnOutline, { flex: 1 }, job && job.onMyWayAt && { opacity: 0.45 }]}
              onPress={async () => { if (projectId) { const j = await setElevatorProgress(String(projectId), 'onMyWay'); setJob(j); } }}
            ><Text style={ui.btnOutlineText}>{job && job.onMyWayAt ? 'On my way \u2713' : 'On my way'}</Text></Pressable>
            <Pressable
              disabled={!!(job && job.startedAt)}
              style={[ui.btnOutline, { flex: 1 }, job && job.startedAt && { opacity: 0.45 }]}
              onPress={async () => { if (projectId) { const j = await setElevatorProgress(String(projectId), 'started'); setJob(j); } }}
            ><Text style={ui.btnOutlineText}>{job && job.startedAt ? 'Started \u2713' : 'Started job'}</Text></Pressable>
          </View>
          <Pressable
            disabled={!!(job && (job.completedAt || job.status === 'done'))}
            style={[ui.btn, job && (job.completedAt || job.status === 'done') && { opacity: 0.45 }]}
            onPress={async () => {
              if (!projectId) return;
              const j = await completeElevatorJob(String(projectId));
              setJob(j);
              Alert.alert('Submitted', 'The elevator report, address, and photos were sent to management.', [{ text: 'OK', onPress: () => router.back() }]);
            }}
          >
            <Text style={ui.btnText}>{job && (job.completedAt || job.status === 'done') ? 'Completed \u2713' : 'Job completion'}</Text>
          </Pressable>
        </View>
      )}
      <View style={{ height: 40 }} />
      <PhotoViewer uri={viewer} onClose={() => setViewer(null)} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
