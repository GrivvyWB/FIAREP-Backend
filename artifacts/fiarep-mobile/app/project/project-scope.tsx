import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform, Modal, Image, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getProjectScopeForm, setProjectScopeForm, getProject, getProcurementRequest, getCurrentActor, submitProjectScope, createChangeOrder } from '../../lib/store';
import {
  emptyScope, addSectionToScope, newLine,
  lineAmount, sectionTotal, grandTotal, costPerDU, SCOPE_CATALOG,
  type VendorScope, type ScopeLine,
} from '../../lib/vendorScope';
import { ui, ACCENT } from '../../lib/ui';
import { takePhoto, pickPhoto, photoUri } from '../../lib/photos';
import RemotePhoto from '../../components/RemotePhoto';
import PhotoViewer from '../../components/PhotoViewer';

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProjectScope() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const [scope, setScope] = useState<VendorScope>(emptyScope());
  const [pickDiv, setPickDiv] = useState<number | null>(null);   // index into SCOPE_CATALOG, or null
  const [divModal, setDivModal] = useState(false);
  const [secModal, setSecModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [coDesc, setCoDesc] = useState('');
  const [coCost, setCoCost] = useState('');
  const [coBusy, setCoBusy] = useState(false);
  const [coPhotos, setCoPhotos] = useState<string[]>([]);
  const [coViewer, setCoViewer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    getProjectScopeForm(projectId).then(async (saved: any) => {
      // Pull the sources for header pre-fill either way.
      const proj = await getProject(projectId).catch(() => null);
      const req = await getProcurementRequest(String(projectId)).catch(() => null);
      const actor = await getCurrentActor().catch(() => null);
      const base: any = (saved && Array.isArray(saved.divisions)) ? saved : emptyScope();
      const h = { ...(base.header || {}) };
      // Backfill only EMPTY fields so we never overwrite the CPM's own edits.
      const fill = (k: string, v: string) => { if (!h[k] && v) h[k] = v; };
      fill('projectName', (req && req.scope) || (proj ? proj.name : ''));
      fill('address', (req && req.address) || (proj ? proj.name : ''));
      fill('projectManager', (actor && actor.name) || '');
      fill('date', new Date().toLocaleDateString('en-US'));
      if (!h.multiBuilding) h.multiBuilding = 'NO';
      setScope({ ...base, header: h });
    });
  }, [projectId]);
  useFocusEffect(load);

  const save = (next: VendorScope) => { setScope(next); if (submitted) setSubmitted(false); if (projectId) setProjectScopeForm(projectId, next); };

  async function submitChangeOrder() {
    if (!coDesc.trim()) { Alert.alert('Describe the change', 'Enter what add-on work is needed.'); return; }
    const costNum = parseFloat(String(coCost).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(costNum) || costNum <= 0) { Alert.alert('Cost required', 'Enter the cost of the change (materials + labor + markup).'); return; }
    setCoBusy(true);
    try {
      const ref = (scope.header && scope.header.address) ? String(scope.header.address) : (scope.header && scope.header.projectName ? String(scope.header.projectName) : 'Scope');
      await createChangeOrder(String(projectId || ''), ref, '', '', coDesc.trim(), costNum, coPhotos);
      setCoDesc(''); setCoCost(''); setCoPhotos([]);
      Alert.alert('Change order submitted', 'Sent to management for approval.');
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Could not submit.'); }
    finally { setCoBusy(false); }
  }

  async function submitToSupervisor() {
    if (!projectId || submitting || submitted) return;
    if (scope.divisions.length === 0) { Alert.alert('Nothing to submit', 'Add at least one section of work first.'); return; }
    setSubmitting(true);
    try {
      // Persist the current scope, then send it to the supervisor. The vendor form
      // loads this same project_scopes record (prices stripped) once it reaches them.
      await setProjectScopeForm(String(projectId), scope);
      const name = (scope.header && scope.header.projectName) ? String(scope.header.projectName) : 'Scope of Work';
      const addr = (scope.header && scope.header.address) ? String(scope.header.address) : '';
      const r = await submitProjectScope(String(projectId), name, addr);
      if (r) { setSubmitted(true); Alert.alert('Submitted', 'Your Scope of Work was sent to your supervisor.'); }
      else Alert.alert('Not sent', 'Could not submit the scope.');
    } finally {
      setSubmitting(false);
    }
  }
  const setHeader = (k: string, v: string) => save({ ...scope, header: { ...scope.header, [k]: v } });

  const setLine = (di: number, si: number, li: number, k: keyof ScopeLine, v: string) => {
    const divisions = scope.divisions.map((d, i) => i !== di ? d : {
      ...d, sections: d.sections.map((sec, j) => j !== si ? sec : {
        ...sec, lines: sec.lines.map((l, k2) => k2 !== li ? l : { ...l, [k]: v }),
      }),
    });
    save({ ...scope, divisions });
  };
  const addLine = (di: number, si: number) => {
    const divisions = scope.divisions.map((d, i) => i !== di ? d : {
      ...d, sections: d.sections.map((sec, j) => j !== si ? sec : { ...sec, lines: [...sec.lines, newLine()] }),
    });
    save({ ...scope, divisions });
  };
  const removeLine = (di: number, si: number, li: number) => {
    const divisions = scope.divisions.map((d, i) => i !== di ? d : {
      ...d, sections: d.sections.map((sec, j) => j !== si ? sec : { ...sec, lines: sec.lines.filter((_, k2) => k2 !== li) }),
    });
    save({ ...scope, divisions });
  };
  const removeSection = (di: number, si: number) => {
    const divisions = scope.divisions
      .map((d, i) => i !== di ? d : { ...d, sections: d.sections.filter((_, j) => j !== si) })
      .filter((d) => d.sections.length > 0);
    save({ ...scope, divisions });
  };

  function chooseSection(sectionCode: string) {
    if (pickDiv == null) return;
    const divTitle = SCOPE_CATALOG[pickDiv].title;
    save(addSectionToScope(scope, divTitle, sectionCode));
    setSecModal(false); setPickDiv(null);
  }

  const HF = (label: string, key: string, placeholder = '') => (
    <View style={{ marginBottom: 6 }}>
      <Text style={ui.label}>{label}</Text>
      <TextInput style={ui.input} value={(scope.header as any)[key] ?? ''} onChangeText={(t) => setHeader(key, t)} placeholder={placeholder} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Scope of Work (Divisions)</Text>
      <Text style={ui.label}>Pick a division and section, then add the work and pricing.</Text>

      <View style={[ui.card, { gap: 2, marginTop: 8 }]}>
        {HF('Contractor', 'contractor', '')}
        {HF('Multi-Building Project? (YES/NO)', 'multiBuilding', 'NO')}
        {HF('Date', 'date', 'e.g. 8/30/2026')}
        {HF('Construction Project Manager', 'projectManager', 'Name')}
        {HF('Number of DUs', 'numDUs', 'e.g. 6')}
        {HF('Revision Date', 'revisionDate', '')}
        {HF('Project Name', 'projectName', '')}
        {HF('Address', 'address', '')}
      </View>

      <Pressable style={[ui.btn, { marginTop: 14 }]} onPress={() => setDivModal(true)}>
        <Text style={ui.btnText}>+ Add work (pick division / section)</Text>
      </Pressable>

      {scope.divisions.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No sections added yet. Tap "+ Add work" to start.</Text>}

      {scope.divisions.map((d, di) => (
        <View key={d.id} style={{ marginTop: 16 }}>
          <Text style={{ backgroundColor: '#d9ead3', fontWeight: '800', padding: 8, borderRadius: 6 }}>{d.title}</Text>
          {d.sections.map((sec, si) => (
            <View key={sec.id} style={[ui.card, { marginTop: 8, gap: 6 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', flex: 1 }}>{sec.code}</Text>
                <Pressable onPress={() => removeSection(di, si)}><Text style={{ color: '#c0392b', fontWeight: '600' }}>Remove</Text></Pressable>
              </View>
              {sec.lines.map((l, li) => (
                <View key={l.id} style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6, gap: 4 }}>
                  <TextInput style={[ui.input, { minHeight: 40 }]} value={l.description} onChangeText={(t) => setLine(di, si, li, 'description', t)} placeholder="Description of work" multiline />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <View style={{ flex: 1 }}><Text style={ui.label}>Qty</Text><TextInput style={ui.input} value={l.quantity} onChangeText={(t) => setLine(di, si, li, 'quantity', t)} placeholder="0" keyboardType="numeric" /></View>
                    <View style={{ flex: 1 }}><Text style={ui.label}>Unit</Text><TextInput style={ui.input} value={l.unit} onChangeText={(t) => setLine(di, si, li, 'unit', t)} placeholder="Each" /></View>
                    <View style={{ flex: 1.2 }}><Text style={ui.label}>Unit Cost</Text><TextInput style={ui.input} value={l.unitCost} onChangeText={(t) => setLine(di, si, li, 'unitCost', t)} placeholder="$" keyboardType="numeric" /></View>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '600' }}>Amount: {money(lineAmount(l))}</Text>
                    {sec.lines.length > 1 && <Pressable onPress={() => removeLine(di, si, li)}><Text style={{ color: '#c0392b', fontWeight: '600' }}>Remove line</Text></Pressable>}
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#ddd', paddingTop: 6 }}>
                <Pressable onPress={() => addLine(di, si)}><Text style={{ color: ACCENT, fontWeight: '600' }}>+ Add line</Text></Pressable>
                <Text style={{ fontWeight: '700' }}>Sub-Total {money(sectionTotal(sec))}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}

      {scope.divisions.length > 0 && (
        <View style={[ui.card, { borderColor: ACCENT, borderWidth: 1.5, marginTop: 16, gap: 6 }]}>
          <View style={ui.line}><Text style={[ui.lineK, { fontWeight: '700', color: '#000' }]}>Grand Total Construction Cost</Text><Text style={[ui.lineV, { fontWeight: '700' }]}>{money(grandTotal(scope))}</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>Cost Per D.U.</Text><Text style={ui.lineV}>{money(costPerDU(scope))}</Text></View>
        </View>
      )}

      {scope.divisions.length > 0 && (
        <Pressable
          style={[ui.btn, { marginTop: 16 }, (submitting || submitted) && { opacity: 0.5 }]}
          onPress={submitToSupervisor}
          disabled={submitting || submitted}
        >
          <Text style={ui.btnText}>{submitted ? 'Submitted' : submitting ? 'Submitting\u2026' : 'Submit to supervisor'}</Text>
        </Pressable>
      )}

      <View style={[ui.card, { marginTop: 16, gap: 6 }]}>
        <Text style={{ fontWeight: '700' }}>Change work order (add-on)</Text>
        <Text style={ui.label}>New work found on this job? Submit an add-on with its cost to management.</Text>
        <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} value={coDesc} onChangeText={setCoDesc} placeholder="Describe the add-on work" multiline />
        <Text style={ui.label}>Cost of change (materials + labor + markup)</Text>
        <TextInput style={ui.input} value={coCost} onChangeText={setCoCost} placeholder="$" keyboardType="numeric" />
        <Text style={ui.label}>Photos (optional)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {coPhotos.map((uri, i) => (
            <TouchableOpacity key={`${uri}-${i}`} onPress={() => setCoViewer(uri)}>
              <RemotePhoto localUri={uri} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#eee' }} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await takePhoto(); if (u) setCoPhotos((p) => [...p, u]); } catch (e: any) { Alert.alert('Camera', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Take photo</Text></Pressable>
          <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await pickPhoto(); if (u) setCoPhotos((p) => [...p, u]); } catch (e: any) { Alert.alert('Photos', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Add from library</Text></Pressable>
        </View>
        <Pressable style={[ui.btn, coBusy && { opacity: 0.6 }]} onPress={submitChangeOrder} disabled={coBusy}>
          <Text style={ui.btnText}>Submit change order to management</Text>
        </Pressable>
      </View>

      <View style={{ height: 60 }} />
      <PhotoViewer uri={coViewer} onClose={() => setCoViewer(null)} />

      {/* Division picker */}
      <Modal visible={divModal} transparent animationType="slide" onRequestClose={() => setDivModal(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Pick a division</Text>
            <ScrollView>
              {SCOPE_CATALOG.map((c, i) => (
                <Pressable key={i} onPress={() => { setPickDiv(i); setDivModal(false); setSecModal(true); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontWeight: '600' }}>{c.title}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setDivModal(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

      {/* Section picker */}
      <Modal visible={secModal} transparent animationType="slide" onRequestClose={() => setSecModal(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>{pickDiv != null ? SCOPE_CATALOG[pickDiv].title : 'Pick a section'}</Text>
            <ScrollView>
              {pickDiv != null && SCOPE_CATALOG[pickDiv].sections.map((s, i) => (
                <Pressable key={i} onPress={() => chooseSection(s)} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text>{s}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => { setSecModal(false); setPickDiv(null); }} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
