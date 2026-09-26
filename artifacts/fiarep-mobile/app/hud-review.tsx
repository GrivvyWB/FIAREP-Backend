import { useAppReadOnly } from '../lib/useAppReadOnly';
import { ReadOnlyBanner } from '../components/ReadOnlyBanner';
import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { listHudInspections, deleteHudInspection, type HudInspection } from '../lib/hud';
import { getCurrentActor, developmentsForManager } from '../lib/store';
import { useAppMode } from './_layout';
import { ui, ACCENT } from '../lib/ui';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

export default function HudReview() {
  const readOnlyBanner = useAppReadOnly() === true;
  const router = useRouter();
  const { mode } = useAppMode();
  const canDelete = useDeletionPolicy(mode !== null && mode !== 'resident' && mode !== 'vendor');
  const [items, setItems] = useState<HudInspection[]>([]);
  const [myDevs, setMyDevs] = useState<string[]>([]);

  const load = useCallback(() => {
    listHudInspections().then(setItems);
    if (mode === 'management') {
      (async () => {
        const a = await getCurrentActor();
        if (a.name) setMyDevs(await developmentsForManager(a.name));
      })();
    }
  }, [mode]);
  useFocusEffect(load);

  function onDelete(insp: HudInspection) {
    Alert.alert('Delete inspection?', 'This permanently removes the HUD inspection.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteHudInspection(insp.id); load(); } },
    ]);
  }

  // Management and admin both see all HUD inspections (read-only).
  const visible = items;

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      {readOnlyBanner && <ReadOnlyBanner />}
      <Text style={ui.h}>HUD Inspections</Text>
      <Text style={ui.label}>Read-only. Tap an inspection to view details and send a note to the inspector.</Text>

      {visible.length === 0 && <Text style={ui.empty}>No inspections yet.</Text>}

      {visible.map((insp) => (
        <Pressable key={insp.id} style={[ui.card, { gap: 4 }]} onPress={() => router.push('/hud-view?id=' + insp.id)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: ACCENT, flex: 1 }}>
              {insp.unitAddress || 'Inspection'}{insp.development ? ' · ' + insp.development : ''}
            </Text>
            {mode === 'administrator' && canDelete && (
              <Pressable onPress={() => onDelete(insp)} hitSlop={8}><Text style={{ color: '#c0392b', fontWeight: '600' }}>Delete</Text></Pressable>
            )}
          </View>
          <Text style={ui.listSub}>{insp.inspectionType} · {fmt(insp.inspectionDate)} · {insp.status}</Text>
          {!!insp.overallResult && (
            <Text style={{ fontSize: 13, fontWeight: '700', color: insp.overallResult === 'pass' ? '#1a8f4c' : '#c0392b' }}>
              {insp.overallResult === 'pass' ? 'PASS' : 'FAIL'}
            </Text>
          )}
          {(insp.notes || []).length > 0 && <Text style={{ fontSize: 12, color: '#666' }}>{(insp.notes || []).length} note(s)</Text>}
        </Pressable>
      ))}
    </ScrollView>
  );
}
