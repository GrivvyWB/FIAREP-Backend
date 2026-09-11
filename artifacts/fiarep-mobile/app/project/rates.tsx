import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getProject, getGlobalRates, setProjectRates } from '../../lib/store';
import { type Rates } from '../../lib/takeoff';
import { ui } from '../../lib/ui';
import { useAppMode } from '../_layout';

const FIELDS: { key: keyof Rates; label: string }[] = [
  { key: 'waste', label: 'Waste factor' },
  { key: 'sheetCost', label: 'Drywall $/sheet' },
  { key: 'laborPerSqFt', label: 'Hang + finish $/sq ft' },
  { key: 'paintPerSqFt', label: 'Paint $/sq ft' },
  { key: 'floorPerSqFt', label: 'Flooring $/sq ft' },
];

export default function ProjectRates() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { mode } = useAppMode();
  const readOnly = mode === 'administrator';
  const router = useRouter();
  const [r, setR] = useState<Rates | null>(null);
  const [usingOverride, setUsingOverride] = useState(false);

  useEffect(() => {
    (async () => {
      const p = projectId ? await getProject(projectId) : null;
      if (p?.rates) { setR(p.rates); setUsingOverride(true); }
      else { setR(await getGlobalRates()); setUsingOverride(false); }
    })();
  }, [projectId]);

  const upd = (k: keyof Rates, v: string) => setR(prev => prev ? { ...prev, [k]: parseFloat(v) || 0 } : prev);
  const onSaveOverride = async () => { if (r) await setProjectRates(projectId!, r); Alert.alert('Saved', 'This project now uses its own rates.'); router.back(); };
  const onClearOverride = async () => { await setProjectRates(projectId!, null); Alert.alert('Reverted', 'This project uses the global default rates.'); router.back(); };

  if (!r) return <View style={ui.wrap}><Text>Loading…</Text></View>;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={{ color: '#666', fontSize: 13 }}>{usingOverride ? 'This project uses custom rates.' : 'This project uses the global default rates. Edit below to override just this project.'}</Text>
      {FIELDS.map(({ key, label }) => (
        <View key={key}>
          <Text style={ui.label}>{label}</Text>
          <TextInput editable={!readOnly} style={ui.input} value={String(r[key])} onChangeText={v => upd(key, v)} keyboardType="decimal-pad" />
        </View>
      ))}
      <Pressable style={[ui.btn, { marginTop: 8 }]} onPress={() => { if (readOnly) return; onSaveOverride(); }}><Text style={ui.btnText}>Save project rates</Text></Pressable>
      {usingOverride && <Pressable style={ui.btnOutline} onPress={() => { if (readOnly) return; onClearOverride(); }}><Text style={ui.btnOutlineText}>Use global default instead</Text></Pressable>}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
