import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getVendorQuote, setVendorQuote, submitVendorQuoteAsBid, getProjectScopeForm } from '../lib/store';
import {
  seedVendorScope, stripPrices, usedOnly, newLine,
  lineAmount, sectionTotal, grandTotal, costPerDU,
  type VendorScope, type ScopeLine,
} from '../lib/vendorScope';
import { ui, ACCENT } from '../lib/ui';

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VendorQuote() {
  const router = useRouter();
  const { trackingId, vendor, address, scope: scopeText, projectId, jobId } = useLocalSearchParams<{ trackingId: string; vendor: string; address: string; scope: string; projectId: string; jobId: string }>();
  const [scope, setScope] = useState<VendorScope>(seedVendorScope());
  // locked = the CPM specified the work; vendor may only enter Unit Cost.
  // unlocked (fallback) = no CPM scope on file; vendor fills everything.
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!trackingId || !vendor) return;
    getVendorQuote(String(trackingId), String(vendor)).then(async (saved: any) => {
      if (saved && Array.isArray(saved.divisions) && saved.divisions.length > 0) {
        setScope(saved);
        setLocked(saved.__locked !== false);
        return;
      }
      const scopeKey = (projectId && String(projectId)) || (jobId && String(jobId)) || '';
      if (scopeKey) {
        const cpm = await getProjectScopeForm(scopeKey).catch(() => null);
        if (cpm && Array.isArray(cpm.divisions) && cpm.divisions.length > 0) {
          const clean: any = stripPrices(usedOnly(cpm));
          clean.header = { ...clean.header, contractor: String(vendor || '') };
          clean.__locked = true;
          setScope(clean); setLocked(true);
          setVendorQuote(String(trackingId), String(vendor), clean);
          return;
        }
      }
      // Fallback: no CPM Divisions scope. Give the vendor the full skeleton to
      // fill themselves (descriptions/qty/unit/cost all editable).
      const seed: any = seedVendorScope();
      seed.header.contractor = String(vendor || '');
      seed.header.address = String(address || '');
      seed.header.projectName = String(scopeText || '');
      seed.__locked = false;
      setScope(seed); setLocked(false);
      setVendorQuote(String(trackingId), String(vendor), seed);
    });
  }, [trackingId, vendor, address, scopeText, projectId, jobId]);
  useFocusEffect(load);

  const save = (next: VendorScope) => {
    setScope(next);
    if (trackingId && vendor) setVendorQuote(String(trackingId), String(vendor), next);
  };

  const setField = (di: number, si: number, li: number, k: keyof ScopeLine, v: string) => {
    const divisions = scope.divisions.map((d, i) => i !== di ? d : {
      ...d, sections: d.sections.map((sec, j) => j !== si ? sec : {
        ...sec, lines: sec.lines.map((l, k2) => k2 !== li ? l : { ...l, [k]: v }),
      }),
    });
    save({ ...scope, divisions });
  };
  const addLine = (di: number, si: number) => {
    const divisions = scope.divisions.map((d, i) => i !== di ? d : {
      ...d, sections: d.sections.map((sec, j) => j !== si ? sec : { ...sec, lines: [...sec.lines, newLine()] }),
    });
    save({ ...scope, divisions });
  };

  async function submit() {
    const total = grandTotal(scope);
    if (total <= 0) { Alert.alert('Add pricing', 'Enter your unit cost on at least one line before submitting.'); return; }
    setBusy(true);
    try {
      const b = await submitVendorQuoteAsBid(String(trackingId), String(vendor), '');
      if (b) {
        Alert.alert('Quote submitted', 'Your quote of ' + money(total) + ' was sent to procurement.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else { Alert.alert('Not sent', 'Could not submit your quote.'); }
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Scope of Work — Your Quote</Text>
      <Text style={ui.label}>
        {locked
          ? 'The work below was specified for this job. Enter your Unit Cost on each line; your grand total is sent to procurement as your bid.'
          : 'No itemized scope was attached, so fill in the work and your pricing. Your grand total is sent to procurement as your bid.'}
      </Text>

      <View style={[ui.card, { borderColor: ACCENT, borderWidth: 1.5, marginTop: 8 }]}>
        <Text style={{ fontWeight: '700', color: ACCENT }}>Quoting job {String(trackingId || '')}</Text>
        <Text style={{ fontWeight: '600' }}>Contractor: {scope.header?.contractor || String(vendor || '')}</Text>
        {!!scope.header?.address && <Text style={ui.listSub}>{scope.header.address}</Text>}
        {!!scopeText && <Text style={ui.listSub}>Scope: {String(scopeText)}</Text>}
      </View>

      {scope.divisions.map((d, di) => (
        <View key={d.id} style={{ marginTop: 16 }}>
          <Text style={{ backgroundColor: '#d9ead3', fontWeight: '800', padding: 8, borderRadius: 6 }}>{d.title}</Text>
          {d.sections.map((sec, si) => (
            <View key={sec.id} style={[ui.card, { marginTop: 8, gap: 6 }]}>
              <Text style={{ fontWeight: '700' }}>{sec.code}</Text>
              {sec.lines.map((l, li) => (
                <View key={l.id} style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6, gap: 4 }}>
                  {locked ? (
                    <Text style={{ fontSize: 14 }}>{l.description || '(no description)'}</Text>
                  ) : (
                    <TextInput style={[ui.input, { minHeight: 40 }]} value={l.description} onChangeText={(t) => setField(di, si, li, 'description', t)} placeholder="Description of work" multiline />
                  )}
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-end' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.label}>Qty</Text>
                      {locked ? <Text style={{ paddingVertical: 8, fontWeight: '600' }}>{l.quantity || '—'}</Text>
                        : <TextInput style={ui.input} value={l.quantity} onChangeText={(t) => setField(di, si, li, 'quantity', t)} placeholder="0" keyboardType="numeric" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.label}>Unit</Text>
                      {locked ? <Text style={{ paddingVertical: 8, fontWeight: '600' }}>{l.unit || '—'}</Text>
                        : <TextInput style={ui.input} value={l.unit} onChangeText={(t) => setField(di, si, li, 'unit', t)} placeholder="Each" />}
                    </View>
                    <View style={{ flex: 1.3 }}>
                      <Text style={ui.label}>Your Unit Cost</Text>
                      <TextInput style={ui.input} value={l.unitCost} onChangeText={(t) => setField(di, si, li, 'unitCost', t)} placeholder="$" keyboardType="numeric" />
                    </View>
                  </View>
                  <Text style={{ fontWeight: '600', textAlign: 'right' }}>Amount: {money(lineAmount(l))}</Text>
                </View>
              ))}
              <View style={{ borderTopWidth: 1, borderTopColor: '#ddd', paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                {!locked ? <Pressable onPress={() => addLine(di, si)}><Text style={{ color: ACCENT, fontWeight: '600' }}>+ Add line</Text></Pressable> : <View />}
                <Text style={{ fontWeight: '700' }}>Sub-Total {money(sectionTotal(sec))}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}

      <View style={[ui.card, { borderColor: ACCENT, borderWidth: 1.5, marginTop: 16, gap: 6 }]}>
        <View style={ui.line}><Text style={[ui.lineK, { fontWeight: '700', color: '#000' }]}>Grand Total Construction Cost</Text><Text style={[ui.lineV, { fontWeight: '700' }]}>{money(grandTotal(scope))}</Text></View>
        <View style={ui.line}><Text style={ui.lineK}>Cost Per D.U.</Text><Text style={ui.lineV}>{money(costPerDU(scope))}</Text></View>
      </View>

      <Pressable style={[ui.btn, { marginTop: 16 }, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={ui.btnText}>Submit quote to procurement</Text>
      </Pressable>
      <View style={{ height: 60 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
