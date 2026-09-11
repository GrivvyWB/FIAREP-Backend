import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform, Modal, FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  listStaffAccounts,
  issueStaffAccountFull,
  listDevelopmentNames,
  resetStaffCode,
  deleteStaffAccount,
  STAFF_POSITIONS,
  type StaffAccount,
  type StaffRole,
  type StaffPosition,
  getCurrentPosition,
} from '../lib/store';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';

const ROLE_LABEL: Record<StaffRole, string> = {
  administrator: 'Administrator',
  management: 'Management',
  worker: 'Worker',
  inspector: 'Inspection',
  procurement: 'Procurement',
  resident: 'Resident',
  vendor: 'Vendor',
};

const MGMT_TITLES = ['Property Manager', 'Superintendent', 'Regional Manager', 'Director', 'Other'] as const;

export default function StaffIssue() {
  const { mode } = useAppMode();
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState<StaffPosition>('Staff Worker');
  const [mgmtTitle, setMgmtTitle] = useState<string>('Property Manager');
  const [mgmtTitleOther, setMgmtTitleOther] = useState<string>('');
  const [positionOther, setPositionOther] = useState<string>('');
  const [newRole, setNewRole] = useState<StaffRole>('worker');
  const [selectedDevs, setSelectedDevs] = useState<string[]>([]);
  const [devQuery, setDevQuery] = useState('');
  const [devPickerOpen, setDevPickerOpen] = useState(false);

  const [myPosition, setMyPosition] = useState('');
  const load = useCallback(() => { listStaffAccounts().then(setAccounts); getCurrentPosition().then(setMyPosition).catch(() => {}); }, []);
  useFocusEffect(load);

  // Regional Director: a management account that can issue everyone EXCEPT
  // administrators (management, supervisors, and all staff/trades).
  const isRegionalDirector = mode === 'management' && (myPosition || '').trim().toLowerCase() === 'regional director';

  const issuerName = mode === 'administrator' ? 'Administrator' : (isRegionalDirector ? 'Regional Director' : 'Management');
  const canIssueRoles: StaffRole[] =
    mode === 'administrator' ? ['administrator', 'management', 'procurement'] :
    isRegionalDirector ? ['management', 'procurement', 'worker', 'inspector'] :
    mode === 'management' ? ['worker', 'inspector'] : [];

  // Admin deletes anyone; Regional Director deletes everyone except admins.
  const canDeleteRoles: StaffRole[] =
    mode === 'administrator' ? ['administrator', 'management', 'worker', 'inspector', 'procurement'] :
    isRegionalDirector ? ['management', 'procurement', 'worker', 'inspector'] :
    mode === 'management' ? ['worker', 'inspector'] : [];

  const managed = accounts.filter((a) => canDeleteRoles.includes(a.role) && a.status !== 'revoked');
  const showPosition = mode === 'management' || mode === 'administrator';
  const showDevelopments = mode === 'administrator';
  // Any issuer can assign developments to the staff they create (trade workers included).
  const canAssignDevs = mode === 'administrator' || mode === 'management';
  const effRole: StaffRole = canIssueRoles.length === 1 ? canIssueRoles[0] : newRole;
  const showTitle = showDevelopments && (effRole === 'management' || effRole === 'administrator');
  const allDevs = listDevelopmentNames();
  const devFiltered = devQuery.trim() ? allDevs.filter(d => d.toLowerCase().includes(devQuery.trim().toLowerCase())) : allDevs;
  function toggleDev(d: string) {
    setSelectedDevs(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  async function onIssue() {
    if (!firstName.trim() || !lastName.trim()) { Alert.alert('Name required', 'Enter first and last name.'); return; }
    const role = canIssueRoles.length === 1 ? canIssueRoles[0] : newRole;
    const effTitle = mgmtTitle === 'Other' ? (mgmtTitleOther.trim() || 'Other') : mgmtTitle;
    const effPos = position === 'Other' ? (positionOther.trim() || 'Other') : position;
    const pos = (showPosition ? effPos : (showDevelopments ? effTitle : 'Other')) as StaffPosition;
    try {
      const acct = await issueStaffAccountFull(firstName.trim(), lastName.trim(), pos, role, issuerName, canAssignDevs ? selectedDevs : []);
      setFirstName(''); setLastName(''); setSelectedDevs([]); setDevQuery(''); setMgmtTitleOther(''); setPositionOther('');
      load();
      Alert.alert(
        ROLE_LABEL[role] + ' account created',
        'Give this login to ' + acct.name + ':\n\nCode: ' + acct.code + '\n\nThey log in with their name and this code.'
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not create account.');
    }
  }

  async function onReset(a: StaffAccount) {
    Alert.alert('Reset code?', 'Generate a new code for ' + a.name + '? The old code stops working.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', onPress: async () => { const code = await resetStaffCode(a.id); load(); if (code) Alert.alert('New code', a.name + ' new code:\n\n' + code); } },
    ]);
  }

  function onDelete(a: StaffAccount) {
    Alert.alert('Delete account?', 'Delete ' + a.name + ' (' + ROLE_LABEL[a.role] + ')? They can no longer log in. Their name stays on past work.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { const res = await deleteStaffAccount(a.id); if (res && res.ok === false) { Alert.alert('Cannot delete', res.reason || 'Not allowed.'); } else { load(); } } },
    ]);
  }

  if (canIssueRoles.length === 0) {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.empty}>No staff management available for this role.</Text>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Issue {mode === 'administrator' ? 'Management' : 'Staff'} account</Text>

      <View><Text style={ui.label}>First name</Text>
        <TextInput style={ui.input} value={firstName} onChangeText={setFirstName} placeholder="Rick" autoCapitalize="words" />
      </View>
      <View><Text style={ui.label}>Last name</Text>
        <TextInput style={ui.input} value={lastName} onChangeText={setLastName} placeholder="Johnson" autoCapitalize="words" />
      </View>

      {showPosition && (
        <View>
          <Text style={ui.label}>Position</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {STAFF_POSITIONS.map((p) => (
              <Pressable key={p} style={[ui.btnOutline, position === p && { backgroundColor: ACCENT }]} onPress={() => setPosition(p)}>
                <Text style={position === p ? ui.btnText : ui.btnOutlineText}>{p}</Text>
              </Pressable>
            ))}
          </View>
          {position === 'Other' && (
            <TextInput style={[ui.input, { marginTop: 6 }]} value={positionOther} onChangeText={setPositionOther} placeholder="Type a position" autoCapitalize="words" />
          )}
        </View>
      )}

      {showTitle && (
        <View>
          <Text style={ui.label}>Title</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
            {(effRole === 'administrator' ? (['Other'] as const) : MGMT_TITLES).map((t) => (
              <Pressable key={t} style={[ui.btnOutline, mgmtTitle === t && { backgroundColor: ACCENT }]} onPress={() => setMgmtTitle(t)}>
                <Text style={mgmtTitle === t ? ui.btnText : ui.btnOutlineText}>{t}</Text>
              </Pressable>
            ))}
          </View>
          {mgmtTitle === 'Other' && (
            <TextInput style={[ui.input, { marginTop: 6 }]} value={mgmtTitleOther} onChangeText={setMgmtTitleOther} placeholder="Type a title" autoCapitalize="words" />
          )}
        </View>
      )}
      {canAssignDevs && (
        <View>
          <Text style={ui.label}>Assigned developments{selectedDevs.length ? ' (' + selectedDevs.length + ')' : ''}</Text>
          <Pressable style={ui.input} onPress={() => { setDevQuery(''); setDevPickerOpen(true); }}>
            <Text style={{ color: selectedDevs.length ? '#000' : '#999' }}>
              {selectedDevs.length ? 'Tap to edit (' + selectedDevs.length + ' selected)' : 'Select developments'}
            </Text>
          </Pressable>
          {selectedDevs.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {selectedDevs.map((d) => (
                <Pressable key={d} style={[ui.btnOutline, { backgroundColor: ACCENT, paddingVertical: 6 }]} onPress={() => toggleDev(d)}>
                  <Text style={ui.btnText}>{d}  ✕</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {canIssueRoles.length > 1 && (
        <View>
          <Text style={ui.label}>Access role</Text>
          <View style={ui.row}>
            {canIssueRoles.map((r) => (
              <Pressable key={r} style={[ui.btnOutline, { flex: 1 }, newRole === r && { backgroundColor: ACCENT }]} onPress={() => { setNewRole(r); setMgmtTitle(r === 'administrator' ? 'Other' : 'Property Manager'); }}>
                <Text style={newRole === r ? ui.btnText : ui.btnOutlineText}>{ROLE_LABEL[r]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <Pressable style={ui.btn} onPress={onIssue}>
        <Text style={ui.btnText}>Create account & generate code</Text>
      </Pressable>

      <Text style={[ui.h, { marginTop: 16 }]}>Current staff</Text>
      {managed.length === 0 && <Text style={ui.empty}>No accounts yet.</Text>}
      {managed.map((a) => (
        <View key={a.id} style={[ui.card, { gap: 8 }]}>
          <View style={ui.line}><Text style={ui.lineK}>Name</Text><Text style={ui.lineV}>{a.name}</Text></View>
          {!!a.position && <View style={ui.line}><Text style={ui.lineK}>Position</Text><Text style={ui.lineV}>{a.position}</Text></View>}
          <View style={ui.line}><Text style={ui.lineK}>Development</Text><Text style={ui.lineV}>{(Array.isArray(a.developments) && a.developments.length) ? a.developments.join(', ') : '\u2014'}</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>Role</Text><Text style={[ui.lineV, { color: ACCENT }]}>{ROLE_LABEL[a.role]}</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>Code</Text><Text style={ui.lineV}>{a.code}</Text></View>
          <View style={ui.row}>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => onReset(a)}><Text style={ui.btnOutlineText}>Reset code</Text></Pressable>
            <Pressable style={[ui.btn, ui.btnMuted, { flex: 1 }]} onPress={() => onDelete(a)}><Text style={ui.btnText}>Delete</Text></Pressable>
          </View>
        </View>
      ))}
          <Modal visible={devPickerOpen} animationType="slide" onRequestClose={() => setDevPickerOpen(false)}>
        <View style={{ flex: 1, padding: 16, paddingTop: 60, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={ui.h}>Select developments</Text>
            <Pressable onPress={() => setDevPickerOpen(false)}><Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>Done</Text></Pressable>
          </View>
          <TextInput style={ui.input} value={devQuery} onChangeText={setDevQuery} placeholder="Search developments..." autoFocus />
          <FlatList
            data={devFiltered}
            keyExtractor={(d) => d}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center' }} onPress={() => toggleDev(item)}>
                <Text style={{ fontSize: 16, color: selectedDevs.includes(item) ? ACCENT : '#333', fontWeight: selectedDevs.includes(item) ? '700' : '400' }}>
                  {selectedDevs.includes(item) ? '✓  ' : '•  '}{item}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={ui.empty}>No matches.</Text>}
          />
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
