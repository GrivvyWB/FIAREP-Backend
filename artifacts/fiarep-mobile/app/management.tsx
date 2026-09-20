import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, Modal, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import PhotoViewer from '../components/PhotoViewer';
import { photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import { useFocusEffect } from 'expo-router';
import {
  listResidentReports,
  assignResidentReport,
  updateResidentReportStatus,
  getContractorScores,
  setReportDevelopment,
  listDevelopmentNames,
  listStaffByPosition,
  STAFF_POSITIONS, displayStaffPosition,
  createChangeOrder,
  getCurrentActor,
  developmentsForManager,
  type ResidentReport,
  type StaffAccount,
  type StaffPosition,
  clearResidentReportForStaff,
  deleteResidentReport,
  getCurrentPosition,
  listResidentReportPhotoUrls,
  getScores,
  type DevelopmentScore,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { useAppMode } from './_layout';
import { syncAllEntities } from '../lib/sync';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';

const STATUS_LABEL: Record<ResidentReport['status'], string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  resolved: 'Resolved',
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

const ALL = '__ALL__';

const MANAGEMENT_WORK_ORDER_EXCLUDED_POSITIONS = new Set<StaffPosition>([
  'Borough Director',
  'Regional Director',
  'Property Manager',
  'Assistant Property Manager',
  'Superintendent',
  'Plumber',
  'Electrician',
  'Painter',
  'Plumber Supervisor',
  'Electric Supervisor',
  'Elevator Supervisor',
  'Painter Supervisor',
  'Carpenter Supervisor',
  'Roofer',
  'CCTV Installation',
  'Director',
]);

const MANAGEMENT_WORK_ORDER_POSITIONS = STAFF_POSITIONS.filter(
  (position) => !MANAGEMENT_WORK_ORDER_EXCLUDED_POSITIONS.has(position),
);

function DevPicker(props: {
  visible: boolean;
  onClose: () => void;
  onPick: (name: string) => void;
  names: string[];
  includeAll?: boolean;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? props.names.filter((n) => n.toLowerCase().includes(s)) : props.names;
    return base;
  }, [q, props.names]);

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <View style={{ flex: 1, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={ui.h}>Select development</Text>
          <Pressable onPress={props.onClose}><Text style={{ color: ACCENT, fontSize: 16 }}>Close</Text></Pressable>
        </View>
        <TextInput
          style={ui.input}
          value={q}
          onChangeText={setQ}
          placeholder="Search developments…"
          autoFocus
        />
        {props.includeAll && (
          <Pressable
            style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}
            onPress={() => { props.onPick(ALL); props.onClose(); }}
          >
            <Text style={{ fontSize: 16, fontWeight: '500' }}>All developments</Text>
          </Pressable>
        )}
        <FlatList
          data={filtered}
          keyExtractor={(n) => n}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}
              onPress={() => { props.onPick(item); props.onClose(); }}
            >
              <Text style={{ fontSize: 16 }}>{item}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={ui.empty}>No matches.</Text>}
        />
      </View>
    </Modal>
  );
}

export default function Management() {
  const { mode } = useAppMode();
  const canDelete = useDeletionPolicy(mode !== null && mode !== 'resident' && mode !== 'vendor');
  const [reports, setReports] = useState<ResidentReport[]>([]);
  const [myDevs, setMyDevs] = useState<string[]>([]);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [workerNames, setWorkerNames] = useState<Record<string, string>>({});
  const [filterDev, setFilterDev] = useState<string>(ALL);
  const [showReports, setShowReports] = useState(false);
  const [picker, setPicker] = useState<{ mode: 'filter' | 'tag'; id?: string } | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignPos, setAssignPos] = useState<StaffPosition | null>(null);
  const [staffList, setStaffList] = useState<StaffAccount[]>([]);
  const [cwoFor, setCwoFor] = useState<ResidentReport | null>(null);
  const [currentPosition, setCurrentPosition] = useState('');
  const [scoreByName, setScoreByName] = useState<Record<string, number>>({});
  const [developmentScores, setDevelopmentScores] = useState<DevelopmentScore[]>([]);
  const [cwoPos, setCwoPos] = useState<string>('');
  const [cwoName, setCwoName] = useState<string>('');
  const [cwoDesc, setCwoDesc] = useState<string>('');
  const [cwoCost, setCwoCost] = useState<string>('');
  const [cwoStaff, setCwoStaff] = useState<StaffAccount[]>([]);
  const resolvedPhotosByReportId = useRef(new Map<string, string[]>());
  const photoRequestsInFlight = useRef(new Set<string>());
  const needsReportRehydrate = useRef(true);

  const names = useMemo(() => listDevelopmentNames(), []);
  const load = useCallback(() => {
    listResidentReports().then((items) => {
      // Preserve already-resolved photo URLs so periodic refreshes do not
      // re-sign them and remount every RemotePhoto.
      const refreshed = items.map((item) => {
        const cached = resolvedPhotosByReportId.current.get(item.id);
        if (cached) return { ...item, photos: cached };
        const existingUrls = item.photos.filter((uri) => /^https?:\/\//i.test(uri));
        if (existingUrls.length > 0) {
          resolvedPhotosByReportId.current.set(item.id, existingUrls);
          return { ...item, photos: existingUrls };
        }
        return item;
      });
      setReports(refreshed);

      for (const item of items) {
        if (
          resolvedPhotosByReportId.current.has(item.id) ||
          photoRequestsInFlight.current.has(item.id)
        ) continue;
        photoRequestsInFlight.current.add(item.id);
        void listResidentReportPhotoUrls(item.id)
          .then((urls) => {
            resolvedPhotosByReportId.current.set(item.id, urls);
            setReports((current) => current.map((report) =>
              report.id === item.id ? { ...report, photos: urls } : report
            ));
          })
          .catch(() => undefined)
          .finally(() => {
            photoRequestsInFlight.current.delete(item.id);
          });
      }
    });
    getContractorScores().then((arr) => { const m: Record<string, number> = {}; for (const c of arr) m[c.name] = c.score; setScoreByName(m); });
    getScores().then((snapshot) => setDevelopmentScores(snapshot.developments));
    (async () => {
      const a = await getCurrentActor();
      if (a.name) setMyDevs(await developmentsForManager(a.name));
      else setMyDevs([]);
      setCurrentPosition(await getCurrentPosition());
    })();
  }, []);
  useFocusEffect(useCallback(() => {
    let active = true;
    let syncing = false;
    const refresh = async () => {
      if (syncing) return;
      syncing = true;
      try {
        await syncAllEntities(
          needsReportRehydrate.current
            ? { refreshEntities: ['resident-reports'] }
            : undefined,
        );
        needsReportRehydrate.current = false;
        if (active) load();
      } finally {
        syncing = false;
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]));

  // Admin edits all. Management with no assigned developments edits all (backward-compatible).
  // Management with assigned developments edits only reports in those developments; others are read-only.
  function canEdit(r: ResidentReport): boolean {
    if (mode === 'administrator') return true;
    if (currentPosition === 'Superintendent Ⓔ') return true;
    if (myDevs.length === 0) return true;
    const dev = (r.development || '').trim().toLowerCase();
    return myDevs.some((d) => (d || '').trim().toLowerCase() === dev);
  }

  const visible = filterDev === ALL
    ? reports
    : reports.filter((r) =>
        (r.development || '').trim().toLowerCase() === filterDev.trim().toLowerCase()
      );

  const inProgressCount = visible.filter((r) => r.status === 'submitted' || r.status === 'assigned' || r.status === 'in_progress').length;
  const completedCount = visible.filter((r) => r.status === 'completed' || r.status === 'resolved').length;
  const visibleDevelopmentScores = developmentScores.filter((score) =>
    filterDev === ALL
      ? true
      : score.development.trim().toLowerCase() === filterDev.trim().toLowerCase()
  );
  const score = visibleDevelopmentScores.length === 0
    ? null
    : filterDev === ALL
      ? Math.max(0, Math.min(100, 50 + visibleDevelopmentScores.reduce(
          (total, item) => total + (item.points ?? ((item.scorePercent ?? item.score) - 50)),
          0,
        )))
      : visibleDevelopmentScores[0]?.scorePercent ?? visibleDevelopmentScores[0]?.score ?? null;

  async function onAssign(r: ResidentReport) {
    const name = (workerNames[r.id] || '').trim();
    if (!name) { Alert.alert('Staff member name required', 'Enter a staff member name to assign.'); return; }
    try {
      const selected = staffList.find((staff) => staff.name.trim().toLowerCase() === name.toLowerCase());
      if (!selected) throw new Error('Choose an approved staff member from the assignment list.');
      await assignResidentReport(r.id, selected.id, selected.name);
      setWorkerNames((m) => ({ ...m, [r.id]: '' }));
      load();
    } catch (e: any) { Alert.alert('Assign failed', e?.message ?? 'Could not assign.'); }
  }

  async function pickPosition(pos: StaffPosition) {
    setAssignPos(pos);
    const report = reports.find((item) => item.id === assignFor);
    const development = (report?.development || '').trim().toLowerCase();
    const candidates = await listStaffByPosition(pos);
    setStaffList(currentPosition === 'Superintendent Ⓔ'
      ? candidates
      : candidates.filter((staff) =>
          Boolean(development) &&
          (staff.developments || []).some((item) => item.trim().toLowerCase() === development)
        ));
  }

  async function assignStaff(a: StaffAccount) {
    if (!assignFor) return;
    try {
      await assignResidentReport(assignFor, a.id, a.name);
      setAssignFor(null); setAssignPos(null); setStaffList([]);
      load();
    } catch (e: any) { Alert.alert('Assign failed', e?.message ?? 'Could not assign.'); }
  }

  async function cwoPickPosition(pos: string) {
    setCwoPos(pos); setCwoName('');
    setCwoStaff(await listStaffByPosition(pos));
  }

  async function submitCwo() {
    if (!cwoFor) return;
    if (!cwoPos) { Alert.alert('Pick a trade', 'Choose which trade this change is for.'); return; }
    if (!cwoDesc.trim()) { Alert.alert('Describe the change', 'Enter what needs to change.'); return; }
    const costNum = parseFloat(String(cwoCost).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(costNum) || costNum <= 0) { Alert.alert('Cost required', 'Enter the cost of the change (materials + labor + markup).'); return; }
    try {
      const ref = (cwoFor.location || cwoFor.unit || 'Report') + (cwoFor.development ? ' \u00b7 ' + cwoFor.development : '');
      await createChangeOrder(cwoFor.id, ref, cwoPos, cwoName, cwoDesc.trim(), costNum);
      setCwoFor(null); setCwoPos(''); setCwoName(''); setCwoDesc(''); setCwoCost(''); setCwoStaff([]);
      Alert.alert('Change order sent', 'The change work order was sent.');
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Could not create change order.'); }
  }

  async function onResolve(r: ResidentReport) {
    try { await updateResidentReportStatus(r.id, 'resolved'); load(); }
    catch (e: any) { Alert.alert('Update failed', e?.message ?? 'Could not update.'); }
  }

  function confirmDelete(r: ResidentReport) {
    Alert.alert(
      'Delete resident report',
      'Permanently delete this resident report? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteResidentReport(r.id)
              .then(load)
              .catch((e: any) => Alert.alert('Delete failed', e?.message ?? 'Could not delete.'));
          },
        },
      ],
    );
  }

  async function onPickDevelopment(name: string) {
    if (!picker) return;
    if (picker.mode === 'filter') {
      setFilterDev(name);
      return;
    }
    // tag mode
    if (picker.id) {
      try { await setReportDevelopment(picker.id, name); load(); }
      catch (e: any) { Alert.alert('Tag failed', e?.message ?? 'Could not set development.'); }
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Resident Reports</Text>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, backgroundColor: '#fafafa' }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#185FA5' }}>{inProgressCount}</Text>
          <Text style={{ fontSize: 13, color: '#666', marginTop: 2 }}>In Progress</Text>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, backgroundColor: '#fafafa' }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#2e7d32' }}>{completedCount}</Text>
          <Text style={{ fontSize: 13, color: '#666', marginTop: 2 }}>Completed</Text>
        </View>
        <View style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, backgroundColor: '#fafafa' }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: score !== null && score >= 50 ? '#2e7d32' : '#c0392b' }}>
            {score === null ? '—' : `${score}%`}
          </Text>
          <Text style={{ fontSize: 13, color: '#666', marginTop: 2 }}>Score</Text>
        </View>
      </View>

      <View>
        <Text style={ui.label}>Development</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable style={[ui.input, { flex: 1 }]} onPress={() => setPicker({ mode: 'filter' })}>
            <Text>{filterDev === ALL ? 'All developments' : filterDev}</Text>
          </Pressable>
          {filterDev !== ALL && (
            <Pressable style={ui.btnOutline} onPress={() => setFilterDev(ALL)}>
              <Text style={{ color: '#c0392b', fontWeight: '600' }}>Close</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Pressable onPress={() => setShowReports((v) => !v)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, backgroundColor: '#f2f7fb', borderRadius: 10, padding: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{showReports ? '\u2013' : '+'}  Reports</Text>
        <Text style={{ fontSize: 13, color: '#667085' }}>{visible.length}</Text>
      </Pressable>

      {showReports && visible.length === 0 && (
        <Text style={ui.empty}>No reports{filterDev === ALL ? '' : ' for ' + filterDev}.</Text>
      )}

      {showReports && visible.map((r) => (
        <View key={r.id} style={[ui.card, { gap: 8 }]}>
          {!!r.complaintNo && (
            <View style={ui.line}>
              <Text style={ui.lineK}>Complaint #</Text>
              <Text style={[ui.lineV, { color: ACCENT, fontWeight: '700' }]}>{r.complaintNo}</Text>
            </View>
          )}
          {!!r.location && (
            <View style={ui.line}>
              <Text style={ui.lineK}>Location</Text>
              <Text style={ui.lineV}>{r.location}</Text>
            </View>
          )}
          <View style={ui.line}>
            <Text style={ui.lineK}>Unit</Text>
            <Text style={ui.lineV}>{r.unit}</Text>
          </View>
          <View style={[ui.line, { alignItems: 'flex-start', gap: 12 }]}>
            <Text style={[ui.lineK, { width: 58, flexShrink: 0 }]}>Address</Text>
            <Text style={[ui.lineV, { flex: 1, minWidth: 0, flexShrink: 1, textAlign: 'right', lineHeight: 20 }]}>
              {r.address}
            </Text>
          </View>
          <View style={ui.line}>
            <Text style={ui.lineK}>Development</Text>
            <Text style={ui.lineV}>{r.development || 'Untagged'}</Text>
          </View>
          <View style={ui.line}>
            <Text style={ui.lineK}>Status</Text>
            <Text style={[ui.lineV, { color: ACCENT }]}>{STATUS_LABEL[r.status]}</Text>
          </View>
          {!!r.assignedTo && (
            <View style={ui.line}>
              <Text style={ui.lineK}>Assigned to</Text>
              <Text style={ui.lineV}>{r.assignedTo}</Text>
            </View>
          )}
          <View style={{ paddingVertical: 4 }}>
            <Text style={ui.label}>Issue</Text>
            <Text>{r.description}</Text>
          </View>
          <Text style={ui.listSub}>Submitted {fmt(r.createdAt)}</Text>

          {r.photos.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {r.photos.map((uri, i) => (
                <Pressable key={`${uri}-${i}`} onPress={() => setViewerUri(uri)}><RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} /></Pressable>
              ))}
            </View>
          )}

          <View style={{ marginTop: 6, gap: 8 }}>
            {canEdit(r) ? (
              <>
                <Text style={ui.label}>Development</Text>
                <Pressable style={ui.btnOutline} onPress={() => setPicker({ mode: 'tag', id: r.id })}>
                  <Text style={ui.btnOutlineText}>{r.development ? `Change (now: ${r.development})` : 'Set development'}</Text>
                </Pressable>

                <Text style={ui.label}>Send complaint</Text>
                <Pressable style={ui.btn} onPress={() => { setAssignFor(r.id); setAssignPos(null); setStaffList([]); }}>
                  <Text style={ui.btnText}>{r.assignedTo ? `Reassign complaint (now: ${r.assignedTo})` : 'Send complaint to staff'}</Text>
                </Pressable>
                {r.status !== 'resolved' && (
                  <Pressable style={ui.btnOutline} onPress={() => onResolve(r)}>
                    <Text style={ui.btnOutlineText}>Mark Resolved</Text>
                  </Pressable>
                )}
                {r.status === 'resolved' && !!r.assignedTo && !r.clearedByMgmt && (
                  <Pressable style={ui.btnOutline} onPress={() => { clearResidentReportForStaff(r.id).then(load); }}>
                    <Text style={ui.btnOutlineText}>Clear for worker (lets them remove it)</Text>
                  </Pressable>
                )}
                <Pressable style={ui.btnOutline} onPress={() => { setCwoFor(r); setCwoPos(''); setCwoName(''); setCwoDesc(''); setCwoStaff([]); }}>
                  <Text style={ui.btnOutlineText}>Request Change</Text>
                </Pressable>
                {canDelete && (mode === 'administrator' || currentPosition === 'Regional Director') && (
                  <Pressable style={[ui.btnOutline, { borderColor: '#c0392b' }]} onPress={() => confirmDelete(r)}>
                    <Text style={{ color: '#c0392b', fontWeight: '600', textAlign: 'center' }}>Delete</Text>
                  </Pressable>
                )}
              </>
            ) : (
              <Text style={{ fontSize: 13, color: '#999', fontStyle: 'italic', paddingVertical: 6 }}>
                View only — not your assigned development.
              </Text>
            )}
          </View>

          {r.updates.length > 0 && (
            <View style={{ marginTop: 4 }}>
              <Text style={ui.label}>History</Text>
              {r.updates.slice().reverse().map((u, i) => (
                <View key={i} style={{ paddingVertical: 3 }}>
                  <Text style={ui.lineV}>{STATUS_LABEL[u.status]}{u.note ? ` — ${u.note}` : ''}</Text>
                  <Text style={ui.listSub}>{fmt(u.at)}{u.by ? ` · ${u.by}` : ''}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}

      <DevPicker
        visible={!!picker}
        onClose={() => setPicker(null)}
        onPick={onPickDevelopment}
        names={names}
        includeAll={picker?.mode === 'filter'}
      />

      <Modal visible={!!assignFor} animationType="slide" onRequestClose={() => setAssignFor(null)}>
        <View style={{ flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>{assignPos ? assignPos + 's' : 'Choose staff position'}</Text>
            <Pressable onPress={() => { setAssignFor(null); setAssignPos(null); setStaffList([]); }}>
              <Text style={{ color: ACCENT, fontWeight: '600', fontSize: 16 }}>Close</Text>
            </Pressable>
          </View>
          {!assignPos ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(currentPosition === 'Superintendent Ⓔ'
                ? STAFF_POSITIONS.filter((pos) => !['Borough Director', 'Superintendent Ⓔ'].includes(pos))
                : MANAGEMENT_WORK_ORDER_POSITIONS
              ).map((pos) => (
                <Pressable key={pos} style={ui.btnOutline} onPress={() => pickPosition(pos)}>
                  <Text style={ui.btnOutlineText}>{pos}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              <Pressable style={[ui.btnOutline, { marginBottom: 10 }]} onPress={() => { setAssignPos(null); setStaffList([]); }}>
                <Text style={ui.btnOutlineText}>Back to positions</Text>
              </Pressable>
              {staffList.length === 0 ? (
                <Text style={ui.empty}>No {assignPos} staff yet.</Text>
              ) : (
                <FlatList
                  data={staffList}
                  keyExtractor={(a) => a.id}
                  renderItem={({ item }) => (
                    <Pressable style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }} onPress={() => assignStaff(item)}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16 }}>{item.name}</Text>
                        <Text style={ui.listSub}>{item.position}</Text>
                      </View>
                      {typeof scoreByName[item.name] === 'number' ? (
                        <View style={{ backgroundColor: scoreByName[item.name] >= 80 ? '#1a8f4c' : scoreByName[item.name] >= 55 ? '#b8860b' : '#c0392b', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{scoreByName[item.name]}</Text>
                        </View>
                      ) : (
                        <Text style={{ color: '#bbb', fontSize: 13 }}>no score</Text>
                      )}
                    </Pressable>
                  )}
                />
              )}
            </>
          )}
        </View>
      </Modal>
    <PhotoViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
          <Modal visible={!!cwoFor} animationType="slide" onRequestClose={() => setCwoFor(null)}>
        <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 60 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={ui.h}>Change Work Order</Text>
            <Pressable onPress={() => setCwoFor(null)}><Text style={{ color: ACCENT, fontWeight: '600' }}>Close</Text></Pressable>
          </View>
          <Text style={ui.label}>Trade / position</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {STAFF_POSITIONS.map((pos) => (
              <Pressable key={pos} style={[ui.btnOutline, cwoPos === pos && { backgroundColor: ACCENT }]} onPress={() => cwoPickPosition(pos)}>
                <Text style={cwoPos === pos ? ui.btnText : ui.btnOutlineText}>{displayStaffPosition(pos)}</Text>
              </Pressable>
            ))}
          </View>
          {cwoStaff.length > 0 && (
            <View>
              <Text style={ui.label}>Specific person (optional)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {cwoStaff.map((a) => (
                  <Pressable key={a.id} style={[ui.btnOutline, cwoName === a.name && { backgroundColor: ACCENT }]} onPress={() => setCwoName(cwoName === a.name ? '' : a.name)}>
                    <Text style={cwoName === a.name ? ui.btnText : ui.btnOutlineText}>{a.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <Text style={ui.label}>Change requested</Text>
          <TextInput style={[ui.input, { minHeight: 90 }]} value={cwoDesc} onChangeText={setCwoDesc} placeholder="Describe the change to this job..." multiline textAlignVertical="top" />
          <Text style={[ui.label, { marginTop: 8 }]}>Cost of change (materials + labor + markup)</Text>
          <TextInput style={ui.input} value={cwoCost} onChangeText={setCwoCost} placeholder="$" keyboardType="numeric" />
          <Pressable style={[ui.btn, { marginTop: 12 }]} onPress={submitCwo}>
            <Text style={ui.btnText}>Send Change Order</Text>
          </Pressable>
        </ScrollView>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
