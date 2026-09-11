import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform, Image, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getCurrentActor, listChangeOrders, approveChangeOrderMgmt, approveChangeOrderProcurement, declineChangeOrder, resubmitChangeOrder, findScopeForChangeOrder, type ChangeOrder } from '../lib/store';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';
import { takePhoto, pickPhoto, photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<string, { label: string; color: string }> = {
  submitted: { label: 'Awaiting management', color: '#B4741A' },
  mgmt_approved: { label: 'Awaiting procurement (cost)', color: '#B4741A' },
  cost_approved: { label: 'Cost approved', color: '#1a8f4c' },
  declined: { label: 'Declined', color: '#c0392b' },
};

export default function ChangeOrders() {
  const { mode } = useAppMode();
  const router = useRouter();
  const [items, setItems] = useState<ChangeOrder[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({ action: true });
  const toggleSec = (k: string) => setOpen((m) => ({ ...m, [k]: !m[k] }));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [me, setMe] = useState<{ role: string; name: string }>({ role: '', name: '' });
  const [viewer, setViewer] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [eDesc, setEDesc] = useState('');
  const [eCost, setECost] = useState('');
  const [ePhotos, setEPhotos] = useState<string[]>([]);

  const load = useCallback(() => {
    (async () => {
      const a = await getCurrentActor();
      setMe(a);
      const all = await listChangeOrders();
      setItems(all.sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || '')));
    })();
  }, [mode]);
  useFocusEffect(load);

  const isMgmt = mode === 'management' || mode === 'administrator';
  const isProcurement = mode === 'procurement';

  async function mgmtApprove(co: ChangeOrder) {
    try { await approveChangeOrderMgmt(co.id); load(); Alert.alert('Approved', 'Sent to procurement for cost approval.'); }
    catch (e: any) { Alert.alert('Failed', e?.message ?? 'Error'); }
  }
  async function procApprove(co: ChangeOrder) {
    try { await approveChangeOrderProcurement(co.id); load(); Alert.alert('Cost approved', 'The change work order is approved.'); }
    catch (e: any) { Alert.alert('Failed', e?.message ?? 'Error'); }
  }
  function openEdit(co: ChangeOrder) {
    setEditId(co.id); setEDesc(co.description || ''); setECost(String(co.cost || '')); setEPhotos(Array.isArray(co.photos) ? co.photos : []);
  }
  async function resubmit(co: ChangeOrder) {
    const costNum = parseFloat(String(eCost).replace(/[^0-9.]/g, ''));
    if (!eDesc.trim()) { Alert.alert('Describe the change', 'Enter the corrected work.'); return; }
    if (!Number.isFinite(costNum) || costNum <= 0) { Alert.alert('Cost required', 'Enter the cost.'); return; }
    try {
      await resubmitChangeOrder(co.id, eDesc.trim(), costNum, ePhotos);
      setEditId(null); load();
      Alert.alert('Resubmitted', 'Sent back to management for review.');
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Error'); }
  }
  async function viewOriginalScope(co: ChangeOrder) {
    const req = await findScopeForChangeOrder(co.reportId, co.reportRef).catch(() => null);
    if (req) router.push('/scope-review?id=' + req.id);
    else Alert.alert('No linked scope', 'Could not find the original scope for this change order. Verify the address or work order.');
  }
  async function decline(co: ChangeOrder) {
    try { await declineChangeOrder(co.id, reasons[co.id] || ''); setReasons((m) => ({ ...m, [co.id]: '' })); load(); }
    catch (e: any) { Alert.alert('Failed', e?.message ?? 'Error'); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Change Work Orders</Text>
      <Text style={ui.label}>Add-on work with its cost impact. Flow: submitted → management approves → procurement approves the cost.</Text>
      {items.length === 0 && <Text style={ui.empty}>No change work orders.</Text>}
      {(() => {
      const needsAction = items.filter((c) => c.status === 'submitted' || c.status === 'mgmt_approved');
      const history = items.filter((c) => c.status === 'cost_approved' || c.status === 'declined');
      const renderCO = (co: ChangeOrder) => {
        const st = STATUS[co.status] || { label: co.status, color: '#666' };
        const canMgmt = isMgmt && co.status === 'submitted';
        const canProc = isProcurement && co.status === 'mgmt_approved';
        return (
          <Pressable key={co.id} style={[ui.card, { gap: 6 }]} onPress={() => co.reportId && router.push('/report-detail?id=' + co.reportId)}>
            <View style={ui.line}><Text style={ui.lineK}>Job</Text><Text style={ui.lineV}>{co.reportRef}</Text></View>
            <View style={ui.line}><Text style={ui.lineK}>For</Text><Text style={ui.lineV}>{co.targetName || co.targetPosition}</Text></View>
            <Text style={{ fontSize: 14, color: '#333' }}>{co.description}</Text>
            <View style={ui.line}><Text style={[ui.lineK, { fontWeight: '700', color: '#000' }]}>Cost of change</Text><Text style={[ui.lineV, { fontWeight: '700' }]}>{money(co.cost)}</Text></View>
            {(isMgmt || isProcurement) && (
              <Pressable style={[ui.btnOutline, { marginTop: 2 }]} onPress={() => viewOriginalScope(co)}>
                <Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>View original scope</Text>
              </Pressable>
            )}
            <Text style={{ fontSize: 12, color: '#999' }}>{fmt(co.createdAt)}{co.createdByName ? ' \u00b7 ' + co.createdByName : ''}</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: st.color }}>{st.label}{co.respondedByName ? ' \u00b7 ' + co.respondedByName : ''}</Text>
            {!!co.reason && <Text style={{ fontSize: 13, color: '#c0392b' }}>Reason: {co.reason}</Text>}
            {co.status === 'declined' && (me.name && co.createdByName === me.name) && (
              editId === co.id ? (
                <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, gap: 6 }}>
                  <Text style={ui.label}>Corrected description</Text>
                  <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} value={eDesc} onChangeText={setEDesc} multiline />
                  <Text style={ui.label}>Cost</Text>
                  <TextInput style={ui.input} value={eCost} onChangeText={setECost} placeholder="$" keyboardType="numeric" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {ePhotos.map((uri, i) => (
                      <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
                        <RemotePhoto localUri={uri} style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#eee' }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await takePhoto(); if (u) setEPhotos((p) => [...p, u]); } catch (e: any) { Alert.alert('Camera', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Take photo</Text></Pressable>
                    <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await pickPhoto(); if (u) setEPhotos((p) => [...p, u]); } catch (e: any) { Alert.alert('Photos', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Add photo</Text></Pressable>
                  </View>
                  <Pressable style={ui.btn} onPress={() => resubmit(co)}><Text style={ui.btnText}>Resubmit to management</Text></Pressable>
                  <Pressable onPress={() => setEditId(null)}><Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>Cancel</Text></Pressable>
                </View>
              ) : (
                <Pressable style={[ui.btn, { marginTop: 4 }]} onPress={() => openEdit(co)}><Text style={ui.btnText}>Edit & resubmit</Text></Pressable>
              )
            )}
            {Array.isArray(co.photos) && co.photos.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {co.photos.map((uri, i) => (
                  <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
                    <RemotePhoto localUri={uri} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#eee' }} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {(canMgmt || canProc) && (
              <>
                <TextInput style={ui.input} value={reasons[co.id] || ''} onChangeText={(t) => setReasons((m) => ({ ...m, [co.id]: t }))} placeholder="Decline reason (optional)" />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {canMgmt && <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => mgmtApprove(co)}><Text style={ui.btnText}>Approve & send to procurement</Text></Pressable>}
                  {canProc && <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => procApprove(co)}><Text style={ui.btnText}>Approve cost</Text></Pressable>}
                  <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#c0392b' }]} onPress={() => decline(co)}><Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Decline</Text></Pressable>
                </View>
              </>
            )}
          </Pressable>
        );
      };
      return (<>
        <Pressable onPress={() => toggleSec('action')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, backgroundColor: '#f2f7fb', borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{open['action'] ? '\u2013' : '+'}  Needs action</Text>
          <Text style={{ fontSize: 13, color: '#667085' }}>{needsAction.length}</Text>
        </Pressable>
        {open['action'] && needsAction.map(renderCO)}
        <Pressable onPress={() => toggleSec('history')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, backgroundColor: '#f2f7fb', borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{open['history'] ? '\u2013' : '+'}  History</Text>
          <Text style={{ fontSize: 13, color: '#667085' }}>{history.length}</Text>
        </Pressable>
        {open['history'] && history.map(renderCO)}
      </>);
      })()}
      <PhotoViewer uri={viewer} onClose={() => setViewer(null)} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
