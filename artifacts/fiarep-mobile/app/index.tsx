import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { listProjects, createProject, deleteProject, type Project, listApprovedProjectIds, getSessionIdentity, getCurrentPosition } from '../lib/store';
import { useAppMode } from './_layout';
import { ui } from '../lib/ui';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';

export default function Projects() {
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();
  const { mode } = useAppMode();
  const canDelete = useDeletionPolicy(mode !== null && mode !== 'resident' && mode !== 'vendor');

  // '/' (this Projects screen) is only for inspector & administrator.
  // Any other role that lands here is redirected to their own home.
  if (mode === 'resident') return <Redirect href="/resident-home" />;
  if (mode === 'worker') return <Redirect href="/worker-home" />;
  const [projects, setProjects] = useState<Project[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [adding, setAdding] = useState(false);
  const [developments, setDevelopments] = useState<string[]>([]);
  const [development, setDevelopment] = useState('');
  const [position, setPosition] = useState('');

  const load = useCallback(() => {
    listProjects().then(setProjects);
    listApprovedProjectIds().then(setApproved);
    getSessionIdentity().then((identity) => setDevelopments(identity?.developments || []));
    getCurrentPosition().then(setPosition).catch(() => undefined);
  }, []);
  useFocusEffect(load);
  useEffect(() => {
    if (params.new === '1') setAdding(true);
  }, [params.new]);

  const onCreate = async () => {
    if (!name.trim()) { Alert.alert('Name required', 'Give the project a name.'); return; }
    if (developments.length > 1 && !development) { Alert.alert('Development required', 'Select a development for this project.'); return; }
    await createProject(name.trim(), client.trim(), {}, development || undefined);
    setName(''); setClient(''); setDevelopment(''); setAdding(false); load();
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
          <View><Text style={ui.label}>Project name</Text>
            <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="123 Main St renovation" /></View>
          <View><Text style={ui.label}>Client (optional)</Text>
            <TextInput style={ui.input} value={client} onChangeText={setClient} placeholder="Jane Doe" /></View>
          {developments.length > 1 && <View><Text style={ui.label}>Development</Text>
            <View style={ui.row}>{developments.map((item) => <Pressable key={item} style={[ui.btnOutline, development === item && ui.btn]} onPress={() => setDevelopment(item)}><Text style={development === item ? ui.btnText : ui.btnOutlineText}>{item}</Text></Pressable>)}</View>
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
            {isApproved && <Text style={{ fontSize: 12, color: '#1a8f4c', fontWeight: '700', marginTop: 2 }}>✓ Completed · approved (locked)</Text>}
          </View>
          <Text style={{ color: '#999', fontSize: 20 }}>›</Text>
        </Pressable>
        );
      })}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
