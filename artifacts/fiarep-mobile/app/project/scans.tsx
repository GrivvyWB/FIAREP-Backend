import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { listRooms, type Room } from '../../lib/store';
import { FloorPlan, type Wall2D } from '../../lib/FloorPlan';
import { ui } from '../../lib/ui';

export default function Scans() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);

  const load = useCallback(() => {
    if (id) listRooms(id).then(setRooms);
  }, [id]);
  useFocusEffect(load);

  // only rooms that have a scan (outline captured)
  const scanned = rooms.filter(r => (r.walls2d && r.walls2d.length > 0) || (r as any).scan);

  // group by unit
  const unitNames: string[] = [];
  const byUnit: Record<string, Room[]> = {};
  scanned.forEach(r => {
    const u = (r.unit && r.unit.trim()) ? r.unit.trim() : 'General';
    if (!byUnit[u]) { byUnit[u] = []; unitNames.push(u); }
    byUnit[u].push(r);
  });

  const fmt = (s: any): string => {
    if (!s) return '';
    const doors = s.doors ?? 0, windows = s.windows ?? 0;
    return `${s.lengthFt ?? '?'} \u00d7 ${s.widthFt ?? '?'} ft \u00b7 ${s.heightFt ?? '?'} ft ceiling\n` +
      `Floor ${s.floorAreaSqFt ?? '?'} sq ft \u00b7 Walls ${s.wallGrossSqFt ?? '?'} sq ft (${s.wallNetSqFt ?? '?'} net)\n` +
      `${doors} door${doors === 1 ? '' : 's'}, ${windows} window${windows === 1 ? '' : 's'}`;
  };

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      {scanned.length === 0 && (
        <Text style={ui.empty}>No scans yet. Open a room and tap "Scan room" to capture an outline and measurements.</Text>
      )}
      {unitNames.map(u => (
        <View key={u} style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 4 }}>{u}</Text>
          {byUnit[u].map(r => (
            <Pressable key={r.id} style={ui.card}
              onPress={() => router.push(`/project/room?projectId=${id}&roomId=${r.id}`)}>
              <Text style={ui.cardTitle}>{r.name || 'Room'}</Text>
              {!!(r as any).scan && (
                <Text style={{ fontSize: 13, color: '#333', marginVertical: 6 }}>{fmt((r as any).scan)}</Text>
              )}
              {r.walls2d && r.walls2d.length > 0 && (
                <FloorPlan walls={r.walls2d as Wall2D[]} size={200} />
              )}
              <Text style={{ color: '#185FA5', fontSize: 12, marginTop: 6 }}>Tap to open room</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
