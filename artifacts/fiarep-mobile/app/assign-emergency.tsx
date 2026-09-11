import { useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { createEmergencyJob, listDevelopmentNames, listEmergencyUnits, type EmergencyUnit } from '../lib/store';
import AddressInput from '../components/AddressInput';
import { ui, ACCENT } from '../lib/ui';

export default function AssignEmergency() {
  const router = useRouter();
  const [truck, setTruck] = useState('');
  const [units, setUnits] = useState<EmergencyUnit[]>([]);
  const [truckPicker, setTruckPicker] = useState(false);
  useFocusEffect(useCallback(() => { listEmergencyUnits().then(setUnits); }, []));
  const [development, setDevelopment] = useState('');
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState('');
  const [issue, setIssue] = useState('');
  const [devPicker, setDevPicker] = useState(false);
  const [devQuery, setDevQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const allDevs = listDevelopmentNames();
  const devs = devQuery.trim() ? allDevs.filter((d) => d.toLowerCase().startsWith(devQuery.trim().toLowerCase())) : allDevs;

  async function onAssign() {
    if (!truck.trim()) { Alert.alert('Truck required', 'Pick a registered truck.'); return; }
    if (!development.trim() && !address.trim()) { Alert.alert('Location required', 'Pick a development or enter an address.'); return; }
    if (!issue.trim()) { Alert.alert('Issue required', 'Describe the emergency.'); return; }
    setBusy(true);
    try {
      const job = await createEmergencyJob(truck.trim(), development.trim(), address.trim(), issue.trim(), location.trim());
      Alert.alert('Emergency assigned', truck.trim() + ' has been assigned ' + job.emId + '.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Could not assign.'); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Assign Emergency Unit</Text>
      <Text style={ui.label}>Dispatch a truck to an emergency. Generates a unique Emergency Job ID; updates and photos flow back to you.</Text>

      <Text style={[ui.label, { marginTop: 10 }]}>Emergency unit / truck</Text>
      <Pressable style={ui.input} onPress={() => setTruckPicker(true)}>
        <Text style={{ color: truck ? '#000' : '#999' }}>{truck || 'Pick a registered truck'}</Text>
      </Pressable>

      <Text style={[ui.label, { marginTop: 12 }]}>Development</Text>
      <Pressable style={ui.input} onPress={() => setDevPicker(true)}>
        <Text style={{ color: development ? '#000' : '#999' }}>{development || 'Pick a development (optional)'}</Text>
      </Pressable>

      <Text style={[ui.label, { marginTop: 12 }]}>Address</Text>
      <AddressInput value={address} onChangeText={setAddress} placeholder="e.g. 55 Hall St" development={development} />

      <Text style={[ui.label, { marginTop: 12 }]}>Location in building</Text>
      <TextInput style={ui.input} value={location} onChangeText={setLocation} placeholder="e.g. cellar, apartment 4B, hallway, roof" />

      <Text style={[ui.label, { marginTop: 12 }]}>Emergency / issue</Text>
      <TextInput style={[ui.input, { minHeight: 70, textAlignVertical: 'top' }]} value={issue} onChangeText={setIssue} placeholder="What's the emergency?" multiline />

      <Pressable style={[ui.btn, { marginTop: 16 }, busy && { opacity: 0.6 }]} onPress={onAssign} disabled={busy}>
        <Text style={ui.btnText}>Assign emergency unit</Text>
      </Pressable>
      <View style={{ height: 40 }} />

      <Modal visible={truckPicker} transparent animationType="slide" onRequestClose={() => setTruckPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Pick a truck</Text>
            <ScrollView>
              {units.length === 0 && <Text style={[ui.listSub, { padding: 16 }]}>No trucks registered. Register one in Manage Trucks first.</Text>}
              {units.map((u) => (
                <Pressable key={u.id} onPress={() => { setTruck(u.name); setTruckPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 15 }}>{u.name}</Text>
                  <Text style={{ fontSize: 13, color: ACCENT }}>{u.code}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setTruckPicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={devPicker} transparent animationType="slide" onRequestClose={() => setDevPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Pick a development</Text>
            <TextInput style={[ui.input, { marginHorizontal: 16, marginBottom: 8 }]} value={devQuery} onChangeText={setDevQuery} placeholder="Type to filter (e.g. G)" autoCapitalize="characters" />
            <ScrollView>
              <Pressable onPress={() => { setDevelopment(''); setDevPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}><Text style={{ fontSize: 15, color: '#999' }}>None</Text></Pressable>
              {devs.map((dv, i) => (
                <Pressable key={i} onPress={() => { setDevelopment(dv); setDevPicker(false); setDevQuery(''); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15 }}>{dv}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setDevPicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
