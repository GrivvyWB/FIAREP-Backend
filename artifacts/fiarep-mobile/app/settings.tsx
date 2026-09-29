import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { getGlobalRates, setGlobalRates } from '../lib/store';
import { DEFAULT_RATES, type Rates } from '../lib/takeoff';
import { APP_BUTTON_GUIDE } from '../lib/buttonGuide';
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

  const guide = (
    <View style={{ marginTop: 16 }}>
      <Text style={ui.h}>What the buttons do</Text>
      <Text style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>A plain-words guide to the tiles and buttons you have.</Text>
      {APP_BUTTON_GUIDE.filter((g) => (g.for as string[]).includes(String(mode || ''))).map((g) => (
        <View key={g.title} style={[ui.card, { marginBottom: 8, padding: 12 }]}>
          <Text style={{ fontWeight: '700', fontSize: 15, marginBottom: 4 }}>{g.title}</Text>
          <Text style={{ color: '#444', fontSize: 14 }}>{g.does}</Text>
        </View>
      ))}
    </View>
  );

  if (mode !== 'administrator' && mode !== 'management') {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        {guide}
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
      {guide}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
