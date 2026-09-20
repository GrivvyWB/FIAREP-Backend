import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  createProcurementRequest,
  updateScopeDraft,
  submitScopeForApproval,
  listReturnedScopes,
  listViolationLookups,
  type ViolationLookup,
  getProcurementRequest,
  getCurrentActor,
  getCurrentPosition,
  type ProcurementRequest,
} from '../lib/store';
import { pickDocument } from '../lib/files';
import { ui, ACCENT } from '../lib/ui';
import AddressInput from '../components/AddressInput';
import { useAppMode } from './_layout';

export default function ScopeSubmit() {
  const router = useRouter();
  const { mode } = useAppMode();
  const { openId, preAddress, preScope } = useLocalSearchParams<{ openId?: string; preAddress?: string; preScope?: string }>();
  const [prefilled, setPrefilled] = useState(false);
  const [address, setAddress] = useState('');
  const [scope, setScope] = useState('');
  const [cpmNotes, setCpmNotes] = useState('');
  const [me, setMe] = useState('');
  const [draft, setDraft] = useState<ProcurementRequest | null>(null);
  const [returned, setReturned] = useState<ProcurementRequest[]>([]);
  const [violations, setViolations] = useState<ViolationLookup[]>([]);
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  useFocusEffect(useCallback(() => {
    getCurrentPosition().then((position) => {
       const allowed = position.trim().toLowerCase() === 'cpm';
      if (!allowed) router.replace(mode === 'management' ? '/management-home' : '/cpm-home');
      setAuthorized(allowed);
    }).catch(() => router.replace(mode === 'management' ? '/management-home' : '/cpm-home'));
  }, [mode, router]));

  const load = useCallback(() => {
    getCurrentActor().then(async (a) => {
      const nm = (a && a.name) || '';
      setMe(nm);
      if (nm) setReturned(await listReturnedScopes(nm));
      if (nm) setViolations(await listViolationLookups(nm));
    });
    if (openId) {
      getProcurementRequest(openId).then((r) => { if (r) setDraft(r); });
    } else if (!prefilled && (preAddress || preScope)) {
      if (preAddress) setAddress(String(preAddress));
      if (preScope) setScope(String(preScope));
      setPrefilled(true);
    }
  }, [openId, preAddress, preScope, prefilled]);
  useFocusEffect(load);

  async function saveDraft() {
    if (!address.trim()) { Alert.alert('Missing', 'Enter an address.'); return; }
    if (!scope.trim()) { Alert.alert('Missing', 'Describe the scope of work.'); return; }
    setBusy(true);
    try {
      if (draft) {
        const r = await updateScopeDraft(draft.id, draft.address, draft.scope, draft.cpmNotes);
        if (r) setDraft(r);
      } else {
        const r = await createProcurementRequest('', address, scope, me, '', '', cpmNotes);
        setDraft(r);
      }
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function attachFile() {
    if (!draft) return;
    try {
      const f = await pickDocument();
      if (!f) return;
      setDraft({ ...draft, scopeFile: f.path, scopeFileName: f.name });
      Alert.alert('Attached', f.name + '\n\nStored on this device.');
    } catch (e: any) {
      Alert.alert('Attach failed', String(e && e.message ? e.message : e));
    }
  }

  async function send() {
    if (!draft) return;
    setBusy(true);
    try {
      await submitScopeForApproval(draft.id, draft.scopeFile || '', draft.scopeFileName || '', draft.address || '', draft.scope || '');
      Alert.alert('Sent for approval', 'Your scope was sent to management for approval.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (!authorized) return null;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Submit Scope</Text>

      {!draft ? (
        <>
          {violations.length > 0 && (
            <View style={{ marginBottom: 18 }}>
              <Text style={[ui.label, { fontWeight: '700' }]}>Start from an inspection</Text>
              {violations.slice(0, 8).map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => { setAddress(v.address + (v.unit ? '  Unit ' + v.unit : '')); setScope(v.note ? v.note : ''); }}
                  onLongPress={() => { Alert.alert('Can\'t remove this', 'This inspection stays until management or your supervisor removes it (from Send Violation).'); }}
                  style={{ borderWidth: 1, borderColor: ACCENT, borderRadius: 10, padding: 12, marginTop: 8 }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: ACCENT }}>{v.violationNumber}</Text>
                  <Text style={{ fontSize: 14 }}>{v.address}{v.unit ? '  Unit ' + v.unit : ''}</Text>
                  {!!v.note && <Text style={ui.listSub}>{v.note}</Text>}
                </Pressable>
              ))}
            </View>
          )}
          {returned.length > 0 && (
            <View style={{ marginBottom: 18 }}>
              <Text style={[ui.label, { color: '#c0392b', fontWeight: '700' }]}>Returned for revision ({returned.length})</Text>
              {returned.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => setDraft(r)}
                  style={{ borderWidth: 1, borderColor: '#c0392b', borderRadius: 10, padding: 12, marginTop: 8 }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600' }}>{r.address}</Text>
                  {!!r.returnNote && <Text style={{ fontSize: 13, color: '#c0392b', marginTop: 4 }}>Note: {r.returnNote}</Text>}
                  <Text style={{ fontSize: 12, color: ACCENT, marginTop: 6, fontWeight: '600' }}>Tap to reopen & fix</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={ui.label}>Address</Text>
          <AddressInput value={address} onChangeText={setAddress} placeholder="245 Main St., Brooklyn, NY 11213" />

          <Text style={[ui.label, { marginTop: 12 }]}>Scope of work</Text>
          <TextInput style={[ui.input, { height: 100, textAlignVertical: 'top' }]} value={scope} onChangeText={setScope} placeholder="Describe the work" multiline />

          <Text style={[ui.label, { marginTop: 12 }]}>CPM notes (your own)</Text>
          <TextInput style={[ui.input, { height: 80, textAlignVertical: 'top' }]} value={cpmNotes} onChangeText={setCpmNotes} placeholder="Your notes \u2014 does not change the inspector's violation notes above" multiline />

          <Pressable style={[ui.btn, { marginTop: 16 }, busy && { opacity: 0.6 }]} onPress={saveDraft} disabled={busy}>
            <Text style={ui.btnText}>Save & build quote</Text>
          </Pressable>
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={ui.label}>Address</Text>
          <AddressInput value={draft.address} onChangeText={(t) => setDraft({ ...draft, address: t })} placeholder="245 Main St., Brooklyn, NY 11213" />
          <Text style={[ui.label, { marginTop: 8 }]}>Scope of work</Text>
          <TextInput style={[ui.input, { height: 100, textAlignVertical: 'top' }]} value={draft.scope} onChangeText={(t) => setDraft({ ...draft, scope: t })} placeholder="Describe the work" multiline />

          <Text style={[ui.label, { marginTop: 8 }]}>CPM notes (your own)</Text>
          <TextInput style={[ui.input, { height: 80, textAlignVertical: 'top' }]} value={draft.cpmNotes || ''} onChangeText={(t) => setDraft({ ...draft, cpmNotes: t })} placeholder="Your notes \u2014 does not change the inspector's violation notes above" multiline />

          <Text style={[ui.label, { marginTop: 10 }]}>Quote tools</Text>
          <Pressable style={ui.btnOutline} onPress={() => router.push('/project/checklist?projectId=' + draft.id)}>
            <Text style={ui.btnOutlineText}>Renovation checklist</Text>
          </Pressable>
          <Pressable style={ui.btnOutline} onPress={() => router.push('/project/estimate?projectId=' + draft.id)}>
            <Text style={ui.btnOutlineText}>Nature of Work & Cost Estimate</Text>
          </Pressable>
          <Pressable style={ui.btnOutline} onPress={() => router.push('/project/project-scope?projectId=' + draft.id)}>
            <Text style={ui.btnOutlineText}>Scope of Work (Divisions)</Text>
          </Pressable>
          <Pressable style={ui.btnOutline} onPress={() => router.push('/project/elevator?projectId=' + draft.id)}>
            <Text style={ui.btnOutlineText}>Elevator Services</Text>
          </Pressable>

          <Pressable style={[ui.btnOutline, { marginTop: 6 }]} onPress={attachFile}>
            <Text style={ui.btnOutlineText}>{draft.scopeFile ? 'Replace scope file' : 'Attach scope file'}</Text>
          </Pressable>
          {!!draft.scopeFile && (
            <>
              <Text style={ui.label}>Attachment name</Text>
              <TextInput
                style={ui.input}
                value={draft.scopeFileName || ''}
                onChangeText={(t) => setDraft({ ...draft, scopeFileName: t })}
                placeholder="Name this document (e.g. Kitchen scope.pdf)"
              />
            </>
          )}

          <Pressable style={[ui.btn, { marginTop: 16 }, busy && { opacity: 0.6 }]} onPress={send} disabled={busy}>
            <Text style={ui.btnText}>Send to management for approval</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
