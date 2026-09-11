import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { getGlobalRates, setGlobalRates } from '../lib/store';
import { DEFAULT_RATES, type Rates } from '../lib/takeoff';
import { ui } from '../lib/ui';
import { useAppMode } from './_layout';

const FIELDS: { key: keyof Rates; label: string }[] = [
  { key: 'waste', label: 'Waste factor (e.g. 1.12)' },
  { key: 'sheetCost', label: 'Drywall $/sheet' },
  { key: 'laborPerSqFt', label: 'Hang + finish $/sq ft' },
  { key: 'paintPerSqFt', label: 'Paint $/sq ft' },
  { key: 'floorPerSqFt', label: 'Flooring $/sq ft' },
];

export default function Settings() {
  const router = useRouter();
  const { mode } = useAppMode();
  const [r, setR] = useState<Rates>(DEFAULT_RATES);
  useEffect(() => { getGlobalRates().then(setR); }, []);
  const upd = (k: keyof Rates, v: string) => setR(prev => ({ ...prev, [k]: parseFloat(v) || 0 }));

  const onSave = async () => { await setGlobalRates(r); Alert.alert('Saved', 'Default rates updated.'); router.back(); };
  const onReset = () => setR(DEFAULT_RATES);

  if (mode !== 'administrator' && mode !== 'management') {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.h}>Default rates</Text>
        <Text style={ui.empty}>Only administrators and management can change default rates.</Text>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Default rates</Text>
      <Text style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>Used for every project unless a project sets its own.</Text>
      {FIELDS.map(({ key, label }) => (
        <View key={key}>
          <Text style={ui.label}>{label}</Text>
          <TextInput style={ui.input} value={String(r[key])} onChangeText={v => upd(key, v)} keyboardType="decimal-pad" />
        </View>
      ))}
      <Pressable style={[ui.btn, { marginTop: 8 }]} onPress={onSave}><Text style={ui.btnText}>Save defaults</Text></Pressable>
      <Pressable style={ui.btnOutline} onPress={onReset}><Text style={ui.btnOutlineText}>Reset to built-in</Text></Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
