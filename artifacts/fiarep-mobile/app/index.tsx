import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useRouter, Redirect } from 'expo-router';
import { listProjects, createProject, deleteProject, type Project, clearAppMode, listApprovedProjectIds } from '../lib/store';
import { useAppMode } from './_layout';
import { ui } from '../lib/ui';

export default function Projects() {
  const router = useRouter();
  const { mode, refresh } = useAppMode();

  // '/' (this Projects screen) is only for inspector & administrator.
  // Any other role that lands here is redirected to their own home.
  if (mode === 'resident') return <Redirect href="/resident-home" />;
  if (mode === 'worker') return <Redirect href="/worker-home" />;
  const [projects, setProjects] = useState<Project[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    listProjects().then(setProjects);
    listApprovedProjectIds().then(setApproved);
  }, []);
  useFocusEffect(load);

  const onCreate = async () => {
    if (!name.trim()) { Alert.alert('Name required', 'Give the project a name.'); return; }
    await createProject(name.trim(), client.trim());
    setName(''); setClient(''); setAdding(false); load();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Pressable style={ui.btnOutline} onPress={async () => { await clearAppMode(); refresh(); }}>
        <Text style={ui.btnOutlineText}>Switch role</Text>
      </Pressable>
      {mode !== 'administrator' && (
      <Pressable style={ui.btnOutline} onPress={() => router.push('/settings')}>
        <Text style={ui.btnOutlineText}>Default rates</Text>
      </Pressable>
      )}
      {mode !== 'administrator' && (!adding ? (
        <Pressable style={ui.btn} onPress={() => setAdding(true)}>
          <Text style={ui.btnText}>+ New project</Text>
        </Pressable>
      ) : (
        <View style={[ui.card, { gap: 10 }]}>
          <Text style={ui.cardTitle}>New project</Text>
          <View><Text style={ui.label}>Project name</Text>
            <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="123 Main St renovation" /></View>
          <View><Text style={ui.label}>Client (optional)</Text>
            <TextInput style={ui.input} value={client} onChangeText={setClient} placeholder="Jane Doe" /></View>
          <View style={ui.row}>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => setAdding(false)}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
            <Pressable style={[ui.btn, { flex: 1 }]} onPress={onCreate}><Text style={ui.btnText}>Create</Text></Pressable>
          </View>
        </View>
      ))}

      {projects.length === 0 && <Text style={ui.empty}>No projects yet. Create one to start estimating.</Text>}
      {projects.map(p => {
        const isApproved = approved.has(p.id);
        return (
        <Pressable key={p.id} style={[ui.listItem, isApproved && { borderColor: '#1a8f4c', borderWidth: 2 }]} onPress={() => router.push(`/project/${p.id}`)} onLongPress={() => { Alert.alert('Delete project?', p.name + '\n\nThis permanently removes the project and its data.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteProject(p.id); listProjects().then(setProjects); } }]); }}>
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
