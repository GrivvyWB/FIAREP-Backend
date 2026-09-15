import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  listResidentReports, deleteResidentReport,
  listChangeOrders, deleteChangeOrder,
  listAllNotifications, deleteNotification,
  type ResidentReport, type ChangeOrder, type Notification,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function ManageRequests() {
  const router = useRouter();
  const canDelete = useDeletionPolicy();
  const [reports, setReports] = useState<ResidentReport[]>([]);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((m) => ({ ...m, [k]: !m[k] }));
  const groupedNotifs = Object.values(notifs.reduce<Record<string, { notification: Notification; ids: string[] }>>((groups, notification) => {
    const key = `${(notification.message || '').trim().toLowerCase()}|${(notification.reportId || notification.detail || '').trim().toLowerCase()}`;
    if (groups[key]) groups[key].ids.push(notification.id);
    else groups[key] = { notification, ids: [notification.id] };
    return groups;
  }, {}));

  const load = useCallback(() => {
    listResidentReports().then(setReports);
    listChangeOrders().then(setOrders);
    listAllNotifications().then(setNotifs);
  }, []);
  useFocusEffect(load);

  function confirmDelete(label: string, fn: () => Promise<void>) {
    Alert.alert('Delete ' + label + '?', 'This permanently removes it for everyone. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await fn(); load(); } },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Manage All Requests</Text>
      <Text style={ui.listSub}>Admin only. Delete any request, job, change order, or inbox item.</Text>

      <Pressable onPress={() => toggle('reports')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, backgroundColor: '#f2f7fb', borderRadius: 10, padding: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{open['reports'] ? '\u2013' : '+'}  Reports & Jobs</Text>
        <Text style={{ fontSize: 13, color: '#667085' }}>{reports.length}</Text>
      </Pressable>
      {open['reports'] && reports.length === 0 && <Text style={ui.empty}>None.</Text>}
      {open['reports'] && reports.map((r) => (
        <View key={r.id} style={[ui.card, { gap: 4 }]}>
          <Pressable onPress={() => router.push('/report-detail?id=' + r.id)}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: ACCENT }}>{(r.location || r.unit || 'Report')}{r.development ? ' \u00b7 ' + r.development : ''}</Text>
            {!!r.description && <Text style={{ fontSize: 14, color: '#333' }}>{r.description}</Text>}
            <Text style={{ fontSize: 12, color: '#999' }}>{r.status} · {fmt(r.createdAt)}</Text>
          </Pressable>
          {canDelete && <Pressable style={[ui.btnOutline, { borderColor: '#c0392b', marginTop: 4 }]} onPress={() => confirmDelete('report', () => deleteResidentReport(r.id))}>
            <Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Delete</Text>
          </Pressable>}
        </View>
      ))}

      <Pressable onPress={() => toggle('orders')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, backgroundColor: '#f2f7fb', borderRadius: 10, padding: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{open['orders'] ? '\u2013' : '+'}  Change Orders</Text>
        <Text style={{ fontSize: 13, color: '#667085' }}>{orders.length}</Text>
      </Pressable>
      {open['orders'] && orders.length === 0 && <Text style={ui.empty}>None.</Text>}
      {open['orders'] && orders.map((c) => (
        <View key={c.id} style={[ui.card, { gap: 4 }]}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: ACCENT }}>{c.reportRef || 'Change order'}</Text>
          <Text style={{ fontSize: 14, color: '#333' }}>{c.targetName || c.targetPosition}{c.description ? ' \u00b7 ' + c.description : ''}</Text>
          <Text style={{ fontSize: 12, color: '#999' }}>{c.status} · {fmt(c.createdAt)}</Text>
          {canDelete && <Pressable style={[ui.btnOutline, { borderColor: '#c0392b', marginTop: 4 }]} onPress={() => confirmDelete('change order', () => deleteChangeOrder(c.id))}>
            <Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Delete</Text>
          </Pressable>}
        </View>
      ))}

      <Pressable onPress={() => toggle('notifs')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, backgroundColor: '#f2f7fb', borderRadius: 10, padding: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>{open['notifs'] ? '\u2013' : '+'}  Inbox Notifications</Text>
        <Text style={{ fontSize: 13, color: '#667085' }}>{groupedNotifs.length}</Text>
      </Pressable>
      {open['notifs'] && groupedNotifs.length === 0 && <Text style={ui.empty}>None.</Text>}
      {open['notifs'] && groupedNotifs.map(({ notification: n, ids }) => (
        <View key={`${n.reportId || n.detail || n.id}:${n.message}`} style={[ui.card, { gap: 4 }]}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: ACCENT }}>{n.message}</Text>
          <Text style={{ fontSize: 13, color: '#666' }}>To: {n.target}{n.detail ? ' \u00b7 ' + n.detail : ''}</Text>
          <Text style={{ fontSize: 12, color: '#999' }}>{fmt(n.at)}</Text>
          <Pressable style={[ui.btnOutline, { borderColor: '#c0392b', marginTop: 4 }]} onPress={() => confirmDelete('notification', () => Promise.all(ids.map(deleteNotification)).then(() => undefined))}>
            <Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Delete</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
