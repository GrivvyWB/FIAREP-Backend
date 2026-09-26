import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { listProjects, createProject, deleteProject, type Project, listApprovedProjectIds, getSessionIdentity, getCurrentPosition, listResidentReports, lookupComplaintOrViolation } from '../lib/store';
import { useAppMode } from './_layout';
import { ui } from '../lib/ui';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';
import { useModuleAccess } from '../lib/module-access';

export default function Projects() {
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string; list?: string; preName?: string; preDevelopment?: string; preReportId?: string; preComplaintNo?: string; preAddress?: string; preUnit?: string; preNote?: string }>();
  const { mode } = useAppMode();
  const canDelete = useDeletionPolicy(mode !== null && mode !== 'resident' && mode !== 'vendor');
  const modules = useModuleAccess();

  // '/' (this Projects screen) is only for inspector & administrator.
  // Any other role that lands here is redirected to their own home.
  if (mode === 'resident') return <Redirect href="/resident-home" />;
  // A worker-role account is redirected home, EXCEPT when it explicitly came
  // here to start a new project (e.g. a CPM tapping "+ New Project"). The
  // create form itself is still gated by position below.
  // '?list=1' is the CPM "Projects" tile: it must open the list, not bounce home.
  if (mode === 'worker' && params.new !== '1' && params.list !== '1') return <Redirect href="/worker-home" />;
  // Projects is an opt-in module; a worker without it enabled cannot open the
  // new-project workflow even via a direct link.
  if (mode === 'worker' && !modules['proj-new']) return <Redirect href="/worker-home" />;
  const [projects, setProjects] = useState<Project[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [adding, setAdding] = useState(false);
  const [developments, setDevelopments] = useState<string[]>([]);
  const [development, setDevelopment] = useState('');
  const [devQuery, setDevQuery] = useState('');
  const [position, setPosition] = useState('');

  const load = useCallback(() => {
    listProjects().then(setProjects);
    listApprovedProjectIds().then(setApproved);
    getSessionIdentity().then((identity) => setDevelopments(identity?.developments || []));
    getCurrentPosition().then(setPosition).catch(() => undefined);
  }, []);
  useFocusEffect(load);
  // Started from a complaint/violation ("Start project" on Job Details):
  // prefill the name and development and carry the complaint link.
  const fromComplaint = String(params.preComplaintNo || '').trim();
  // Complaint / violation # typed on the New project form (or carried in).
  const [refNo, setRefNo] = useState(fromComplaint);
  const [refInfo, setRefInfo] = useState<{ reportId?: string; address?: string; unit?: string; note?: string; kind?: string } | null>(null);
  const [refMsg, setRefMsg] = useState('');
  useEffect(() => { if (fromComplaint) setRefNo(fromComplaint); }, [fromComplaint]);
  const lookUpRef = async () => {
    const key = refNo.trim().toLowerCase();
    if (!key) { setRefInfo(null); setRefMsg(''); return; }
    const reports = await listResidentReports().catch(() => []);
    const rep = reports.find((r) => (r.complaintNo || '').trim().toLowerCase() === key);
    if (rep) {
      setRefInfo({ reportId: rep.id, address: rep.address, unit: rep.unit, note: rep.description, kind: 'complaint' });
      if (!name.trim()) setName([rep.complaintNo, rep.address, rep.unit ? 'Unit ' + rep.unit : ''].filter(Boolean).join(' · '));
      if (rep.development) {
        const match = developments.find((d) => d.trim().toLowerCase() === String(rep.development).trim().toLowerCase());
        if (match) setDevelopment(match);
      }
      setRefMsg('Found complaint — details pulled in.');
      return;
    }
    const v = await lookupComplaintOrViolation(refNo.trim()).catch(() => null);
    if (v) {
      setRefInfo({ address: v.address, unit: v.unit, note: v.problem, kind: v.kind });
      if (!name.trim()) setName([refNo.trim().toUpperCase(), v.address, v.unit ? 'Unit ' + v.unit : ''].filter(Boolean).join(' · '));
      setRefMsg('Found ' + v.kind + ' — details pulled in.');
      return;
    }
    setRefInfo(null);
    setRefMsg('Not found on this phone — it will still be saved on the project.');
  };
  useEffect(() => {
    if (params.new === '1') setAdding(true);
    if (params.preName) setName(String(params.preName));
  }, [params.new, params.preName]);
  useEffect(() => {
    const pre = String(params.preDevelopment || '').trim().toLowerCase();
    if (!pre) return;
    const match = developments.find((d) => d.trim().toLowerCase() === pre);
    setDevelopment(match || String(params.preDevelopment));
  }, [params.preDevelopment, developments]);

  const onCreate = async () => {
    if (!name.trim()) { Alert.alert('Name required', 'Give the project a name.'); return; }
    if (developments.length > 1 && !development) { Alert.alert('Development required', 'Select a development for this project.'); return; }
    const ref = refNo.trim().toUpperCase();
    const source = ref ? {
      sourceReportId: (ref === fromComplaint.toUpperCase() ? String(params.preReportId || '') : '') || refInfo?.reportId || undefined,
      complaintNo: ref,
      address: (ref === fromComplaint.toUpperCase() ? String(params.preAddress || '') : '') || refInfo?.address || undefined,
      unit: (ref === fromComplaint.toUpperCase() ? String(params.preUnit || '') : '') || refInfo?.unit || undefined,
      sourceDescription: (ref === fromComplaint.toUpperCase() ? String(params.preNote || '') : '') || refInfo?.note || undefined,
    } : {};
    const created = await createProject(name.trim(), client.trim(), source, development || undefined);
    setName(''); setClient(''); setDevelopment(''); setRefNo(''); setRefInfo(null); setRefMsg(''); setAdding(false); load();
    if (ref) router.replace(`/project/${created.id}`);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      {mode !== 'administrator' && !/maintenance worker/i.test(position) && (
        <View style={[ui.card, { gap: 10 }]}>
          <Text style={ui.cardTitle}>Project tools</Text>
          {!adding ? (
            <View style={ui.row}>
              <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => router.push('/settings')}>
                <Text style={ui.btnOutlineText}>Default rates</Text>
              </Pressable>
              <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => setAdding(true)}>
                <Text style={ui.btnText}>+ New project</Text>
              </Pressable>
            </View>
          ) : (
          <>
          <Text style={ui.cardTitle}>New project</Text>
          {!!fromComplaint && <Text style={{ color: '#1E7D4F', fontWeight: '700' }}>From complaint {fromComplaint}{development ? ' · ' + development : ''}</Text>}
          <View><Text style={ui.label}>Complaint / Violation #</Text>
            <TextInput style={ui.input} value={refNo} onChangeText={(t) => { setRefNo(t); setRefMsg(''); }} onEndEditing={() => { void lookUpRef(); }} placeholder="e.g. RC-45570 or V-23678" autoCapitalize="characters" />
            {!!refMsg && <Text style={{ fontSize: 12, marginTop: 4, color: refInfo ? '#1a8f4c' : '#8a6d1a' }}>{refMsg}</Text>}
          </View>
          <View><Text style={ui.label}>Project name</Text>
            <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="123 Main St renovation" /></View>
          <View><Text style={ui.label}>Client (optional)</Text>
            <TextInput style={ui.input} value={client} onChangeText={setClient} placeholder="Jane Doe" /></View>
          {developments.length > 1 && <View><Text style={ui.label}>Development</Text>
            <TextInput style={[ui.input, { marginBottom: 8 }]} value={devQuery} onChangeText={setDevQuery} placeholder="Search developments" autoCapitalize="characters" />
            <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{developments.filter((item) => !devQuery.trim() || item.toLowerCase().includes(devQuery.trim().toLowerCase())).map((item) => <Pressable key={item} style={[ui.btnOutline, development === item && ui.btn]} onPress={() => setDevelopment(item)}><Text style={development === item ? ui.btnText : ui.btnOutlineText}>{item}</Text></Pressable>)}</View>
            </ScrollView>
          </View>}
          <View style={ui.row}>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => setAdding(false)}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
            <Pressable style={[ui.btn, { flex: 1 }]} onPress={onCreate}><Text style={ui.btnText}>Create</Text></Pressable>
          </View>
          </>
          )}
        </View>
      )}

      {projects.length === 0 && <Text style={ui.empty}>No projects yet. Create one to start estimating.</Text>}
      {projects.map(p => {
        const isApproved = approved.has(p.id);
        return (
        <Pressable key={p.id} style={[ui.listItem, isApproved && { borderColor: '#1a8f4c', borderWidth: 2 }]} onPress={() => router.push(`/project/${p.id}`)} onLongPress={() => { if (!canDelete) return; Alert.alert('Delete project?', p.name + '\n\nThis permanently removes the project and its data.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteProject(p.id); listProjects().then(setProjects); } }]); }}>
          <View style={{ flex: 1 }}>
            <Text style={ui.listTitle}>{p.name}</Text>
            {!!p.client && <Text style={ui.listSub}>{p.client}</Text>}
            {isApproved && <Text style={{ fontSize: 12, color: '#1a8f4c', fontWeight: '700', marginTop: 2 }}>Completed · approved (locked)</Text>}
          </View>
          <Text style={{ color: '#999', fontSize: 20 }}>›</Text>
        </Pressable>
        );
      })}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
