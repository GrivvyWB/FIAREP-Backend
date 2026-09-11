import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Dimensions, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { listRooms, updateRoom, type Room } from '../../lib/store';
import RemotePhoto from '../../components/RemotePhoto';
import { ui } from '../../lib/ui';

export default function ProjectPhotos() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selected, setSelected] = useState<{ localUri: string; remote?: any } | null>(null);

  const load = useCallback(() => {
    if (id) listRooms(id).then(setRooms);
  }, [id]);
  useFocusEffect(load);

  // group all room photos by unit/apartment
  const unitNames: string[] = [];
  const photosByUnit: Record<string, { uri: string; remote?: any; room: string; roomId: string }[]> = {};
  rooms.forEach((r) => {
    const u = (r.unit && r.unit.trim()) ? r.unit.trim() : 'General';
    (r.photos ?? []).forEach((uri) => {
      if (!photosByUnit[u]) { photosByUnit[u] = []; unitNames.push(u); }
      const remote = ((r as any).remoteFiles || []).find((f: any) => f.localUri === uri);
      photosByUnit[u].push({ uri, remote, room: r.name || 'Room', roomId: r.id });
    });
  });

  const total = Object.values(photosByUnit).reduce((s, a) => s + a.length, 0);

  const deletePhoto = (roomId: string, uri: string) => {
    Alert.alert('Delete photo?', 'This removes the photo from the room permanently.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const r = rooms.find(x => x.id === roomId);
        if (!r) return;
        const nextPhotos = (r.photos ?? []).filter(p => p !== uri);
        await updateRoom(r.id, r.name, r.lines, nextPhotos, (r.walls2d ?? []) as any, r.unit ?? '', (r as any).scan ?? null);
        load();
      }},
    ]);
  };

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      {total === 0 && (
        <Text style={ui.empty}>No photos yet. Add photos to rooms and they'll be grouped by apartment here.</Text>
      )}
      {unitNames.map((u) => (
        <View key={u} style={{ marginTop: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 17, fontWeight: '600' }}>{u}</Text>
            <Text style={{ color: '#666', fontSize: 13 }}>{photosByUnit[u].length} photo{photosByUnit[u].length === 1 ? '' : 's'}</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {photosByUnit[u].map((p, i) => (
              <View key={p.uri + i} style={{ width: 108 }}>
                <Pressable onPress={() => setSelected({ localUri: p.uri, remote: p.remote })}>
                  <RemotePhoto localUri={p.uri} remote={p.remote} style={{ width: 108, height: 108, borderRadius: 8 }} />
                </Pressable>
                <Pressable onPress={() => deletePhoto(p.roomId, p.uri)} style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#c0392b', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 17 }}>×</Text>
                </Pressable>
                <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }} numberOfLines={1}>{p.room}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable onPress={() => setSelected(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}>
          {selected && (
            <RemotePhoto localUri={selected.localUri} remote={selected.remote}
              style={{ width: Dimensions.get('window').width, height: Dimensions.get('window').height * 0.8 }}
              resizeMode="contain" />
          )}
          <Pressable onPress={() => setSelected(null)} style={{ position: 'absolute', top: 50, right: 20, padding: 10 }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>Done</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
