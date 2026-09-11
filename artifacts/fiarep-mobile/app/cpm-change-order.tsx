import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, Image, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getCurrentActor, listProjects, listProcurementRequests, createChangeOrder } from '../lib/store';
import { takePhoto, pickPhoto, photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';

export default function CpmChangeOrder() {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [address, setAddress] = useState('');
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    (async () => {
      const a = await getCurrentActor();
      const me = (a && a.name || '').trim().toLowerCase();
      const projects = await listProjects().catch(() => []);
      const scopes = await listProcurementRequests().catch(() => []);
      const set: Record<string, boolean> = {};
      const out: string[] = [];
      const push = (addr?: string) => {
        const v = (addr || '').trim();
        if (!v) return;
        const k = v.toLowerCase();
        if (!set[k]) { set[k] = true; out.push(v); }
      };
      // Projects (name is the address/label)
      for (const p of projects) push(p.name);
      // This CPM's scopes
      for (const r of scopes) {
        if ((r.requestedBy || '').trim().toLowerCase() === me) push(r.address);
      }
      out.sort();
      setAddresses(out);
    })();
  }, []);
  useFocusEffect(load);

  async function submit() {
    if (!address.trim()) { Alert.alert('Pick an address', 'Choose the job address first.'); return; }
    if (!desc.trim()) { Alert.alert('Describe the change', 'Enter what add-on work is needed.'); return; }
    const costNum = parseFloat(String(cost).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(costNum) || costNum <= 0) { Alert.alert('Cost required', 'Enter the cost of the change (materials + labor + markup).'); return; }
    setBusy(true);
    try {
      await createChangeOrder('', address.trim(), '', '', desc.trim(), costNum, photos);
      setDesc(''); setCost(''); setPhotos([]);
      Alert.alert('Change order submitted', 'Sent to management for approval.');
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Could not submit.'); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Change Work Order</Text>
      <Text style={ui.label}>Pick an address you've worked, then submit an add-on with its cost to management.</Text>

      <Text style={[ui.label, { marginTop: 8 }]}>Job address</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Pressable style={[ui.input, { flex: 1 }]} onPress={() => setPicker(true)}>
          <Text style={{ color: address ? '#000' : '#999' }}>{address || 'Search by address or ID'}</Text>
        </Pressable>
        <Pressable style={ui.btnOutline} onPress={() => setPicker(true)}>
          <Text style={{ color: ACCENT, fontWeight: '600' }}>Addresses</Text>
        </Pressable>
      </View>

      <Text style={[ui.label, { marginTop: 12 }]}>Describe the change</Text>
      <TextInput style={[ui.input, { minHeight: 70, textAlignVertical: 'top' }]} value={desc} onChangeText={setDesc} placeholder="Add-on work needed" multiline />

      <Text style={[ui.label, { marginTop: 8 }]}>Cost of change (materials + labor + markup)</Text>
      <TextInput style={ui.input} value={cost} onChangeText={setCost} placeholder="$" keyboardType="numeric" />

      <Text style={[ui.label, { marginTop: 8 }]}>Photos (optional)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {photos.map((uri, i) => (
          <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewer(uri)}>
            <RemotePhoto localUri={uri} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#eee' }} />
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await takePhoto(); if (u) setPhotos((p) => [...p, u]); } catch (e: any) { Alert.alert('Camera', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Take photo</Text></Pressable>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={async () => { try { const u = await pickPhoto(); if (u) setPhotos((p) => [...p, u]); } catch (e: any) { Alert.alert('Photos', String(e && e.message ? e.message : e)); } }}><Text style={ui.btnOutlineText}>Add from library</Text></Pressable>
      </View>

      <Pressable style={[ui.btn, { marginTop: 16 }, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={ui.btnText}>Submit change order to management</Text>
      </Pressable>
      <View style={{ height: 40 }} />

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Addresses you've worked</Text>
            <ScrollView>
              {addresses.length === 0 && <Text style={[ui.listSub, { padding: 16 }]}>No addresses found yet.</Text>}
              {addresses.map((a, i) => (
                <Pressable key={i} onPress={() => { setAddress(a); setPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15 }}>{a}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setPicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

      <PhotoViewer uri={viewer} onClose={() => setViewer(null)} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
