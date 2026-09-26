import { useAppReadOnly } from '../lib/useAppReadOnly';
import { ReadOnlyScreen } from '../components/ReadOnlyBanner';
import { useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { DEVELOPMENT_NAMES } from '../lib/developments.seed';
import { getDevelopmentCoverageCode, unlockCoverage, listActiveCoverage } from '../lib/store';
import { ACCENT } from '../lib/ui';

function CoverSiteScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [development, setDevelopment] = useState('');
  const [expectedCode, setExpectedCode] = useState('');
  const [code, setCode] = useState('');
  const [active, setActive] = useState<{ development: string; expiresAt: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const loadActive = useCallback(() => { listActiveCoverage().then(setActive).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => { loadActive(); }, [loadActive]));

  const suggestions = query.trim().length >= 2 && !development
    ? DEVELOPMENT_NAMES.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  async function pick(name: string) {
    setDevelopment(name); setQuery(name); setCode('');
    try { setExpectedCode(await getDevelopmentCoverageCode(name)); } catch { setExpectedCode(''); }
  }

  async function unlock() {
    if (!development || code.length !== 2) return;
    setBusy(true);
    try {
      await unlockCoverage(development, code);
      Alert.alert('Site unlocked', `Checked in at ${development}. You can assign across all developments for 24 hours.`);
      setDevelopment(''); setQuery(''); setExpectedCode(''); setCode('');
      loadActive();
    } catch (e: any) {
      Alert.alert('Could not unlock', e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  }

  function fmt(iso: string) {
    try { return new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return iso; }
  }

  const canUnlock = !busy && !!development && code.length === 2;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fff' }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={{ marginBottom: 12 }}>
        <Text style={{ color: ACCENT, fontWeight: '600', fontSize: 16 }}>‹ Back</Text>
      </Pressable>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 6 }}>Cover a Site</Text>
      <Text style={{ color: '#555', marginBottom: 18, lineHeight: 20 }}>
        Working at a development that isn't yours today? Confirm the site's 2-digit code to check in — that
        unlocks the ability to assign at every development for the next 24 hours.
      </Text>

      <Text style={{ fontWeight: '600', marginBottom: 6 }}>Development</Text>
      <TextInput
        value={query}
        onChangeText={(t) => { setQuery(t); setDevelopment(''); setExpectedCode(''); setCode(''); }}
        placeholder="Start typing…"
        placeholderTextColor="#999"
        autoCapitalize="characters"
        style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 6 }}
      />
      {suggestions.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 8 }}>
          {suggestions.map((n) => (
            <Pressable key={n} onPress={() => pick(n)} style={{ padding: 11, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' }}>
              <Text>{n}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {expectedCode ? (
        <View style={{ backgroundColor: '#1E7D4F11', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: '#555' }}>
            Code for <Text style={{ fontWeight: '700' }}>{development}</Text>:{' '}
            <Text style={{ fontWeight: '700', color: ACCENT, letterSpacing: 3 }}>{expectedCode}</Text>
          </Text>
        </View>
      ) : null}

      <Text style={{ fontWeight: '600', marginBottom: 6 }}>Enter the 2-digit code</Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 2))}
        keyboardType="number-pad"
        placeholder="00"
        placeholderTextColor="#999"
        style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, width: 96, textAlign: 'center', letterSpacing: 6, fontWeight: '700', fontSize: 18, marginBottom: 16 }}
      />

      <Pressable
        onPress={unlock}
        disabled={!canUnlock}
        style={{ backgroundColor: canUnlock ? ACCENT : '#9bbfa9', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 22 }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{busy ? 'Unlocking…' : 'Unlock for 24 hours'}</Text>
      </Pressable>

      {active.length > 0 && (
        <View>
          <Text style={{ fontWeight: '700', marginBottom: 8 }}>Active coverage</Text>
          {active.map((a) => (
            <View key={a.development} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' }}>
              <Text style={{ fontWeight: '600' }}>{a.development}</Text>
              <Text style={{ color: '#666' }}>until {fmt(a.expiresAt)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// Supervisors/managers are view-only on the app; this screen only takes action.
export default function CoverSite() {
  const readOnly = useAppReadOnly();
  if (readOnly === null) return null;
  if (readOnly) return <ReadOnlyScreen title="Cover a Site" />;
  return <CoverSiteScreen />;
}
