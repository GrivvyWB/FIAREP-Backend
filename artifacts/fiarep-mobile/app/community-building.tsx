import { useCallback, useState, type ComponentProps } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ui } from '../lib/ui';
import { BOROUGHS, getCommunity, saveCommunity, str, today, type CommunityRecord } from '../lib/community';
import { Chips } from '../lib/community-ui';

export default function CommunityBuilding() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = str(params.id);
  const [record, setRecord] = useState<CommunityRecord | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    address: '', borough: '', units: '', floors: '', ownerName: '', ownerPhone: '', ownerEmail: '',
    ownerAddress: '', managementCompany: '', managementPhone: '', superName: '', superPhone: '', superApartment: '',
    notes: '', visitedOn: today(),
  });
  const set = (k: keyof typeof f, v: string) => setF((c) => ({ ...c, [k]: v }));

  useFocusEffect(useCallback(() => {
    if (!id || loaded) return;
    getCommunity('community-buildings', id).then((r) => {
      const st = r.state || {};
      setRecord(r);
      setF({
        address: str(st.address), borough: str(st.borough),
        units: str(st.units), floors: str(st.floors), ownerName: str(st.ownerName), ownerPhone: str(st.ownerPhone), ownerEmail: str(st.ownerEmail),
        ownerAddress: str(st.ownerAddress), managementCompany: str(st.managementCompany), managementPhone: str(st.managementPhone),
        superName: str(st.superName), superPhone: str(st.superPhone), superApartment: str(st.superApartment),
        notes: str(st.notes), visitedOn: str(st.visitedOn) || today(),
      });
      setLoaded(true);
    }).catch((e) => { Alert.alert('Could not open', e?.message || 'Try again.'); router.back(); });
  }, [id, loaded, router]));

  async function save() {
    if (!f.address.trim()) { Alert.alert('Building address is required'); return; }
    if (f.units && !(Number(f.units) >= 0)) { Alert.alert('Apartment units must be a number'); return; }
    setBusy(true);
    try {
      const state = { ...f, address: f.address.trim(), units: f.units ? Number(f.units) : '', floors: f.floors ? Number(f.floors) : '' };
      await saveCommunity('community-buildings', record, state, '');
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Check your connection and try again.');
    } finally { setBusy(false); }
  }

  const field = (label: string, key: keyof typeof f, extra?: Partial<ComponentProps<typeof TextInput>>) => (
    <>
      <Text style={ui.label}>{label}</Text>
      <TextInput style={ui.input} value={f[key]} onChangeText={(v) => set(key, v)} {...extra} />
    </>
  );

  if (!loaded) return <View style={ui.wrap}><Text style={ui.empty}>Loading…</Text></View>;
  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.label}>The building, how many apartments are in it, and who owns or manages it.</Text>
      {field('Building address *', 'address', { placeholder: '262 Ralph Ave, Brooklyn' })}
      <Text style={ui.label}>Borough</Text>
      <Chips options={BOROUGHS} value={f.borough} onChange={(v) => set('borough', v === f.borough ? '' : v)} />
      <View style={ui.row}>
        <View style={{ flex: 1 }}>{field('Apartment units', 'units', { keyboardType: 'number-pad' })}</View>
        <View style={{ flex: 1 }}>{field('Floors', 'floors', { keyboardType: 'number-pad' })}</View>
      </View>
      <Text style={[ui.h, { marginTop: 4 }]}>Owner</Text>
      {field('Owner name', 'ownerName', { autoCapitalize: 'words' })}
      {field('Owner phone', 'ownerPhone', { keyboardType: 'phone-pad' })}
      {field('Owner email', 'ownerEmail', { keyboardType: 'email-address', autoCapitalize: 'none' })}
      {field('Owner mailing address', 'ownerAddress')}
      {field('Management company', 'managementCompany', { autoCapitalize: 'words' })}
      {field('Management phone', 'managementPhone', { keyboardType: 'phone-pad' })}
      <Text style={[ui.h, { marginTop: 4 }]}>Super</Text>
      {field("Super's name", 'superName', { autoCapitalize: 'words' })}
      {field("Super's phone", 'superPhone', { keyboardType: 'phone-pad' })}
      {field("Super's apartment (if they live in the building)", 'superApartment', { placeholder: '1A', autoCapitalize: 'characters' })}
      <Text style={ui.label}>Notes</Text>
      <TextInput style={[ui.input, { minHeight: 90, textAlignVertical: 'top' }]} multiline value={f.notes} onChangeText={(v) => set('notes', v)} placeholder="Condition of the building, access, super's name…" />
      {field('Visit date (YYYY-MM-DD)', 'visitedOn', { placeholder: today() })}
      <Pressable style={[ui.btn, busy && ui.btnMuted]} onPress={() => void save()} disabled={busy}>
        <Text style={ui.btnText}>{busy ? 'Saving…' : record ? 'Save changes' : 'Add building'}</Text>
      </Pressable>
      <Pressable style={ui.btnOutline} onPress={() => router.back()}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
    </ScrollView>
  );
}
