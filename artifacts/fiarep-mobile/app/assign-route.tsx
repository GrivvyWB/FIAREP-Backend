import { useAppReadOnly } from '../lib/useAppReadOnly';
import { ReadOnlyScreen } from '../components/ReadOnlyBanner';
import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  listStaffByPosition,
  parseAddressList,
  createRouteAssignment,
  type StaffAccount,
} from '../lib/store';
import { pickTextFile } from '../lib/files';
import { ui, ACCENT } from '../lib/ui';

function AssignRouteScreen() {
  const [inspectors, setInspectors] = useState<StaffAccount[]>([]);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [picked, setPicked] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState('');

  const load = useCallback(() => {
    listStaffByPosition('Inspector').then(setInspectors);
  }, []);
  useFocusEffect(load);

  async function upload() {
    try {
      const f = await pickTextFile();
      if (!f) return;
      const addrs = parseAddressList(f.text);
      if (addrs.length === 0) { Alert.alert('Empty', 'No addresses found in that file.'); return; }
      setAddresses(addrs);
      setFileName(f.name);
    } catch (e: any) {
      Alert.alert('Upload failed', String(e && e.message ? e.message : e));
    }
  }

  function useManual() {
    const addrs = parseAddressList(manual);
    if (addrs.length === 0) { Alert.alert('Empty', 'Type at least one address, one per line.'); return; }
    setAddresses(addrs);
    setFileName('typed list');
  }

  async function send() {
    if (!picked) { Alert.alert('Pick an inspector', 'Choose who this list goes to.'); return; }
    if (addresses.length === 0) { Alert.alert('No list', 'Upload or type an address list first.'); return; }
    try {
      await createRouteAssignment(picked, addresses, fileName);
      Alert.alert('Assigned', addresses.length + ' stops sent to ' + picked + '.', [
        { text: 'OK', onPress: () => { setAddresses([]); setFileName(''); setPicked(''); setManual(''); } },
      ]);
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    }
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Assign a Route</Text>
      <Text style={ui.label}>Upload a list of addresses and assign it to an inspector.</Text>

      <Pressable style={[ui.btn, { marginTop: 8 }]} onPress={upload}>
        <Text style={ui.btnText}>Upload CSV / text file</Text>
      </Pressable>

      <Text style={[ui.label, { marginTop: 12 }]}>Or type addresses, one per line</Text>
      <TextInput style={[ui.input, { minHeight: 90 }]} value={manual} onChangeText={setManual} placeholder={"123 Main St\n456 Oak Ave"} multiline />
      <Pressable style={[ui.btnOutline, { marginTop: 6 }]} onPress={useManual}>
        <Text style={[ui.btnOutlineText, { color: ACCENT }]}>Use typed list</Text>
      </Pressable>

      {addresses.length > 0 && (
        <View style={[ui.card, { gap: 4, marginTop: 12 }]}>
          <Text style={{ fontWeight: '700' }}>{addresses.length} address{addresses.length === 1 ? '' : 'es'} · {fileName}</Text>
          {addresses.slice(0, 8).map((a, i) => (
            <Text key={i} style={ui.listSub}>{a}</Text>
          ))}
          {addresses.length > 8 && <Text style={ui.listSub}>…and {addresses.length - 8} more</Text>}
        </View>
      )}

      <Text style={[ui.label, { marginTop: 16 }]}>Assign to inspector</Text>
      {inspectors.length === 0 ? (
        <Text style={ui.listSub}>No inspectors found. Issue an Inspector-position account first.</Text>
      ) : (
        <View>
          <Pressable
            style={[ui.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, picked ? { borderColor: ACCENT, borderWidth: 2 } : null]}
            onPress={() => setOpen(!open)}
          >
            <Text style={{ fontWeight: '600', color: picked ? ACCENT : '#666' }}>{picked || 'Select an inspector'}</Text>
            <Text style={{ color: '#666' }}>{open ? '\u25b2' : '\u25bc'}</Text>
          </Pressable>
          {open && (
            <View style={{ marginTop: 4, gap: 4 }}>
              {inspectors.map((ins) => {
                const on = picked === ins.name;
                return (
                  <Pressable key={ins.id} onPress={() => { setPicked(ins.name); setOpen(false); }} style={[ui.input, { borderColor: on ? ACCENT : '#e0e0e0', borderWidth: on ? 2 : 1 }]}>
                    <Text style={{ fontWeight: '600', color: on ? ACCENT : '#000' }}>{ins.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      <Pressable style={[ui.btn, { marginTop: 16 }]} onPress={send}>
        <Text style={ui.btnText}>Send route to inspector</Text>
      </Pressable>
    </ScrollView>
  );
}

// Supervisors/managers are view-only on the app; this screen only takes action.
export default function AssignRoute() {
  const readOnly = useAppReadOnly();
  if (readOnly === null) return null;
  if (readOnly) return <ReadOnlyScreen title="Assign Route" />;
  return <AssignRouteScreen />;
}
