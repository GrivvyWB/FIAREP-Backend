// FIAREP Building Baseline — the walk-through (FIAREP staff) and the report.
// Every area reviewed, every issue photographed and located; FIAREP fills in
// the issue, trade, priority, repair, tools, materials and fixtures from the
// photo; findings are numbered by priority (P1-001 …) into the baseline report.
import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, Image, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getSessionIdentity } from '../lib/store';
import { takePhoto, pickPhoto, photoBase64 } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import { readHeading, requestSmartTicket } from '../lib/smartRepair';
import { getBaseline, updateBaseline, importViolations, uploadFindingPhoto, priorityFromTicket, tradeCategory, PRIORITY_COLOR, BAND_ICON, type Assessment, type Finding, type Priority } from '../lib/baseline';
import { ui } from '../lib/ui';

const NAVY = '#0B2A4A';
const BLUE = '#1C4E86';
const LEVELS: Array<{ p: Priority; title: string; note: string }> = [
  { p: 'Critical', title: 'Priority Level 1 - Immediate Action Required', note: 'Life safety hazards, active leaks, structural concerns, electrical hazards, gas-related issues, or conditions likely to cause further damage.' },
  { p: 'High', title: 'Priority Level 2 - High Priority', note: 'Conditions requiring prompt attention to avoid escalation, tenant complaints, or future violations.' },
  { p: 'Medium', title: 'Priority Level 3 - Medium Priority', note: 'Maintenance deficiencies requiring correction but not posing an immediate threat.' },
  { p: 'Low', title: 'Priority Level 4 - Low Priority', note: 'Cosmetic or non-urgent maintenance items.' },
];
const blank = (area: string): Finding => ({ id: '', area, floor: '', unit: '', wall: '', issue: '', description: '', trade: '', priority: 'Medium', time: '', action: '', tools: [], materials: [], fixtures: [], photos: [], existing: false, sourceRef: '', status: 'open', createdAt: '' });

function Panel({ title, children, color = BLUE }: { title: string; children: React.ReactNode; color?: string }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#dbe3ee' }}>
      <View style={{ backgroundColor: color, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{title.toUpperCase()}</Text></View>
      <View style={{ padding: 12, gap: 6 }}>{children}</View>
    </View>
  );
}

export default function BaselineAssess() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [a, setA] = useState<Assessment | null>(null);
  const [fiarep, setFiarep] = useState(false);
  const [openArea, setOpenArea] = useState<string | null>(null);
  // The area whose note box is open, and the note being written in it.
  const [noteArea, setNoteArea] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaved, setNoteSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState<Finding>(blank(''));
  const [photo, setPhoto] = useState<string | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [sign, setSign] = useState({ inspector: '', representative: '', date: '' });

  const load = useCallback(() => {
    void (async () => {
      const ident = await getSessionIdentity().catch(() => null);
      setFiarep((ident?.tenantId || 'default') === 'default');
      try { const x = await getBaseline(String(id)); setA(x); setSign({ inspector: x.signatures.inspector || x.inspector, representative: x.signatures.representative, date: x.signatures.date || new Date().toLocaleDateString() }); }
      catch (e: any) { Alert.alert('Baseline', String(e?.message || e)); }
    })();
  }, [id]);
  useFocusEffect(load);

  if (!a) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  const editable = fiarep && a.status === 'in_progress';
  const save = async (patch: Parameters<typeof updateBaseline>[1], label = 'Saving…') => {
    setBusy(label);
    try { setA(await updateBaseline(a.id, patch)); } catch (e: any) { Alert.alert('Baseline', String(e?.message || e)); }
    finally { setBusy(''); }
  };
  const findingsIn = (area: string) => a.findings.filter((f) => f.area === area).length;
  const set = (k: keyof Finding, v: any) => setDraft((d) => ({ ...d, [k]: v }));

  async function shoot(fn: () => Promise<string | null>) {
    const u = await fn().catch(() => null);
    if (!u) return;
    setPhoto(u); setHeading(await readHeading());
  }
  async function analyze() {
    if (!photo) return;
    setBusy('FIAREP is reading the photo…');
    try {
      const b64 = await photoBase64(photo);
      if (!b64) throw new Error('Could not read the photo.');
      const t = await requestSmartTicket({ image: b64, heading, address: a!.address, area: [openArea, draft.floor && 'Floor ' + draft.floor, draft.unit && 'Unit ' + draft.unit].filter(Boolean).join(' · ') });
      setDraft((d) => ({ ...d, issue: t.issueFound, description: t.issueDetail || t.repairRequired, trade: tradeCategory(t.trade), priority: priorityFromTicket(t.priority, t.priorityNote), time: t.estimatedTime, action: t.repairRequired, tools: t.tools, materials: t.supplies, fixtures: t.fixtures, wall: d.wall || t.exactArea }));
    } catch (e: any) { Alert.alert('Analyze', String(e?.message || e)); }
    finally { setBusy(''); }
  }
  async function saveFinding() {
    if (!draft.issue.trim()) { Alert.alert('Finding', 'Describe the issue (or analyze the photo).'); return; }
    setBusy('Saving finding…');
    try {
      const photos = photo ? [await uploadFindingPhoto(photo)] : [];
      const f: Finding = { ...draft, id: '', photos, createdAt: new Date().toISOString() };
      setA(await updateBaseline(a!.id, { findings: [...a!.findings, f], areas: { ...a!.areas, [openArea || draft.area]: true } }));
      setOpenArea(null); setPhoto(null); setDraft(blank(''));
    } catch (e: any) { Alert.alert('Finding', String(e?.message || e)); }
    finally { setBusy(''); }
  }
  const removeFinding = (f: Finding) => Alert.alert('Remove this finding?', f.issue, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void save({ findings: a.findings.filter((x) => x.id !== f.id) }) }]);
  const toggleRepaired = (f: Finding) => void save({ findings: a.findings.map((x) => (x.id === f.id ? { ...x, status: x.status === 'repaired' ? 'open' : 'repaired' } : x)) });

  // Each area has its own note box: what you see, written down, with photos.
  const hasNote = (ar: string) => !!(a.areaNotes?.[ar]?.note || a.areaNotes?.[ar]?.photos.length);
  const toggleNote = (ar: string) => {
    if (noteArea === ar) { setNoteArea(null); return; }
    setNoteArea(ar); setNoteText(a.areaNotes?.[ar]?.note || ''); setNoteSaved(null);
  };
  const notesWith = (ar: string, note: string, photos: string[]) => ({ ...(a.areaNotes || {}), [ar]: { note, photos } });
  async function saveNote(ar: string) {
    setNoteSaved(null);
    await save({ areaNotes: notesWith(ar, noteText.trim(), a!.areaNotes?.[ar]?.photos || []), areas: { ...a!.areas, [ar]: true } }, 'Saving note…');
    setNoteSaved(ar);
  }
  async function addAreaPhoto(ar: string, fn: () => Promise<string | null>) {
    const u = await fn().catch(() => null);
    if (!u) return;
    setBusy('Saving photo…');
    try {
      const path = await uploadFindingPhoto(u);
      // The note typed so far is kept with the photo.
      setA(await updateBaseline(a!.id, { areaNotes: notesWith(ar, noteText.trim(), [...(a!.areaNotes?.[ar]?.photos || []), path]), areas: { ...a!.areas, [ar]: true } }));
    } catch (e: any) { Alert.alert('Photo', String(e?.message || e)); }
    finally { setBusy(''); }
  }
  const removeAreaPhoto = (ar: string, p: string) => Alert.alert('Remove this photo?', ar, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void save({ areaNotes: notesWith(ar, a!.areaNotes?.[ar]?.note || '', (a!.areaNotes?.[ar]?.photos || []).filter((x) => x !== p)) }) }]);

  // The finding form opens right inside the area you tapped, not at the bottom of the page.
  const findingForm = editable && openArea ? (
        <Panel title={'Add finding · ' + openArea} color="#334155">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => shoot(takePhoto)}><Text style={ui.btnText}>Take photo</Text></Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => shoot(pickPhoto)}><Text style={ui.btnOutlineText}>Upload</Text></Pressable>
          </View>
          {!!photo && <RemotePhoto localUri={photo} style={{ width: '100%', height: 200, borderRadius: 8, backgroundColor: '#111' }} resizeMode="cover" />}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput style={[ui.input, { flex: 1 }]} value={draft.floor} onChangeText={(v) => set('floor', v)} placeholder="Floor" />
            <TextInput style={[ui.input, { flex: 1 }]} value={draft.unit} onChangeText={(v) => set('unit', v)} placeholder="Unit" />
          </View>
          <TextInput style={ui.input} value={draft.wall} onChangeText={(v) => set('wall', v)} placeholder="Wall / area (e.g. north wall, right-side handrail)" />
          {!!photo && <Pressable style={[ui.btn, { backgroundColor: BLUE }]} onPress={analyze}><Text style={ui.btnText}>Analyze photo — fill in the finding</Text></Pressable>}
          <TextInput style={ui.input} value={draft.issue} onChangeText={(v) => set('issue', v)} placeholder="Issue detected" />
          <TextInput style={[ui.input, { minHeight: 60 }]} multiline value={draft.description} onChangeText={(v) => set('description', v)} placeholder="Description" />
          <Text style={ui.label}>Recommended trade</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {['Plumbing', 'Electrical', 'Carpentry', 'Roofing', 'Masonry', 'Painting', 'HVAC', 'General Maintenance'].map((t) => (
              <Pressable key={t} onPress={() => set('trade', t)} style={{ borderRadius: 999, borderWidth: 1, borderColor: draft.trade === t ? BLUE : '#cbd5e1', backgroundColor: draft.trade === t ? BLUE : '#fff', paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: 12, color: draft.trade === t ? '#fff' : '#0f172a' }}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={ui.label}>Priority rating</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['Critical', 'High', 'Medium', 'Low'] as Priority[]).map((p) => (
              <Pressable key={p} onPress={() => set('priority', p)} style={{ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: PRIORITY_COLOR[p], backgroundColor: draft.priority === p ? PRIORITY_COLOR[p] : '#fff', paddingVertical: 6 }}>
                <Text style={{ textAlign: 'center', fontSize: 12, fontWeight: '700', color: draft.priority === p ? '#fff' : PRIORITY_COLOR[p] }}>{p}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput style={ui.input} value={draft.time} onChangeText={(v) => set('time', v)} placeholder="Estimated repair time" />
          <TextInput style={[ui.input, { minHeight: 50 }]} multiline value={draft.action} onChangeText={(v) => set('action', v)} placeholder="Recommended action" />
          {[['tools', 'Tools suggested'], ['materials', 'Materials suggested'], ['fixtures', 'Fixtures suggested']].map(([k, label]) => (
            <TextInput key={k} style={ui.input} value={(draft as any)[k].join(', ')} onChangeText={(v) => set(k as keyof Finding, v.split(',').map((x) => x.trim()).filter(Boolean))} placeholder={label + ' (comma separated)'} />
          ))}
          <Pressable onPress={() => set('existing', !draft.existing)}><Text style={{ fontSize: 14 }}>{draft.existing ? '☑' : '☐'} Existing known violation</Text></Pressable>
          {draft.existing && <TextInput style={ui.input} value={draft.sourceRef} onChangeText={(v) => set('sourceRef', v)} placeholder="Violation # (e.g. HPD #1234567)" />}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => { setOpenArea(null); setPhoto(null); }}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
            <Pressable style={[ui.btn, { flex: 1 }]} onPress={saveFinding}><Text style={ui.btnText}>Save finding</Text></Pressable>
          </View>
        </Panel>
  ) : null;

  const reviewed = Object.values(a.areaGroups).flat().filter((x) => a.areas[x]).length;
  const totalAreas = Object.values(a.areaGroups).flat().length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView style={{ backgroundColor: '#eef2f7' }} contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
      <View style={{ backgroundColor: NAVY, borderRadius: 10, padding: 14 }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>FIAREP Building Baseline Report</Text>
        <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2 }}>{a.reportId} · {a.status === 'complete' ? 'Complete' : 'Walk-through in progress'}</Text>
      </View>

      <Panel title="Building information">
        {[['Property Name', a.propertyName], ['Building Address', a.address], ['Owner/Management Company', a.ownerCompany], ['Building Type', a.buildingType], ['Number of Units', a.units != null ? String(a.units) : ''], ['Inspection Date', a.inspectionDate], ['Inspected by', a.inspector], ['Report ID', a.reportId]].map(([k, v]) => (
          <Text key={k} style={{ fontSize: 14 }}><Text style={{ fontWeight: '700' }}>{k}: </Text>{v || '—'}</Text>
        ))}
      </Panel>

      <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#dbe3ee', flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <Text style={{ fontSize: 40, fontWeight: '900', color: a.score >= 90 ? '#166534' : a.score >= 75 ? '#a16207' : a.score >= 60 ? '#c2410c' : '#b91c1c' }}>{a.score}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '800' }}>Building Health Score — {BAND_ICON[a.band]} {a.band}</Text>
          <Text style={ui.listSub}>{a.counts.Critical} critical · {a.counts.High} high · {a.counts.Medium} medium · {a.counts.Low} low · {reviewed} of {totalAreas} areas reviewed</Text>
          <Text style={[ui.listSub, { fontSize: 11 }]}>100 less 15 per critical, 7 per high, 3 per medium and 1 per low finding still open.</Text>
        </View>
      </View>

      {editable && (
        <Pressable style={[ui.btnOutline, !!busy && { opacity: 0.6 }]} disabled={!!busy} onPress={async () => {
          setBusy('Reading the City\'s records…');
          try { const r = await importViolations(a.id); setA(r.assessment); Alert.alert('Existing violations', r.added ? `${r.added} open HPD / DOB violation${r.added === 1 ? '' : 's'} added as existing known violations.` : 'No new open HPD / DOB violations to add.'); }
          catch (e: any) { Alert.alert('HPD / DOB', String(e?.message || e)); } finally { setBusy(''); }
        }}><Text style={ui.btnOutlineText}>Import open HPD / DOB violations (existing known)</Text></Pressable>
      )}

      <Panel title={editable ? 'Inspection areas — tap one to write what you see' : 'Inspection areas reviewed'}>
        {Object.entries(a.areaGroups).map(([group, areas]) => (
          <View key={group}>
            <Text style={{ fontWeight: '800', marginTop: 4 }}>{group}</Text>
            {areas.map((ar) => (
              <View key={ar} style={{ borderTopWidth: 1, borderTopColor: '#eef2f7' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 }}>
                <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }} disabled={!editable && !hasNote(ar)} onPress={() => toggleNote(ar)}>
                  <Text style={{ fontSize: 14 }}>{noteArea === ar ? '▾' : '▸'} {ar}</Text>
                  {hasNote(ar) && <Text style={{ fontSize: 11, color: '#475569' }}>📝{(a.areaNotes?.[ar]?.photos.length || 0) > 0 ? ' 📷' + a.areaNotes[ar].photos.length : ''}</Text>}
                </Pressable>
                {findingsIn(ar) > 0 && <Text style={{ backgroundColor: '#fee2e2', color: '#b91c1c', fontWeight: '800', fontSize: 11, borderRadius: 999, paddingHorizontal: 7 }}>{findingsIn(ar)}</Text>}
                <Pressable disabled={!editable} onPress={() => void save({ areas: { ...a.areas, [ar]: !a.areas[ar] } })}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: a.areas[ar] ? '#166534' : '#94a3b8' }}>{a.areas[ar] ? '✓ reviewed' : editable ? 'mark reviewed' : 'not reviewed'}</Text>
                </Pressable>
              </View>
              {noteArea === ar && (
                <View style={{ backgroundColor: '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: '#dbe3ee', padding: 10, gap: 8, marginBottom: 8 }}>
                  <Text style={ui.label}>What you see — {ar}</Text>
                  {editable
                    ? <TextInput style={[ui.input, { minHeight: 80, textAlignVertical: 'top' }]} multiline value={noteText} onChangeText={setNoteText} placeholder="Write what you see here: the condition, where it is, what is wrong." />
                    : <Text style={{ fontSize: 14 }}>{a.areaNotes?.[ar]?.note || 'No note.'}</Text>}
                  {(a.areaNotes?.[ar]?.photos || []).map((p) => a.photoUrls[p]
                    ? <Pressable key={p} disabled={!editable} onLongPress={() => removeAreaPhoto(ar, p)}><Image source={{ uri: a.photoUrls[p] }} style={{ width: '100%', height: 170, borderRadius: 8, backgroundColor: '#111' }} resizeMode="cover" /></Pressable>
                    : null)}
                  {editable && (a.areaNotes?.[ar]?.photos.length || 0) > 0 && <Text style={ui.listSub}>Hold a photo to remove it.</Text>}
                  {editable && (
                    <>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => void addAreaPhoto(ar, takePhoto)}><Text style={ui.btnOutlineText}>📷 Take photo</Text></Pressable>
                        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => void addAreaPhoto(ar, pickPhoto)}><Text style={ui.btnOutlineText}>Choose photo</Text></Pressable>
                      </View>
                      <Pressable style={[ui.btn, !!busy && { opacity: 0.6 }]} disabled={!!busy} onPress={() => void saveNote(ar)}><Text style={ui.btnText}>Save note</Text></Pressable>
                      {!!busy && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /><Text style={ui.listSub}>{busy}</Text></View>}
                      {!busy && noteSaved === ar && <Text style={{ color: '#166534', fontWeight: '700', textAlign: 'center' }}>✓ Note saved</Text>}
                      {openArea !== ar && <Pressable onPress={() => { setOpenArea(ar); setDraft(blank(ar)); setPhoto(null); }}><Text style={{ color: BLUE, fontWeight: '700', textAlign: 'center' }}>+ Add a finding (violation) for {ar}</Text></Pressable>}
                    </>
                  )}
                  {openArea === ar && findingForm}
                </View>
              )}
              </View>
            ))}
          </View>
        ))}
      </Panel>

      {!!busy && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Text style={ui.listSub}>{busy}</Text></View>}

      <Text style={{ fontWeight: '800', fontSize: 15, marginTop: 4 }}>Priority Violation Summary</Text>
      {LEVELS.map((lv) => {
        const rows = a.findings.filter((f) => f.priority === lv.p);
        return (
          <Panel key={lv.p} title={lv.title} color={PRIORITY_COLOR[lv.p]}>
            <Text style={ui.listSub}>{lv.note}</Text>
            {rows.length === 0 && <Text style={ui.listSub}>None.</Text>}
            {rows.map((f) => (
              <View key={f.id} style={{ borderTopWidth: 1, borderTopColor: '#eef2f7', paddingTop: 6, gap: 2 }}>
                <Text style={{ fontWeight: '800' }}>{f.code} · {f.issue}{f.status === 'repaired' ? '  ✅ repaired' : ''}</Text>
                <Text style={{ fontSize: 13 }}>📍 {[f.area, f.floor && 'Floor ' + f.floor, f.unit && 'Unit ' + f.unit, f.wall].filter(Boolean).join(' · ') || '—'}</Text>
                <Text style={{ fontSize: 13 }}>👷 {f.trade || '—'}{f.time ? ' · ⏱ ' + f.time : ''}{f.existing ? ' · Existing known' + (f.sourceRef ? ' (' + f.sourceRef + ')' : '') : ' · Newly identified'}</Text>
                {!!f.action && <Text style={{ fontSize: 13 }}>🔧 {f.action}</Text>}
                {(f.tools.length > 0 || f.materials.length > 0 || f.fixtures.length > 0) && <Text style={ui.listSub}>Tools: {f.tools.join(', ') || '—'} · Materials: {f.materials.join(', ') || '—'} · Fixtures: {f.fixtures.join(', ') || '—'}</Text>}
                {f.photos.map((p) => a.photoUrls[p] ? <Image key={p} source={{ uri: a.photoUrls[p] }} style={{ width: '100%', height: 170, borderRadius: 8, backgroundColor: '#111' }} resizeMode="cover" /> : null)}
                {fiarep && (
                  <View style={{ flexDirection: 'row', gap: 14, marginTop: 2 }}>
                    <Pressable onPress={() => toggleRepaired(f)}><Text style={{ color: BLUE, fontWeight: '700', fontSize: 13 }}>{f.status === 'repaired' ? 'Mark open' : 'Mark repaired'}</Text></Pressable>
                    {editable && <Pressable onPress={() => removeFinding(f)}><Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 13 }}>Remove</Text></Pressable>}
                  </View>
                )}
              </View>
            ))}
          </Panel>
        );
      })}

      <Panel title="FIAREP Repair Roadmap">
        <Text style={{ fontSize: 14 }}>🔴 Immediate Repairs (0-7 Days): <Text style={{ fontWeight: '800' }}>{a.roadmap.immediate}</Text></Text>
        <Text style={{ fontSize: 14 }}>🟠 Short-Term Repairs (7-30 Days): <Text style={{ fontWeight: '800' }}>{a.roadmap.shortTerm}</Text></Text>
        <Text style={{ fontSize: 14 }}>🟢 Long-Term Repairs (30-90 Days): <Text style={{ fontWeight: '800' }}>{a.roadmap.longTerm}</Text></Text>
      </Panel>

      <Panel title="Baseline Asset Archive">
        <Text style={{ fontSize: 13, lineHeight: 19 }}>All identified conditions are stored in the FIAREP Building Archive and linked to the building profile, unit location, repair history, future resident complaints, work orders, inspection records and compliance tracking. Future resident complaints are compared against this baseline: ✅ Existing condition ✅ New condition ✅ Reoccurring issue ✅ Escalating issue ✅ Repair verification status.</Text>
      </Panel>

      <Panel title="FIAREP Baseline Assessment Certification">
        <Text style={{ fontSize: 13, lineHeight: 19 }}>The building walk-through inspection has been completed and all observed conditions have been documented and entered into the FIAREP platform. This report establishes the property's initial operating condition and serves as the foundation for ongoing compliance, maintenance, repair management, and resident complaint tracking.</Text>
        {editable ? (
          <>
            <TextInput style={ui.input} value={sign.inspector} onChangeText={(v) => setSign((x) => ({ ...x, inspector: v }))} placeholder="Inspector signature (type full name)" />
            <TextInput style={ui.input} value={sign.representative} onChangeText={(v) => setSign((x) => ({ ...x, representative: v }))} placeholder="Property representative (type full name)" />
            <TextInput style={ui.input} value={sign.date} onChangeText={(v) => setSign((x) => ({ ...x, date: v }))} placeholder="Date" />
            <Pressable style={[ui.btn, { backgroundColor: '#16a34a' }]} onPress={() => Alert.alert('Complete the baseline?', 'The report is locked and sent to the client\'s platform and app.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Complete', onPress: () => void save({ signatures: sign, status: 'complete' }, 'Completing…') }])}>
              <Text style={ui.btnText}>Complete assessment → Baseline Report</Text>
            </Pressable>
          </>
        ) : (
          <Text style={{ fontSize: 14 }}>Inspector Signature: <Text style={{ fontWeight: '700' }}>{a.signatures.inspector || '—'}</Text>{'\n'}Property Representative: <Text style={{ fontWeight: '700' }}>{a.signatures.representative || '—'}</Text>{'\n'}Date: <Text style={{ fontWeight: '700' }}>{a.signatures.date || '—'}</Text></Text>
        )}
        <Text style={{ textAlign: 'center', fontStyle: 'italic', color: '#475569', marginTop: 6 }}>"Inspect. Prioritize. Repair. Track."{'\n'}"Building Baselines Create Better Buildings."</Text>
      </Panel>

      {a.status === 'complete' && (
        <Pressable style={ui.btnOutline} onPress={() => void Linking.openURL('https://fiarep.com/baseline-report/' + encodeURIComponent(a.id))}><Text style={ui.btnOutlineText}>Open the full report (print / PDF)</Text></Pressable>
      )}
      {fiarep && a.status === 'complete' && (
        <Pressable onPress={() => void save({ status: 'in_progress' })}><Text style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>Reopen the walk-through</Text></Pressable>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
