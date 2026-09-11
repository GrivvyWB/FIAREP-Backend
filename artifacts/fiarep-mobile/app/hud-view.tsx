import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getHudInspection, addHudNote, setHudReview, type HudInspection, type ReviewDecision } from '../lib/hud';
import { getCurrentActor } from '../lib/store';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';

const ROOM_LABEL: Record<string, string> = {
  living_room: 'Living room', kitchen: 'Kitchen', bathroom: 'Bathroom', bedroom: 'Bedroom', hallway: 'Hallway', common_area: 'Common area',
};
const RESULT_LABEL: Record<string, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconclusive' };

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={ui.line}>
      <Text style={ui.lineK}>{k}</Text>
      <Text style={ui.lineV}>{v}</Text>
    </View>
  );
}

export default function HudView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { mode } = useAppMode();
  const [insp, setInsp] = useState<HudInspection | null>(null);
  const [noteText, setNoteText] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  const load = useCallback(() => {
    if (id) getHudInspection(id).then(setInsp);
  }, [id]);
  useFocusEffect(load);

  async function submitReview(decision: ReviewDecision) {
    if (!insp) return;
    if (decision === 'rejected' && !reviewNotes.trim()) { Alert.alert('Notes required', 'Please add notes explaining the rejection.'); return; }
    const a = await getCurrentActor();
    await setHudReview(insp.id, decision, reviewNotes.trim(), a.name || 'administrator');
    setReviewNotes('');
    load();
    Alert.alert('Decision recorded', 'The inspector has been notified.');
  }

  async function sendNote() {
    if (!insp || !noteText.trim()) return;
    const a = await getCurrentActor();
    await addHudNote(insp.id, noteText.trim(), a.role || (mode ?? ''), a.name || '');
    setNoteText('');
    load();
  }

  if (!insp) {
    return <ScrollView contentContainerStyle={ui.wrap}><Text style={ui.empty}>Loading…</Text></ScrollView>;
  }

  const fails = insp.rooms.flatMap((r) => r.items.filter((it) => it.result === 'fail').map((it) => ({ room: r.roomType, name: it.itemName })));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>{insp.unitAddress || 'Inspection'}</Text>
      {!!insp.overallResult && (
        <Text style={{ fontSize: 16, fontWeight: '800', color: insp.overallResult === 'pass' ? '#1a8f4c' : '#c0392b', marginBottom: 8 }}>
          {insp.overallResult === 'pass' ? 'PASS' : 'FAIL'}
        </Text>
      )}

      <View style={[ui.card, { gap: 4 }]}>
        <Row k="Type" v={insp.inspectionType} />
        <Row k="Date" v={insp.inspectionDate} />
        <Row k="Inspector" v={insp.inspectorName || '—'} />
        <Row k="Development" v={insp.development || '—'} />
        <Row k="Status" v={insp.status} />
        {!!insp.residentName && <Row k="Resident" v={insp.residentName} />}
        {insp.utilitiesAvailable.length > 0 && <Row k="Utilities" v={insp.utilitiesAvailable.join(', ')} />}
      </View>

      <Text style={[ui.h, { fontSize: 17, marginTop: 16 }]}>Summary</Text>
      <View style={[ui.card, { gap: 4 }]}>
        <Row k="Rooms" v={String(insp.rooms.length)} />
        <Row k="Failed items" v={String(fails.length)} />
        <Row k="Deficiencies" v={String(insp.deficiencies.length)} />
        <Row k="Physical items" v={String(insp.physicalItems.length)} />
        <Row k="Corrective actions" v={String(insp.correctiveActions.length)} />
      </View>

      {insp.rooms.length > 0 && (
        <>
          <Text style={[ui.h, { fontSize: 17, marginTop: 16 }]}>Rooms & HQS Items</Text>
          {insp.rooms.map((room) => (
            <View key={room.id} style={[ui.card, { gap: 6 }]}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: ACCENT }}>{ROOM_LABEL[room.roomType] || room.roomType}</Text>
              {room.items.length === 0 && <Text style={ui.listSub}>No items recorded.</Text>}
              {room.items.map((it) => (
                <View key={it.id} style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6, gap: 2 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600' }}>{it.itemName || '(unnamed item)'}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: it.result === 'fail' ? '#c0392b' : it.result === 'pass' ? '#1a8f4c' : '#b8860b' }}>
                    {RESULT_LABEL[it.result] || it.result}{it.severity ? '  ·  Severity: ' + it.severity : ''}
                  </Text>
                  {!!it.comments && <Text style={{ fontSize: 13, color: '#333' }}>{it.comments}</Text>}
                </View>
              ))}
            </View>
          ))}
        </>
      )}

      {insp.physicalItems.length > 0 && (
        <>
          <Text style={[ui.h, { fontSize: 17, marginTop: 16 }]}>Physical Condition</Text>
          {insp.physicalItems.map((pi) => (
            <View key={pi.id} style={[ui.card, { gap: 2 }]}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: ACCENT }}>{pi.category === 'interior' ? 'Interior' : 'Exterior'}: {pi.itemName || '(unnamed)'}</Text>
              <Text style={ui.listSub}>
                {pi.maintenanceNeeded ? 'Maintenance needed' : 'No maintenance'}{pi.urgency ? '  ·  ' + pi.urgency + ' urgency' : ''}{pi.onPriorReport ? '  ·  on prior report' : ''}{pi.estimatedCost != null ? '  ·  $' + pi.estimatedCost : ''}
              </Text>
            </View>
          ))}
        </>
      )}

      <Text style={[ui.h, { fontSize: 17, marginTop: 16 }]}>Lead-Based Paint</Text>
      <View style={[ui.card, { gap: 4 }]}>
        <Row k="Visual assessment" v={insp.lead.leadVisualAssessment ? 'Done' : 'Not done'} />
        <Row k="Deteriorated paint" v={insp.lead.deterioratedPaintPresent ? 'Present' : 'None'} />
        {!!insp.lead.riskLevel && <Row k="Risk level" v={insp.lead.riskLevel} />}
        {!!insp.lead.requiredAction && <Row k="Required action" v={insp.lead.requiredAction.replace('_', ' ')} />}
      </View>

      <Text style={[ui.h, { fontSize: 17, marginTop: 16 }]}>Life & Safety</Text>
      <View style={[ui.card, { gap: 4 }]}>
        <Row k="Smoke detectors" v={insp.lifeSafety.smokeDetectorsPresent ? 'Present' : 'No'} />
        <Row k="CO detectors" v={insp.lifeSafety.coDetectorsPresent ? 'Present' : 'No'} />
        <Row k="Fire exits clear" v={insp.lifeSafety.fireExitsClear ? 'Yes' : 'No'} />
        <Row k="Emergency lighting" v={insp.lifeSafety.emergencyLightingOperational ? 'Operational' : 'No'} />
        <Row k="Trip hazards" v={insp.lifeSafety.tripHazardsPresent ? 'Present' : 'None'} />
        <Row k="Gas leak" v={insp.lifeSafety.gasLeakDetected ? 'Detected' : 'None'} />
        <Row k="Electrical hazard" v={insp.lifeSafety.electricalHazardPresent ? 'Present' : 'None'} />
      </View>

      {insp.deficiencies.length > 0 && (
        <>
          <Text style={[ui.h, { fontSize: 17, marginTop: 16 }]}>Deficiencies</Text>
          {insp.deficiencies.map((d) => (
            <View key={d.id} style={[ui.card, { gap: 2 }]}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: ACCENT }}>{d.title || 'Untitled'}</Text>
              {!!d.location && <Text style={ui.listSub}>Location: {d.location}{d.rationaleCode ? ' · ' + d.rationaleCode : ''}{d.correctionTimeframe ? ' · ' + d.correctionTimeframe.replace('_', ' ') : ''}</Text>}
              {d.healthSafety && <Text style={{ color: '#c0392b', fontSize: 12, fontWeight: '700' }}>Health & Safety</Text>}
              {!!d.notes && <Text style={{ fontSize: 13, color: '#333' }}>{d.notes}</Text>}
            </View>
          ))}
        </>
      )}

      {insp.correctiveActions.length > 0 && (
        <>
          <Text style={[ui.h, { fontSize: 17, marginTop: 16 }]}>Corrective Actions</Text>
          {insp.correctiveActions.map((a) => (
            <View key={a.id} style={[ui.card, { gap: 2 }]}>
              <Text style={{ fontSize: 14, color: '#333' }}>{a.description || '—'}</Text>
              <Text style={ui.listSub}>{a.assignedToStaff ? 'Assigned: ' + a.assignedToStaff : 'Unassigned'}{a.deadline ? ' · due ' + a.deadline : ''} · {a.status || 'pending'}</Text>
            </View>
          ))}
        </>
      )}

      {insp.review && (
        <View style={{ borderRadius: 10, padding: 12, marginTop: 16, backgroundColor: insp.review.decision === 'approved' ? '#eaf7ef' : insp.review.decision === 'rejected' ? '#fdecea' : '#fff6e6', borderWidth: 1, borderColor: insp.review.decision === 'approved' ? '#1a8f4c' : insp.review.decision === 'rejected' ? '#c0392b' : '#b8860b' }}>
          <Text style={{ fontWeight: '800', fontSize: 15, color: insp.review.decision === 'approved' ? '#1a8f4c' : insp.review.decision === 'rejected' ? '#c0392b' : '#b8860b' }}>
            {insp.review.decision === 'approved' ? 'APPROVED' : insp.review.decision === 'rejected' ? 'REJECTED' : 'NEEDS REVISION'}
          </Text>
          {!!insp.review.notes && <Text style={{ fontSize: 13, color: '#333', marginTop: 4 }}>{insp.review.notes}</Text>}
          <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>By {insp.review.decidedBy}</Text>
        </View>
      )}

      {true && (
        <>
          <Text style={[ui.h, { fontSize: 17, marginTop: 20 }]}>Review Decision</Text>
          <TextInput style={[ui.input, { minHeight: 60 }]} value={reviewNotes} onChangeText={setReviewNotes} placeholder="Notes (required to reject)" multiline textAlignVertical="top" />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#1a8f4c' }]} onPress={() => submitReview('approved')}>
              <Text style={[ui.btnOutlineText, { color: '#1a8f4c' }]}>Approve</Text>
            </Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#b8860b' }]} onPress={() => submitReview('needs_revision')}>
              <Text style={[ui.btnOutlineText, { color: '#b8860b', fontSize: 13 }]}>Needs revision</Text>
            </Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#c0392b' }]} onPress={() => submitReview('rejected')}>
              <Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Reject</Text>
            </Pressable>
          </View>
        </>
      )}

      <Text style={[ui.h, { fontSize: 17, marginTop: 20 }]}>Notes</Text>
      {(insp.notes || []).length === 0 && <Text style={ui.empty}>No notes yet.</Text>}
      {(insp.notes || []).map((n) => (
        <View key={n.id} style={[ui.card, { gap: 2 }]}>
          <Text style={{ fontSize: 14, color: '#333' }}>{n.text}</Text>
          <Text style={ui.listSub}>{n.byName || n.byRole} · {fmt(n.at)}</Text>
        </View>
      ))}

      <Text style={ui.label}>Write a note to the inspector</Text>
      <TextInput style={[ui.input, { minHeight: 70 }]} value={noteText} onChangeText={setNoteText} placeholder="Your note…" multiline textAlignVertical="top" />
      <Pressable style={[ui.btn, { marginTop: 8, marginBottom: 24 }]} onPress={sendNote}>
        <Text style={ui.btnText}>Send note</Text>
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
