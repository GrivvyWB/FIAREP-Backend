import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  parseEmployeeList,
  parseEmployeeCSV,
  addBulkPendingEmployees,
  listStaffAccounts,
  approveStaffAccount,
  denyStaffAccount,
  listDevelopmentNames,
  getCurrentActor,
  developmentsForManager,
  type ParsedEmployee,
  type StaffAccount,
} from '../lib/store';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';

export default function BulkEmployees() {
  const { mode } = useAppMode();
  const [text, setText] = useState('');
  const [development, setDevelopment] = useState('');
  const [devPickerOpen, setDevPickerOpen] = useState(false);
  const [devQuery, setDevQuery] = useState('');
  const [pending, setPending] = useState<StaffAccount[]>([]);

  const devNames = useMemo(() => listDevelopmentNames(), []);
  const devFiltered = useMemo(() => {
    const q = devQuery.trim().toLowerCase();
    return q ? devNames.filter((n) => n.toLowerCase().includes(q)) : devNames;
  }, [devQuery, devNames]);

  const parsed: ParsedEmployee[] = useMemo(() => parseEmployeeList(text), [text]);

  const load = useCallback(() => {
    listStaffAccounts('pending').then(setPending);
    if (mode === 'management') {
      (async () => {
        const a = await getCurrentActor();
        if (a.name) {
          const devs = await developmentsForManager(a.name);
          if (devs.length > 0) setDevelopment((prev) => prev || devs[0]);
        }
      })();
    }
  }, [mode]);
  useFocusEffect(load);

  async function onAdd() {
    if (parsed.length === 0) { Alert.alert('Nothing to add', 'Paste employees as "First Last, Trade" — one per line.'); return; }
    const devs = development.trim() ? [development.trim()] : [];
    const n = await addBulkPendingEmployees(parsed, 'worker', devs);
    setText('');
    load();
    Alert.alert('Added', n + ' employee' + (n === 1 ? '' : 's') + ' added to the pending list for approval.');
  }

  async function onUploadCSV() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const uri = res.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(uri);
      const parsed = parseEmployeeCSV(content);
      if (parsed.length === 0) { Alert.alert('No rows found', 'Could not read any employees from that file. Expected columns: First, Last, Trade.'); return; }
      const devs = development.trim() ? [development.trim()] : [];
      const n = await addBulkPendingEmployees(parsed, 'worker', devs);
      load();
      Alert.alert('Imported', n + ' employee' + (n === 1 ? '' : 's') + ' imported from file and added to pending.');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Could not read the file.');
    }
  }

  async function onApprove(a: StaffAccount) {
    await approveStaffAccount(a.id);
    load();
    Alert.alert('Approved', a.name + ' is approved.\n\nName: ' + a.name + '\nCode: ' + a.code + '\n\nGive them this login.');
  }

  function onDeny(a: StaffAccount) {
    Alert.alert('Remove ' + a.name + '?', 'This removes the pending employee.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await denyStaffAccount(a.id); load(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Bulk Employees</Text>
      <Text style={ui.label}>Paste one employee per line as "First Last, Trade" (e.g. "John Smith, Plumber").</Text>

      <TextInput
        style={[ui.input, { minHeight: 140 }]}
        value={text}
        onChangeText={setText}
        placeholder={"John Smith, Plumber\nMaria Lopez, Electrician\nSam Cole, Carpenter"}
        multiline
        textAlignVertical="top"
        autoCapitalize="words"
      />

      <Text style={ui.label}>Development (optional)</Text>
      <Pressable style={ui.input} onPress={() => { setDevQuery(''); setDevPickerOpen(true); }}>
        <Text style={{ color: development ? '#000' : '#999' }}>{development || 'Select development'}</Text>
      </Pressable>

      {parsed.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={ui.label}>Preview ({parsed.length})</Text>
          {parsed.slice(0, 50).map((e, i) => (
            <View key={i} style={[ui.line, { paddingVertical: 4 }]}>
              <Text style={ui.lineK}>{(e.firstName + ' ' + e.lastName).trim()}</Text>
              <Text style={ui.lineV}>{e.position}{e.position === 'Other' && e.rawTrade ? ' (' + e.rawTrade + ')' : ''}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable style={[ui.btn, { marginTop: 10 }]} onPress={onAdd}>
        <Text style={ui.btnText}>Add {parsed.length > 0 ? parsed.length + ' ' : ''}to pending</Text>
      </Pressable>

      <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={onUploadCSV}>
        <Text style={ui.btnOutlineText}>Upload CSV file</Text>
      </Pressable>
      <Text style={{ fontSize: 12, color: '#999', marginTop: 4 }}>CSV columns: First, Last, Trade. A header row is optional.</Text>

      <Text style={[ui.h, { fontSize: 18, marginTop: 20 }]}>Pending approval ({pending.length})</Text>
      {pending.length === 0 && <Text style={ui.empty}>No pending employees.</Text>}
      {pending.map((a) => (
        <View key={a.id} style={[ui.card, { gap: 4 }]}>
          <View style={ui.line}><Text style={ui.lineK}>Name</Text><Text style={ui.lineV}>{a.name}</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>Position</Text><Text style={ui.lineV}>{a.position || 'Other'}</Text></View>
          {Array.isArray(a.developments) && a.developments.length > 0 && (
            <View style={ui.line}><Text style={ui.lineK}>Development</Text><Text style={ui.lineV}>{a.developments.join(', ')}</Text></View>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => onApprove(a)}><Text style={ui.btnText}>Approve & show code</Text></Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#c0392b' }]} onPress={() => onDeny(a)}><Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Remove</Text></Pressable>
          </View>
        </View>
      ))}

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
              <Pressable style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => { setDevelopment(item); setDevPickerOpen(false); setDevQuery(''); }}>
                <Text style={{ fontSize: 16 }}>{item}</Text>
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
