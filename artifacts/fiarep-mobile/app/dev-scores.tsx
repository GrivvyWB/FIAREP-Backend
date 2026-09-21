import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Modal } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getScores, deleteScoreItem, type DevelopmentScore } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { useAppMode } from './_layout';
import { useDeletionPolicy } from '../lib/useDeletionPolicy';

const scoreColor = (n: number) => n > 0 ? '#1a8f4c' : n < 0 ? '#c0392b' : '#666';
const stateColor = (s: string) => s === 'completed' ? '#1a8f4c' : s === 'overdue' ? '#c0392b' : '#B4741A';
const kindLabel: Record<string, string> = { scope: 'Scope', route: 'Route', violation: 'Violation', report: 'Report', inspection: 'Inspection' };

export default function DevScores() {
  const { mode } = useAppMode();
  const policyCanDelete = useDeletionPolicy();
  const canDelete = (mode === 'administrator' || mode === 'management') && policyCanDelete;
  const [scores, setScores] = useState<DevelopmentScore[]>([]);
  const [selectedDev, setSelectedDev] = useState<string>('');
  const [picker, setPicker] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  const load = useCallback(() => {
    getScores().then((snapshot) => {
      setScores(snapshot.developments);
      setIsFallback(snapshot.isFallback);
      setSelectedDev((cur) => cur || (snapshot.developments[0] ? snapshot.developments[0].development : ''));
    });
  }, []);
  useFocusEffect(load);

  function del(it: any) {
    Alert.alert('Delete this item?', it.label + '\n\nThis permanently removes the record and its score. Cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteScoreItem(it.kind, it.id); load(); } },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Development Scores</Text>
      <Text style={ui.label}>Score = 50 + points: completed +10, open -5, overdue -10 (open 14+ days). Pick a development to view its page.</Text>
      {isFallback && <Text style={[ui.label, { color: '#9a3412' }]}>Server unavailable. Showing existing local development calculations.</Text>}

      {scores.length === 0 && <Text style={[ui.empty, { marginTop: 20 }]}>No scored work yet.</Text>}

      {scores.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <Pressable style={[ui.input, { flex: 1 }]} onPress={() => setPicker(true)}>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>{selectedDev || 'Pick a development'}  ▾</Text>
          </Pressable>
          {!!selectedDev && (
            <Pressable style={ui.btnOutline} onPress={() => setSelectedDev('')}>
              <Text style={{ color: '#c0392b', fontWeight: '600' }}>Close</Text>
            </Pressable>
          )}
        </View>
      )}

      {scores.filter((d) => d.development === selectedDev).map((d) => (
        <View key={d.development} style={[ui.card, { gap: 6, marginTop: 12 }]}>
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', flex: 1 }}>{d.development}</Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: scoreColor(d.scorePercent ?? d.score) }}>{d.scorePercent ?? d.score}%</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 2 }}>
              <Text style={{ fontSize: 12, color: '#1a8f4c' }}>{d.completed} done</Text>
              <Text style={{ fontSize: 12, color: '#B4741A' }}>{d.open} open</Text>
              <Text style={{ fontSize: 12, color: '#c0392b' }}>{d.overdue} overdue</Text>
            </View>
          </View>

          {(
            <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6, gap: 6 }}>
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={ui.listSub}>Base score</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700' }}>50</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={ui.listSub}>Completed: {d.completed} × +10</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: scoreColor(d.completed * 10) }}>+{d.completed * 10}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={ui.listSub}>Open: {d.open} × -5</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: scoreColor(d.open * -5) }}>{d.open * -5}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={ui.listSub}>Overdue: {d.overdue} × -10</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: scoreColor(d.overdue * -10) }}>{d.overdue * -10}</Text>
                </View>
              </View>
              {d.items && d.items.length > 0 && d.items.map((it, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14 }}><Text style={{ fontWeight: '700' }}>{kindLabel[it.kind]}:</Text> {it.label}</Text>
                    {!!it.who && <Text style={ui.listSub}>{it.who}</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: stateColor(it.state) }}>{it.state}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: scoreColor(it.points) }}>{it.points > 0 ? '+' : ''}{it.points}</Text>
                    {canDelete && (
                      <Pressable onPress={() => del(it)} hitSlop={8}>
                        <Text style={{ fontSize: 12, color: '#c0392b', fontWeight: '600', marginTop: 2 }}>Delete</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
      <View style={{ height: 40 }} />
      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Pick a development</Text>
            <ScrollView>
              {scores.map((d) => (
                <Pressable key={d.development} onPress={() => { setSelectedDev(d.development); setPicker(false); }} style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 15 }}>{d.development}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: scoreColor(d.scorePercent ?? d.score) }}>{d.scorePercent ?? d.score}%</Text>
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
