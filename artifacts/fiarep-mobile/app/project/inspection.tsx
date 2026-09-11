import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getInspection, setInspection } from '../../lib/store';
import { INSPECTION_TEMPLATE, inspectionProgress, EMPTY_INSPECTION, OVERVIEW_CATEGORIES, ACTION_PRIORITIES,
  type InspectionState, type Finding, type ActionRow } from '../../lib/inspection';
import { ui } from '../../lib/ui';
import { useAppMode } from '../_layout';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildInspectionHTML } from '../../lib/inspectionReport';
import { captureGeo } from '../../lib/geo';


const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export default function Inspection() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { mode } = useAppMode();
  const readOnly = mode === 'administrator';
  const [state, setState] = useState<InspectionState>(EMPTY_INSPECTION);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    if (projectId) getInspection(projectId).then((s: any) =>
      setState(s && s.items ? s : EMPTY_INSPECTION));
  }, [projectId]);
  useFocusEffect(load);

  const save = (next: InspectionState) => {
    setState(next);
    if (projectId) setInspection(projectId, next);
  };

  const ov = state.overview ?? { categorySummaries: {}, actions: [] };
  const setOverview = (patch: Partial<NonNullable<InspectionState['overview']>>) =>
    save({ ...state, overview: { ...ov, ...patch } });
  const setCatSummary = (cat: string, text: string) =>
    setOverview({ categorySummaries: { ...(ov.categorySummaries ?? {}), [cat]: text } });
  const addAction = () =>
    setOverview({ actions: [...(ov.actions ?? []), { id: uid(), category: '', action: '', priority: '' } as ActionRow] });
  const updateAction = (id: string, patch: Partial<ActionRow>) =>
    setOverview({ actions: (ov.actions ?? []).map(a => a.id === id ? { ...a, ...patch } : a) });
  const removeAction = (id: string) =>
    setOverview({ actions: (ov.actions ?? []).filter(a => a.id !== id) });

  const addApartment = () =>
    save({ ...state, apartments: [...state.apartments, { id: uid(), label: '' }] });
  const setAptLabel = (id: string, label: string) =>
    save({ ...state, apartments: state.apartments.map(a => a.id === id ? { ...a, label } : a) });
  const removeApartment = (id: string) =>
    save({
      ...state,
      apartments: state.apartments.filter(a => a.id !== id),
      items: Object.fromEntries(Object.entries(state.items).map(([k, v]) => [k, {
        ...v, findings: (v.findings ?? []).map(f => ({ ...f, aptIds: f.aptIds.filter(x => x !== id) })),
      }])),
    });

  const pickBuilding = (itemId: string, choice: string) => {
    const cur = state.items[itemId] ?? {};
    const next = cur.choice === choice ? undefined : choice;
    save({ ...state, items: { ...state.items, [itemId]: { ...cur, choice: next } } });
  };
  const setBuildingNote = (itemId: string, note: string) => {
    const cur = state.items[itemId] ?? {};
    save({ ...state, items: { ...state.items, [itemId]: { ...cur, note } } });
  };

  const addFinding = (itemId: string) => {
    const cur = state.items[itemId] ?? {};
    const findings = [...(cur.findings ?? []), { id: uid(), aptIds: [], choice: undefined, note: '' } as Finding];
    save({ ...state, items: { ...state.items, [itemId]: { ...cur, findings } } });
  };
  const updateFinding = (itemId: string, fid: string, patch: Partial<Finding>) => {
    const cur = state.items[itemId] ?? {};
    const findings = (cur.findings ?? []).map(f => f.id === fid ? { ...f, ...patch } : f);
    save({ ...state, items: { ...state.items, [itemId]: { ...cur, findings } } });
  };
  const removeFinding = (itemId: string, fid: string) => {
    const cur = state.items[itemId] ?? {};
    const findings = (cur.findings ?? []).filter(f => f.id !== fid);
    save({ ...state, items: { ...state.items, [itemId]: { ...cur, findings } } });
  };
  const toggleFindingApt = (itemId: string, fid: string, aptId: string) => {
    const cur = state.items[itemId] ?? {};
    const findings = (cur.findings ?? []).map(f => {
      if (f.id !== fid) return f;
      const has = f.aptIds.includes(aptId);
      return { ...f, aptIds: has ? f.aptIds.filter(x => x !== aptId) : [...f.aptIds, aptId] };
    });
    save({ ...state, items: { ...state.items, [itemId]: { ...cur, findings } } });
  };

  const generateReport = async () => {
    try {
      const html = buildInspectionHTML(state, 'Building Inspection');
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Inspection Report' });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e) {
      // swallow: user may cancel the share sheet
    }
  };
  const toggleSection = (t: string) => setOpen(o => ({ ...o, [t]: !o[t] }));
  const prog = inspectionProgress(state);

  const chip = (label: string, selected: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key ?? label} onPress={() => { if (readOnly) return; onPress(); }} style={{
      borderWidth: 1, borderColor: selected ? '#185FA5' : '#ccc',
      backgroundColor: selected ? '#185FA5' : '#fff',
      borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12,
    }}>
      <Text style={{ color: selected ? '#fff' : '#333', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  const onCaptureGeo = async () => {
    try {
      const g = await captureGeo();
      save({ ...state, geo: g });
      Alert.alert('Location stamped', 'GPS and time recorded for this inspection.');
    } catch (e) {
      Alert.alert('Location error', 'Could not capture location.');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 13, color: '#666' }}>{prog.done} of {prog.total} items recorded</Text>
      <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={generateReport}>
        <Text style={ui.btnOutlineText}>Generate Report (PDF)</Text>
      </Pressable>
      <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={onCaptureGeo}>
        <Text style={ui.btnOutlineText}>Capture GPS + Time</Text>
      </Pressable>
      {state.geo && (
        <Text style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
          Stamped: {state.geo.lat?.toFixed(5)}, {state.geo.lng?.toFixed(5)}
        </Text>
      )}

      <View style={ui.card}>
        <Pressable onPress={() => toggleSection('__overview')}>
          <Text style={ui.cardTitle}>📋  Building Overview  {(open['__overview'] ?? true) ? '\u25be' : '\u25b8'}</Text>
        </Pressable>
        {(open['__overview'] ?? true) && (
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', marginTop: 4, marginBottom: 4 }}>Total Violations</Text>
            <TextInput editable={!readOnly} value={ov.totalViolations ?? ''} onChangeText={t => setOverview({ totalViolations: t })}
              placeholder="e.g. 296" placeholderTextColor="#999" keyboardType="numeric"
              style={[ui.input, { marginBottom: 10 }]} />

            <Text style={{ fontSize: 13, fontWeight: '500', marginBottom: 4 }}>Scope</Text>
            <TextInput editable={!readOnly} value={ov.scope ?? ''} onChangeText={t => setOverview({ scope: t })}
              placeholder="e.g. Interior of apartments, exterior, and common areas" placeholderTextColor="#999"
              style={[ui.input, { marginBottom: 10, minHeight: 40 }]} multiline />

            <Text style={{ fontSize: 13, fontWeight: '600', marginTop: 4, marginBottom: 6 }}>Condition Summary by Category</Text>
            {OVERVIEW_CATEGORIES.map(cat => (
              <View key={cat} style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>{cat}</Text>
                <TextInput editable={!readOnly} value={(ov.categorySummaries ?? {})[cat] ?? ''} onChangeText={t => setCatSummary(cat, t)}
                  placeholder={`${cat} condition\u2026`} placeholderTextColor="#999"
                  style={[ui.input, { minHeight: 38 }]} multiline />
              </View>
            ))}

            <Text style={{ fontSize: 13, fontWeight: '600', marginTop: 8, marginBottom: 6 }}>Summary of Required Actions</Text>
            {(ov.actions ?? []).map(a => (
              <View key={a.id} style={{ padding: 10, backgroundColor: '#f7f7f7', borderRadius: 8, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 12, color: '#666', fontWeight: '500' }}>Action</Text>
                  <Pressable onPress={() => removeAction(a.id)}><Text style={{ color: '#c00', fontSize: 12 }}>Remove</Text></Pressable>
                </View>
                <TextInput editable={!readOnly} value={a.category} onChangeText={t => updateAction(a.id, { category: t })}
                  placeholder="Category (e.g. Structural)" placeholderTextColor="#999"
                  style={[ui.input, { marginBottom: 6, backgroundColor: '#fff' }]} />
                <TextInput editable={!readOnly} value={a.action} onChangeText={t => updateAction(a.id, { action: t })}
                  placeholder="Action needed" placeholderTextColor="#999"
                  style={[ui.input, { marginBottom: 6, backgroundColor: '#fff', minHeight: 36 }]} multiline />
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {ACTION_PRIORITIES.map(p => chip(p, a.priority === p, () => updateAction(a.id, { priority: a.priority === p ? '' : p }), p))}
                </View>
              </View>
            ))}
            <Pressable style={[ui.btnOutline, { paddingVertical: 8 }]} onPress={addAction}>
              <Text style={[ui.btnOutlineText, { fontSize: 13 }]}>+ Add required action</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={ui.card}>
        <Text style={ui.cardTitle}>🏢  Apartments in this building</Text>
        {state.apartments.length === 0 && (
          <Text style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>
            No apartments yet. Add the units this building has (e.g. 2R, 1L, 4C).
          </Text>
        )}
        {state.apartments.map(a => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <TextInput editable={!readOnly}
              value={a.label}
              onChangeText={t => setAptLabel(a.id, t)}
              placeholder="Apartment # (e.g. 2R)"
              placeholderTextColor="#999"
              style={[ui.input, { flex: 1 }]}
            />
            <Pressable onPress={() => removeApartment(a.id)}>
              <Text style={{ color: '#c00', fontSize: 13, paddingHorizontal: 8 }}>Remove</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={addApartment}>
          <Text style={ui.btnOutlineText}>+ Add apartment</Text>
        </Pressable>
      </View>

      {INSPECTION_TEMPLATE.map(section => {
        const isOpen = open[section.title] ?? true;
        return (
          <View key={section.title} style={ui.card}>
            <Pressable onPress={() => toggleSection(section.title)}>
              <Text style={ui.cardTitle}>{section.icon}  {section.title}  {isOpen ? '▾' : '▸'}</Text>
            </Pressable>

            {isOpen && section.items.map(item => {
              const rec = state.items[item.id] ?? {};
              const findings = rec.findings ?? [];
              return (
                <View key={item.id} style={{ marginBottom: 18 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6 }}>{item.label}</Text>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                    {item.options.map(opt => chip(opt, rec.choice === opt, () => pickBuilding(item.id, opt), opt))}
                  </View>
                  <TextInput editable={!readOnly}
                    value={rec.note ?? ''}
                    onChangeText={t => setBuildingNote(item.id, t)}
                    placeholder="Notes…"
                    placeholderTextColor="#999"
                    style={[ui.input, { minHeight: 38 }]}
                    multiline
                  />

                  {findings.map(f => (
                    <View key={f.id} style={{ marginTop: 8, padding: 10, backgroundColor: '#f7f7f7', borderRadius: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={{ fontSize: 12, color: '#666', fontWeight: '500' }}>Observation</Text>
                        <Pressable onPress={() => removeFinding(item.id, f.id)}>
                          <Text style={{ color: '#c00', fontSize: 12 }}>Remove</Text>
                        </Pressable>
                      </View>
                      {state.apartments.length === 0 ? (
                        <Text style={{ color: '#999', fontSize: 12, marginBottom: 6 }}>Optional: add apartments above to tag specific units.</Text>
                      ) : (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                          {state.apartments.map(a =>
                            chip(a.label || '(unnamed)', f.aptIds.includes(a.id), () => toggleFindingApt(item.id, f.id, a.id), a.id))}
                        </View>
                      )}
                      <TextInput editable={!readOnly}
                        value={f.note ?? ''}
                        onChangeText={t => updateFinding(item.id, f.id, { note: t })}
                        placeholder="Describe the observation (apartment, hallway, cellar, roof, etc.)…"
                        placeholderTextColor="#999"
                        style={[ui.input, { minHeight: 44, backgroundColor: '#fff' }]}
                        multiline
                      />
                    </View>
                  ))}

                  <Pressable style={[ui.btnOutline, { marginTop: 8, paddingVertical: 8 }]} onPress={() => addFinding(item.id)}>
                    <Text style={[ui.btnOutlineText, { fontSize: 13 }]}>+ Add observation</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        );
      })}

      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
