import { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getScores, type VendorScore } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

function scoreColor(score: number): string {
  if (score >= 80) return '#1a8f4c';
  if (score >= 55) return '#b8860b';
  return '#c0392b';
}

export default function ContractorScores() {
  const [scores, setScores] = useState<VendorScore[]>([]);
  const [isFallback, setIsFallback] = useState(false);

  const load = useCallback(() => {
    getScores().then((snapshot) => {
      setScores(snapshot.vendors);
      setIsFallback(snapshot.isFallback);
    });
  }, []);
  useFocusEffect(load);

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Vendor Scores</Text>
      <Text style={ui.label}>Based on closed jobs: 60% performance, 25% on-time within 14 days, minus 15% for the deduction rate.</Text>
      {isFallback && <Text style={[ui.label, { color: '#9a3412' }]}>Server unavailable. Showing existing local vendor calculations.</Text>}

      {scores.length === 0 && <Text style={ui.empty}>No closed & rated vendor jobs yet.</Text>}

      {scores.map((c) => (
        <View key={c.name} style={[ui.card, { gap: 6 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: ACCENT }}>{c.name}</Text>
            <View style={{ backgroundColor: scoreColor(c.score), borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{c.score}</Text>
            </View>
          </View>
          <View style={ui.line}><Text style={ui.lineK}>Jobs completed</Text><Text style={ui.lineV}>{c.completed}</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>On-time</Text><Text style={ui.lineV}>{Math.round(c.onTimeRate * 100)}%</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>Jobs docked</Text><Text style={ui.lineV}>{c.deductions}</Text></View>
        </View>
      ))}
    </ScrollView>
  );
}
