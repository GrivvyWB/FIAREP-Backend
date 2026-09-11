import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  addBuildingViolation,
  listBuildingViolations,
  deleteBuildingViolation,
  type BuildingViolation,
} from '../lib/store';
import { VIOLATION_CODES, HAZARD_CLASSES, type HazardClass } from '../lib/violationCodes';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

const CLASS_COLOR: Record<HazardClass, string> = { A: '#1E7D4F', B: '#B4741A', C: '#C0392B' };

export default function InspectorViolations() {
  const { preBuilding, preViolationNo, preNote } = useLocalSearchParams<{ preBuilding?: string; preViolationNo?: string; preNote?: string }>();
  const [building, setBuilding] = useState('');
  const [violationNo, setViolationNo] = useState('');
  const [prefilled, setPrefilled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (prefilled) return;
      if (preBuilding || preViolationNo || preNote) {
        if (preBuilding) setBuilding(String(preBuilding));
        if (preViolationNo) setViolationNo(String(preViolationNo));
        if (preNote) setNotes(String(preNote));
        setPrefilled(true);
      }
    }, [preBuilding, preViolationNo, preNote, prefilled])
  );
  const [query, setQuery] = useState('');
  const [pickedCode, setPickedCode] = useState<string>('');
  const [pickedDesc, setPickedDesc] = useState<string>('');
  const [pickedFull, setPickedFull] = useState<string>('');
  const [pickedHint, setPickedHint] = useState<string>('');
  const [hazard, setHazard] = useState<HazardClass | null>(null);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<BuildingViolation[]>([]);

  const load = useCallback(() => {
    if (building.trim()) listBuildingViolations(building, violationNo).then(setItems);
    else setItems([]);
  }, [building, violationNo]);
  useFocusEffect(load);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return VIOLATION_CODES.filter(
      c => c.code.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q),
    ).slice(0, 25);
  }, [query]);

  async function add() {
    if (!building.trim()) { Alert.alert('Missing', 'Enter the building.'); return; }
    if (!pickedCode) { Alert.alert('Missing', 'Search and pick a violation code.'); return; }
    if (!hazard) { Alert.alert('Missing', 'Pick a hazard class (A, B, or C).'); return; }
    try {
      await addBuildingViolation(building, violationNo, pickedCode, pickedDesc, hazard, notes);
      setPickedCode(''); setPickedDesc(''); setHazard(null); setNotes(''); setQuery('');
      load();
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    }
  }

  function onDelete(v: BuildingViolation) {
    Alert.alert('Remove violation?', v.code + ' from ' + v.building, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteBuildingViolation(v.id); load(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Log Violations</Text>
      <Text style={ui.label}>Building the supervisor assigned</Text>
      <TextInput style={ui.input} value={building} onChangeText={setBuilding} placeholder="Building / address" autoCapitalize="words" />
      <Text style={[ui.label, { marginTop: 8 }]}>Violation number</Text>
      <TextInput style={ui.input} value={violationNo} onChangeText={setViolationNo} placeholder="Number from supervisor" />

      <View style={[ui.card, { gap: 8, marginTop: 16 }]}>
        <Text style={{ fontWeight: '700' }}>Add a violation</Text>
        <Text style={ui.label}>Search by code number or keyword</Text>
        <TextInput style={ui.input} value={query} onChangeText={setQuery} placeholder="e.g. 550, mold, smoke detector" autoCapitalize="none" />

        {!pickedCode && matches.map((c) => (
          <Pressable key={c.code} onPress={() => { setPickedCode(c.code); setPickedDesc(c.desc); setPickedFull(c.full || ''); setPickedHint(c.hint || ''); setQuery(''); }} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <Text style={{ fontWeight: '700', color: ACCENT }}>{c.code}</Text>
            <Text style={{ fontSize: 13, color: '#333' }}>{c.desc}</Text>
          </Pressable>
        ))}
        {!pickedCode && !!query.trim() && matches.length === 0 && <Text style={ui.listSub}>No codes match.</Text>}

        {!!pickedCode && (
          <View style={{ backgroundColor: '#f2f7fb', borderRadius: 8, padding: 10, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: ACCENT }}>Code {pickedCode}</Text>
              <Pressable onPress={() => { setPickedCode(''); setPickedDesc(''); setPickedFull(''); setPickedHint(''); }}>
                <Text style={{ color: '#c0392b', fontWeight: '600' }}>Change</Text>
              </Pressable>
            </View>
            {!!pickedHint && <Text style={{ fontSize: 12, fontWeight: '700', color: '#B4741A' }}>Class {pickedHint.split('').join('/')}</Text>}
            <Text style={{ fontSize: 13 }}>{pickedFull || pickedDesc}</Text>
          </View>
        )}

        <Text style={[ui.label, { marginTop: 4 }]}>Hazard class</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {HAZARD_CLASSES.map((h) => {
            const on = hazard === h;
            return (
              <Pressable key={h} onPress={() => setHazard(h)} style={{ flex: 1, borderWidth: 1.5, borderColor: CLASS_COLOR[h], borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: on ? CLASS_COLOR[h] : '#fff' }}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: on ? '#fff' : CLASS_COLOR[h] }}>{h}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[ui.label, { marginTop: 4 }]}>Notes</Text>
        <TextInput style={[ui.input, { minHeight: 60 }]} value={notes} onChangeText={setNotes} placeholder="What you observed, location, etc." multiline />

        <Pressable style={[ui.btn, { marginTop: 4 }]} onPress={add}>
          <Text style={ui.btnText}>Add violation</Text>
        </Pressable>
      </View>

      <Text style={[ui.h, { fontSize: 16, marginTop: 20 }]}>Logged ({items.length})</Text>
      {items.length === 0 && <Text style={ui.empty}>None logged for this building yet.</Text>}
      {items.map((v) => (
        <View key={v.id} style={[ui.card, { gap: 4 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', color: ACCENT }}>Code {v.code}</Text>
            <View style={{ backgroundColor: CLASS_COLOR[v.hazardClass], borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Class {v.hazardClass}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 13, color: '#333' }}>{v.codeDesc}</Text>
          {!!v.notes && <Text style={{ fontSize: 13 }}>Notes: {v.notes}</Text>}
          <Text style={ui.listSub}>{v.loggedBy || 'Inspector'}  {fmt(v.loggedAt)}</Text>
          <Pressable onPress={() => onDelete(v)} style={{ marginTop: 2 }}>
            <Text style={{ color: '#c0392b', fontWeight: '600' }}>Remove</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
