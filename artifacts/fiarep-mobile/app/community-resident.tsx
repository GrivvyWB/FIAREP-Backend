import { useCallback, useState, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Switch } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ui } from '../lib/ui';
import {
  BOROUGHS, CRITICAL_TAGS, PROGRAMS, getCommunity, saveCommunity, str, today, type CommunityRecord,
} from '../lib/community';
import { Chips } from '../lib/community-ui';
import {
  LEAD_DOCUMENTS, LEAD_TESTED, MOLD_EXTENT, VERMIN_FREQUENCY, VERMIN_TYPES,
  type AffidavitInfo, type LeadChild, type LeadInfo, type MoldInfo, type VerminInfo,
} from '../lib/community-report';

export default function CommunityResident() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = str(params.id);
  const [record, setRecord] = useState<CommunityRecord | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: '', phone: '', email: '', borough: '', address: '', apartment: '',
    program: PROGRAMS[0]!, critical: false, criticalTags: [] as string[], notes: '', visitedOn: today(),
    mold: { present: false, locations: '', extent: '', since: '', notes: '' } as MoldInfo,
    vermin: { present: false, types: [], locations: '', frequency: '', notes: '' } as VerminInfo,
    lead: { present: false, childUnder6: false, children: [], peelingPaint: '', tested: '', documents: [], notes: '' } as LeadInfo,
    affidavit: { given: false, statement: '', affiantName: '', date: '', witnessName: '', affirmed: false } as AffidavitInfo,
  });
  const set = (k: keyof typeof f, v: unknown) => setF((c) => ({ ...c, [k]: v }));
  const sub = <K extends 'mold' | 'vermin' | 'lead' | 'affidavit'>(k: K, patch: Partial<typeof f[K]>) => setF((c) => ({ ...c, [k]: { ...c[k], ...patch } }));

  useFocusEffect(useCallback(() => {
    if (!id || loaded) return;
    getCommunity('community-residents', id).then((r) => {
      const st = r.state || {};
      setRecord(r);
      setF({
        name: str(st.name), phone: str(st.phone), email: str(st.email),
        borough: str(st.borough), address: str(st.address), apartment: str(st.apartment), program: str(st.program) || PROGRAMS[0]!,
        critical: st.critical === true, criticalTags: Array.isArray(st.criticalTags) ? st.criticalTags : [],
        notes: str(st.notes), visitedOn: str(st.visitedOn) || today(),
        mold: { present: false, locations: '', extent: '', since: '', notes: '', ...(st.mold || {}) },
        vermin: { present: false, types: [], locations: '', frequency: '', notes: '', ...(st.vermin || {}) },
        lead: { present: false, childUnder6: false, children: [], peelingPaint: '', tested: '', documents: [], notes: '', ...(st.lead || {}) },
        affidavit: { given: false, statement: '', affiantName: '', date: '', witnessName: '', affirmed: false, ...(st.affidavit || {}) },
      });
      setLoaded(true);
    }).catch((e) => { Alert.alert('Could not open', e?.message || 'Try again.'); router.back(); });
  }, [id, loaded, router]));

  async function save() {
    if (!f.name.trim() || !f.address.trim()) { Alert.alert('Name and building address are required'); return; }
    setBusy(true);
    try {
      const state = { ...f, name: f.name.trim(), address: f.address.trim(), criticalTags: f.critical ? f.criticalTags : [] };
      await saveCommunity('community-residents', record, state, '');
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
      <Section title="Mold" on={!!f.mold.present} onToggle={(v) => sub('mold', { present: v })}>
        <Text style={ui.label}>Where in the apartment</Text>
        <TextInput style={ui.input} value={f.mold.locations || ''} onChangeText={(v) => sub('mold', { locations: v })} placeholder="Bathroom ceiling, bedroom wall near window…" />
        <Text style={ui.label}>How much</Text>
        <Chips options={MOLD_EXTENT} value={f.mold.extent || ''} onChange={(v) => sub('mold', { extent: v })} />
        <Text style={ui.label}>Since when</Text>
        <TextInput style={ui.input} value={f.mold.since || ''} onChangeText={(v) => sub('mold', { since: v })} placeholder="e.g. March 2026" />
        <Text style={ui.label}>Mold notes</Text>
        <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline value={f.mold.notes || ''} onChangeText={(v) => sub('mold', { notes: v })} placeholder="Leak source, previous repairs, health complaints…" />
      </Section>
      <Section title="Vermin / pests" on={!!f.vermin.present} onToggle={(v) => sub('vermin', { present: v })}>
        <Text style={ui.label}>Type</Text>
        <Chips options={VERMIN_TYPES} values={f.vermin.types || []} onToggle={(t) => sub('vermin', { types: (f.vermin.types || []).includes(t) ? (f.vermin.types || []).filter((x) => x !== t) : [...(f.vermin.types || []), t] })} />
        <Text style={ui.label}>Where</Text>
        <TextInput style={ui.input} value={f.vermin.locations || ''} onChangeText={(v) => sub('vermin', { locations: v })} placeholder="Kitchen, under sink, hallway…" />
        <Text style={ui.label}>How often</Text>
        <Chips options={VERMIN_FREQUENCY} value={f.vermin.frequency || ''} onChange={(v) => sub('vermin', { frequency: v })} />
        <Text style={ui.label}>Vermin notes</Text>
        <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline value={f.vermin.notes || ''} onChangeText={(v) => sub('vermin', { notes: v })} placeholder="Extermination history, entry points, bites…" />
      </Section>
      <Section title="Lead paint" on={!!f.lead.present} onToggle={(v) => sub('lead', { present: v })}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ flex: 1 }}>A child under 6 lives in or regularly visits the unit</Text>
          <Switch value={!!f.lead.childUnder6} onValueChange={(v) => sub('lead', { childUnder6: v, children: v && !(f.lead.children || []).length ? [{ name: '', age: '', dob: '' }] : f.lead.children })} />
        </View>
        {f.lead.childUnder6 && (
          <View style={{ gap: 8, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 8 }}>
            <Text style={ui.label}>Children under 6</Text>
            {(f.lead.children || []).map((child: LeadChild, i: number) => {
              const setChild = (patch: Partial<LeadChild>) => sub('lead', { children: (f.lead.children || []).map((c, j) => j === i ? { ...c, ...patch } : c) });
              return (
                <View key={i} style={{ gap: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
                  <TextInput style={ui.input} value={child.name || ''} onChangeText={(v) => setChild({ name: v })} placeholder="Child's name" autoCapitalize="words" />
                  <View style={ui.row}>
                    <TextInput style={[ui.input, { flex: 1 }]} value={child.age || ''} onChangeText={(v) => setChild({ age: v })} placeholder="Age" keyboardType="number-pad" />
                    <TextInput style={[ui.input, { flex: 2 }]} value={child.dob || ''} onChangeText={(v) => setChild({ dob: v, age: ageFromDob(v) ?? child.age })} placeholder="Date of birth (YYYY-MM-DD)" />
                  </View>
                  <Pressable onPress={() => sub('lead', { children: (f.lead.children || []).filter((_, j) => j !== i) })}><Text style={{ color: '#b91c1c', fontWeight: '600' }}>Remove</Text></Pressable>
                </View>
              );
            })}
            <Pressable style={ui.btnOutline} onPress={() => sub('lead', { children: [...(f.lead.children || []), { name: '', age: '', dob: '' }] })}><Text style={ui.btnOutlineText}>+ Add another child</Text></Pressable>
          </View>
        )}
        <Text style={ui.label}>Peeling / chipping paint — where</Text>
        <TextInput style={ui.input} value={f.lead.peelingPaint || ''} onChangeText={(v) => sub('lead', { peelingPaint: v })} placeholder="Window sills, bedroom door frame…" />
        <Text style={ui.label}>Testing</Text>
        <Chips options={LEAD_TESTED} value={f.lead.tested || ''} onChange={(v) => sub('lead', { tested: v })} wrap />
        <Text style={ui.label}>Lead documents provided</Text>
        <Chips options={LEAD_DOCUMENTS} values={f.lead.documents || []} onToggle={(t) => sub('lead', { documents: (f.lead.documents || []).includes(t) ? (f.lead.documents || []).filter((x) => x !== t) : [...(f.lead.documents || []), t] })} wrap />
        <Text style={ui.label}>Lead notes</Text>
        <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline value={f.lead.notes || ''} onChangeText={(v) => sub('lead', { notes: v })} placeholder="Blood lead level if known, doctor, HPD case #…" />
      </Section>
      <Section title="Affidavit" on={!!f.affidavit.given} onToggle={(v) => sub('affidavit', { given: v, affiantName: f.affidavit.affiantName || f.name, date: f.affidavit.date || f.visitedOn })}>
        <Text style={ui.label}>Resident's statement</Text>
        <TextInput style={[ui.input, { minHeight: 120, textAlignVertical: 'top' }]} multiline value={f.affidavit.statement || ''} onChangeText={(v) => sub('affidavit', { statement: v })} placeholder="In the resident's own words: what happened, when, who they told, what was done…" />
        <Text style={ui.label}>Affiant (resident)</Text>
        <TextInput style={ui.input} value={f.affidavit.affiantName || ''} onChangeText={(v) => sub('affidavit', { affiantName: v })} autoCapitalize="words" />
        <Text style={ui.label}>Date (YYYY-MM-DD)</Text>
        <TextInput style={ui.input} value={f.affidavit.date || ''} onChangeText={(v) => sub('affidavit', { date: v })} />
        <Text style={ui.label}>Witness</Text>
        <TextInput style={ui.input} value={f.affidavit.witnessName || ''} onChangeText={(v) => sub('affidavit', { witnessName: v })} placeholder="Coordinator or other witness" autoCapitalize="words" />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ flex: 1 }}>Resident affirms this is true and correct (signature lines print on the PDF)</Text>
          <Switch value={!!f.affidavit.affirmed} onValueChange={(v) => sub('affidavit', { affirmed: v })} />
        </View>
      </Section>
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

function Section({ title, on, onToggle, children }: { title: string; on: boolean; onToggle: (v: boolean) => void; children: ReactNode }) {
  return (
    <View style={[ui.card, { gap: 8, borderColor: on ? '#F2C14E' : '#e0e0e0' }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '600', fontSize: 16 }}>{title}</Text>
        <Switch value={on} onValueChange={onToggle} />
      </View>
      {on && children}
    </View>
  );
}

function ageFromDob(dob: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob); if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? String(age) : null;
}
