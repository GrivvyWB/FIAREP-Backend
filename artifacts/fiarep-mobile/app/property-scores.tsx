import { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getScores, type ScoresSnapshot } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

const scoreColor = (score: number) => score >= 80 ? '#1a8f4c' : score >= 55 ? '#b8860b' : '#c0392b';

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={ui.line}>
      <Text style={ui.lineK}>{label}</Text>
      <Text style={ui.lineV}>{value}</Text>
    </View>
  );
}

export default function PropertyScores() {
  const [snapshot, setSnapshot] = useState<ScoresSnapshot | null>(null);

  const load = useCallback(() => {
    getScores().then(setSnapshot);
  }, []);
  useFocusEffect(load);

  const buildings = snapshot?.buildings ?? [];
  const residential = snapshot?.residential ?? [];

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Building & Residential Scores</Text>
      {snapshot?.isFallback && (
        <Text style={[ui.label, { color: '#9a3412' }]}>
          Server unavailable. Building and residential scores are not available offline.
        </Text>
      )}

      <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 12, marginBottom: 8 }}>
        Building
      </Text>
      {snapshot && buildings.length === 0 && <Text style={ui.empty}>No building scores yet.</Text>}
      {buildings.map((building) => (
        <View key={building.building} style={[ui.card, { gap: 6 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: ACCENT, flex: 1 }}>{building.building}</Text>
            <View style={{ backgroundColor: scoreColor(building.score), borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{building.score}</Text>
            </View>
          </View>
          <Metric label="Total" value={building.total} />
          <Metric label="Resolved" value={building.resolved} />
          <Metric label="Open" value={building.open} />
          <Metric label="Overdue" value={building.overdue} />
          <Metric label="Resolution rate" value={`${Math.round(building.resolutionRate * 100)}%`} />
        </View>
      ))}

      <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 }}>
        Residential
      </Text>
      {snapshot && residential.length === 0 && <Text style={ui.empty}>No residential scores yet.</Text>}
      {residential.map((home) => (
        <View key={home.address} style={[ui.card, { gap: 6 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: ACCENT, flex: 1 }}>{home.address}</Text>
            <View style={{ backgroundColor: scoreColor(home.score), borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{home.score}</Text>
            </View>
          </View>
          <Metric label="Total" value={home.total} />
          <Metric label="Resolved" value={home.resolved} />
          <Metric label="Open" value={home.open} />
          <Metric label="Overdue" value={home.overdue} />
          <Metric label="Resolution rate" value={`${Math.round(home.resolutionRate * 100)}%`} />
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}