import { useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { dispatchJob, listAssignableByTrade, sendViolationLookup, getCurrentActor, lookupComplaintOrViolation, createElevatorJob, type TradeGroup } from '../lib/store';
import { ui } from '../lib/ui';
import AddressInput from '../components/AddressInput';

export default function DispatchJob() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [unit, setUnit] = useState('');
  const [refNum, setRefNum] = useState('');
  const [resident, setResident] = useState('');
  const [problem, setProblem] = useState('');
  const [lookupMsg, setLookupMsg] = useState('');
  const [inspector, setInspector] = useState('');
  const [assigneePos, setAssigneePos] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assignable, setAssignable] = useState<TradeGroup[]>([]);
  const [openTrade, setOpenTrade] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { listAssignableByTrade().then(setAssignable); }, []));

  async function onAssign() {
    if (!address.trim()) { Alert.alert('Address required', 'Enter the job address.'); return; }
    if (!inspector.trim()) { Alert.alert('Assignee required', 'Pick who to assign.'); return; }
    if (!refNum.trim()) { Alert.alert('Complaint/Violation # required', 'Enter the resident complaint (RC-) or inspector violation number so the worker can pull it up.'); return; }
    await dispatchJob(address.trim(), unit.trim(), inspector.trim());
    // Send the assignee the complaint/violation number so they can look up the
    // details and make the repair (in-house, no vendor).
    const a = await getCurrentActor().catch(() => null);
    await sendViolationLookup(refNum.trim(), address.trim(), inspector.trim(), (a && a.name) || 'management', unit.trim(), problem.trim());
    // Elevator Service mechanic -> also create an Elevator Job with an EL- id.
    if (assigneePos === 'Elevator Service') {
      await createElevatorJob(address.trim(), unit.trim(), inspector.trim(), refNum.trim(), problem.trim());
    }
    Alert.alert('Job assigned', inspector + ' has been notified with ' + refNum.trim() + '.', [{ text: 'OK', onPress: () => router.back() }]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.label}>Complaint / Violation #</Text>
      <TextInput
        style={ui.input}
        value={refNum}
        onChangeText={setRefNum}
        onEndEditing={async () => {
          const n = refNum.trim();
          if (!n) { setLookupMsg(''); return; }
          const r = await lookupComplaintOrViolation(n).catch(() => null);
          if (r) {
            if (r.address) setAddress(r.address);
            if (r.unit) setUnit(r.unit);
            setResident(r.residentName || '');
            setProblem(r.problem || '');
            setLookupMsg('Found ' + (r.kind === 'complaint' ? 'complaint' : 'violation') + ' — details pulled in.');
          } else {
            setResident(''); setProblem('');
            setLookupMsg('No complaint or violation found for that number.');
          }
        }}
        placeholder="e.g. RC-82050 or V-23678"
        autoCapitalize="characters"
      />
      {!!lookupMsg && <Text style={{ fontSize: 12, color: (resident || problem) ? '#1a8f4c' : '#c0392b', marginTop: 4 }}>{lookupMsg}</Text>}
      {(!!resident || !!problem) && (
        <View style={{ backgroundColor: '#eef4ea', borderRadius: 8, padding: 10, marginTop: 6, gap: 2 }}>
          {!!resident && <Text style={{ fontSize: 14 }}>Tenant: <Text style={{ fontWeight: '700' }}>{resident}</Text></Text>}
          {!!problem && <Text style={{ fontSize: 14 }}>Problem: {problem}</Text>}
        </View>
      )}

      <Text style={[ui.label, { marginTop: 12 }]}>Job address</Text>
      <AddressInput value={address} onChangeText={setAddress} placeholder="e.g. 55 Hall St" />

      <Text style={[ui.label, { marginTop: 12 }]}>Unit (optional)</Text>
      <TextInput style={ui.input} value={unit} onChangeText={setUnit} placeholder="e.g. Apt 2B" />

      <Text style={[ui.label, { marginTop: 12 }]}>Assign to</Text>
      <Pressable style={ui.input} onPress={() => setPickerOpen(true)}>
        <Text style={{ color: inspector ? '#000' : '#999' }}>{inspector || 'Pick a trade, then a person'}</Text>
      </Pressable>

      <Pressable style={[ui.btn, { marginTop: 20 }]} onPress={onAssign}>
        <Text style={ui.btnText}>Assign job</Text>
      </Pressable>

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, padding: 16, paddingTop: 60 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={ui.h}>Pick a trade</Text>
            <Pressable onPress={() => setPickerOpen(false)}><Text style={{ color: '#c0392b', fontSize: 16 }}>Close</Text></Pressable>
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
                    <Pressable key={a.id} style={{ paddingVertical: 12, paddingLeft: 16, borderTopWidth: 1, borderTopColor: '#f2f2f2' }} onPress={() => { setInspector(a.name); setAssigneePos(item.position); setPickerOpen(false); }}>
                      <Text style={{ fontSize: 16 }}>{a.name}</Text>
                      <Text style={{ fontSize: 13, color: '#666' }}>{a.position || (a.role === 'inspector' ? 'Inspector' : a.role)}</Text>
                    </Pressable>
                  ))}
                </View>
              );
            }}
            ListEmptyComponent={<Text style={ui.empty}>No assignable people found. Approve staff first.</Text>}
          />
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
