import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { takePhoto, pickPhoto, photoUri, photoBase64 } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import { classifyViolationPhoto, type ViolationClassification } from '../lib/aiVision';
import { addBuildingViolation } from '../lib/store';
import AddressInput from '../components/AddressInput';
import { ui, ACCENT } from '../lib/ui';

const clsColor = (c: string) => c === 'A' ? { bg: '#fee2e2', fg: '#b91c1c' } : c === 'C' ? { bg: '#dcfce7', fg: '#166534' } : { bg: '#fef3c7', fg: '#92400e' };

export default function FiarepVision() {
  const router = useRouter();
  const { preBuilding } = useLocalSearchParams<{ preBuilding?: string }>();
  const [building, setBuilding] = useState(preBuilding ? String(preBuilding) : '');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ViolationClassification | null>(null);
  const [cls, setCls] = useState<'A' | 'B' | 'C'>('B');
  const [status, setStatus] = useState('');

  async function pick(fn: () => Promise<string | null>) {
    try { const u = await fn(); if (u) { setPhoto(u); setResult(null); setStatus(''); } }
    catch (e: any) { Alert.alert('Photo', String(e && e.message ? e.message : e)); }
  }

  async function analyze() {
    if (!photo) { Alert.alert('Photo needed', 'Take or upload an inspection photo first.'); return; }
    setBusy(true); setStatus('');
    try {
      const b64 = await photoBase64(photo);
      if (!b64) throw new Error('Could not read the photo.');
      const r = await classifyViolationPhoto(b64);
      setResult(r); setCls(r.classification);
    } catch (e: any) { Alert.alert('Analysis failed', String(e && e.message ? e.message : e)); }
    finally { setBusy(false); }
  }

  function cycleClass() { setCls((c) => c === 'A' ? 'B' : c === 'B' ? 'C' : 'A'); setStatus('Inspector adjusted to ' + (cls === 'A' ? 'B' : cls === 'B' ? 'C' : 'A') + '. Accept to save.'); }

  async function accept() {
    if (!result) return;
    if (!building.trim()) { Alert.alert('Address needed', 'Enter the building / address to save this violation.'); return; }
    try {
      const notes = 'AI Vision: ' + result.condition + (result.description ? ' \u2014 ' + result.description : '') + ' (AI ' + result.confidence + '%, ' + result.classification + '; inspector ' + cls + ')';
      await addBuildingViolation(building.trim(), '', result.hpCode || '', result.condition || '', cls, notes, photo ? [photo] : []);
      setStatus('\u2713 Classification ' + cls + ' confirmed and saved to FIAREP.');
      Alert.alert('Saved', 'Violation saved (Class ' + cls + ').', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert('Save failed', String(e && e.message ? e.message : e)); }
  }

  function reject() { setResult(null); setStatus('AI classification rejected. Nothing saved.'); }

  const cc = clsColor(cls);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>FIAREP Vision</Text>
      <Text style={ui.label}>AI-assisted inspection. Take a photo, get a suggested A/B/C classification, then confirm as the inspector.</Text>

      <Text style={[ui.label, { marginTop: 10 }]}>Building / address</Text>
      <AddressInput value={building} onChangeText={setBuilding} placeholder="e.g. 55 Hall St" />

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => pick(takePhoto)}><Text style={ui.btnText}>Take photo</Text></Pressable>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => pick(pickPhoto)}><Text style={ui.btnOutlineText}>Upload</Text></Pressable>
      </View>

      {!!photo && (
        <>
          <RemotePhoto localUri={photo} style={{ width: '100%', height: 260, borderRadius: 12, backgroundColor: '#111', marginTop: 12 }} resizeMode="contain" />
          <Pressable style={[ui.btn, { marginTop: 12 }, busy && { opacity: 0.6 }]} onPress={analyze} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.btnText}>Analyze Violation</Text>}
          </Pressable>
        </>
      )}

      {result && (
        <View style={{ marginTop: 18 }}>
          <View style={{ backgroundColor: '#fff7ed', padding: 12, borderRadius: 10, marginBottom: 14 }}>
            <Text style={{ color: '#9a3412', fontSize: 12 }}>⚠️ AI recommendation only. Inspector confirmation is required before this becomes an official FIAREP classification.</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: cc.bg }}>
              <Text style={{ fontSize: 32, fontWeight: '900', color: cc.fg }}>{cls}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>{result.condition}</Text>
              <Text style={{ color: '#667085', marginTop: 4 }}>AI confidence: {result.confidence}%</Text>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <View style={ui.line}><Text style={ui.lineK}>Suggested FIA Code</Text><Text style={ui.lineV}>{result.hpCode}</Text></View>
            <View style={ui.line}><Text style={ui.lineK}>Recommended trade</Text><Text style={ui.lineV}>{result.trade}</Text></View>
            <View style={ui.line}><Text style={ui.lineK}>Priority</Text><Text style={ui.lineV}>{result.priority}</Text></View>
            <View style={ui.line}><Text style={ui.lineK}>Classification</Text><Text style={[ui.lineV, { color: cc.fg, fontWeight: '700' }]}>Class {cls}</Text></View>
          </View>

          <View style={{ backgroundColor: '#f7f9fc', padding: 14, borderRadius: 10, marginTop: 12 }}>
            <Text style={{ fontWeight: '700', marginBottom: 4 }}>AI observation</Text>
            <Text style={{ lineHeight: 20 }}>{result.description}</Text>
          </View>

          <View style={{ gap: 8, marginTop: 16 }}>
            <Pressable style={[ui.btn, { backgroundColor: '#16a34a' }]} onPress={accept}><Text style={ui.btnText}>✓ Accept & save (Class {cls})</Text></Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={cycleClass}><Text style={ui.btnOutlineText}>Change A / B / C</Text></Pressable>
              <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#c0392b' }]} onPress={reject}><Text style={{ color: '#c0392b', fontWeight: '600', textAlign: 'center' }}>Reject</Text></Pressable>
            </View>
          </View>
        </View>
      )}

      {!!status && <Text style={{ marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: '#dcfce7', color: '#166534', fontWeight: '700' }}>{status}</Text>}
      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
