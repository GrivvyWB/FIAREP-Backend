import { useCallback, useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { createLeaveRequest, leaveBalances, leavePrefillForEmployee, listStaffNames, listLeaveForEmployee, getCurrentActor, getCurrentPosition, LEAVE_TYPES, type LeaveType, type LeaveBalance, type LeaveRequest } from '../lib/store';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';
import { syncAllEntities } from '../lib/sync';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function pad(n: number) { return n < 10 ? '0' + n : '' + n; }
function toISO(y: number, m: number, d: number) { return y + '-' + pad(m + 1) + '-' + pad(d); }
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }

function DatePicker({ visible, initial, onPick, onClose }: { visible: boolean; initial: string; onPick: (iso: string) => void; onClose: () => void }) {
  const now = new Date();
  const parse = () => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(initial || '');
    if (m) return { y: +m[1], mo: +m[2] - 1, d: +m[3] };
    return { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() };
  };
  const [sel, setSel] = useState(parse());
  useEffect(() => { if (visible) setSel(parse()); }, [visible]);
  const years = Array.from({ length: 31 }, (_, i) => now.getFullYear() + i);
  const dim = daysInMonth(sel.y, sel.mo);
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const col = (items: (string | number)[], current: number, onSel: (i: number) => void, keyFn?: (v: any) => string) => (
    <ScrollView style={{ flex: 1, maxHeight: 220 }} showsVerticalScrollIndicator={false}>
      {items.map((v, i) => (
        <Pressable key={keyFn ? keyFn(v) : String(v)} onPress={() => onSel(i)} style={{ paddingVertical: 10, alignItems: 'center', backgroundColor: current === i ? '#eef4fb' : 'transparent' }}>
          <Text style={{ fontSize: 16, fontWeight: current === i ? '700' : '400', color: current === i ? ACCENT : '#333' }}>{v}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 }}>
          <Text style={{ fontWeight: '700', fontSize: 16, marginBottom: 10 }}>Pick a date</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {col(MONTHS, sel.mo, (i) => setSel((s) => ({ ...s, mo: i, d: Math.min(s.d, daysInMonth(s.y, i)) })))}
            {col(days, sel.d - 1, (i) => setSel((s) => ({ ...s, d: i + 1 })))}
            {col(years, years.indexOf(sel.y), (i) => setSel((s) => ({ ...s, y: years[i], d: Math.min(s.d, daysInMonth(years[i], s.mo)) })))}
          </View>
          <Pressable style={[ui.btn, { marginTop: 12 }]} onPress={() => { onPick(toISO(sel.y, sel.mo, sel.d)); onClose(); }}>
            <Text style={ui.btnText}>Set {toISO(sel.y, sel.mo, sel.d)}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={{ padding: 12 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function LeaveRequestScreen() {
  const router = useRouter();
  const { mode } = useAppMode();
  const isMgmt = mode === 'management' || mode === 'administrator';

  const [employee, setEmployee] = useState('');
  const [title, setTitle] = useState('');
  const [development, setDevelopment] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [type, setType] = useState<LeaveType>('Vacation');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('');
  const [hoursPicker, setHoursPicker] = useState(false);
  const [typePicker, setTypePicker] = useState(false);
  const [startPicker, setStartPicker] = useState(false);
  const [endPicker, setEndPicker] = useState(false);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [empFocused, setEmpFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showMine, setShowMine] = useState(false);
  const [mine, setMine] = useState<LeaveRequest[]>([]);

  useFocusEffect(useCallback(() => {
    (async () => {
      const a = await getCurrentActor();
      if (isMgmt) {
        setNames(await listStaffNames().catch(() => []));
        setEmployee(a.name || '');
        try { setTitle(await getCurrentPosition()); } catch (e) {}
        const pre = await leavePrefillForEmployee(a.name || '').catch(() => null);
        if (pre) {
          if (pre.development) setDevelopment(pre.development);
          if (pre.supervisor) setSupervisor(pre.supervisor);
        }
        setBalances(await leaveBalances(a.name || '').catch(() => []));
      } else {
        setEmployee(a.name || '');
        try { setTitle(await getCurrentPosition()); } catch (e) {}
        const pre = await leavePrefillForEmployee(a.name || '').catch(() => null);
        if (pre) { if (pre.development) setDevelopment(pre.development); if (pre.supervisor) setSupervisor(pre.supervisor); }
        setBalances(await leaveBalances(a.name || '').catch(() => []));
      }
    })();
  }, [isMgmt]));

  async function chooseEmployee(name: string) {
    setEmployee(name); setEmpFocused(false);
    const pre = await leavePrefillForEmployee(name).catch(() => null);
    if (pre) { setTitle(pre.title || ''); setDevelopment(pre.development || ''); setSupervisor(pre.supervisor || ''); }
    setBalances(await leaveBalances(name).catch(() => []));
  }

  const q = employee.trim().toLowerCase();
  const nameMatches = (isMgmt && empFocused && q.length >= 1)
    ? names.filter(n => n.toLowerCase().includes(q) && n.toLowerCase() !== q).slice(0, 8) : [];

  async function submit() {
    if (!employee.trim()) { Alert.alert('Employee required', 'Enter the employee name.'); return; }
    if (!start.trim()) { Alert.alert('Start date required', 'Pick a start date.'); return; }
    setBusy(true);
    try {
      await createLeaveRequest({ employee: employee.trim(), title: title.trim(), development: development.trim(), supervisor: supervisor.trim(), type, startDate: start.trim(), endDate: (end.trim() || start.trim()), reason: reason.trim(), hours: hours.trim() ? Number(hours.trim()) : undefined });
      Alert.alert('Submitted', 'Leave request submitted for review.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert('Failed', String(e && e.message ? e.message : e)); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Request Time Off</Text>
      <Pressable style={[ui.btnOutline, { marginTop: 6 }]} onPress={async () => {
        if (showMine) {
          setShowMine(false);
          return;
        }
        const who = employee.trim() || '';
        if (!who) { return; }
        await syncAllEntities().catch(() => undefined);
        const list = await listLeaveForEmployee(who).catch(() => []);
        setMine(list);
        setShowMine(true);
      }}>
        <Text style={ui.btnOutlineText}>{showMine ? 'Hide my requests' : 'My Requests (see if approved)'}</Text>
      </Pressable>
      {showMine && (
        <View style={{ marginTop: 8, gap: 8 }}>
          {mine.length === 0 && <Text style={ui.listSub}>No requests yet for {employee.trim() || 'this employee'}.</Text>}
          {mine.map((r) => {
            const sc = r.status === 'Approved' ? '#1a8f4c' : r.status === 'Denied' ? '#c0392b' : r.status === 'Cancelled' ? '#999' : '#B4741A';
            const amt = r.hours && r.hours > 0 ? r.hours + ' hour' + (r.hours === 1 ? '' : 's') : ((r.approvedDays != null ? r.approvedDays : r.days) + ' day' + ((r.approvedDays != null ? r.approvedDays : r.days) === 1 ? '' : 's'));
            return (
              <View key={r.id} style={[ui.card, { gap: 3 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700' }}>{r.type}</Text>
                  <View style={{ backgroundColor: sc, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{r.status}</Text>
                  </View>
                </View>
                <Text style={ui.listSub}>{r.startDate}{r.endDate && r.endDate !== r.startDate ? '  \u2013  ' + r.endDate : ''}  ({amt})</Text>
              </View>
            );
          })}
        </View>
      )}
      <Text style={ui.label}>{isMgmt ? 'Log a leave request for an employee at your development.' : 'Submit a time-off request for management review.'}</Text>

      <Text style={[ui.label, { marginTop: 10 }]}>Employee</Text>
      <TextInput style={ui.input} value={employee} onChangeText={setEmployee} onFocus={() => setEmpFocused(true)} onBlur={() => setTimeout(() => setEmpFocused(false), 150)} placeholder="Employee name" autoCapitalize="words" editable={isMgmt} />
      {nameMatches.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, marginTop: 2 }}>
          {nameMatches.map((n, i) => (
            <Pressable key={i} onPress={() => chooseEmployee(n)} style={{ paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: '#f2f2f2', backgroundColor: '#fafafa' }}>
              <Text style={{ fontSize: 14, color: ACCENT }}>{n}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={[ui.label, { marginTop: 12 }]}>Title / trade</Text>
      <TextInput style={ui.input} value={title} onChangeText={setTitle} placeholder="e.g. Plumber" autoCapitalize="words" />

      <Text style={[ui.label, { marginTop: 12 }]}>Development</Text>
      <TextInput style={ui.input} value={development} onChangeText={setDevelopment} placeholder="Development (auto-fills from employee)" autoCapitalize="words" />

      <Text style={[ui.label, { marginTop: 12 }]}>Supervisor</Text>
      <TextInput style={ui.input} value={supervisor} onChangeText={setSupervisor} placeholder="Auto-fills from development; type if none" autoCapitalize="words" />

      <Text style={[ui.label, { marginTop: 12 }]}>Leave type</Text>
      <Pressable style={ui.input} onPress={() => setTypePicker(true)}>
        <Text style={{ fontWeight: '600' }}>{type}  {'\u25be'}</Text>
      </Pressable>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={ui.label}>Start date</Text>
          <Pressable style={ui.input} onPress={() => setStartPicker(true)}>
            <Text style={{ color: start ? '#000' : '#999' }}>{start || 'Pick date'}</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ui.label}>End date</Text>
          <Pressable style={ui.input} onPress={() => setEndPicker(true)}>
            <Text style={{ color: end ? '#000' : '#999' }}>{end || 'Same day'}</Text>
          </Pressable>
        </View>
      </View>

      <Text style={[ui.label, { marginTop: 12 }]}>Amount of time</Text>
      <Pressable style={ui.input} onPress={() => setHoursPicker(true)}>
        <Text style={{ fontWeight: '600' }}>{hours ? hours + ' hour' + (hours === '1' ? '' : 's') + ' (partial day)' : 'Full day(s)'}  {'\u25be'}</Text>
      </Pressable>
      <Text style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Choose full days, or a partial-day amount (8 hours = 1 day).</Text>

      <Text style={[ui.label, { marginTop: 12 }]}>Reason (optional)</Text>
      <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} value={reason} onChangeText={setReason} placeholder="Notes" multiline />

      {balances.length > 0 && (
        <View style={[ui.card, { marginTop: 14, gap: 4 }]}>
          <Text style={{ fontWeight: '700', fontSize: 13 }}>Remaining balances ({new Date().getFullYear()})</Text>
          {balances.filter(b => b.allotment > 0).map((b) => (
            <View key={b.type} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13 }}>{b.type}</Text>
              <Text style={{ fontSize: 13, fontWeight: '600', color: b.remaining <= 2 ? '#c0392b' : '#1a8f4c' }}>{b.remaining} / {b.allotment} days</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable style={[ui.btn, { marginTop: 16 }, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={ui.btnText}>Submit request</Text>
      </Pressable>
      <View style={{ height: 40 }} />

      <DatePicker visible={startPicker} initial={start} onPick={setStart} onClose={() => setStartPicker(false)} />
      <DatePicker visible={endPicker} initial={end || start} onPick={setEnd} onClose={() => setEndPicker(false)} />

      <Modal visible={hoursPicker} transparent animationType="slide" onRequestClose={() => setHoursPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Amount of time off</Text>
            <ScrollView>
              {[
                { label: 'Full day(s)', val: '' },
                { label: 'Quarter day (2 hours)', val: '2' },
                { label: 'Half day (4 hours)', val: '4' },
                { label: 'Three-quarter day (6 hours)', val: '6' },
                { label: '1 hour', val: '1' },
                { label: '3 hours', val: '3' },
                { label: '5 hours', val: '5' },
                { label: '7 hours', val: '7' },
              ].map((o) => (
                <Pressable key={o.label} onPress={() => { setHours(o.val); setHoursPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15, fontWeight: hours === o.val ? '700' : '400', color: hours === o.val ? ACCENT : '#000' }}>{o.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setHoursPicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={typePicker} transparent animationType="slide" onRequestClose={() => setTypePicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Leave type</Text>
            <ScrollView>
              {LEAVE_TYPES.map((t) => (
                <Pressable key={t} onPress={() => { setType(t); setTypePicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15, fontWeight: t === type ? '700' : '400', color: t === type ? ACCENT : '#000' }}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setTypePicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
