import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAppMode } from './_layout';
import {
  listProcurementRequests,
  broadcastProcurement,
  awardProcurementRequest,
  closeProcurementRequest,
  rateAndCloseProcurement,
  returnScopeToManagement,
  deleteProcurementRequest,
  listBids,
  getCurrentActor,
  type ProcurementRequest,
  type ProcurementBid,
  type VendorPerformance,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

export default function Procurement() {
  const router = useRouter();
  const { mode } = useAppMode();
  const canAct = mode === 'procurement';
  const canDelete = mode === 'procurement' || mode === 'administrator';
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [walk, setWalk] = useState<Record<string, string>>({});
  const [walkNote, setWalkNote] = useState<Record<string, string>>({});
  const [closeAt, setCloseAt] = useState<Record<string, string>>({});
  const [bids, setBids] = useState<Record<string, ProcurementBid[]>>({});
  const [perf, setPerf] = useState<Record<string, VendorPerformance>>({});
  const [charged, setCharged] = useState<Record<string, string>>({});
  const [deduct, setDeduct] = useState<Record<string, string>>({});
  const [deductWhy, setDeductWhy] = useState<Record<string, string>>({});
  const [me, setMe] = useState('');
  const [query, setQuery] = useState('');
  const [addrPicker, setAddrPicker] = useState(false);
  const [openBids, setOpenBids] = useState<Record<string, boolean>>({});
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ pending: true, bidding: true, awarded: true, closed: true });

  const load = useCallback(() => {
    listProcurementRequests().then(async (rs) => {
      setRequests(rs);
      const bidding = rs.filter((r) => r.status === 'bidding');
      const map: Record<string, ProcurementBid[]> = {};
      for (const r of bidding) { map[r.id] = await listBids(r.id); }
      setBids(map);
    });
    getCurrentActor().then((a) => setMe((a && a.name) || ''));
  }, []);
  useFocusEffect(load);

  function returnToSupervisor(r: ProcurementRequest) {
    Alert.prompt(
      'Return to supervisor',
      'Send this scope back to management for revision. A reason is required.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Return', style: 'destructive', onPress: async (note?: string) => {
          const reason = (note || '').trim();
          if (!reason) { Alert.alert('Reason required', 'Add a note explaining why this scope is being sent back.'); return; }
          try { await returnScopeToManagement(r.id, reason); load(); Alert.alert('Returned', 'Sent back to the supervisor for revision.'); }
          catch (e: any) { Alert.alert('Error', String(e && e.message ? e.message : e)); }
        } },
      ],
      'plain-text',
    );
  }
  async function broadcast(r: ProcurementRequest) {
    try {
      await broadcastProcurement(r.id, walk[r.id] || '', walkNote[r.id] || '', closeAt[r.id] || '');
      load();
      Alert.alert('Sent to vendors', 'Job ' + r.trackingId + ' is now open for bids.');
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    }
  }

  async function award(r: ProcurementRequest, vendorName: string) {
    try {
      await awardProcurementRequest(r.id, vendorName, me);
      load();
      Alert.alert('Awarded', r.trackingId + ' awarded to ' + vendorName + '. Winner and other bidders notified.');
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    }
  }

  async function rateClose(r: ProcurementRequest) {
    const p = perf[r.id];
    if (!p) { Alert.alert('Rate the work', 'Choose Good, Fair, or Poor.'); return; }
    const amt = parseFloat((charged[r.id] || '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) { Alert.alert('Amount charged', 'Enter what the vendor charged.'); return; }
    const cut = parseFloat((deduct[r.id] || '').replace(/[^0-9.]/g, '')) || 0;
    if (cut > amt) { Alert.alert('Deduction too high', 'The cut cannot exceed the amount charged.'); return; }
    try {
      const done = await rateAndCloseProcurement(r.id, p, amt, cut, (deductWhy[r.id] || '').trim());
      load();
      if (done) Alert.alert('Closed', 'Vendor paid $' + done.finalAmount + (done.deduction ? ' (cut $' + done.deduction + ')' : ''));
    } catch (e: any) { Alert.alert('Error', String(e && e.message ? e.message : e)); }
  }

  function onDelete(r: ProcurementRequest) {
    Alert.alert('Delete procurement?', 'Permanently removes ' + r.trackingId + ' and all its bids. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteProcurementRequest(r.id); load(); } },
    ]);
  }

  function DeleteRow({ r }: { r: ProcurementRequest }) {
    if (!canDelete) return null;
    return (
      <Pressable onPress={() => onDelete(r)} style={{ marginTop: 6 }}>
        <Text style={{ color: '#c0392b', fontWeight: '600' }}>Delete procurement</Text>
      </Pressable>
    );
  }

  const pending = requests.filter((r) => r.status === 'approved' && (!query.trim() || (r.address || '').toLowerCase().includes(query.trim().toLowerCase()) || (r.trackingId || '').toLowerCase().includes(query.trim().toLowerCase())));
  const q = query.trim().toLowerCase();
  const allAddresses = (() => {
    const set: Record<string, boolean> = {}; const out: string[] = [];
    for (const r of requests) { const v = (r.address || '').trim(); if (v && !set[v.toLowerCase()]) { set[v.toLowerCase()] = true; out.push(v); } }
    out.sort(); return out;
  })();
  const match = (r: ProcurementRequest) => !q
    || (r.address || '').toLowerCase().includes(q)
    || (r.trackingId || '').toLowerCase().includes(q);
  const bidding = requests.filter((r) => r.status === 'bidding' && match(r));
  const awarded = requests.filter((r) => r.status === 'awarded' && match(r));
  const closed = requests.filter((r) => r.status === 'closed' && match(r));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Procurement</Text>

      <Pressable style={[ui.btnOutline, { marginBottom: 12 }]} onPress={() => router.push('/vendor-contacts')}>
        <Text style={ui.btnOutlineText}>Vendor Contacts</Text>
      </Pressable>

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by address or ID"
          autoCapitalize="none"
        />
        <Pressable style={ui.btnOutline} onPress={() => setAddrPicker(true)}>
          <Text style={{ color: ACCENT, fontWeight: '600' }}>Addresses</Text>
        </Pressable>
      </View>
      {!!query && <Pressable onPress={() => setQuery('')} style={{ paddingVertical: 4 }}><Text style={{ color: ACCENT }}>Clear filter</Text></Pressable>}

      <Modal visible={addrPicker} transparent animationType="slide" onRequestClose={() => setAddrPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>All addresses ({allAddresses.length})</Text>
            <ScrollView>
              {allAddresses.length === 0 && <Text style={[ui.listSub, { padding: 16 }]}>No addresses yet.</Text>}
              {allAddresses.map((a, i) => (
                <Pressable key={i} onPress={() => { setQuery(a); setAddrPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15 }}>{a}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setAddrPicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>


      <Pressable onPress={() => setOpenSec((m) => ({ ...m, pending: !m.pending }))}><Text style={[ui.label, { marginTop: 24, color: ACCENT, fontWeight: '700' }]}>{openSec.pending ? '[-]' : '[+]'} Awaiting broadcast ({pending.length})</Text></Pressable>
      {!openSec.pending ? null : pending.length === 0 ? (
        <Text style={ui.listSub}>Nothing pending.</Text>
      ) : (
        pending.map((r) => (
          <View key={r.id} style={[ui.card, { gap: 6 }]}>
            <View style={ui.line}>
              <Text style={ui.lineK}>ID</Text>
              <Text style={[ui.lineV, { color: ACCENT }]}>{r.trackingId || 'Not yet sent'}</Text>
            </View>
            <View style={ui.line}>
              <Text style={ui.lineK}>Address</Text>
              <Text style={ui.lineV}>{r.address}</Text>
            </View>
            <Text style={ui.label}>Scope</Text>
            <Text>{r.scope}</Text>
            {!!r.scopeFileName && <Text style={ui.listSub}>File: {r.scopeFileName}</Text>}
            <Text style={ui.listSub}>Sent by {r.requestedBy || 'unknown'}  {fmt(r.requestedAt)}</Text>
            <Pressable style={ui.btnOutline} onPress={() => router.push('/scope-review?id=' + r.id)}>
              <Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>View full scope & quote</Text>
            </Pressable>
            {canAct && (
            <View style={{ gap: 4, marginTop: 4 }}>
              <Text style={ui.label}>Walkthrough date & time</Text>
              <TextInput style={ui.input} value={walk[r.id] || ''} onChangeText={(t) => setWalk((m) => ({ ...m, [r.id]: t }))} placeholder="e.g. 08/31/2026 Monday 10:00 AM" />
              <Text style={ui.label}>Meeting note</Text>
              <TextInput style={[ui.input, { minHeight: 44 }]} value={walkNote[r.id] || ''} onChangeText={(t) => setWalkNote((m) => ({ ...m, [r.id]: t }))} placeholder="Where to meet, what to bring, etc." multiline />
              <Text style={ui.label}>Bids close</Text>
              <TextInput style={ui.input} value={closeAt[r.id] || ''} onChangeText={(t) => setCloseAt((m) => ({ ...m, [r.id]: t }))} placeholder="e.g. 09/07/2026 Monday 5:00 PM" />
            </View>
            )}
            {canAct && (
            <Pressable style={ui.btn} onPress={() => broadcast(r)}>
              <Text style={ui.btnText}>Send to all vendors</Text>
            </Pressable>
            )}
            {canAct && (
            <Pressable onPress={() => returnToSupervisor(r)} style={{ marginTop: 8 }}>
              <Text style={{ color: '#c0392b', fontWeight: '600', textAlign: 'center' }}>Return to supervisor for revision</Text>
            </Pressable>
            )}
            <DeleteRow r={r} />
          </View>
        ))
      )}

      <Pressable onPress={() => setOpenSec((m) => ({ ...m, bidding: !m.bidding }))}><Text style={[ui.label, { marginTop: 24, color: ACCENT, fontWeight: '700' }]}>{openSec.bidding ? '[-]' : '[+]'} Out for bid ({bidding.length})</Text></Pressable>
      {!openSec.bidding ? null : bidding.length === 0 ? (
        <Text style={ui.listSub}>No open bids.</Text>
      ) : (
        bidding.map((r) => {
          const rBids = bids[r.id] || [];
          return (
            <View key={r.id} style={[ui.card, { gap: 6 }]}>
              <View style={ui.line}>
                <Text style={ui.lineK}>ID</Text>
                <Text style={[ui.lineV, { color: ACCENT }]}>{r.trackingId || 'Not yet sent'}</Text>
              </View>
              <View style={ui.line}>
                <Text style={ui.lineK}>Address</Text>
                <Text style={ui.lineV}>{r.address}</Text>
              </View>
              <Text style={ui.listSub}>Open since {r.invitedAt ? fmt(r.invitedAt) : ''}</Text>

              <Pressable style={ui.btnOutline} onPress={() => router.push('/scope-review?id=' + r.id)}>
                <Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>View full scope & quote</Text>
              </Pressable>
              {canAct && (
              <Pressable onPress={() => returnToSupervisor(r)} style={{ marginTop: 4 }}>
                <Text style={{ color: '#c0392b', fontWeight: '600', textAlign: 'center' }}>Return to supervisor for revision</Text>
              </Pressable>
              )}

              <Pressable onPress={() => setOpenBids((m) => ({ ...m, [r.id]: !m[r.id] }))} style={{ marginTop: 6 }}>
                <Text style={[ui.label, { color: ACCENT, fontWeight: '700' }]}>{openBids[r.id] ? '[-]' : '[+]'} Bids ({rBids.length})</Text>
              </Pressable>
              {openBids[r.id] && (rBids.length === 0 ? (
                <Text style={ui.listSub}>No bids in yet.</Text>
              ) : (
                rBids.map((b) => (
                  <View key={b.id} style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, marginTop: 6, gap: 4 }}>
                    <View style={ui.line}>
                      <Text style={ui.lineK}>{b.vendorName}</Text>
                      <Text style={[ui.lineV, { fontWeight: '700' }]}>${b.amount}</Text>
                    </View>
                    {!!b.note && <Text style={ui.listSub}>{b.note}</Text>}
                    {canAct && (
                    <Pressable style={ui.btn} onPress={() => award(r, b.vendorName)}>
                      <Text style={ui.btnText}>Award to {b.vendorName}</Text>
                    </Pressable>
                    )}
                  </View>
                ))
              ))}
              <DeleteRow r={r} />
            </View>
          );
        })
      )}

      <Pressable onPress={() => setOpenSec((m) => ({ ...m, awarded: !m.awarded }))}><Text style={[ui.label, { marginTop: 24, color: ACCENT, fontWeight: '700' }]}>{openSec.awarded ? '[-]' : '[+]'} Awarded ({awarded.length})</Text></Pressable>
      {!openSec.awarded ? null : awarded.length === 0 ? (
        <Text style={ui.listSub}>Nothing awarded yet.</Text>
      ) : (
        awarded.map((r) => (
          <View key={r.id} style={[ui.card, { gap: 6 }]}>
            <View style={ui.line}>
              <Text style={ui.lineK}>ID</Text>
              <Text style={[ui.lineV, { color: ACCENT }]}>{r.trackingId || 'Not yet sent'}</Text>
            </View>
            <View style={ui.line}>
              <Text style={ui.lineK}>Address</Text>
              <Text style={ui.lineV}>{r.address}</Text>
            </View>
            <View style={ui.line}>
              <Text style={ui.lineK}>Vendor</Text>
              <Text style={ui.lineV}>{r.vendor}</Text>
            </View>
            <Text style={ui.listSub}>
              Awarded by {r.awardedBy || 'procurement'}  {r.awardedAt ? fmt(r.awardedAt) : ''}
            </Text>
            <Pressable style={ui.btnOutline} onPress={() => router.push('/scope-review?id=' + r.id)}>
              <Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>View full scope & quote</Text>
            </Pressable>

            <Text style={[ui.label, { marginTop: 6 }]}>Work quality</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['good', 'fair', 'poor'] as VendorPerformance[]).map((lvl) => {
                const on = perf[r.id] === lvl;
                const col = lvl === 'good' ? '#1E7D4F' : lvl === 'fair' ? '#B4741A' : '#C0392B';
                return (
                  <Pressable
                    key={lvl}
                    onPress={() => setPerf((m) => ({ ...m, [r.id]: lvl }))}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: col, backgroundColor: on ? col : '#fff', alignItems: 'center' }}
                  >
                    <Text style={{ color: on ? '#fff' : col, fontWeight: '600', textTransform: 'capitalize' }}>{lvl}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={ui.label}>Amount vendor charged</Text>
            <TextInput style={ui.input} value={charged[r.id] || ''} onChangeText={(t) => setCharged((m) => ({ ...m, [r.id]: t }))} placeholder="$" keyboardType="numeric" />

            <Text style={ui.label}>Deduction for poor work (optional)</Text>
            <TextInput style={ui.input} value={deduct[r.id] || ''} onChangeText={(t) => setDeduct((m) => ({ ...m, [r.id]: t }))} placeholder="$0" keyboardType="numeric" />
            {!!(parseFloat((deduct[r.id] || '0')) > 0) && (
              <TextInput style={ui.input} value={deductWhy[r.id] || ''} onChangeText={(t) => setDeductWhy((m) => ({ ...m, [r.id]: t }))} placeholder="Reason for the deduction" />
            )}
            {!!charged[r.id] && (
              <Text style={[ui.listSub, { marginTop: 2 }]}>
                Vendor paid ${Math.max(0, (parseFloat((charged[r.id] || '0').replace(/[^0-9.]/g, '')) || 0) - (parseFloat((deduct[r.id] || '0').replace(/[^0-9.]/g, '')) || 0))}
              </Text>
            )}

            {canAct && (
            <Pressable style={[ui.btn, { marginTop: 6 }]} onPress={() => rateClose(r)}>
              <Text style={ui.btnText}>Rate & close out</Text>
            </Pressable>
            )}
            <DeleteRow r={r} />
          </View>
        ))
      )}

      {closed.length > 0 && (
        <>
          <Pressable onPress={() => setOpenSec((m) => ({ ...m, closed: !m.closed }))}><Text style={[ui.label, { marginTop: 24, color: ACCENT, fontWeight: '700' }]}>{openSec.closed ? '[-]' : '[+]'} Closed / history ({closed.length})</Text></Pressable>
          {openSec.closed && closed.map((r) => (
            <View key={r.id} style={[ui.card, { gap: 4 }]}>
              <View style={ui.line}>
                <Text style={ui.lineK}>{r.trackingId || 'Not yet sent'}</Text>
                <Text style={ui.lineV}>{r.vendor || ''}</Text>
              </View>
              <Text style={ui.listSub}>{r.address}</Text>
              {!!r.closedAt && <Text style={ui.listSub}>Closed {fmt(r.closedAt)}</Text>}
              <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={() => router.push('/scope-review?id=' + r.id)}>
                <Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>View full scope & quote</Text>
              </Pressable>
              <DeleteRow r={r} />
            </View>
          ))}
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
