import { useCallback, useState } from 'react';
import { Text, TextInput, Pressable, ScrollView, View, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ui } from '../lib/ui';
import { findResidentCompany, getResidentCode, setResidentCode, type ResidentCode } from '../lib/store';

/**
 * First time in: the resident types their management company's name. The
 * server hands back that company's resident code, the phone keeps it, and
 * every complaint from this phone goes to that company. Done once.
 */
export default function ResidentHome() {
  const router = useRouter();
  const [saved, setSaved] = useState<ResidentCode | null | undefined>(undefined);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [choices, setChoices] = useState<ResidentCode[]>([]);
  useFocusEffect(useCallback(() => { void getResidentCode().then(setSaved); }, []));

  async function keep(v: ResidentCode) {
    await setResidentCode(v);
    setSaved(v); setEntry(''); setChoices([]); setChanging(false);
    Alert.alert('Saved', `${v.organizationName}\nResident code ${v.code}\n\nThis phone remembers it — you won't be asked again.`);
  }

  async function lookUp() {
    setBusy(true);
    try {
      const matches = await findResidentCompany(entry);
      if (matches.length === 1) await keep(matches[0]!);
      else setChoices(matches);
    } catch (e: any) {
      Alert.alert('Company not found', e?.data?.error || e?.message || 'Check the spelling with your management office.');
    } finally { setBusy(false); }
  }

  const needsCompany = saved === null || changing;

  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 40 }]} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 26, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
        Resident Services
      </Text>
      <Text style={[ui.label, { textAlign: 'center', marginBottom: 24 }]}>
        Report an issue or check the status of a report.
      </Text>

      {saved && !changing && (
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 13, color: '#555' }}>Your building is managed by</Text>
          <Text style={{ fontSize: 16, fontWeight: '700' }}>{saved.organizationName || 'your management company'}</Text>
          <Text style={{ fontSize: 12, color: '#777' }}>Resident code {saved.code}</Text>
          <Pressable onPress={() => setChanging(true)}><Text style={{ fontSize: 12, color: '#2563eb', marginTop: 4 }}>Change management company</Text></Pressable>
        </View>
      )}

      {needsCompany && (
        <View style={[ui.card, { gap: 8, marginBottom: 16 }]}>
          <Text style={ui.cardTitle}>Who manages your building?</Text>
          <Text style={ui.listSub}>Type your management company's name. You do this once — this phone remembers it.</Text>
          <TextInput
            style={ui.input}
            value={entry}
            onChangeText={(v) => { setEntry(v); setChoices([]); }}
            placeholder="e.g. ABC Inc."
            placeholderTextColor="#999"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => { if (entry.trim().length >= 2) void lookUp(); }}
            autoFocus={saved === null}
          />
          {choices.length > 1 && (
            <View style={{ gap: 6 }}>
              <Text style={ui.label}>Which one?</Text>
              {choices.map((c) => (
                <Pressable key={c.code} style={ui.btnOutline} onPress={() => void keep(c)}>
                  <Text style={ui.btnOutlineText}>{c.organizationName}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable style={[ui.btn, (busy || entry.trim().length < 2) && ui.btnMuted]} disabled={busy || entry.trim().length < 2} onPress={() => void lookUp()}>
            <Text style={ui.btnText}>{busy ? 'Looking up…' : 'Find my company'}</Text>
          </Pressable>
          {changing && <Pressable onPress={() => { setChanging(false); setEntry(''); setChoices([]); }}><Text style={{ textAlign: 'center', color: '#666' }}>Keep current company</Text></Pressable>}
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
