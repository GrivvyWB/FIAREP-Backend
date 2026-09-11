import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import {
  listProcurementRequests,
  approveProcurementRequest,
  rejectScope,
  deleteProcurementRequest,
  repairScopeAddresses,
  getCurrentActor,
  type ProcurementRequest,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

export default function ScopeApprovals() {
  const [items, setItems] = useState<ProcurementRequest[]>([]);
  const [returned, setReturned] = useState<ProcurementRequest[]>([]);
  const [me, setMe] = useState('');
  const [rejectWhy, setRejectWhy] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({ pending: true });
  const toggle = (k: string) => setOpen((m) => ({ ...m, [k]: !m[k] }));

  const load = useCallback(() => {
    repairScopeAddresses().then(() => listProcurementRequests('submitted').then(setItems));
    listProcurementRequests('draft').then((all) => setReturned(all.filter((r) => !!r.returnedAt)));
    getCurrentActor().then((a) => setMe((a && a.name) || ''));
  }, []);
  useFocusEffect(load);

  async function approve(r: ProcurementRequest) {
    try { await approveProcurementRequest(r.id, me); load(); Alert.alert('Approved', 'Sent to procurement.'); }
    catch (e: any) { Alert.alert('Error', String(e && e.message ? e.message : e)); }
  }

  async function reject(r: ProcurementRequest) {
    try { await rejectScope(r.id, (rejectWhy[r.id] || '').trim()); setRejectWhy((m) => ({ ...m, [r.id]: '' })); load(); }
    catch (e: any) { Alert.alert('Error', String(e && e.message ? e.message : e)); }
  }

  function del(r: ProcurementRequest) {
    Alert.alert('Delete this scope?', (r.address || 'This scope') + '\n\nRemoves it everywhere, including the CPM\'s revision list. Cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteProcurementRequest(r.id); load(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Scope Approvals</Text>
      <Text style={ui.label}>Scopes submitted by CPMs awaiting your approval.</Text>

      <Pressable onPress={() => toggle('pending')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, backgroundColor: '#f2f7fb', borderRadius: 10, padding: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{open['pending'] ? '\u2013' : '+'}  Awaiting approval</Text>
        <Text style={{ fontSize: 13, color: '#667085' }}>{items.length}</Text>
      </Pressable>
      {open['pending'] && items.length === 0 && <Text style={ui.empty}>Nothing awaiting approval.</Text>}

      {open['pending'] && items.map((r) => (
        <View key={r.id} style={[ui.card, { gap: 6 }]}>
          <View style={ui.line}><Text style={ui.lineK}>Address</Text><Text style={ui.lineV}>{r.address}</Text></View>
          {!!r.returnNote && (
            <View style={{ backgroundColor: '#fdecea', borderColor: '#c0392b', borderWidth: 1, borderRadius: 8, padding: 8 }}>
              <Text style={{ color: '#c0392b', fontWeight: '700' }}>Returned by procurement</Text>
              <Text style={{ color: '#c0392b', fontSize: 13, marginTop: 2 }}>{r.returnNote}</Text>
            </View>
          )}
          <Text style={ui.label}>Scope</Text>
          <Text>{r.scope}</Text>
          {!!r.scopeFileName && <Text style={ui.listSub}>File: {r.scopeFileName}</Text>}
          <Text style={ui.listSub}>From {r.requestedBy || 'CPM'}  {fmt(r.requestedAt)}</Text>

          <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={() => router.push('/scope-review?id=' + r.id)}>
            <Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>View full scope & quote</Text>
          </Pressable>
          <Pressable style={[ui.btn, { marginTop: 8 }]} onPress={() => approve(r)}>
            <Text style={ui.btnText}>Approve & send to procurement</Text>
          </Pressable>

          <TextInput
            style={[ui.input, { marginTop: 8 }]}
            value={rejectWhy[r.id] || ''}
            onChangeText={(t) => setRejectWhy((m) => ({ ...m, [r.id]: t }))}
            placeholder="Reason (optional)"
          />
          <Pressable onPress={() => reject(r)} style={{ marginTop: 4 }}>
            <Text style={{ color: '#c0392b', fontWeight: '600' }}>Return to CPM for revision</Text>
          </Pressable>
          <Pressable onPress={() => del(r)} style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8 }}>
            <Text style={{ color: '#c0392b', fontWeight: '700' }}>Delete scope</Text>
          </Pressable>
        </View>
      ))}

      {returned.length > 0 && (
        <>
          <Pressable onPress={() => toggle('returned')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, backgroundColor: '#f2f7fb', borderRadius: 10, padding: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{open['returned'] ? '\u2013' : '+'}  Returned to CPMs</Text>
            <Text style={{ fontSize: 13, color: '#667085' }}>{returned.length}</Text>
          </Pressable>
          {open['returned'] && <Text style={ui.listSub}>Awaiting the CPM's revision. Delete any that should no longer exist.</Text>}
          {open['returned'] && returned.map((r) => (
            <View key={r.id} style={[ui.card, { gap: 4, marginTop: 8 }]}>
              <Text style={{ fontWeight: '600' }}>{r.address || 'No address'}</Text>
              {!!r.scope && <Text style={ui.listSub}>{r.scope}</Text>}
              {!!r.returnNote && <Text style={{ color: '#c0392b', fontSize: 12 }}>Note: {r.returnNote}</Text>}
              <Text style={ui.listSub}>From {r.requestedBy || '—'}</Text>
              <Pressable style={{ marginTop: 6 }} onPress={() => del(r)}>
                <Text style={{ color: '#c0392b', fontWeight: '600' }}>Delete scope</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
