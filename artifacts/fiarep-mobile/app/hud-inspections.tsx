import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { listHudInspections, newHudInspection, saveHudInspection, deleteHudInspection, type HudInspection } from '../lib/hud';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', in_progress: 'In progress', completed: 'Completed', failed: 'Failed',
};

export default function HudInspections() {
  const router = useRouter();
  const [items, setItems] = useState<HudInspection[]>([]);

  const load = useCallback(() => { listHudInspections().then(setItems); }, []);
  useFocusEffect(load);

  async function onNew() {
    const insp = newHudInspection();
    await saveHudInspection(insp);
    router.push('/hud-inspection?id=' + insp.id);
  }

  function onDelete(insp: HudInspection) {
    Alert.alert('Delete inspection?', 'This permanently removes it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteHudInspection(insp.id); load(); } },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>HUD / NSPIRE Inspections</Text>

      <Pressable style={ui.btn} onPress={onNew}>
        <Text style={ui.btnText}>+ New Inspection</Text>
      </Pressable>

      {items.length === 0 && <Text style={ui.empty}>No inspections yet.</Text>}

      {items.map((insp) => (
        <View key={insp.id} style={[ui.card, { gap: 4 }]}>
          <Pressable onPress={() => router.push('/hud-inspection?id=' + insp.id)}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT }}>
              {insp.unitAddress || 'New inspection'}{insp.development ? ' · ' + insp.development : ''}
            </Text>
            <Text style={ui.listSub}>{insp.inspectionType} · {fmt(insp.inspectionDate)} · {STATUS_LABEL[insp.status] || insp.status}</Text>
            {!!insp.overallResult && (
              <Text style={{ fontSize: 13, fontWeight: '700', color: insp.overallResult === 'pass' ? '#1a8f4c' : '#c0392b' }}>
                {insp.overallResult === 'pass' ? 'PASS' : 'FAIL'}
              </Text>
            )}
          </Pressable>
          <Pressable style={[ui.btnOutline, { borderColor: '#c0392b', marginTop: 4 }]} onPress={() => onDelete(insp)}>
            <Text style={[ui.btnOutlineText, { color: '#c0392b' }]}>Delete</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
