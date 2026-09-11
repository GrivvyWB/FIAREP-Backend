import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { lookupNycProperty, type NycPropertyLookup } from '@workspace/api-client-react';
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
  const { preBuilding, preUnit, preViolationNo, preNote } = useLocalSearchParams<{ preBuilding?: string; preUnit?: string; preViolationNo?: string; preNote?: string }>();
  const [building, setBuilding] = useState('');
  const [assignedUnit, setAssignedUnit] = useState('');
  const [violationNo, setViolationNo] = useState('');
  const [prefilled, setPrefilled] = useState(false);

  const [query, setQuery] = useState('');
  const [pickedCode, setPickedCode] = useState<string>('');
  const [pickedDesc, setPickedDesc] = useState<string>('');
  const [pickedFull, setPickedFull] = useState<string>('');
  const [pickedHint, setPickedHint] = useState<string>('');
  const [hazard, setHazard] = useState<HazardClass | null>(null);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<BuildingViolation[]>([]);
  const [lookupData, setLookupData] = useState<NycPropertyLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string>('');

  const load = useCallback(() => {
    if (building.trim()) listBuildingViolations(building, violationNo).then(setItems);
    else setItems([]);
  }, [building, violationNo]);
  useFocusEffect(load);

  async function lookupAddress(address: string) {
    if (!address.trim()) return;
    setLookupLoading(true);
    setLookupError('');
    setLookupData(null);
    try {
      const res = await lookupNycProperty({ address: address.trim(), limit: 25 });
      setLookupData(res);
    } catch (err: any) {
      setLookupError(err?.message || 'Lookup failed.');
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleLookup() {
    await lookupAddress(building);
  }

  useFocusEffect(
    useCallback(() => {
      if (prefilled) return;
      if (preBuilding || preUnit || preViolationNo || preNote) {
        const address = preBuilding ? String(preBuilding) : '';
        setBuilding(address);
        if (preUnit) setAssignedUnit(String(preUnit));
        if (preViolationNo) setViolationNo(String(preViolationNo));
        if (preNote) setNotes(String(preNote));
        setPrefilled(true);
        if (address.trim()) lookupAddress(address).catch(() => undefined);
      }
    }, [preBuilding, preUnit, preViolationNo, preNote, prefilled])
  );

  const normalizedUnit = assignedUnit.trim().toLowerCase().replace(/^(apartment|apt|unit|#)\s*/i, '').replace(/^0+/, '');
  const matchesAssignedUnit = (apartment?: string | null) => {
    if (!normalizedUnit || !apartment) return false;
    return apartment.trim().toLowerCase().replace(/^(apartment|apt|unit|#)\s*/i, '').replace(/^0+/, '') === normalizedUnit;
  };
  const hpdViolations = lookupData
    ? [...lookupData.hpdViolations].sort((a, b) => Number(matchesAssignedUnit(b.apartment)) - Number(matchesAssignedUnit(a.apartment)))
    : [];
  const hpdComplaints = lookupData
    ? [...lookupData.hpdComplaints].sort((a, b) => Number(matchesAssignedUnit(b.apartment)) - Number(matchesAssignedUnit(a.apartment)))
    : [];

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
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput style={[ui.input, { flex: 1 }]} value={building} onChangeText={setBuilding} placeholder="Building / address" autoCapitalize="words" />
        <Pressable style={building.trim() ? [ui.btn, { padding: 10 }] : [ui.btn, ui.btnMuted, { padding: 10 }]} onPress={handleLookup} disabled={!building.trim() || lookupLoading}>
          <Text style={ui.btnText}>{lookupLoading ? 'Wait' : 'Lookup'}</Text>
        </Pressable>
      </View>
      {!!assignedUnit && (
        <Text style={{ color: ACCENT, fontWeight: '700', marginTop: 6 }}>
          Assigned apartment/unit: {assignedUnit}
        </Text>
      )}
      {!!lookupError && <Text style={{ color: '#c0392b', marginTop: 4, fontSize: 13 }}>{lookupError}</Text>}
      {lookupData && (
        <View style={[ui.card, { marginTop: 8, backgroundColor: '#f9f9f9', padding: 12 }]}>
          <Text style={[ui.cardTitle, { marginBottom: 6 }]}>Official NYC Records</Text>
          <View style={ui.line}>
            <Text style={ui.lineK}>Address</Text>
            <Text style={ui.lineV}>{lookupData.property.formattedAddress}</Text>
          </View>
          <View style={ui.line}>
            <Text style={ui.lineK}>Boro / Blk / Lot</Text>
            <Text style={ui.lineV}>{lookupData.property.borough} / {lookupData.property.block} / {lookupData.property.lot}</Text>
          </View>
          {!!lookupData.property.bin && (
            <View style={ui.line}>
              <Text style={ui.lineK}>BIN</Text>
              <Text style={ui.lineV}>{lookupData.property.bin}</Text>
            </View>
          )}

          {lookupData.warnings && lookupData.warnings.length > 0 && (
            <View style={{ marginTop: 8, padding: 8, backgroundColor: '#fff3cd', borderRadius: 8 }}>
              {lookupData.warnings.map((w, i) => (
                <Text key={i} style={{ color: '#8a6d3b', fontSize: 13, fontWeight: '500' }}>Warning: {w}</Text>
              ))}
            </View>
          )}

          <Text style={[ui.h, { fontSize: 14, marginTop: 12 }]}>HPD Violations ({lookupData.summary.hpdViolations} building total, {lookupData.summary.openHpdViolations} open)</Text>
          {hpdViolations.length === 0 ? <Text style={ui.listSub}>No HPD violations found.</Text> : hpdViolations.map((v, i) => (
            <View key={v.id || i} style={{ marginTop: 6, padding: 8, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '600', color: ACCENT }}>Class {v.class || '?'}{v.apartment ? ` · Apt ${v.apartment}` : ''}</Text>
                <Text style={{ color: v.status === 'Open' ? '#c0392b' : '#1E7D4F', fontWeight: '600' }}>{v.status}</Text>
              </View>
              {matchesAssignedUnit(v.apartment) && <Text style={{ color: '#1E7D4F', fontWeight: '700', fontSize: 12, marginTop: 3 }}>Matches assigned unit</Text>}
              <Text style={{ fontSize: 13, marginTop: 4 }}>{v.description}</Text>
              {!!v.inspectionDate && <Text style={[ui.listSub, { marginTop: 4 }]}>Inspected: {v.inspectionDate}</Text>}
            </View>
          ))}

          <Text style={[ui.h, { fontSize: 14, marginTop: 12 }]}>DOB Violations ({lookupData.summary.dobViolations} total, {lookupData.summary.openDobViolations} open)</Text>
          {lookupData.dobViolations.length === 0 ? <Text style={ui.listSub}>No DOB violations found.</Text> : lookupData.dobViolations.map((v, i) => (
            <View key={v.id || i} style={{ marginTop: 6, padding: 8, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '600', color: ACCENT }}>{v.number || v.type}</Text>
                <Text style={{ color: v.status === 'Open' ? '#c0392b' : '#1E7D4F', fontWeight: '600' }}>{v.status}</Text>
              </View>
              <Text style={{ fontSize: 13, marginTop: 4 }}>{v.description}</Text>
              {!!v.issueDate && <Text style={[ui.listSub, { marginTop: 4 }]}>Issued: {v.issueDate}</Text>}
            </View>
          ))}

          <Text style={[ui.h, { fontSize: 14, marginTop: 12 }]}>HPD Complaints ({lookupData.summary.hpdComplaints} building total)</Text>
          {hpdComplaints.length === 0 ? <Text style={ui.listSub}>No HPD complaints found.</Text> : hpdComplaints.map((c, i) => (
            <View key={c.id || i} style={{ marginTop: 6, padding: 8, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '600', color: ACCENT, flex: 1 }} numberOfLines={1}>{c.majorCategory}</Text>
                <Text style={{ color: c.status === 'Open' ? '#c0392b' : '#1E7D4F', fontWeight: '600', marginLeft: 8 }}>{c.status}</Text>
              </View>
              {!!c.apartment && <Text style={ui.listSub}>Apartment: {c.apartment}</Text>}
              {matchesAssignedUnit(c.apartment) && <Text style={{ color: '#1E7D4F', fontWeight: '700', fontSize: 12, marginTop: 3 }}>Matches assigned unit</Text>}
              <Text style={{ fontSize: 13, marginTop: 4 }}>{c.description}</Text>
              {!!c.receivedDate && <Text style={[ui.listSub, { marginTop: 4 }]}>Received: {c.receivedDate}</Text>}
            </View>
          ))}

          <Text style={[ui.listSub, { marginTop: 12, textAlign: 'center' }]}>Retrieved: {fmt(lookupData.retrievedAt)}</Text>
        </View>
      )}

      <Text style={[ui.label, { marginTop: 12 }]}>Violation number</Text>
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
