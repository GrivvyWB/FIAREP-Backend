import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { listAuditLog, clearAuditLog, deleteAuditEntry, type AuditEntry } from '../lib/store';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';

function csvCell(v: string): string {
  const s = (v ?? '').toString();
  return '"' + s.replace(/"/g, '""') + '"';
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}

// Group audit actions into human-friendly categories for the dropdown.
const AUDIT_CATEGORIES: { label: string; match: (a: string) => boolean }[] = [
  { label: 'All activity', match: () => true },
  { label: 'Hiring / Staff accounts', match: (a) => /staff account|staff code|bulk employees/i.test(a) },
  { label: 'Reports', match: (a) => /^report (created|submitted|resolved|status|deleted|sent)/i.test(a) },
  { label: 'Report assignments', match: (a) => /report assigned|assigned to project|job sent to management/i.test(a) },
  { label: 'Change orders', match: (a) => /change (order|work order)/i.test(a) },
  { label: 'Inspections', match: (a) => /inspection|repair complete/i.test(a) },
  { label: 'Elevator', match: (a) => /elevator/i.test(a) },
  { label: 'Project notes', match: (a) => /project note/i.test(a) },
];

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [catIdx, setCatIdx] = useState(-1);
  const [catPicker, setCatPicker] = useState(false);
  const router = useRouter();
  const { mode } = useAppMode();
  const isAdmin = mode === 'administrator';

  function onClearAll() {
    Alert.alert('Clear audit log?', 'This permanently deletes all audit entries. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: async () => { await clearAuditLog(); load(); } },
    ]);
  }

  function onDeleteEntry(id: string) {
    Alert.alert('Delete entry?', 'Remove this audit entry permanently.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteAuditEntry(id); load(); } },
    ]);
  }

  const load = useCallback(() => { listAuditLog().then(setEntries); }, []);
  useFocusEffect(load);

  async function onExport() {
    if (entries.length === 0) { Alert.alert('Nothing to export', 'The audit log is empty.'); return; }
    setBusy(true);
    try {
      const header = ['Time', 'Role', 'Name', 'Action', 'Detail'].map(csvCell).join(',');
      const rows = entries.map((e) =>
        [e.at, e.actorRole, e.actorName, e.action, e.detail].map(csvCell).join(',')
      );
      const csv = [header, ...rows].join('\n');
      const uri = FileSystem.documentDirectory + 'audit-log.csv';
      await FileSystem.writeAsStringAsync(uri, csv);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export audit log' });
      } else {
        Alert.alert('Sharing unavailable', 'Cannot open the share sheet on this device.');
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not export the audit log.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Audit Log</Text>

      <Pressable style={ui.btn} onPress={onExport} disabled={busy}>
        <Text style={ui.btnText}>{busy ? 'Exporting…' : 'Export CSV'}</Text>
      </Pressable>

      {isAdmin && (
        <Pressable style={[ui.btnOutline, { borderColor: '#c0392b' }]} onPress={onClearAll}>
          <Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Clear all</Text>
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <Pressable style={[ui.input, { flex: 1 }]} onPress={() => setCatPicker(true)}>
          <Text style={{ fontSize: 15, fontWeight: '600' }}>{catIdx >= 0 ? AUDIT_CATEGORIES[catIdx].label : 'Pick a category to view'}  ▾</Text>
        </Pressable>
        {catIdx >= 0 && (
          <Pressable style={ui.btnOutline} onPress={() => setCatIdx(-1)}>
            <Text style={{ color: '#c0392b', fontWeight: '600' }}>Close</Text>
          </Pressable>
        )}
      </View>

      {catIdx < 0 && <Text style={[ui.empty, { marginTop: 20 }]}>Pick a category above to view its activity.</Text>}
      {catIdx >= 0 && (() => { const filtered = entries.filter((e) => AUDIT_CATEGORIES[catIdx].match(e.action || '')); return (<>
      {filtered.length === 0 && <Text style={ui.empty}>No activity in this category.</Text>}

      {filtered.map((e) => (
        <Pressable key={e.id} style={[ui.card, { gap: 4 }]} onPress={() => { const rid = e.reportId; const act = (e.action || '').toLowerCase(); if (act.includes('elevator')) { router.push('/elevator-dashboard'); return; } if (act.includes('change order') || act.includes('change work order')) { router.push('/change-orders'); return; } if (act.includes('inspection')) { router.push('/inspection-approvals'); return; } if (!rid) return; if (rid.startsWith('proj:')) router.push('/project/' + rid.slice(5)); else if (rid.startsWith('hud:')) router.push('/hud-view?id=' + rid.slice(4)); else router.push('/report-detail?id=' + rid); }}>
          <Text style={{ fontSize: 12, color: '#999' }}>{fmtTime(e.at)}</Text>
          <Text style={{ fontSize: 15, fontWeight: '600', color: ACCENT }}>{e.action}{e.reportId ? '  \u203a' : ''}</Text>
          {!!e.detail && <Text style={{ fontSize: 14, color: '#333' }}>{e.detail}</Text>}
          <Text style={{ fontSize: 12, color: '#666' }}>
            {e.actorName ? e.actorName + ' \u00b7 ' : ''}{e.actorRole || 'unknown'}
          </Text>
          {isAdmin && (
            <Pressable onPress={() => onDeleteEntry(e.id)} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
              <Text style={{ fontSize: 13, color: '#c0392b', fontWeight: '600' }}>Delete</Text>
            </Pressable>
          )}
        </Pressable>
      ))}
      </>); })()}
      <Modal visible={catPicker} transparent animationType="slide" onRequestClose={() => setCatPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Filter by category</Text>
            <ScrollView>
              {AUDIT_CATEGORIES.map((c, i) => (
                <Pressable key={i} onPress={() => { setCatIdx(i); setCatPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontSize: 15, fontWeight: i === catIdx ? '700' : '400', color: i === catIdx ? ACCENT : '#000' }}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setCatPicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
