import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getTruckScores, type TruckScore } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

const scoreColor = (n: number) => n > 0 ? '#1a8f4c' : n < 0 ? '#c0392b' : '#666';
const stateColor = (s: string) => s === 'completed' ? '#1a8f4c' : '#c0392b';
function fmt(iso?: string): string { try { return iso ? new Date(iso).toLocaleDateString() : ''; } catch { return ''; } }

export default function TruckScores() {
  const [scores, setScores] = useState<TruckScore[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [picker, setPicker] = useState(false);

  const load = useCallback(() => {
    getTruckScores().then((all) => { setScores(all); setSelected((cur) => cur || (all[0] ? all[0].truck : '')); });
  }, []);
  useFocusEffect(load);

  const current = scores.find((s) => s.truck === selected);

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Truck Scores</Text>
      <Text style={ui.label}>+10 per completed emergency, -5 per still-active. Ranked below; pick a truck for its history.</Text>

      {scores.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No trucks yet.</Text>}

      {/* Ranked list */}
      {scores.length > 0 && (
        <View style={[ui.card, { marginTop: 10, gap: 2 }]}>
          <Text style={{ fontWeight: '700', fontSize: 13, marginBottom: 4 }}>Ranking</Text>
          {scores.map((s, i) => (
            <Pressable key={s.truck} onPress={() => setSelected(s.truck)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: '#f2f2f2' }}>
              <Text style={{ fontSize: 15, fontWeight: s.truck === selected ? '700' : '500', flex: 1 }}>{i + 1}. {s.truck}</Text>
              <Text style={{ fontSize: 12, color: '#1a8f4c', marginRight: 10 }}>{s.completed} done</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: scoreColor(s.score) }}>{s.score > 0 ? '+' : ''}{s.score}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Dropdown */}
      {scores.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 14 }}>
          <Pressable style={[ui.input, { flex: 1 }]} onPress={() => setPicker(true)}>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>{selected || 'Pick a truck'}  ▾</Text>
          </Pressable>
          {!!selected && (
            <Pressable style={ui.btnOutline} onPress={() => setSelected('')}>
              <Text style={{ color: '#c0392b', fontWeight: '600' }}>Close</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Selected truck page */}
      {current && (
        <View style={[ui.card, { gap: 6, marginTop: 12 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{current.truck}</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: scoreColor(current.score) }}>{current.score > 0 ? '+' : ''}{current.score}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Text style={{ fontSize: 12, color: '#1a8f4c' }}>{current.completed} completed</Text>
            <Text style={{ fontSize: 12, color: '#c0392b' }}>{current.active} active</Text>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6, gap: 6 }}>
            {current.items.length === 0 ? (
              <Text style={ui.listSub}>No emergency jobs yet.</Text>
            ) : current.items.map((it, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14 }}><Text style={{ fontWeight: '700', color: ACCENT }}>{it.emId}</Text> {it.label}</Text>
                  {!!it.at && <Text style={ui.listSub}>{fmt(it.at)}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: stateColor(it.state) }}>{it.state}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: scoreColor(it.points) }}>{it.points > 0 ? '+' : ''}{it.points}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
      <View style={{ height: 40 }} />

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Pick a truck</Text>
            <ScrollView>
              {scores.map((s) => (
                <Pressable key={s.truck} onPress={() => { setSelected(s.truck); setPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 15 }}>{s.truck}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: scoreColor(s.score) }}>{s.score > 0 ? '+' : ''}{s.score}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => setPicker(false)} style={{ padding: 16 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
