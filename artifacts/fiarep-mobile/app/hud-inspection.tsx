import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getHudInspection, saveHudInspection, notifyInspectionForReview, setHudReview, HUD_INSPECTION_TYPES, ROOM_TYPES, RATIONALE_CODES, CORRECTION_TIMEFRAMES, type HudInspection, type HudInspectionType, type HudRoom, type HudItem, type RoomType, type HudResult, type Severity, type HudDeficiency, type DeficiencyLocation, type CorrectionTimeframe, type RationaleCode, type HudPhysicalItem, type PhysicalCategory, type Urgency, type HudLeadAssessment, type HudLifeSafety, type LeadRisk, type LeadAction, type HudCorrectiveAction, type ActionStatus, type PassFail, type HudStatus, type ReviewDecision } from '../lib/hud';
import { listDevelopmentNames, getCurrentActor, raisePriorityViolation, listProjects, type Project } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { useAppMode } from './_layout';

const UTILITIES = ['Gas', 'Electric', 'Water', 'Heat'];
const HOUSING_TYPES = ['single_family', 'duplex', 'row_house', 'low_rise', 'high_rise', 'manufactured'];
const HOUSING_LABEL: Record<string, string> = {
  single_family: 'Single family', duplex: 'Duplex', row_house: 'Row house',
  low_rise: 'Low rise', high_rise: 'High rise', manufactured: 'Manufactured',
};
const TYPE_LABEL: Record<HudInspectionType, string> = {
  initial: 'Initial', annual: 'Annual', special: 'Special', reinspection: 'Reinspection',
};
const ROOM_LABEL: Record<RoomType, string> = {
  living_room: 'Living room', kitchen: 'Kitchen', bathroom: 'Bathroom', bedroom: 'Bedroom', hallway: 'Hallway', common_area: 'Common area',
};
const RESULTS: HudResult[] = ['pass', 'fail', 'inconclusive'];
const RESULT_LABEL: Record<HudResult, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconc.' };
const SEVERITIES: Severity[] = ['low', 'medium', 'high'];
const SEV_LABEL: Record<Severity, string> = { low: 'Low', medium: 'Med', high: 'High' };
const DEF_LOCATIONS: DeficiencyLocation[] = ['unit', 'inside', 'outside'];
const TIMEFRAME_LABEL: Record<CorrectionTimeframe, string> = { '24_hours': '24 hours', '30_days': '30 days', annual: 'Annual' };
const URGENCIES: Urgency[] = ['high', 'medium', 'low'];
const URG_LABEL: Record<Urgency, string> = { high: 'High', medium: 'Med', low: 'Low' };
const LEAD_RISKS: LeadRisk[] = ['low', 'medium', 'high'];
const LEAD_ACTIONS: LeadAction[] = ['stabilization', 'abatement', 'clearance_test'];
const LEAD_ACTION_LABEL: Record<LeadAction, string> = { stabilization: 'Stabilization', abatement: 'Abatement', clearance_test: 'Clearance test' };
const ACTION_STATUSES: ActionStatus[] = ['pending', 'in_progress', 'completed'];
const ACTION_STATUS_LABEL: Record<ActionStatus, string> = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' };
const LIFE_SAFETY_FIELDS: { key: keyof HudLifeSafety; label: string; danger?: boolean }[] = [
  { key: 'smokeDetectorsPresent', label: 'Smoke detectors present' },
  { key: 'coDetectorsPresent', label: 'CO detectors present' },
  { key: 'fireExitsClear', label: 'Fire exits clear' },
  { key: 'emergencyLightingOperational', label: 'Emergency lighting operational' },
  { key: 'tripHazardsPresent', label: 'Trip hazards present', danger: true },
  { key: 'gasLeakDetected', label: 'Gas leak detected', danger: true },
  { key: 'electricalHazardPresent', label: 'Electrical hazard present', danger: true },
];

export default function HudInspectionForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [insp, setInsp] = useState<HudInspection | null>(null);
  const { mode } = useAppMode();
  const [reviewNotes, setReviewNotes] = useState('');
  const [otherText, setOtherText] = useState('');
  const [devPickerOpen, setDevPickerOpen] = useState(false);
  const [devQuery, setDevQuery] = useState('');
  const [projPickerOpen, setProjPickerOpen] = useState(false);
  const [projQuery, setProjQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);

  const devNames = useMemo(() => listDevelopmentNames(), []);
  const devFiltered = useMemo(() => {
    const q = devQuery.trim().toLowerCase();
    return q ? devNames.filter((n) => n.toLowerCase().includes(q)) : devNames;
  }, [devQuery, devNames]);

  const projFiltered = useMemo(() => {
    const q = projQuery.trim().toLowerCase();
    return q ? projects.filter((x) => (x.name || '').toLowerCase().includes(q)) : projects;
  }, [projQuery, projects]);

  const load = useCallback(() => {
    if (id) getHudInspection(id).then((x) => setInsp(x));
    listProjects().then(setProjects).catch(() => {});
  }, [id]);
  useFocusEffect(load);

  function patch(p: Partial<HudInspection>) {
    setInsp((cur) => (cur ? { ...cur, ...p } : cur));
  }

  async function persist() {
    if (insp) { await saveHudInspection(insp); }
  }

  async function submitReview(decision: ReviewDecision) {
    if (!insp) return;
    if (decision === 'rejected' && !reviewNotes.trim()) { Alert.alert('Notes required', 'Please add notes explaining the rejection.'); return; }
    const a = await getCurrentActor();
    await setHudReview(insp.id, decision, reviewNotes.trim(), a.name || 'administrator');
    setReviewNotes('');
    const fresh = await getHudInspection(insp.id);
    setInsp(fresh);
    Alert.alert('Decision recorded', 'The inspector has been notified.');
  }

  function addRoom(rt: RoomType) {
    if (!insp) return;
    const room: HudRoom = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), roomType: rt, items: [] };
    patch({ rooms: [...insp.rooms, room] });
  }
  function removeRoom(roomId: string) {
    if (!insp) return;
    patch({ rooms: insp.rooms.filter((r) => r.id !== roomId) });
  }
  function addItem(roomId: string) {
    if (!insp) return;
    const item: HudItem = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), itemName: '', result: 'pass', photos: [] };
    patch({ rooms: insp.rooms.map((r) => r.id === roomId ? { ...r, items: [...r.items, item] } : r) });
  }
  function updateItem(roomId: string, itemId: string, u: Partial<HudItem>) {
    if (!insp) return;
    patch({ rooms: insp.rooms.map((r) => r.id === roomId ? { ...r, items: r.items.map((it) => it.id === itemId ? { ...it, ...u } : it) } : r) });
  }
  function removeItem(roomId: string, itemId: string) {
    if (!insp) return;
    patch({ rooms: insp.rooms.map((r) => r.id === roomId ? { ...r, items: r.items.filter((it) => it.id !== itemId) } : r) });
  }

  function addDeficiency() {
    if (!insp) return;
    const d: HudDeficiency = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: '', photos: [] };
    patch({ deficiencies: [...insp.deficiencies, d] });
  }
  function updateDeficiency(id: string, u: Partial<HudDeficiency>) {
    if (!insp) return;
    patch({ deficiencies: insp.deficiencies.map((d) => d.id === id ? { ...d, ...u } : d) });
  }
  function removeDeficiency(id: string) {
    if (!insp) return;
    patch({ deficiencies: insp.deficiencies.filter((d) => d.id !== id) });
  }

  function addPhysical(cat: PhysicalCategory) {
    if (!insp) return;
    const pi: HudPhysicalItem = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), category: cat, itemName: '', photos: [] };
    patch({ physicalItems: [...insp.physicalItems, pi] });
  }
  function updatePhysical(id: string, u: Partial<HudPhysicalItem>) {
    if (!insp) return;
    patch({ physicalItems: insp.physicalItems.map((pi) => pi.id === id ? { ...pi, ...u } : pi) });
  }
  function removePhysical(id: string) {
    if (!insp) return;
    patch({ physicalItems: insp.physicalItems.filter((pi) => pi.id !== id) });
  }

  function patchLead(u: Partial<HudLeadAssessment>) {
    if (!insp) return;
    patch({ lead: { ...insp.lead, ...u } });
  }
  // Danger flags on the life-safety checklist are the red/priority findings.
  // Turning one ON routes it to every supervisor assigned to this development.
  const DANGER_LABELS: Record<string, string> = {
    tripHazardsPresent: 'Trip hazards present',
    gasLeakDetected: 'Gas leak detected — inspector must contact the Fire Department',
    electricalHazardPresent: 'Electrical hazard present',
  };

  function patchLifeSafety(u: Partial<HudLifeSafety>) {
    if (!insp) return;
    const prev: any = insp.lifeSafety || {};
    patch({ lifeSafety: { ...insp.lifeSafety, ...u } });

    for (const key of Object.keys(u)) {
      const label = DANGER_LABELS[key];
      if (!label) continue;
      const wasOn = prev[key] === true;
      const nowOn = (u as any)[key] === true;
      if (wasOn || !nowOn) continue;
      raisePriorityViolation(
        insp.development || '',
        insp.unitAddress || '',
        label,
        insp.inspectorName || '',
        insp.unitId || '',
        'Flagged during HUD inspection.',
        insp.projectId || '',
      )
        .then((v) => {
          const who = v.unrouted
            ? 'No supervisor is assigned to this development — sent to the general management inbox.'
            : 'Sent to: ' + v.routedTo.join(', ');
          Alert.alert('Priority violation routed', label + '\n\n' + who);
        })
        .catch(() => {
          Alert.alert('Not routed', 'The priority violation could not be sent. Contact your supervisor directly.');
        });
    }
  }

  // Free-text emergency for anything the fixed danger flags do not cover.
  async function otherEmergency() {
    if (!insp) return;
    const text = (otherText || '').trim();
    if (!text) { Alert.alert('Describe the emergency', 'Enter what was found before sending.'); return; }
    try {
      const v = await raisePriorityViolation(
        insp.development || '',
        insp.unitAddress || '',
        text,
        insp.inspectorName || '',
        insp.unitId || '',
        'Reported as an emergency during HUD inspection.',
        insp.projectId || '',
      );
      setOtherText('');
      const who = v.unrouted
        ? 'No supervisor is assigned to this development — sent to the general management inbox.'
        : 'Sent to: ' + v.routedTo.join(', ');
      Alert.alert('Emergency routed', text + '\n\n' + who);
    } catch (e: any) {
      Alert.alert('Not routed', 'The emergency could not be sent. Contact your supervisor directly.');
    }
  }

  function addAction() {
    if (!insp) return;
    const a: HudCorrectiveAction = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), description: '', status: 'pending' };
    patch({ correctiveActions: [...insp.correctiveActions, a] });
  }
  function updateAction(id: string, u: Partial<HudCorrectiveAction>) {
    if (!insp) return;
    patch({ correctiveActions: insp.correctiveActions.map((a) => a.id === id ? { ...a, ...u } : a) });
  }
  function removeAction(id: string) {
    if (!insp) return;
    patch({ correctiveActions: insp.correctiveActions.filter((a) => a.id !== id) });
  }

  function toggleUtility(u: string) {
    if (!insp) return;
    const has = insp.utilitiesAvailable.includes(u);
    patch({ utilitiesAvailable: has ? insp.utilitiesAvailable.filter((x) => x !== u) : [...insp.utilitiesAvailable, u] });
  }

  if (!insp) {
    return <ScrollView contentContainerStyle={ui.wrap}><Text style={ui.empty}>Loading…</Text></ScrollView>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Inspection Details</Text>

      {insp.review && (
        <View style={{ borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: insp.review.decision === 'approved' ? '#eaf7ef' : insp.review.decision === 'rejected' ? '#fdecea' : '#fff6e6', borderWidth: 1, borderColor: insp.review.decision === 'approved' ? '#1a8f4c' : insp.review.decision === 'rejected' ? '#c0392b' : '#b8860b' }}>
          <Text style={{ fontWeight: '800', fontSize: 15, color: insp.review.decision === 'approved' ? '#1a8f4c' : insp.review.decision === 'rejected' ? '#c0392b' : '#b8860b' }}>
            {insp.review.decision === 'approved' ? 'APPROVED' : insp.review.decision === 'rejected' ? 'REJECTED' : 'NEEDS REVISION'}
          </Text>
          {!!insp.review.notes && <Text style={{ fontSize: 13, color: '#333', marginTop: 4 }}>{insp.review.notes}</Text>}
          <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Reviewed by {insp.review.decidedBy}</Text>
        </View>
      )}

      {(mode === 'administrator' || mode === 'management') && (
        <View style={{ marginBottom: 8 }}>
          <Text style={ui.label}>Review decision</Text>
          <TextInput style={[ui.input, { minHeight: 50 }]} value={reviewNotes} onChangeText={setReviewNotes} placeholder="Notes (required to reject)" multiline textAlignVertical="top" />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#1a8f4c' }]} onPress={() => submitReview('approved')}>
              <Text style={[ui.btnOutlineText, { color: '#1a8f4c' }]}>Approve</Text>
            </Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#b8860b' }]} onPress={() => submitReview('needs_revision')}>
              <Text style={[ui.btnOutlineText, { color: '#b8860b', fontSize: 12 }]}>Needs revision</Text>
            </Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#c0392b' }]} onPress={() => submitReview('rejected')}>
              <Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Reject</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text style={ui.label}>Inspection type</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {HUD_INSPECTION_TYPES.map((t) => (
          <Pressable key={t} style={[ui.btnOutline, insp.inspectionType === t && { backgroundColor: ACCENT }]} onPress={() => patch({ inspectionType: t })}>
            <Text style={insp.inspectionType === t ? ui.btnText : ui.btnOutlineText}>{TYPE_LABEL[t]}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={ui.label}>Inspection date</Text>
      <TextInput style={ui.input} value={insp.inspectionDate} onChangeText={(v) => patch({ inspectionDate: v })} placeholder="YYYY-MM-DD" />

      <Text style={ui.label}>Inspector name</Text>
      <TextInput style={ui.input} value={insp.inspectorName} onChangeText={(v) => patch({ inspectorName: v })} placeholder="Inspector" autoCapitalize="words" />

      <Text style={ui.label}>Development</Text>
      <Pressable style={ui.input} onPress={() => { setDevQuery(''); setDevPickerOpen(true); }}>
        <Text style={{ color: insp.development ? '#000' : '#999' }}>{insp.development || 'Select development'}</Text>
      </Pressable>

      <Text style={ui.label}>Project (optional)</Text>
      <Pressable style={ui.input} onPress={() => { setProjQuery(''); setProjPickerOpen(true); }}>
        <Text style={{ color: insp.projectId ? '#000' : '#999' }}>
          {(projects.find((x) => x.id === insp.projectId) || {} as Project).name || 'Not linked to a project'}
        </Text>
      </Pressable>
      {!!insp.projectId && (
        <Pressable onPress={() => patch({ projectId: undefined })}>
          <Text style={{ color: ACCENT, fontWeight: '600', marginBottom: 4 }}>Clear project link</Text>
        </Pressable>
      )}

      <Text style={ui.label}>Unit address</Text>
      <TextInput style={ui.input} value={insp.unitAddress} onChangeText={(v) => patch({ unitAddress: v })} placeholder="e.g. 271 Seaside Ave, Apt 5J" autoCapitalize="words" />

      <Text style={ui.label}>Housing type</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {HOUSING_TYPES.map((h) => (
          <Pressable key={h} style={[ui.btnOutline, insp.housingType === h && { backgroundColor: ACCENT }]} onPress={() => patch({ housingType: h })}>
            <Text style={insp.housingType === h ? ui.btnText : ui.btnOutlineText}>{HOUSING_LABEL[h]}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={ui.label}>Year constructed</Text>
      <TextInput style={ui.input} value={insp.yearConstructed ? String(insp.yearConstructed) : ''} onChangeText={(v) => patch({ yearConstructed: parseInt(v) || undefined })} placeholder="e.g. 1975" keyboardType="number-pad" />

      <Text style={ui.label}>Resident name</Text>
      <TextInput style={ui.input} value={insp.residentName ?? ''} onChangeText={(v) => patch({ residentName: v })} placeholder="Resident (optional)" autoCapitalize="words" />

      <Text style={ui.label}>Staff present</Text>
      <TextInput style={ui.input} value={insp.staffName ?? ''} onChangeText={(v) => patch({ staffName: v })} placeholder="Staff (optional)" autoCapitalize="words" />

      <Text style={ui.label}>Utilities available</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {UTILITIES.map((u) => (
          <Pressable key={u} style={[ui.btnOutline, insp.utilitiesAvailable.includes(u) && { backgroundColor: ACCENT }]} onPress={() => toggleUtility(u)}>
            <Text style={insp.utilitiesAvailable.includes(u) ? ui.btnText : ui.btnOutlineText}>{u}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[ui.btnOutline, { marginTop: 8 }, insp.childrenUnder6 && { backgroundColor: ACCENT }]} onPress={() => patch({ childrenUnder6: !insp.childrenUnder6 })}>
        <Text style={insp.childrenUnder6 ? ui.btnText : ui.btnOutlineText}>{insp.childrenUnder6 ? '✓ ' : ''}Children under 6 in unit</Text>
      </Pressable>

      <Text style={ui.label}>General comments</Text>
      <TextInput style={[ui.input, { minHeight: 80 }]} value={insp.generalComments ?? ''} onChangeText={(v) => patch({ generalComments: v })} placeholder="Notes…" multiline textAlignVertical="top" />

      <Text style={[ui.h, { fontSize: 18, marginTop: 20 }]}>Rooms & HQS Items</Text>
      <Text style={ui.label}>Add a room:</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ROOM_TYPES.map((rt) => (
          <Pressable key={rt} style={ui.btnOutline} onPress={() => addRoom(rt)}>
            <Text style={ui.btnOutlineText}>+ {ROOM_LABEL[rt]}</Text>
          </Pressable>
        ))}
      </View>

      {insp.rooms.map((room) => (
        <View key={room.id} style={[ui.card, { gap: 8, marginTop: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{ROOM_LABEL[room.roomType]}</Text>
            <Pressable onPress={() => removeRoom(room.id)}><Text style={{ color: '#c0392b', fontSize: 13 }}>Remove room</Text></Pressable>
          </View>

          {room.items.map((it) => (
            <View key={it.id} style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, gap: 6 }}>
              <TextInput style={ui.input} value={it.itemName} onChangeText={(v) => updateItem(room.id, it.id, { itemName: v })} placeholder="Item (e.g. Smoke detector, Window, Outlet)" />
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {RESULTS.map((r) => (
                  <Pressable key={r} style={[ui.btnOutline, { flex: 1, paddingVertical: 6 }, it.result === r && { backgroundColor: r === 'fail' ? '#c0392b' : r === 'pass' ? '#1a8f4c' : '#b8860b' }]} onPress={() => updateItem(room.id, it.id, { result: r })}>
                    <Text style={[it.result === r ? ui.btnText : ui.btnOutlineText, { fontSize: 13 }]}>{RESULT_LABEL[r]}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: '#666' }}>Severity:</Text>
                {SEVERITIES.map((sv) => (
                  <Pressable key={sv} style={[ui.btnOutline, { paddingVertical: 4, paddingHorizontal: 10 }, it.severity === sv && { backgroundColor: ACCENT }]} onPress={() => updateItem(room.id, it.id, { severity: sv })}>
                    <Text style={[it.severity === sv ? ui.btnText : ui.btnOutlineText, { fontSize: 12 }]}>{SEV_LABEL[sv]}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={ui.input} value={it.comments ?? ''} onChangeText={(v) => updateItem(room.id, it.id, { comments: v })} placeholder="Comments (optional)" />
              <Pressable onPress={() => removeItem(room.id, it.id)}><Text style={{ color: '#c0392b', fontSize: 12 }}>Remove item</Text></Pressable>
            </View>
          ))}

          <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={() => addItem(room.id)}>
            <Text style={ui.btnOutlineText}>+ Add item</Text>
          </Pressable>
        </View>
      ))}

      <Text style={[ui.h, { fontSize: 18, marginTop: 20 }]}>NSPIRE Deficiencies</Text>
      <Pressable style={ui.btnOutline} onPress={addDeficiency}>
        <Text style={ui.btnOutlineText}>+ Add deficiency</Text>
      </Pressable>

      {insp.deficiencies.map((d) => (
        <View key={d.id} style={[ui.card, { gap: 8, marginTop: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: ACCENT }}>Deficiency</Text>
            <Pressable onPress={() => removeDeficiency(d.id)}><Text style={{ color: '#c0392b', fontSize: 13 }}>Remove</Text></Pressable>
          </View>

          <TextInput style={ui.input} value={d.title} onChangeText={(v) => updateDeficiency(d.id, { title: v })} placeholder="Title (e.g. Broken window pane)" />
          <TextInput style={ui.input} value={d.definition ?? ''} onChangeText={(v) => updateDeficiency(d.id, { definition: v })} placeholder="Definition (optional)" />

          <Text style={{ fontSize: 12, color: '#666' }}>Location</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {DEF_LOCATIONS.map((loc) => (
              <Pressable key={loc} style={[ui.btnOutline, { flex: 1, paddingVertical: 6 }, d.location === loc && { backgroundColor: ACCENT }]} onPress={() => updateDeficiency(d.id, { location: loc })}>
                <Text style={[d.location === loc ? ui.btnText : ui.btnOutlineText, { fontSize: 13 }]}>{loc.charAt(0).toUpperCase() + loc.slice(1)}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput style={ui.input} value={d.criteria ?? ''} onChangeText={(v) => updateDeficiency(d.id, { criteria: v })} placeholder="Criteria (optional)" />

          <Pressable style={[ui.btnOutline, d.healthSafety && { backgroundColor: '#c0392b' }]} onPress={() => updateDeficiency(d.id, { healthSafety: !d.healthSafety })}>
            <Text style={d.healthSafety ? ui.btnText : ui.btnOutlineText}>{d.healthSafety ? '✓ ' : ''}Health &amp; Safety</Text>
          </Pressable>

          <Text style={{ fontSize: 12, color: '#666' }}>Correction timeframe</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {CORRECTION_TIMEFRAMES.map((tf) => (
              <Pressable key={tf} style={[ui.btnOutline, { flex: 1, paddingVertical: 6 }, d.correctionTimeframe === tf && { backgroundColor: ACCENT }]} onPress={() => updateDeficiency(d.id, { correctionTimeframe: tf })}>
                <Text style={[d.correctionTimeframe === tf ? ui.btnText : ui.btnOutlineText, { fontSize: 12 }]}>{TIMEFRAME_LABEL[tf]}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ fontSize: 12, color: '#666' }}>Rationale code</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {RATIONALE_CODES.map((rc) => (
              <Pressable key={rc} style={[ui.btnOutline, { paddingVertical: 4, paddingHorizontal: 10 }, d.rationaleCode === rc && { backgroundColor: ACCENT }]} onPress={() => updateDeficiency(d.id, { rationaleCode: rc })}>
                <Text style={[d.rationaleCode === rc ? ui.btnText : ui.btnOutlineText, { fontSize: 12 }]}>{rc}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput style={[ui.input, { minHeight: 50 }]} value={d.notes ?? ''} onChangeText={(v) => updateDeficiency(d.id, { notes: v })} placeholder="Notes (optional)" multiline textAlignVertical="top" />
        </View>
      ))}

      <Text style={[ui.h, { fontSize: 18, marginTop: 20 }]}>Physical Condition</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => addPhysical('interior')}>
          <Text style={ui.btnOutlineText}>+ Interior item</Text>
        </Pressable>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => addPhysical('exterior')}>
          <Text style={ui.btnOutlineText}>+ Exterior item</Text>
        </Pressable>
      </View>

      {insp.physicalItems.map((pi) => (
        <View key={pi.id} style={[ui.card, { gap: 8, marginTop: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: ACCENT }}>{pi.category === 'interior' ? 'Interior' : 'Exterior'}</Text>
            <Pressable onPress={() => removePhysical(pi.id)}><Text style={{ color: '#c0392b', fontSize: 13 }}>Remove</Text></Pressable>
          </View>

          <TextInput style={ui.input} value={pi.itemName} onChangeText={(v) => updatePhysical(pi.id, { itemName: v })} placeholder="Item (e.g. Roof, Foundation, Flooring)" />

          <Pressable style={[ui.btnOutline, pi.maintenanceNeeded && { backgroundColor: ACCENT }]} onPress={() => updatePhysical(pi.id, { maintenanceNeeded: !pi.maintenanceNeeded })}>
            <Text style={pi.maintenanceNeeded ? ui.btnText : ui.btnOutlineText}>{pi.maintenanceNeeded ? '✓ ' : ''}Maintenance needed</Text>
          </Pressable>

          <Text style={{ fontSize: 12, color: '#666' }}>Urgency</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {URGENCIES.map((u) => (
              <Pressable key={u} style={[ui.btnOutline, { flex: 1, paddingVertical: 6 }, pi.urgency === u && { backgroundColor: u === 'high' ? '#c0392b' : u === 'medium' ? '#b8860b' : '#1a8f4c' }]} onPress={() => updatePhysical(pi.id, { urgency: u })}>
                <Text style={[pi.urgency === u ? ui.btnText : ui.btnOutlineText, { fontSize: 13 }]}>{URG_LABEL[u]}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={[ui.btnOutline, pi.onPriorReport && { backgroundColor: ACCENT }]} onPress={() => updatePhysical(pi.id, { onPriorReport: !pi.onPriorReport })}>
            <Text style={pi.onPriorReport ? ui.btnText : ui.btnOutlineText}>{pi.onPriorReport ? '✓ ' : ''}On prior report</Text>
          </Pressable>

          <Text style={{ fontSize: 12, color: '#666' }}>Estimated cost</Text>
          <TextInput style={ui.input} value={pi.estimatedCost != null ? String(pi.estimatedCost) : ''} onChangeText={(v) => updatePhysical(pi.id, { estimatedCost: parseFloat(v) || undefined })} placeholder="0.00" keyboardType="decimal-pad" />
        </View>
      ))}

      <Text style={[ui.h, { fontSize: 18, marginTop: 20 }]}>Lead-Based Paint</Text>
      <View style={[ui.card, { gap: 8 }]}>
        <Pressable style={[ui.btnOutline, insp.lead.leadVisualAssessment && { backgroundColor: ACCENT }]} onPress={() => patchLead({ leadVisualAssessment: !insp.lead.leadVisualAssessment })}>
          <Text style={insp.lead.leadVisualAssessment ? ui.btnText : ui.btnOutlineText}>{insp.lead.leadVisualAssessment ? '✓ ' : ''}Visual assessment done</Text>
        </Pressable>
        <Pressable style={[ui.btnOutline, insp.lead.deterioratedPaintPresent && { backgroundColor: '#c0392b' }]} onPress={() => patchLead({ deterioratedPaintPresent: !insp.lead.deterioratedPaintPresent })}>
          <Text style={insp.lead.deterioratedPaintPresent ? ui.btnText : ui.btnOutlineText}>{insp.lead.deterioratedPaintPresent ? '✓ ' : ''}Deteriorated paint present</Text>
        </Pressable>
        <Text style={{ fontSize: 12, color: '#666' }}>Risk level</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {LEAD_RISKS.map((rk) => (
            <Pressable key={rk} style={[ui.btnOutline, { flex: 1, paddingVertical: 6 }, insp.lead.riskLevel === rk && { backgroundColor: rk === 'high' ? '#c0392b' : rk === 'medium' ? '#b8860b' : '#1a8f4c' }]} onPress={() => patchLead({ riskLevel: rk })}>
              <Text style={[insp.lead.riskLevel === rk ? ui.btnText : ui.btnOutlineText, { fontSize: 13 }]}>{rk.charAt(0).toUpperCase() + rk.slice(1)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ fontSize: 12, color: '#666' }}>Required action</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {LEAD_ACTIONS.map((ac) => (
            <Pressable key={ac} style={[ui.btnOutline, { paddingVertical: 6 }, insp.lead.requiredAction === ac && { backgroundColor: ACCENT }]} onPress={() => patchLead({ requiredAction: ac })}>
              <Text style={[insp.lead.requiredAction === ac ? ui.btnText : ui.btnOutlineText, { fontSize: 13 }]}>{LEAD_ACTION_LABEL[ac]}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={[ui.h, { fontSize: 18, marginTop: 20 }]}>Life &amp; Safety</Text>
      <View style={[ui.card, { gap: 8 }]}>
        {LIFE_SAFETY_FIELDS.map((f) => {
          const on = !!insp.lifeSafety[f.key];
          return (
            <Pressable key={f.key} style={[ui.btnOutline, on && { backgroundColor: f.danger ? '#c0392b' : '#1a8f4c' }]} onPress={() => patchLifeSafety({ [f.key]: !on } as Partial<HudLifeSafety>)}>
              <Text style={on ? ui.btnText : ui.btnOutlineText}>{on ? '✓ ' : ''}{f.label}</Text>
            </Pressable>
          );
        })}

        <Text style={[ui.label, { marginTop: 8 }]}>Other emergency</Text>
        <TextInput
          style={[ui.input, { minHeight: 60 }]}
          value={otherText}
          onChangeText={setOtherText}
          placeholder="Describe an extreme condition not listed above"
          multiline
          textAlignVertical="top"
        />
        <Pressable style={[ui.btn, { backgroundColor: '#c0392b' }]} onPress={otherEmergency}>
          <Text style={ui.btnText}>Send emergency to supervisor</Text>
        </Pressable>
        <Text style={{ fontSize: 12, color: '#666' }}>
          Alerts appear in the supervisor's in-app inbox. They will not sound on a
          locked phone. For anything life-threatening, call emergency services.
        </Text>
      </View>

      <Text style={[ui.h, { fontSize: 18, marginTop: 20 }]}>Corrective Actions</Text>
      <Pressable style={ui.btnOutline} onPress={addAction}>
        <Text style={ui.btnOutlineText}>+ Add action</Text>
      </Pressable>

      {insp.correctiveActions.map((a) => (
        <View key={a.id} style={[ui.card, { gap: 8, marginTop: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: ACCENT }}>Action</Text>
            <Pressable onPress={() => removeAction(a.id)}><Text style={{ color: '#c0392b', fontSize: 13 }}>Remove</Text></Pressable>
          </View>
          <TextInput style={[ui.input, { minHeight: 50 }]} value={a.description} onChangeText={(v) => updateAction(a.id, { description: v })} placeholder="Description of required work" multiline textAlignVertical="top" />
          <TextInput style={ui.input} value={a.assignedToStaff ?? ''} onChangeText={(v) => updateAction(a.id, { assignedToStaff: v })} placeholder="Assigned to (staff name)" autoCapitalize="words" />
          <TextInput style={ui.input} value={a.deadline ?? ''} onChangeText={(v) => updateAction(a.id, { deadline: v })} placeholder="Deadline (YYYY-MM-DD)" />
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {ACTION_STATUSES.map((st) => (
              <Pressable key={st} style={[ui.btnOutline, { flex: 1, paddingVertical: 6 }, a.status === st && { backgroundColor: ACCENT }]} onPress={() => updateAction(a.id, { status: st })}>
                <Text style={[a.status === st ? ui.btnText : ui.btnOutlineText, { fontSize: 12 }]}>{ACTION_STATUS_LABEL[st]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <Text style={[ui.h, { fontSize: 18, marginTop: 20 }]}>Result &amp; Sign-off</Text>
      <Text style={ui.label}>Overall result</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable style={[ui.btnOutline, { flex: 1 }, insp.overallResult === 'pass' && { backgroundColor: '#1a8f4c' }]} onPress={() => patch({ overallResult: 'pass' })}>
          <Text style={insp.overallResult === 'pass' ? ui.btnText : ui.btnOutlineText}>PASS</Text>
        </Pressable>
        <Pressable style={[ui.btnOutline, { flex: 1 }, insp.overallResult === 'fail' && { backgroundColor: '#c0392b' }]} onPress={() => patch({ overallResult: 'fail' })}>
          <Text style={insp.overallResult === 'fail' ? ui.btnText : ui.btnOutlineText}>FAIL</Text>
        </Pressable>
      </View>

      <Text style={ui.label}>Follow-up date</Text>
      <TextInput style={ui.input} value={insp.followUpDate ?? ''} onChangeText={(v) => patch({ followUpDate: v })} placeholder="YYYY-MM-DD (if reinspection needed)" />

      <Text style={ui.label}>Inspector signature</Text>
      <TextInput style={ui.input} value={insp.inspectorSignature ?? ''} onChangeText={(v) => patch({ inspectorSignature: v })} placeholder="Type full name to sign" autoCapitalize="words" />

      <Pressable style={[ui.btn, { marginTop: 16 }]} onPress={async () => { if (!insp) return; const done = { ...insp, status: 'completed' as const }; setInsp(done); await saveHudInspection(done); await notifyInspectionForReview(done); Alert.alert('Saved', 'Inspection saved and sent for review.'); }}>
        <Text style={ui.btnText}>Save & send for review</Text>
      </Pressable>

      <Pressable style={[ui.btnOutline, { marginTop: 8, marginBottom: 24 }]} onPress={async () => { if (!insp) return; const done = { ...insp, status: 'completed' as const }; setInsp(done); await saveHudInspection(done); await notifyInspectionForReview(done); router.back(); }}>
        <Text style={ui.btnOutlineText}>Save &amp; close</Text>
      </Pressable>

      <Modal visible={devPickerOpen} animationType="slide" onRequestClose={() => setDevPickerOpen(false)}>
        <View style={{ flex: 1, padding: 16, paddingTop: 60, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={ui.h}>Select development</Text>
            <Pressable onPress={() => setDevPickerOpen(false)}><Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>Close</Text></Pressable>
          </View>
          <TextInput style={ui.input} value={devQuery} onChangeText={setDevQuery} placeholder="Search developments..." autoFocus />
          <FlatList
            data={devFiltered}
            keyExtractor={(n) => n}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => { patch({ development: item }); setDevPickerOpen(false); setDevQuery(''); }}>
                <Text style={{ fontSize: 16 }}>{item}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={ui.empty}>No matches.</Text>}
          />
        </View>
      </Modal>

      <Modal visible={projPickerOpen} animationType="slide" onRequestClose={() => setProjPickerOpen(false)}>
        <View style={{ flex: 1, padding: 16, paddingTop: 60, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={ui.h}>Select project</Text>
            <Pressable onPress={() => setProjPickerOpen(false)}><Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>Close</Text></Pressable>
          </View>
          <TextInput style={ui.input} value={projQuery} onChangeText={setProjQuery} placeholder="Search projects..." autoFocus />
          <FlatList
            data={projFiltered}
            keyExtractor={(x) => x.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => { patch({ projectId: item.id }); setProjPickerOpen(false); setProjQuery(''); }}>
                <Text style={{ fontSize: 16 }}>{item.name}</Text>
                {!!item.client && <Text style={{ fontSize: 13, color: '#666' }}>{item.client}</Text>}
              </Pressable>
            )}
            ListEmptyComponent={<Text style={ui.empty}>No matches.</Text>}
          />
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
