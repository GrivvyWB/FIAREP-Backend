import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getCostEstimate, setCostEstimate, getProcurementRequest, getProject, type ProcurementRequest } from '../../lib/store';
import { COST_CATEGORIES, EMPTY_COST_ESTIMATE, type CostEstimateState } from '../../lib/costEstimate';
import { buildEstimateHTML } from '../../lib/estimateReport';
import { ui } from '../../lib/ui';
import { useAppMode } from '../_layout';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export default function Estimate() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { mode } = useAppMode();
  const readOnly = mode === 'administrator';
  const [state, setState] = useState<CostEstimateState>(EMPTY_COST_ESTIMATE);
  const [scopeRef, setScopeRef] = useState<ProcurementRequest | null>(null);
  const [catPicker, setCatPicker] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const load = useCallback(() => {
    if (projectId) getCostEstimate(projectId).then(async (s: any) => {
      let next: CostEstimateState = (s && s.rows) ? s : EMPTY_COST_ESTIMATE;
      // Auto-fill building address from the project name, and date with today,
      // but only when each is still empty so we never overwrite the CPM's edits.
      const haveAddr = String(next.header?.buildingAddress || '').trim();
      const haveDate = String(next.header?.date || '').trim();
      if (!haveAddr || !haveDate) {
        const proj = await getProject(projectId).catch(() => null);
        const addr = haveAddr || (proj ? proj.name : '');
        const today = haveDate || new Date().toLocaleDateString();
        next = { ...next, header: { ...next.header, buildingAddress: addr, date: today } };
        setCostEstimate(projectId, next);
      }
      setState(next);
    });
    if (projectId) getProcurementRequest(projectId).then((r) => setScopeRef(r)).catch(() => {});
  }, [projectId]);
  useFocusEffect(load);

  const save = (next: CostEstimateState) => {
    setState(next);
    if (projectId) setCostEstimate(projectId, next);
  };
  const setHeader = (k: string, v: string) =>
    save({ ...state, header: { ...state.header, [k]: v } });
  const setRow = (id: string, k: string, v: string) =>
    save({ ...state, rows: { ...state.rows, [id]: { ...(state.rows[id] ?? {}), [k]: v } } });
  const removeCategory = (id: string) => {
    const rows = { ...state.rows }; delete rows[id];
    save({ ...state, rows });
    setAdded(a => a.filter(x => x !== id));
  };
  const setTotal = (k: string, v: string) =>
    save({ ...state, totals: { ...state.totals, [k]: v } });

  const setUnits = (v: string) =>
    save({ ...state, totals: { ...state.totals, numUnits: v } });

  // auto-calc from category costs
  const parseNum = (v?: string) => {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const costEstimate = COST_CATEGORIES.reduce((sum, c) => sum + parseNum(state.rows[c.id]?.cost), 0);
  const contingency = costEstimate * 0.10;
  const totalCost = costEstimate + contingency;
  const units = parseNum((state.totals as any).numUnits);
  const costPerDU = units > 0 ? totalCost / units : 0;
  const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const generatePDF = async () => {
    try {
      const html = buildEstimateHTML(state);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Cost Estimate' });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e) {}
  };

  const label = (t: string) => <Text style={{ fontSize: 12, color: '#555', marginBottom: 3, marginTop: 6 }}>{t}</Text>;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 17, fontWeight: '600' }}>Nature of Work & Estimate of Cost</Text>

      <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={generatePDF}>
        <Text style={ui.btnOutlineText}>Generate PDF</Text>
      </Pressable>

      {!!scopeRef && (
        <View style={[ui.card, { borderColor: '#185FA5', borderWidth: 1.5 }]}>
          <Text style={{ fontWeight: '700', color: '#185FA5', marginBottom: 4 }}>Estimating this scope</Text>
          <Text style={{ fontSize: 15 }}>{scopeRef.scope || '(no scope text)'}</Text>
          {!!scopeRef.address && <Text style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{scopeRef.address}</Text>}
        </View>
      )}

      <View style={ui.card}>
        <Text style={ui.cardTitle}>Header</Text>
        {label('Company / Header')}
        <TextInput editable={!readOnly} value={state.header.companyName ?? ''} onChangeText={t => setHeader('companyName', t)}
          placeholder="Your company name" placeholderTextColor="#999" style={ui.input} />
        {label('Building Address')}
        <TextInput editable={!readOnly} value={state.header.buildingAddress ?? ''} onChangeText={t => setHeader('buildingAddress', t)}
          placeholder="e.g. 463 52nd Street BK" placeholderTextColor="#999" style={ui.input} />
        {label('Inspection Date(s)')}
        <TextInput editable={!readOnly} value={state.header.inspectionDates ?? ''} onChangeText={t => setHeader('inspectionDates', t)}
          placeholder="e.g. 7/16/2024, 10/11/2024" placeholderTextColor="#999" style={ui.input} />
        {label('Const. Project Manager')}
        <TextInput editable={!readOnly} value={state.header.projectManager ?? ''} onChangeText={t => setHeader('projectManager', t)}
          placeholder="Name" placeholderTextColor="#999" style={ui.input} />
        {label('Date')}
        <TextInput editable={!readOnly} value={state.header.date ?? ''} onChangeText={t => setHeader('date', t)}
          placeholder="e.g. 12/5/2024" placeholderTextColor="#999" style={ui.input} />
      </View>

      {!readOnly && (
        <Pressable style={[ui.btn, { marginTop: 4 }]} onPress={() => setCatPicker(true)}>
          <Text style={ui.btnText}>+ Add a category</Text>
        </Pressable>
      )}

      {COST_CATEGORIES.filter(cat => {
        const row = state.rows[cat.id] ?? {};
        const hasData = !!(row.location || row.description || row.cost);
        return hasData || added.includes(cat.id);
      }).map(cat => {
        const row = state.rows[cat.id] ?? {};
        return (
          <View key={cat.id} style={ui.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[ui.cardTitle, { flex: 1 }]}>{cat.title}</Text>
              {!readOnly && (
                <Pressable onPress={() => removeCategory(cat.id)} hitSlop={8}>
                  <Text style={{ color: '#c0392b', fontWeight: '600' }}>Remove</Text>
                </Pressable>
              )}
            </View>
            {label('Location')}
            <TextInput editable={!readOnly} value={row.location ?? ''} onChangeText={t => setRow(cat.id, 'location', t)}
              placeholder="Location" placeholderTextColor="#999" style={[ui.input, { minHeight: 40 }]} multiline />
            {label('Brief Description of Work Required')}
            <TextInput editable={!readOnly} value={row.description ?? ''} onChangeText={t => setRow(cat.id, 'description', t)}
              placeholder="Description of work (or 'No work needed')" placeholderTextColor="#999"
              style={[ui.input, { minHeight: 70 }]} multiline />
            {label('Estimate of Cost')}
            <TextInput editable={!readOnly} value={row.cost ?? ''} onChangeText={t => setRow(cat.id, 'cost', t)}
              placeholder="$" placeholderTextColor="#999" style={ui.input} />
          </View>
        );
      })}

      <Modal visible={catPicker} transparent animationType="slide" onRequestClose={() => setCatPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Pick a category</Text>
            <ScrollView>
              {COST_CATEGORIES.map(cat => (
                <Pressable key={cat.id} onPress={() => { setAdded(a => a.includes(cat.id) ? a : [...a, cat.id]); setCatPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15 }}>{cat.title}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setCatPicker(false)} style={{ padding: 16 }}><Text style={{ color: '#185FA5', fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

      <View style={ui.card}>
        <Text style={ui.cardTitle}>Totals</Text>
        {label('Number of Units (for Cost / DU)')}
        <TextInput editable={!readOnly} value={(state.totals as any).numUnits ?? ''} onChangeText={setUnits}
          placeholder="e.g. 6" placeholderTextColor="#999" keyboardType="numeric" style={ui.input} />
        <View style={{ marginTop: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14 }}>Cost Estimate</Text>
            <Text style={{ fontSize: 14, fontWeight: '500' }}>{money(costEstimate)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14 }}>Contingency (10%)</Text>
            <Text style={{ fontSize: 14, fontWeight: '500' }}>{money(contingency)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#ddd', paddingTop: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: '700' }}>Total</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#185FA5' }}>{money(totalCost)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14 }}>Cost / DU</Text>
            <Text style={{ fontSize: 14, fontWeight: '500' }}>{units > 0 ? money(costPerDU) : '— (enter units)'}</Text>
          </View>
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
