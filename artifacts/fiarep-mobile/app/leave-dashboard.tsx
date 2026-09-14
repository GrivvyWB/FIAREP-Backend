import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { listLeaveRequests, decideLeaveRequest, deleteLeaveRequest, listDevelopmentNames, getCurrentActor, getCurrentPosition, type LeaveRequest, type LeaveStatus } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

const TYPE_COLOR: Record<string, string> = {
  Vacation: '#1769e0', Sick: '#c0392b', Childcare: '#8e44ad', Personal: '#16a34a',
  LOA: '#666', 'Family Emergency': '#e67e22', 'Jury Duty': '#0891b2', Bereavement: '#334155', Other: '#999',
};
const statusColor = (s: string) => s === 'Approved' ? '#1a8f4c' : s === 'Denied' ? '#c0392b' : s === 'Cancelled' ? '#999' : '#B4741A';
function fmt(d: string): string { return d || ''; }
// US federal holidays for a given year/month/day. Handles fixed dates and the
// floating (Nth weekday) ones. Returns the holiday name or '' if none.
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  // month 0-based, weekday 0=Sun. Returns the day-of-month of the nth weekday.
  const first = new Date(year, month, 1).getDay();
  let day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return day;
}
function lastWeekday(year: number, month: number, weekday: number): number {
  const dim = new Date(year, month + 1, 0).getDate();
  const last = new Date(year, month, dim).getDay();
  return dim - ((last - weekday + 7) % 7);
}
function federalHoliday(y: number, mo: number, d: number): string {
  // mo is 0-based
  if (mo === 0 && d === 1) return "New Year's Day";
  if (mo === 0 && d === nthWeekday(y, 0, 1, 3)) return 'Martin Luther King Jr. Day';
  if (mo === 1 && d === nthWeekday(y, 1, 1, 3)) return "Presidents' Day";
  if (mo === 4 && d === lastWeekday(y, 4, 1)) return 'Memorial Day';
  if (mo === 5 && d === 19) return 'Juneteenth';
  if (mo === 6 && d === 4) return 'Independence Day';
  if (mo === 8 && d === nthWeekday(y, 8, 1, 1)) return 'Labor Day';
  if (mo === 9 && d === nthWeekday(y, 9, 1, 2)) return 'Columbus / Indigenous Peoples Day';
  if (mo === 10 && d === 11) return 'Veterans Day';
  if (mo === 10 && d === nthWeekday(y, 10, 4, 4)) return 'Thanksgiving';
  if (mo === 11 && d === 25) return 'Christmas Day';
  if (mo === 10) {
    // Election Day: first Tuesday after the first Monday of November.
    const firstMon = nthWeekday(y, 10, 1, 1);
    if (d === firstMon + 1) return 'Election Day';
  }
  return '';
}

function overlaps(a: LeaveRequest, b: LeaveRequest): boolean {
  if (a.id === b.id) return false;
  const aS = a.startDate, aE = a.endDate || a.startDate, bS = b.startDate, bE = b.endDate || b.startDate;
  return aS <= bE && bS <= aE;
}

export default function LeaveDashboard() {
  const [all, setAll] = useState<LeaveRequest[]>([]);
  const [devFilter, setDevFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | LeaveStatus>('Pending');
  const [monthOffset, setMonthOffset] = useState(0);
  const [devPicker, setDevPicker] = useState(false);
  const [query, setQuery] = useState('');

  const [myPosition, setMyPosition] = useState('');
  const [myRole, setMyRole] = useState('');
  const load = useCallback(() => {
    listLeaveRequests().then(setAll);
    getCurrentPosition().then(setMyPosition).catch(() => {});
    getCurrentActor().then((actor) => setMyRole(actor?.role || '')).catch(() => {});
  }, []);
  useFocusEffect(load);

  const devs = listDevelopmentNames();

  const q = query.trim().toLowerCase();
  // A Borough Director only reviews management-tier leave; lower staff are hidden.
  const MGMT_TIER = ['borough director', 'regional director', 'property manager', 'assistant property manager', 'superintendent', 'assistant superintendent'];
  const isBoroughDir = (myPosition || '').trim().toLowerCase() === 'borough director';
  const APPROVER_TITLES = [
    'property manager', 'assistant property manager', 'superintendent',
    'assistant superintendent', 'regional director', 'borough director',
    'plumber supervisor', 'electric supervisor', 'elevator supervisor',
    'painter supervisor', 'carpenter supervisor',
  ];
  const canDecide = myRole === 'management' ||
    myRole === 'administrator' ||
    APPROVER_TITLES.includes((myPosition || '').trim().toLowerCase());
  const filtered = all.filter((r) => {
    if (isBoroughDir && !MGMT_TIER.includes((r.title || '').trim().toLowerCase())) return false;
    if (devFilter && (r.development || '').trim().toLowerCase() !== devFilter.trim().toLowerCase()) return false;
    if (statusFilter !== 'All' && r.status !== statusFilter) return false;
    if (q && !((r.employee || '').toLowerCase().includes(q) || (r.type || '').toLowerCase().includes(q) || (r.development || '').toLowerCase().includes(q))) return false;
    return true;
  });

  // Approved leave that overlaps another approved leave (same development) = staffing conflict.
  const approved = all.filter((r) => r.status === 'Approved');
  function conflictCount(r: LeaveRequest): number {
    if (r.status !== 'Approved') return 0;
    return approved.filter((o) => o.id !== r.id && (o.development || '') === (r.development || '') && overlaps(r, o)).length;
  }

  async function decide(r: LeaveRequest, status: LeaveStatus) {
    try {
      await decideLeaveRequest(r.id, status);
      load();
    } catch (error) {
      Alert.alert(
        'Could not update leave',
        error instanceof Error ? error.message : 'The leave request was not changed.',
      );
      load();
    }
  }
  function confirmDelete(r: LeaveRequest) {
    Alert.alert('Delete request?', r.employee + ' \u00b7 ' + r.type + ' \u00b7 ' + r.startDate, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteLeaveRequest(r.id); load(); } },
    ]);
  }

  const pendingCount = all.filter(r => r.status === 'Pending').length;

  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Leave Calendar</Text>
      <Text style={ui.label}>Employee time-off for your development. Approve, deny, and watch for overlapping leave that could short-staff a day.</Text>

      {(() => {
        const base = new Date();
        const view = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
        const y = view.getFullYear(); const mo = view.getMonth();
        const monthName = view.toLocaleString(undefined, { month: 'long', year: 'numeric' });
        const firstDow = new Date(y, mo, 1).getDay();
        const dim = new Date(y, mo + 1, 0).getDate();
        const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
        const iso = (d: number) => y + '-' + pad(mo + 1) + '-' + pad(d);
        const todayISO = base.getFullYear() + '-' + pad(base.getMonth() + 1) + '-' + pad(base.getDate());
        const isToday = (d: number) => iso(d) === todayISO;
        const onDay = (d: number) => { const day = iso(d); return all.filter((r) => r.status !== 'Denied' && r.status !== 'Cancelled' && (r.startDate || '') <= day && (r.endDate || r.startDate || '') >= day && (!devFilter || (r.development || '').trim().toLowerCase() === devFilter.trim().toLowerCase())); };
        const cells: (number | null)[] = [];
        for (let i = 0; i < firstDow; i++) cells.push(null);
        for (let d = 1; d <= dim; d++) cells.push(d);
        const showDay = (d: number) => {
          const hol = federalHoliday(y, mo, d);
          const list = onDay(d);
          const header = iso(d) + (hol ? '  \u2014  ' + hol : '');
          if (list.length === 0) { Alert.alert(header, hol ? 'Federal holiday. No one out.' : 'No one out.'); return; }
          const body = (hol ? '\u2605 ' + hol + '\n\n' : '') + list.map((r) => r.employee + ' \u00b7 ' + r.type + (r.status === 'Pending' ? ' (pending)' : '')).join('\n');
          Alert.alert(header + '  \u00b7  ' + list.length + ' out', body);
        };
        return (
          <View style={[ui.card, { marginTop: 10 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Pressable onPress={() => setMonthOffset((m) => m - 1)} hitSlop={10}><Text style={{ fontSize: 20, color: ACCENT, fontWeight: '700' }}>{'\u2039'}</Text></Pressable>
              <Text style={{ fontWeight: '700', fontSize: 15 }}>{monthName}</Text>
              <Pressable onPress={() => setMonthOffset((m) => m + 1)} hitSlop={10}><Text style={{ fontSize: 20, color: ACCENT, fontWeight: '700' }}>{'\u203a'}</Text></Pressable>
            </View>
            <View style={{ flexDirection: 'row' }}>
              {['S','M','T','W','T','F','S'].map((d, i) => (<Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600', color: '#aab2bd', paddingBottom: 4 }}>{d}</Text>))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((d, i) => (
                <View key={i} style={{ width: '14.28%', aspectRatio: 1, padding: 2 }}>
                  {d != null && (() => {
                    const list = onDay(d);
                    return (
                      <Pressable onPress={() => showDay(d)} style={{ flex: 1, borderRadius: 8, backgroundColor: federalHoliday(y, mo, d) ? '#fdf6e3' : (list.length ? '#f7fafd' : 'transparent'), alignItems: 'center', justifyContent: 'center', borderWidth: isToday(d) ? 1.5 : 0, borderColor: isToday(d) ? ACCENT : 'transparent' }}>
                        <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: isToday(d) ? ACCENT : 'transparent' }}>
                          <Text style={{ fontSize: 12.5, fontWeight: isToday(d) ? '800' : '500', color: isToday(d) ? '#fff' : (federalHoliday(y, mo, d) ? '#B4741A' : '#444') }}>{d}</Text>
                        </View>
                        {!!federalHoliday(y, mo, d) && <Text style={{ fontSize: 8, color: '#B4741A', marginTop: -1 }}>{'\u2605'}</Text>}
                        <View style={{ flexDirection: 'row', gap: 2, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                          {list.slice(0, 4).map((r, k) => (
                            <View key={k} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: TYPE_COLOR[r.type] || '#999', opacity: r.status === 'Approved' ? 1 : 0.4 }} />
                          ))}
                        </View>
                      </Pressable>
                    );
                  })()}
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 10, color: '#999', marginTop: 6 }}>Today is {base.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}. Solid = approved, faded = pending. Tap a day for who's out.</Text>
          </View>
        );
      })()}
      <TextInput style={[ui.input, { marginTop: 8 }]} value={query} onChangeText={setQuery} placeholder="Search employee, type, or development" autoCapitalize="none" />

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Pressable style={[ui.input, { flex: 1 }]} onPress={() => setDevPicker(true)}>
          <Text style={{ color: devFilter ? '#000' : '#999' }}>{devFilter || 'All developments'}</Text>
        </Pressable>
        {!!devFilter && <Pressable style={ui.btnOutline} onPress={() => setDevFilter('')}><Text style={ui.btnOutlineText}>Clear</Text></Pressable>}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {(['Pending', 'Approved', 'Denied', 'Cancelled', 'All'] as const).map((s) => (
          <Pressable key={s} onPress={() => setStatusFilter(s)} style={[ui.btnOutline, statusFilter === s && { backgroundColor: ACCENT }]}>
            <Text style={statusFilter === s ? ui.btnText : ui.btnOutlineText}>{s}{s === 'Pending' && pendingCount ? ' (' + pendingCount + ')' : ''}</Text>
          </Pressable>
        ))}
      </View>

      {filtered.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No leave requests.</Text>}

      {filtered.map((r) => {
        const conflicts = conflictCount(r);
        return (
          <View key={r.id} style={[ui.card, { gap: 4, marginTop: 10, borderLeftWidth: 4, borderLeftColor: TYPE_COLOR[r.type] || '#999' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>{r.employee}</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: statusColor(r.status) }}>{r.status}</Text>
            </View>
            <Text style={{ fontSize: 14, color: TYPE_COLOR[r.type] || '#333', fontWeight: '600' }}>{r.type}</Text>
            <Text style={ui.listSub}>{r.startDate}{r.endDate && r.endDate !== r.startDate ? '  \u2013  ' + r.endDate : ''}  ({r.hours && r.hours > 0 ? r.hours + ' hour' + (r.hours === 1 ? '' : 's') : (r.approvedDays != null ? r.approvedDays : r.days) + ' day' + ((r.approvedDays != null ? r.approvedDays : r.days) === 1 ? '' : 's')})</Text>
            {!!r.title && <Text style={ui.listSub}>{r.title}{r.development ? '  \u00b7  ' + r.development : ''}</Text>}
            {!!r.supervisor && <Text style={ui.listSub}>Supervisor: {r.supervisor}</Text>}
            {!!r.reason && <Text style={{ fontSize: 13 }}>{r.reason}</Text>}
            {conflicts > 0 && <Text style={{ color: '#c0392b', fontWeight: '700', fontSize: 12 }}>⚠️ Overlaps {conflicts} other approved leave in this development</Text>}
            <Text style={ui.listSub}>Requested by {r.requestedBy}{r.decidedBy ? '  \u00b7  decided by ' + r.decidedBy : ''}</Text>

            {r.status === 'Pending' && canDecide && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Pressable style={[ui.btn, { flex: 1, backgroundColor: '#16a34a' }]} onPress={() => decide(r, 'Approved')}><Text style={ui.btnText}>Approve</Text></Pressable>
                <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#c0392b' }]} onPress={() => decide(r, 'Denied')}><Text style={{ color: '#c0392b', fontWeight: '600', textAlign: 'center' }}>Deny</Text></Pressable>
              </View>
            )}
            {canDecide && <Pressable onPress={() => confirmDelete(r)} hitSlop={8}><Text style={{ color: '#c0392b', fontSize: 12, fontWeight: '600', marginTop: 2 }}>Delete</Text></Pressable>}
          </View>
        );
      })}
      <View style={{ height: 40 }} />

      <Modal visible={devPicker} transparent animationType="slide" onRequestClose={() => setDevPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Filter by development</Text>
            <ScrollView>
              <Pressable onPress={() => { setDevFilter(''); setDevPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}><Text style={{ fontSize: 15, color: '#999' }}>All developments</Text></Pressable>
              {devs.map((dv, i) => (
                <Pressable key={i} onPress={() => { setDevFilter(dv); setDevPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15 }}>{dv}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setDevPicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
