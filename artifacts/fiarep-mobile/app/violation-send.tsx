import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  createViolationInspectionAssignment,
  assignResidentReport,
  createEmergencyJob,
  listViolationLookups,
  deleteViolationLookup,
  listStaffAccounts,
  getCurrentActor,
  getCurrentPosition,
  getSessionIdentity,
  listDevelopmentNames,
  supervisedTradeFor,
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
  const { preAddress, preReportId, preUnit, preNote, preComplaintNo, preResident, preDevelopment, filter } = useLocalSearchParams<{ preAddress?: string; preReportId?: string; preUnit?: string; preNote?: string; preComplaintNo?: string; preResident?: string; preDevelopment?: string; filter?: string }>();
  const [violationNumber, setViolationNumber] = useState('');
  const [address, setAddress] = useState(preAddress ? String(preAddress) : '');
  const [unit, setUnit] = useState(preUnit ? String(preUnit) : '');
  const [note, setNote] = useState(preNote ? String(preNote) : '');
  // Resident complaint context carried through so the inspector gets it too.
  const preComplaint = preComplaintNo ? String(preComplaintNo) : '';
  const reportId = preReportId ? String(preReportId) : '';
  const preResidentName = preResident ? String(preResident) : '';
  const preDev = preDevelopment ? String(preDevelopment) : '';
  const [sentTo, setSentTo] = useState('');
  const [sentStaffId, setSentStaffId] = useState('');
  const [sentRole, setSentRole] = useState('');
  const [development, setDevelopment] = useState(preDev);
  const [lastSent, setLastSent] = useState('');
  const [openGroup, setOpenGroup] = useState<string>('');
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [sent, setSent] = useState<ViolationLookup[]>([]);
  const [me, setMe] = useState('');
  const [myId, setMyId] = useState('');
  const canDelete = useDeletionPolicy();
  const [authorized, setAuthorized] = useState(false);
  const [sending, setSending] = useState(false);
  const [assignedDevelopments, setAssignedDevelopments] = useState<string[]>([]);
  const [devOpen, setDevOpen] = useState(false);
  const [devQuery, setDevQuery] = useState('');
  const devFiltered = useMemo(() => {
    const q = devQuery.trim().toLowerCase();
    return q ? assignedDevelopments.filter((d) => d.toLowerCase().includes(q)) : assignedDevelopments;
  }, [assignedDevelopments, devQuery]);
  const complaintMode = String(filter || '').toLowerCase() === 'worker';
  // In violation mode the sender picks who receives it.
  const [violationTarget, setViolationTarget] = useState<'inspector' | 'supervisor-inspector' | 'trade'>('inspector');
  const [currentPosition, setCurrentPosition] = useState('');

  useEffect(() => {
    Promise.all([getCurrentActor(), getCurrentPosition()]).then(([actor, position]) => {
      setCurrentPosition(position);
      // Complaints and violations may both be sent by management/administration
      // (development supervisors, Superintendent E, Supervisor Inspector, etc.).
      if (actor.role === 'management' || actor.role === 'administrator') setAuthorized(true);
      else router.replace('/management-home');
    }).catch(() => router.replace('/management-home'));
  }, [complaintMode, router]);

  const load = useCallback(() => {
    listStaffAccounts('approved').then(setStaff);
    listViolationLookups().then(setSent);
    Promise.all([getCurrentActor(), getSessionIdentity()]).then(([a, si]) => {
      setMe((a && a.name) || '');
      setMyId((a && a.id) || (si as any)?.staffId || '');
      // Developments live on the signed-in staff session, not the lightweight
      // actor object (which omits them and left this list empty). Org-wide
      // managers (no assigned developments) fall back to the full list so they
      // can still pick a site.
      const assigned = ((si as any)?.developments || []).filter((d: any) => typeof d === 'string' && d.trim());
      const devs = assigned.length ? assigned : listDevelopmentNames();
      setAssignedDevelopments(devs);
      // Snap to the canonical list spelling (reports may carry UPPERCASE).
      setDevelopment((current) => devs.find((d: string) => d.trim().toLowerCase() === String(current || '').trim().toLowerCase()) || '');
    });
  }, []);
  useFocusEffect(useCallback(() => {
    if (authorized) load();
  }, [authorized, load]));

  // Inspectors and contractors are the people who go look a violation up.
  const recipients = staff.filter((s) => {
    if (myId && s.id === myId) return false; // a supervisor cannot send work to themselves
    if (complaintMode) {
      const eligibleRole = ['management', 'worker', 'inspector', 'emergency'].includes(s.role);
      const eligiblePosition = s.position !== 'Borough Director' && s.position !== 'Superintendent Ⓔ' && s.position !== 'Director';
      const inDevelopment = !!development &&
        (s.developments || []).some((d) => d.trim().toLowerCase() === development.trim().toLowerCase());
      // Trade supervisors (incl. CPM Supervisor) may only assign their own
      // trade's crew; the server rejects anyone else (canAssignStaff).
      const myTrade = supervisedTradeFor(currentPosition);
      if (myTrade && (s.position !== myTrade || !['worker', 'inspector', 'emergency'].includes(s.role))) return false;
      return eligibleRole && eligiblePosition &&
        (currentPosition === 'Superintendent Ⓔ' || inDevelopment);
    }
    // Violation mode: recipient set depends on the chosen target.
    const pos = String(s.position || '').trim().toLowerCase();
    const inDev = !!development &&
      (s.developments || []).some((d) => d.trim().toLowerCase() === development.trim().toLowerCase());
    if (violationTarget === 'inspector') {
      return s.role === 'inspector' && pos === 'inspector' &&
        (currentPosition === 'Superintendent Ⓔ' || inDev);
    }
    if (violationTarget === 'supervisor-inspector') {
      return s.role === 'management' && pos === 'supervisor inspector';
    }
    // Trade supervisors are office-based (no development requirement).
    const TRADE_SUP = /^(plumber|plumbing|electric|electrical|electrician|elevator|elevator service|painter|carpenter|roofer|heating|heating service|bricklayer|mason|general construction|cctv installation)( service)? supervisor$/;
    return s.role === 'management' && TRADE_SUP.test(pos);
  });

  async function submit() {
    if (sending) return; // block double-tap while a send is in flight
    if (!complaintMode && !violationNumber.trim()) { Alert.alert('Missing', 'Enter a violation number.'); return; }
    if (!address.trim()) { Alert.alert('Missing', 'Enter an address.'); return; }
    if (!sentTo.trim() || !sentStaffId.trim()) {
      Alert.alert('Missing', complaintMode ? 'Choose an approved staff member.' : (violationTarget === 'trade' ? 'Choose a trade supervisor.' : violationTarget === 'supervisor-inspector' ? 'Choose a Supervisor Inspector.' : 'Choose an approved Inspector.'));
      return;
    }
    if (complaintMode && (!reportId || !preComplaint)) {
      Alert.alert('Missing', 'The complaint ID is unavailable.');
      return;
    }
    setSending(true);
    try {
      const to = sentTo;
      // When a supervisor sends a complaint to an EMERGENCY worker, also create
      // an emergency-unit job so it lands on that worker's Emergency Units
      // screen (not only My Jobs).
      if (complaintMode && sentRole === 'emergency') {
        await createEmergencyJob(
          '',                                   // truck: unknown from a complaint
          development.trim(),
          address.trim() + (unit.trim() ? ' Unit ' + unit.trim() : ''),
          note.trim() || ('Complaint ' + preComplaint),
          '',                                   // location in building
          '',                                   // no registered unit id
          sentStaffId,
        ).catch(() => undefined);
      }
      const assignment = complaintMode
        ? await assignResidentReport(reportId, sentStaffId, to)
        : await createViolationInspectionAssignment({
            assignedStaffId: sentStaffId,
            development: development || undefined,
            address: address.trim() + (unit.trim() ? ' Unit ' + unit.trim() : ''),
            instructions: [
              violationNumber.trim() ? 'Violation #: ' + violationNumber.trim() : '',
              preComplaint ? 'Complaint #: ' + preComplaint : '',
              note.trim() ? 'Note: ' + note.trim() : '',
            ].filter(Boolean).join('\n'),
            sourceInspectionRef: violationNumber.trim() || preComplaint || undefined,
          });
      // Keep the violation details so you can immediately send the same job to
      // another person (e.g. a plumber to meet the inspector). Only clear the
      // recipient and show a persistent confirmation.
      setSentTo('');
      setSentStaffId('');
      setSentRole('');
      const queued = !complaintMode && Boolean((assignment as any)?.pendingSync);
      setLastSent((queued ? 'Queued pending sync to ' : 'Sent to ') + to + ' \u00b7 ' + new Date().toLocaleTimeString());
      load();
    } catch (e: any) {
      Alert.alert('Error', String(e && e.message ? e.message : e));
    } finally {
      setSending(false);
    }
  }

  if (!authorized) return null;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>{complaintMode ? 'Send Complaint' : 'Send Violation'}</Text>

      {complaintMode ? (
        <>
          <Text style={ui.label}>Complaint number</Text>
          <View style={ui.input}><Text>{preComplaint}</Text></View>
        </>
      ) : (
        <>
          <Text style={ui.label}>Violation number</Text>
          <TextInput
            style={ui.input}
            value={violationNumber}
            onChangeText={setViolationNumber}
            placeholder="e.g. V-104882"
            autoCapitalize="characters"
          />
          {!!preComplaint && (
            <View style={{ marginTop: 8 }}>
              <Text style={ui.label}>Complaint number (attached)</Text>
              <View style={ui.input}><Text style={{ color: '#185FA5', fontWeight: '700' }}>{preComplaint}</Text></View>
            </View>
          )}
        </>
      )}

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
      {!complaintMode && (
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
          {([['inspector','Inspector'],['supervisor-inspector','Supervisor Inspector'],['trade','Trade supervisor']] as const).map(([key,lbl]) => (
            <Pressable
              key={key}
              style={[ui.btnOutline, { flex: 1, paddingVertical: 8 }, violationTarget === key && ui.btn]}
              onPress={() => { setViolationTarget(key); setSentTo(''); setSentStaffId(''); }}
            >
              <Text style={[violationTarget === key ? ui.btnText : ui.btnOutlineText, { fontSize: 12, textAlign: 'center' }]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={ui.label}>Development</Text>
      <Pressable
        testID="violation-send-development"
        style={[ui.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, !!development && { borderColor: ACCENT, borderWidth: 2 }]}
        onPress={() => setDevOpen((open) => !open)}
      >
        <Text style={{ color: development ? ACCENT : '#999', fontWeight: '600', flex: 1 }}>{development || 'Select development'}</Text>
        <Text style={{ color: '#666', fontSize: 14 }}>{devOpen ? '▲' : '▼'}</Text>
      </Pressable>
      {devOpen && (
        <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, marginBottom: 8, gap: 6 }}>
          {assignedDevelopments.length > 8 && (
            <TextInput style={ui.input} value={devQuery} onChangeText={setDevQuery} placeholder="Search developments..." autoCorrect={false} />
          )}
          <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {devFiltered.map((d) => (
              <Pressable
                key={d}
                style={{ paddingVertical: 10, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#eee' }}
                onPress={() => { setDevelopment(d); setSentTo(''); setSentStaffId(''); setDevOpen(false); setDevQuery(''); }}
              >
                <Text style={{ color: development === d ? ACCENT : '#000', fontWeight: development === d ? '700' : '500' }}>{d}</Text>
              </Pressable>
            ))}
            {devFiltered.length === 0 && <Text style={ui.empty}>No matches.</Text>}
          </ScrollView>
        </View>
      )}
      {assignedDevelopments.length === 0 && <Text style={ui.empty}>No assigned developments.</Text>}
      {recipients.length === 0 ? (
        <Text style={ui.listSub}>{complaintMode ? 'No approved staff yet.' : (violationTarget === 'trade' ? 'No approved trade supervisors yet.' : violationTarget === 'supervisor-inspector' ? 'No approved Supervisor Inspector yet.' : 'No approved inspectors yet.')}</Text>
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
                     {displayStaffPosition(pos)}{hasPick ? '  ' + sentTo : '  (' + people.length + ')'}
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
                           onPress={() => { setSentTo(active ? '' : s.name); setSentStaffId(active ? '' : s.id); setSentRole(active ? '' : (s.role || '')); }}
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

      <Pressable
        style={[ui.btn, { marginTop: 16 }, sending && { opacity: 0.5 }]}
        onPress={submit}
        disabled={sending}
      >
        <Text style={ui.btnText}>{sending ? 'Sending\u2026' : (complaintMode ? 'Send complaint' : 'Send violation')}</Text>
      </Pressable>
      {!!lastSent && <Text style={{ color: '#1a8f4c', fontWeight: '700', textAlign: 'center', marginTop: 8 }}>{lastSent}. Pick another person to send again.</Text>}

      {!complaintMode && <Text style={[ui.label, { marginTop: 24 }]}>Recently sent</Text>}
      {!complaintMode && (sent.length === 0 ? (
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
      ))}
    </ScrollView>
    {sending && (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.15)', alignItems: 'center', justifyContent: 'center' }} pointerEvents="auto">
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 20, alignItems: 'center', gap: 10 }}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={{ fontWeight: '600', color: '#333' }}>Sending\u2026</Text>
        </View>
      </View>
    )}
    </KeyboardAvoidingView>
  );
}
