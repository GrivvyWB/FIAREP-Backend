import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  createViolationInspectionAssignment,
  listViolationLookups,
  deleteViolationLookup,
  listStaffAccounts,
  getCurrentActor,
  getCurrentPosition,
  type ViolationLookup,
  type StaffAccount,
  displayStaffPosition,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

export default function ViolationSend() {
  const router = useRouter();
  const { preAddress, preUnit, preNote, preComplaintNo, preResident, preDevelopment, filter } = useLocalSearchParams<{ preAddress?: string; preUnit?: string; preNote?: string; preComplaintNo?: string; preResident?: string; preDevelopment?: string; filter?: string }>();
  const [violationNumber, setViolationNumber] = useState('');
  const [address, setAddress] = useState(preAddress ? String(preAddress) : '');
  const [unit, setUnit] = useState(preUnit ? String(preUnit) : '');
  const [note, setNote] = useState(preNote ? String(preNote) : '');
  // Resident complaint context carried through so the inspector gets it too.
  const preComplaint = preComplaintNo ? String(preComplaintNo) : '';
  const preResidentName = preResident ? String(preResident) : '';
  const preDev = preDevelopment ? String(preDevelopment) : '';
  const [sentTo, setSentTo] = useState('');
  const [sentStaffId, setSentStaffId] = useState('');
  const [development, setDevelopment] = useState(preDev);
  const [lastSent, setLastSent] = useState('');
  const [openGroup, setOpenGroup] = useState<string>('');
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [sent, setSent] = useState<ViolationLookup[]>([]);
  const [me, setMe] = useState('');
  const canDelete = useDeletionPolicy();
  const [authorized, setAuthorized] = useState(false);
  const [assignedDevelopments, setAssignedDevelopments] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([getCurrentActor(), getCurrentPosition()]).then(([actor, position]) => {
      if (actor.role === 'management' && position.trim().toLowerCase() === 'supervisor inspector') setAuthorized(true);
      else router.replace('/management-home');
    }).catch(() => router.replace('/management-home'));
  }, [router]);

  const load = useCallback(() => {
    listStaffAccounts('approved').then(setStaff);
    listViolationLookups().then(setSent);
    getCurrentActor().then((a) => {
      setMe((a && a.name) || '');
      const devs = ((a as any)?.developments || []).filter((d: any) => typeof d === 'string' && d.trim());
      setAssignedDevelopments(devs);
      setDevelopment((current) => devs.some((d: string) => d.trim().toLowerCase() === String(current || '').trim().toLowerCase()) ? current : '');
    });
  }, []);
  useFocusEffect(useCallback(() => {
    if (authorized) load();
  }, [authorized, load]));

  // Inspectors and contractors are the people who go look a violation up.
  const _filter = (filter ? String(filter) : '').toLowerCase();
  const recipients = staff.filter((s) => {
    return s.role === 'inspector' &&
      String(s.position || '').trim().toLowerCase() === 'inspector' &&
      !!development &&
      (s.developments || []).some((d) => d.trim().toLowerCase() === development.trim().toLowerCase());
  });

  async function submit() {
    if (!violationNumber.trim()) { Alert.alert('Missing', 'Enter a violation number.'); return; }
    if (!address.trim()) { Alert.alert('Missing', 'Enter an address.'); return; }
    if (!sentTo.trim() || !sentStaffId.trim()) { Alert.alert('Missing', 'Choose an approved Inspector.'); return; }
    try {
      const to = sentTo;
      const assignment = await createViolationInspectionAssignment({
        assignedStaffId: sentStaffId,
        development: development || undefined,
        address: address.trim() + (unit.trim() ? ' Unit ' + unit.trim() : ''),
        instructions: [violationNumber.trim(), note.trim()].filter(Boolean).join(' — '),
        sourceInspectionRef: preComplaint || undefined,
      });
      // Keep the violation details so you can immediately send the same job to
      // another person (e.g. a plumber to meet the inspector). Only clear the
      // recipient and show a persistent confirmation.
      setSentTo('');
      setSentStaffId('');
      setLastSent((assignment.pendingSync ? 'Queued pending sync to ' : 'Sent to ') + to + ' \u00b7 ' + new Date().toLocaleTimeString());
      load();
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    }
  }

  if (!authorized) return null;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Send Violation</Text>

      <Text style={ui.label}>Violation number</Text>
      <TextInput
        style={ui.input}
        value={violationNumber}
        onChangeText={setViolationNumber}
        placeholder="e.g. V-104882"
        autoCapitalize="characters"
      />

      <Text style={[ui.label, { marginTop: 12 }]}>Address</Text>
      <TextInput
        style={ui.input}
        value={address}
        onChangeText={setAddress}
        placeholder="245 Main St., Brooklyn, NY 11213"
      />

      <Text style={[ui.label, { marginTop: 12 }]}>Unit (optional)</Text>
      <TextInput style={ui.input} value={unit} onChangeText={setUnit} placeholder="6J" />

      <Text style={[ui.label, { marginTop: 12 }]}>Note (optional)</Text>
      <TextInput
        style={[ui.input, { height: 80, textAlignVertical: 'top' }]}
        value={note}
        onChangeText={setNote}
        placeholder="What to check on site"
        multiline
      />

      <Text style={[ui.label, { marginTop: 12 }]}>Send to</Text>
      <Text style={ui.label}>Development</Text>
      {assignedDevelopments.map((d) => (
        <Pressable key={d} style={[ui.input, development === d && { borderColor: ACCENT, borderWidth: 2 }]} onPress={() => { setDevelopment(d); setSentTo(''); setSentStaffId(''); }}>
          <Text style={{ color: development === d ? ACCENT : '#000', fontWeight: '600' }}>{d}</Text>
        </Pressable>
      ))}
      {assignedDevelopments.length === 0 && <Text style={ui.empty}>No assigned developments.</Text>}
      {recipients.length === 0 ? (
        <Text style={ui.listSub}>No approved inspectors or workers yet.</Text>
      ) : (
        <View style={{ gap: 6 }}>
          {Array.from(new Set(recipients.map((r) => (r.position || 'Other')))).sort().map((pos) => {
            const people = recipients.filter((r) => (r.position || 'Other') === pos);
            const expanded = openGroup === pos;
            const hasPick = people.some((pp) => pp.name === sentTo);
            return (
              <View key={pos}>
                <Pressable
                  style={[ui.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, hasPick ? { borderColor: ACCENT, borderWidth: 2 } : null]}
                  onPress={() => setOpenGroup(expanded ? '' : pos)}
                >
                  <Text style={{ fontWeight: '600', color: hasPick ? ACCENT : '#000' }}>
                     {displayStaffPosition(pos)}{hasPick ? '  \u2713 ' + sentTo : '  (' + people.length + ')'}
                  </Text>
                  <Text style={{ color: '#666' }}>{expanded ? '\u25b2' : '\u25bc'}</Text>
                </Pressable>
                {expanded && (
                  <View style={{ marginLeft: 12, marginTop: 4, gap: 4 }}>
                    {people.map((s) => {
                      const active = sentTo === s.name;
                      return (
                        <Pressable
                          key={s.id}
                          style={[ui.input, active ? { borderColor: ACCENT, borderWidth: 2 } : null]}
                           onPress={() => { setSentTo(active ? '' : s.name); setSentStaffId(active ? '' : s.id); }}
                        >
                          <Text style={{ color: active ? ACCENT : '#000' }}>{s.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Pressable style={[ui.btn, { marginTop: 16 }]} onPress={submit}>
        <Text style={ui.btnText}>Send violation</Text>
      </Pressable>
      {!!lastSent && <Text style={{ color: '#1a8f4c', fontWeight: '700', textAlign: 'center', marginTop: 8 }}>\u2713 {lastSent}. Pick another person to send again.</Text>}

      <Text style={[ui.label, { marginTop: 24 }]}>Recently sent</Text>
      {sent.length === 0 ? (
        <Text style={ui.listSub}>Nothing sent yet.</Text>
      ) : (
        sent.slice(0, 20).map((v) => (
          <Pressable key={v.id} onLongPress={() => { if (!canDelete) return; Alert.alert('Delete this record?', 'Violation ' + v.violationNumber + ' \u2014 ' + v.address, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteViolationLookup(v.id); listViolationLookups().then(setSent); } }]); }} style={[ui.card, { gap: 4 }]}>
            <View style={ui.line}>
              <Text style={ui.lineK}>Violation</Text>
              <Text style={ui.lineV}>{v.violationNumber}</Text>
            </View>
            <View style={ui.line}>
              <Text style={ui.lineK}>Address</Text>
              <Text style={ui.lineV}>{v.address}{v.unit ? '  Unit ' + v.unit : ''}</Text>
            </View>
            <View style={ui.line}>
              <Text style={ui.lineK}>Sent to</Text>
              <Text style={ui.lineV}>{v.sentTo}</Text>
            </View>
            <Text style={ui.listSub}>
              {fmt(v.sentAt)}{v.acknowledgedAt ? '  acknowledged' : '  awaiting pickup'}
            </Text>
          </Pressable>
        ))
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
