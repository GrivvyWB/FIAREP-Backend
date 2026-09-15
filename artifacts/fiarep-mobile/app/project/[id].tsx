import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, TextInput, Modal, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getProject, listRooms, deleteRoom, deleteProject, type Project, type Room, addProjectNote, listProjectNotes, getCurrentActor, type ProjectNote, listAssignableByTrade, type TradeGroup, assignProjectInspector, getProjectInspector, setProjectReview, getProjectReview, isProjectApproved, submitProjectForReview, submitProjectScope, getProjectScope, getCurrentPosition, type ProcurementRequest, type StaffAccount, type ProjectReview, type ProjectReviewDecision } from '../../lib/store';
import { lineTotal, type Category } from '../../lib/catalog';
import { exportQuote } from '../../lib/quote';
import { ui, money, ACCENT } from '../../lib/ui';
import { useAppMode } from '../_layout';
import { useDeletionPolicy } from '../../lib/useDeletionPolicy';

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { mode } = useAppMode();
  const canDelete = useDeletionPolicy(mode !== null && mode !== 'resident' && mode !== 'vendor');
  const [locked, setLocked] = useState(false);
  const readOnly = mode === 'administrator' || locked;
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const canReview = mode === 'administrator' || mode === 'management';
  const [assignedInspector, setAssignedInspector] = useState<string | null>(null);
  const [review, setReview] = useState<ProjectReview | null>(null);
  const [returnedScope, setReturnedScope] = useState<ProcurementRequest | null>(null);
  const [position, setPosition] = useState('');
  // Role gating. Workers = trades (no pricing). Inspectors give violations only
  // (no pricing). Elevator mechanics see ONLY Elevator Services + Change Order.
  const WORKER_POSITIONS = ['Plumber', 'Electrician', 'Maintenance Worker', 'Carpenter', 'Staff Worker', 'Roofer'];
  const isWorker = WORKER_POSITIONS.includes(position);
  const isInspector = position === 'Inspector';
  const isElevatorMech = position === 'Elevator Service';
  const noPricing = isWorker || isInspector || isElevatorMech;  // never see rates/estimate/scope
  const jobTools = !isElevatorMech;  // elevator mech sees none of the general tools
  const [reviewNotes, setReviewNotes] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assignable, setAssignable] = useState<TradeGroup[]>([]);
  const [openTrade, setOpenTrade] = useState<string | null>(null);
  const loadReview = useCallback(() => {
    if (!id) return;
    getProjectInspector(String(id)).then(setAssignedInspector);
    getProjectReview(String(id)).then(setReview);
    isProjectApproved(String(id)).then(setLocked);
    getProjectScope(String(id)).then(setReturnedScope).catch(() => {});
    getCurrentPosition().then(setPosition).catch(() => {});
  }, [id]);
  const loadNotes = useCallback(() => { if (id) listProjectNotes(String(id)).then(setNotes); }, [id]);
  useFocusEffect(loadNotes);
  useFocusEffect(loadReview);
  async function onAddNote() {
    if (!noteText.trim()) return;
    const a = await getCurrentActor();
    await addProjectNote(String(id), noteText.trim(), a.role || (mode || ''), a.name);
    setNoteText('');
    loadNotes();
  }

  async function openAssign() {
    setAssignable(await listAssignableByTrade());
    setOpenTrade(null);
    setPickerOpen(true);
  }
  async function pickInspector(name: string) {
    setPickerOpen(false);
    await assignProjectInspector(String(id), name);
    loadReview();
  }
  async function onSubmitForReview() {
    await submitProjectForReview(String(id));
    loadReview();
    Alert.alert('Submitted', 'A supervisor has been notified to review this inspection.');
  }
  async function doSubmitScope(scopeName: string) {
    try {
      await submitProjectScope(String(id), scopeName);
      Alert.alert('Scope sent', 'Your scope was sent to your supervisor for approval.');
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    }
  }
  function onSubmitScope() {
    const existing = (returnedScope && returnedScope.scope) || '';
    Alert.prompt(
      'Name this scope',
      'Enter a name for this scope of work.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: (v?: string) => { doSubmitScope((v || '').trim()); } },
      ],
      'plain-text',
      existing === 'Nature of Work & Cost Estimate' ? '' : existing,
    );
  }
  async function submitReview(decision: ProjectReviewDecision) {
    if (decision === 'rejected' && !reviewNotes.trim()) { Alert.alert('Notes required', 'Please add notes explaining the rejection.'); return; }
    const a = await getCurrentActor();
    await setProjectReview(String(id), decision, reviewNotes.trim(), a.role || (mode || ''), a.name);
    setReviewNotes('');
    loadReview();
    Alert.alert('Decision recorded', 'The assigned staff member has been notified.');
  }
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  const load = useCallback(() => {
    if (!id) return;
    getProject(id).then(setProject);
    listRooms(id).then(setRooms);
  }, [id]);
  useFocusEffect(load);

  const roomTotal = (r: Room) => r.lines.reduce((s, l) => s + lineTotal(l), 0);
  const projectTotal = rooms.reduce((s, r) => s + roomTotal(r), 0);

  // group rooms by unit (blank -> "General")
  const unitNames: string[] = [];
  const roomsByUnit: Record<string, Room[]> = {};
  rooms.forEach(r => {
    const u = (r.unit && r.unit.trim()) ? r.unit.trim() : 'General';
    if (!roomsByUnit[u]) { roomsByUnit[u] = []; unitNames.push(u); }
    roomsByUnit[u].push(r);
  });
  const unitTotal = (u: string) => (roomsByUnit[u] || []).reduce((s, r) => s + roomTotal(r), 0);
  const multiUnit = unitNames.length > 1 || (unitNames.length === 1 && unitNames[0] !== 'General');

  const onExport = async (unit?: string) => {
    if (!project || rooms.length === 0) { Alert.alert('Nothing to export', 'Add a room with lines first.'); return; }
    const subset = unit ? rooms.filter(r => ((r.unit && r.unit.trim()) ? r.unit.trim() : 'General') === unit) : rooms;
    try { await exportQuote(project, subset, unit); }
    catch (e: any) { Alert.alert('Export failed', e?.message ?? 'Unknown error'); }
  };
  const onDeleteRoom = (roomId: string) =>
    Alert.alert('Delete room?', '', [{ text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteRoom(roomId); load(); } }]);
  const onDeleteProject = () =>
    Alert.alert('Delete project?', 'Removes the project and all its rooms.', [{ text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteProject(id!); router.back(); } }]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={{ fontSize: 20, fontWeight: '500' }}>{project?.name ?? '…'}</Text>
      {!!project?.client && <Text style={ui.listSub}>{project.client}</Text>}
      {locked && (<View style={{ backgroundColor: '#eafaf0', borderColor: '#1a8f4c', borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 8 }}>
        <Text style={{ color: '#1a8f4c', fontWeight: '700' }}>✓ Approved · locked</Text>
        <Text style={{ color: '#1a8f4c', fontSize: 13, marginTop: 2 }}>This inspection is approved. Editing is disabled for all parties.</Text>
      </View>)}
      {!!returnedScope && returnedScope.returnedAt && (
        <View style={{ backgroundColor: '#fdecea', borderColor: '#c0392b', borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 8 }}>
          <Text style={{ color: '#c0392b', fontWeight: '700' }}>Scope returned for revision</Text>
          {!!returnedScope.returnNote && <Text style={{ color: '#c0392b', fontSize: 13, marginTop: 2 }}>{returnedScope.returnNote}</Text>}
          <Text style={{ color: '#c0392b', fontSize: 12, marginTop: 4 }}>Revise the Nature of Work & Cost Estimate, then submit to your supervisor again.</Text>
        </View>
      )}

{!readOnly && jobTools && (
            <Pressable style={ui.btn} onPress={() => router.push(`/project/room?projectId=${id}`)}>
        <Text style={ui.btnText}>+ Add room / area</Text>
      </Pressable>
      )}
      {!noPricing && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/rates?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>{project?.rates ? 'Project rates (custom)' : 'Project rates (default)'}</Text>
      </Pressable>
      )}
      {/* Roof from aerial (Solar API) — hidden until backend proxy for Google key is ready
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/roof?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>Roof from aerial (Solar API)</Text>
      </Pressable>
      */}
      {jobTools && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/checklist?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>Renovation checklist</Text>
      </Pressable>
      )}
      {jobTools && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/inspection?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>Building inspection</Text>
      </Pressable>
      )}
      {!noPricing && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/estimate?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>Nature of Work & Cost Estimate</Text>
      </Pressable>
      )}
      {!noPricing && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/project-scope?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>Scope of Work (Divisions)</Text>
      </Pressable>
      )}
      {jobTools && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/intake?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>Intake Report</Text>
      </Pressable>
      )}
      {isElevatorMech && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/elevator?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>Elevator Services</Text>
      </Pressable>
      )}
      {isElevatorMech && (
      <Pressable style={ui.btnOutline} onPress={() => router.push('/worker-change-order')}>
        <Text style={ui.btnOutlineText}>Change Order</Text>
      </Pressable>
      )}
      {jobTools && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/photos?id=${id}`)}>
        <Text style={ui.btnOutlineText}>Photos</Text>
      </Pressable>
      )}
      {jobTools && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/scans?id=${id}`)}>
        <Text style={ui.btnOutlineText}>Scans</Text>
      </Pressable>
      )}
      {jobTools && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/roofplan?projectId=${id}`)}>
        <Text style={ui.btnOutlineText}>Roof plan sketch</Text>
      </Pressable>
      )}
      {jobTools && (
      <Pressable style={ui.btnOutline} onPress={() => router.push(`/project/compass?id=${id}`)}>
        <Text style={ui.btnOutlineText}>Compass</Text>
      </Pressable>
      )}

      {rooms.length === 0 && <Text style={ui.empty}>No rooms yet. Add one to build the estimate.</Text>}

      {unitNames.map(u => (
        <View key={u} style={{ marginTop: 8 }}>
          {multiUnit && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, marginTop: 6 }}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{u}</Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#185FA5' }}>{money(unitTotal(u))}</Text>
            </View>
          )}
          {roomsByUnit[u].map(r => (
            <Pressable key={r.id} style={ui.card} onPress={() => router.push(`/project/room?projectId=${id}&roomId=${r.id}`)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={ui.cardTitle}>{r.name}</Text>
                {!readOnly && canDelete && (<Pressable onPress={() => onDeleteRoom(r.id)}><Text style={{ color: '#c0392b' }}>Delete</Text></Pressable>)}
              </View>
              <View style={ui.line}><Text style={ui.lineK}>{r.lines.length} line{r.lines.length === 1 ? '' : 's'}</Text><Text style={ui.lineV}>tap to edit</Text></View>
              <View style={ui.totalRow}><Text style={ui.totalK}>Room total</Text><Text style={ui.totalV}>{money(roomTotal(r))}</Text></View>
              {r.lines.filter(l => l.origPrice != null && l.origPrice !== l.unitPrice).map(l => (
                <Text key={l.id} style={{ fontSize: 12, color: '#b8860b', marginTop: 4 }}>{(l.description || l.category)}: was {money(l.origPrice as number)} → now {money(l.unitPrice)}{l.priceBy ? ' (' + l.priceBy + ')' : ''}</Text>
              ))}
            </Pressable>
          ))}
          {multiUnit && (
            <Pressable style={[ui.btnOutline, { marginTop: 2 }]} onPress={() => onExport(u)}>
              <Text style={ui.btnOutlineText}>Export {u} quote (PDF)</Text>
            </Pressable>
          )}
        </View>
      ))}

      {rooms.length > 0 && (
        <Pressable style={[ui.btn, { marginTop: 12 }]} onPress={() => onExport()}>
          <Text style={ui.btnText}>{multiUnit ? 'Export whole building (PDF)' : 'Export quote (PDF)'}</Text>
        </Pressable>
      )}

      {rooms.length > 0 && (
        <View style={[ui.card, { borderColor: '#185FA5' }]}>
          <Text style={ui.cardTitle}>{multiUnit ? 'Building total' : 'Project total'}</Text>
          <View style={ui.line}><Text style={ui.lineK}>Rooms</Text><Text style={ui.lineV}>{rooms.length}</Text></View>
          {multiUnit && unitNames.map(u => (
            <View key={u} style={ui.line}><Text style={ui.lineK}>{u}</Text><Text style={ui.lineV}>{money(unitTotal(u))}</Text></View>
          ))}
          <View style={ui.totalRow}><Text style={ui.totalK}>Total quote</Text><Text style={ui.totalV}>{money(projectTotal)}</Text></View>
        </View>
      )}

          {review && (
            <View style={{ borderRadius: 10, padding: 12, marginTop: 12, backgroundColor: review.decision === 'approved' ? '#eaf7ef' : review.decision === 'rejected' ? '#fdecea' : '#fff6e6', borderWidth: 1, borderColor: review.decision === 'approved' ? '#1a8f4c' : review.decision === 'rejected' ? '#c0392b' : '#b8860b' }}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: review.decision === 'approved' ? '#1a8f4c' : review.decision === 'rejected' ? '#c0392b' : '#b8860b' }}>
                {review.decision === 'approved' ? 'APPROVED' : review.decision === 'rejected' ? 'REJECTED' : 'NEEDS REVISION'}
              </Text>
              {!!review.notes && <Text style={{ fontSize: 13, color: '#333', marginTop: 4 }}>{review.notes}</Text>}
              <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>By {review.byName || review.byRole}</Text>
            </View>
          )}

{mode === 'administrator' && canDelete && (
            <Pressable style={[ui.btnOutline, { borderColor: '#c0392b', marginTop: 20 }]} onPress={onDeleteProject}>
        <Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Delete project</Text>
      </Pressable>
      )}
      {canReview && (
        <>
          <Text style={[ui.label, { marginTop: 20 }]}>Assigned to</Text>
          <Pressable style={ui.input} onPress={openAssign}>
            <Text style={{ color: assignedInspector ? '#000' : '#999' }}>{assignedInspector || 'Assign staff'}</Text>
          </Pressable>

          <Text style={[ui.label, { marginTop: 16 }]}>Review decision</Text>
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
        </>
      )}

      {mode === 'inspector' && (
        <Pressable style={[ui.btn, { marginTop: 20 }]} onPress={onSubmitForReview}>
          <Text style={ui.btnText}>Submit for review</Text>
        </Pressable>
      )}

      {mode === 'inspector' && (
        <Pressable style={[ui.btnOutline, { marginTop: 8, borderColor: ACCENT }]} onPress={onSubmitScope}>
          <Text style={[ui.btnOutlineText, { color: ACCENT }]}>Submit scope to supervisor</Text>
        </Pressable>
      )}

          <Text style={[ui.label, { marginTop: 20 }]}>Notes</Text>
      {!locked && (<>
      <TextInput style={ui.input} value={noteText} onChangeText={setNoteText} placeholder="Add a note for the contractor / inspector..." multiline />
      <Pressable style={[ui.btnOutline, { marginBottom: 8 }]} onPress={onAddNote}>
        <Text style={ui.btnOutlineText}>Add Note</Text>
      </Pressable>
      </>)}
      {notes.map((n) => (
        <View key={n.id} style={[ui.card, { gap: 2 }]}>
          <Text style={{ fontSize: 14, color: '#333' }}>{n.text}</Text>
          <Text style={{ fontSize: 12, color: '#999' }}>{n.byName ? n.byName + ' · ' : ''}{n.byRole}</Text>
        </View>
      ))}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, padding: 16, paddingTop: 60 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>Pick a trade</Text>
            <Pressable onPress={() => setPickerOpen(false)}><Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>Close</Text></Pressable>
          </View>
          <FlatList
            data={assignable}
            keyExtractor={(g) => g.position}
            renderItem={({ item }) => {
              const expanded = openTrade === item.position;
              return (
                <View style={{ borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                  <Pressable style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 }} onPress={() => setOpenTrade(expanded ? null : item.position)}>
                    <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.position}</Text>
                    <Text style={{ fontSize: 15, color: '#666' }}>{expanded ? '−' : '+'}  {item.people.length}</Text>
                  </Pressable>
                  {expanded && item.people.map((a) => (
                    <Pressable key={a.id} style={{ paddingVertical: 12, paddingLeft: 16, borderTopWidth: 1, borderTopColor: '#f2f2f2' }} onPress={() => pickInspector(a.name)}>
                      <Text style={{ fontSize: 16 }}>{a.name}</Text>
                      <Text style={{ fontSize: 13, color: '#666' }}>{a.position || (a.role === 'inspector' ? 'Inspector' : a.role)}</Text>
                    </Pressable>
                  ))}
                </View>
              );
            }}
            ListEmptyComponent={<Text style={ui.empty}>No assignable people found.</Text>}
          />
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
