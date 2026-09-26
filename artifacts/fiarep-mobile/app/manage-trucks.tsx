import { useAppReadOnly } from '../lib/useAppReadOnly';
import { ReadOnlyScreen } from '../components/ReadOnlyBanner';
import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createEmergencyUnit, listEmergencyUnits, deleteEmergencyUnit, type EmergencyUnit } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';

function ManageTrucksScreen() {
  const [units, setUnits] = useState<EmergencyUnit[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const canDelete = useDeletionPolicy();

  const load = useCallback(() => { listEmergencyUnits().then(setUnits); }, []);
  useFocusEffect(load);

  async function add() {
    if (!name.trim()) { Alert.alert('Name required', 'Enter a truck name (e.g. Truck 1).'); return; }
    setBusy(true);
    try {
      const u = await createEmergencyUnit(name.trim());
      setName(''); load();
      Alert.alert('Truck registered', u.name + '\n\nCode: ' + u.code + '\n\nGive this code to the unit — they enter it on the Emergency Unit screen.');
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Could not create.'); }
    finally { setBusy(false); }
  }

  function onDelete(u: EmergencyUnit) {
    Alert.alert('Delete truck?', 'Remove ' + u.name + ' (' + u.code + ')? Its past jobs stay on record.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteEmergencyUnit(u.id); load(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Emergency Units</Text>
      <Text style={ui.label}>Register emergency trucks. Each gets a code the unit enters to pull up its jobs. Trucks serve all developments.</Text>

      <Text style={[ui.label, { marginTop: 10 }]}>Truck name</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[ui.input, { flex: 1 }]} value={name} onChangeText={setName} placeholder="e.g. Truck 1, Truck A" autoCapitalize="words" />
        <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} onPress={add} disabled={busy}><Text style={ui.btnText}>Add</Text></Pressable>
      </View>

      <Text style={[ui.label, { marginTop: 20 }]}>Registered trucks ({units.length})</Text>
      {units.length === 0 && <Text style={ui.empty}>No trucks yet.</Text>}
      {units.map((u) => (
        <View key={u.id} style={[ui.card, { gap: 4, marginTop: 8 }]}>
          <View style={ui.line}><Text style={ui.lineK}>Truck</Text><Text style={ui.lineV}>{u.name}</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>Code</Text><Text style={[ui.lineV, { color: ACCENT, fontWeight: '700' }]}>{u.code}</Text></View>
          {canDelete && <Pressable onPress={() => onDelete(u)} style={{ marginTop: 4 }}><Text style={{ color: '#c0392b', fontWeight: '600' }}>Delete</Text></Pressable>}
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Supervisors/managers are view-only on the app; this screen only takes action.
export default function ManageTrucks() {
  const readOnly = useAppReadOnly();
  if (readOnly === null) return null;
  if (readOnly) return <ReadOnlyScreen title="Manage Trucks" />;
  return <ManageTrucksScreen />;
}
