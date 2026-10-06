import { useCallback, useState } from 'react';
import { Text, TextInput, Pressable, ScrollView, View, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ui } from '../lib/ui';
import { checkResidentCode, getResidentCode, setResidentCode, type ResidentCode } from '../lib/store';

export default function ResidentHome() {
  const router = useRouter();
  // The resident code from the management office: entered once, kept on
  // this phone. Every complaint from this phone goes to that company.
  const [saved, setSaved] = useState<ResidentCode | null | undefined>(undefined);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  useFocusEffect(useCallback(() => { void getResidentCode().then(setSaved); }, []));

  async function saveCode() {
    setBusy(true);
    try {
      const v = await checkResidentCode(entry);
      await setResidentCode(v);
      setSaved(v); setEntry(''); setChanging(false);
    } catch (e: any) {
      Alert.alert('Resident code', e?.data?.error || e?.message || "That code isn't recognized. Call your management office for the code.");
    } finally { setBusy(false); }
  }

  const needsCode = saved === null || changing;

  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 40 }]}>
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
        Resident Services
      </Text>
      <Text style={[ui.label, { textAlign: 'center', marginBottom: 24 }]}>
        Report an issue or check the status of a report.
      </Text>

      {saved && !changing && (
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 13, color: '#555' }}>Your building is managed by</Text>
          <Text style={{ fontSize: 16, fontWeight: '700' }}>{saved.organizationName || `Resident code ${saved.code}`}</Text>
          <Pressable onPress={() => setChanging(true)}><Text style={{ fontSize: 12, color: '#2563eb', marginTop: 4 }}>Change resident code</Text></Pressable>
        </View>
      )}

      {needsCode && (
        <View style={[ui.card, { gap: 8, marginBottom: 16 }]}>
          <Text style={ui.cardTitle}>Enter your resident code</Text>
          <Text style={ui.listSub}>The 6-digit code from your management office. You only enter it once — this phone remembers it. Lost it? Call the office.</Text>
          <TextInput
            style={ui.input}
            value={entry}
            onChangeText={(v) => setEntry(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit resident code"
            placeholderTextColor="#999"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus={saved === null}
          />
          <Pressable style={[ui.btn, (busy || entry.length !== 6) && ui.btnMuted]} disabled={busy || entry.length !== 6} onPress={() => void saveCode()}>
            <Text style={ui.btnText}>{busy ? 'Checking…' : 'Save code'}</Text>
          </Pressable>
          {changing && <Pressable onPress={() => { setChanging(false); setEntry(''); }}><Text style={{ textAlign: 'center', color: '#666' }}>Keep current code</Text></Pressable>}
        </View>
      )}

      <Pressable style={[ui.btn, !saved && ui.btnMuted]} disabled={!saved} onPress={() => router.push('/resident')}>
        <Text style={ui.btnText}>Report an Issue</Text>
      </Pressable>

      <Pressable style={ui.btnOutline} onPress={() => router.push('/resident-lookup')}>
        <Text style={ui.btnOutlineText}>Check Report Status</Text>
      </Pressable>
    </ScrollView>
  );
}
