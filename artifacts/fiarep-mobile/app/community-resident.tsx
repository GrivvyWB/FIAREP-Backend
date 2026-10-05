import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Switch } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ui } from '../lib/ui';
import {
  BOROUGHS, CRITICAL_TAGS, PROGRAMS, getCommunity, saveCommunity, str, today, type CommunityRecord,
} from '../lib/community';
import { Chips, DevelopmentPicker } from '../lib/community-ui';

export default function CommunityResident() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = str(params.id);
  const [record, setRecord] = useState<CommunityRecord | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: '', phone: '', email: '', development: '', borough: '', address: '', apartment: '',
    program: PROGRAMS[0]!, critical: false, criticalTags: [] as string[], notes: '', visitedOn: today(),
  });
  const set = (k: keyof typeof f, v: unknown) => setF((c) => ({ ...c, [k]: v }));

  useFocusEffect(useCallback(() => {
    if (!id || loaded) return;
    getCommunity('community-residents', id).then((r) => {
      const st = r.state || {};
      setRecord(r);
      setF({
        name: str(st.name), phone: str(st.phone), email: str(st.email), development: str(r.development || st.development),
        borough: str(st.borough), address: str(st.address), apartment: str(st.apartment), program: str(st.program) || PROGRAMS[0]!,
        critical: st.critical === true, criticalTags: Array.isArray(st.criticalTags) ? st.criticalTags : [],
        notes: str(st.notes), visitedOn: str(st.visitedOn) || today(),
      });
      setLoaded(true);
    }).catch((e) => { Alert.alert('Could not open', e?.message || 'Try again.'); router.back(); });
  }, [id, loaded, router]));

  async function save() {
    if (!f.name.trim() || !f.address.trim()) { Alert.alert('Name and building address are required'); return; }
    setBusy(true);
    try {
      const state = { ...f, name: f.name.trim(), address: f.address.trim(), criticalTags: f.critical ? f.criticalTags : [] };
      await saveCommunity('community-residents', record, state, f.development);
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Check your connection and try again.');
    } finally { setBusy(false); }
  }

  if (!loaded) return <View style={ui.wrap}><Text style={ui.empty}>Loading…</Text></View>;
  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.label}>What the tenant told you at the door. Mark it critical if it needs attention now.</Text>
      <Text style={ui.label}>Resident name *</Text>
      <TextInput style={ui.input} value={f.name} onChangeText={(v) => set('name', v)} autoCapitalize="words" />
      <Text style={ui.label}>Phone</Text>
      <TextInput style={ui.input} value={f.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" placeholder="(718) 555-0100" />
      <Text style={ui.label}>Email</Text>
      <TextInput style={ui.input} value={f.email} onChangeText={(v) => set('email', v)} keyboardType="email-address" autoCapitalize="none" />
      <DevelopmentPicker value={f.development} onChange={(v) => set('development', v)} />
      <Text style={ui.label}>Borough</Text>
      <Chips options={BOROUGHS} value={f.borough} onChange={(v) => set('borough', v === f.borough ? '' : v)} />
      <Text style={ui.label}>Building address *</Text>
      <TextInput style={ui.input} value={f.address} onChangeText={(v) => set('address', v)} placeholder="262 Ralph Ave" />
      <Text style={ui.label}>Apartment</Text>
      <TextInput style={ui.input} value={f.apartment} onChangeText={(v) => set('apartment', v)} placeholder="4C" autoCapitalize="characters" />
      <Text style={ui.label}>Program / reason for the visit</Text>
      <Chips options={PROGRAMS} value={f.program} onChange={(v) => set('program', v)} wrap />
      <View style={[ui.card, { gap: 8 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontWeight: '600' }}>Critical — needs attention</Text>
          <Switch value={f.critical} onValueChange={(v) => set('critical', v)} />
        </View>
        {f.critical && (
          <Chips options={CRITICAL_TAGS} values={f.criticalTags} onToggle={(t) => set('criticalTags', f.criticalTags.includes(t) ? f.criticalTags.filter((x) => x !== t) : [...f.criticalTags, t])} wrap />
        )}
      </View>
      <Text style={ui.label}>Notes</Text>
      <TextInput style={[ui.input, { minHeight: 100, textAlignVertical: 'top' }]} multiline value={f.notes} onChangeText={(v) => set('notes', v)} placeholder="What the resident reported, who was present, what was promised…" />
      <Text style={ui.label}>Visit date (YYYY-MM-DD)</Text>
      <TextInput style={ui.input} value={f.visitedOn} onChangeText={(v) => set('visitedOn', v)} placeholder={today()} />
      <Pressable style={[ui.btn, busy && ui.btnMuted]} onPress={() => void save()} disabled={busy}>
        <Text style={ui.btnText}>{busy ? 'Saving…' : record ? 'Save changes' : 'Log resident'}</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={() => router.back()}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
    </ScrollView>
  );
}
