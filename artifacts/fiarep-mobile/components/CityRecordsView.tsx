// A city's own record for a building outside New York City (Platform Control → City Records).
import { Linking, Pressable, Text, View } from 'react-native';
import { ui } from '../lib/ui';

export type CityRecord = { address: string; owner: string; units: number | null; value: number | null; use: string; yearBuilt: string; id: string; link: string };
export type CityViolation = { date: string; code: string; title: string; status: string; id: string };
export type CityRecords = { source: { id: string; label: string; publisher: string }; matched: string; records: CityRecord[]; violations: CityViolation[] | null; openViolations: number; retrievedAt: string };

const money = (n: number | null) => (n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`);

export default function CityRecordsView({ data }: { data: CityRecords }) {
  const units = data.records.reduce((a, r) => a + (r.units || 0), 0);
  return (
    <View style={[ui.card, { marginTop: 8, backgroundColor: '#f9f9f9', padding: 12 }]}>
      <Text style={[ui.cardTitle, { marginBottom: 4 }]}>{data.source.label} City Records</Text>
      <Text style={{ fontSize: 14, fontWeight: '600' }}>{data.matched}</Text>
      <Text style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
        {data.records.length} record{data.records.length === 1 ? '' : 's'}{units ? ` · ${units} units` : ''}{data.violations ? ` · ${data.openViolations} open violation${data.openViolations === 1 ? '' : 's'} of ${data.violations.length}` : ''}
      </Text>
      {data.records.length === 0 && <Text style={{ fontSize: 13, color: '#666' }}>The city's records have no building at this address.</Text>}
      {data.records.slice(0, 25).map((r, i) => (
        <Pressable key={`${r.id}-${i}`} disabled={!r.link} onPress={() => { if (r.link) void Linking.openURL(r.link); }} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderColor: '#e5e5e5' }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: r.link ? '#185FA5' : '#111' }}>{r.address}</Text>
          <Text style={{ fontSize: 13, color: '#333' }}>{[r.owner, r.units != null ? `${r.units} units` : '', money(r.value), r.use, r.yearBuilt && r.yearBuilt !== '0' ? `built ${r.yearBuilt}` : ''].filter(Boolean).join(' · ')}</Text>
        </Pressable>
      ))}
      {data.violations && data.violations.length > 0 && (
        <>
          <Text style={[ui.cardTitle, { marginTop: 10, marginBottom: 4 }]}>Violations</Text>
          {data.violations.slice(0, 40).map((v, i) => (
            <View key={`${v.id}-${i}`} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderColor: '#e5e5e5' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: /^open|in violation/i.test(v.status) ? '#c0392b' : '#555' }}>{v.status} · {v.date}</Text>
              <Text style={{ fontSize: 13 }}>{[v.code, v.title].filter(Boolean).join(' — ')}</Text>
            </View>
          ))}
        </>
      )}
      <Text style={{ fontSize: 11, color: '#777', marginTop: 8 }}>From {data.source.publisher}.</Text>
    </View>
  );
}
