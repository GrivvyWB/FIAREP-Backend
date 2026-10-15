// FIAREP Multi-Complaint Priority Engine — every open resident complaint in a
// building, read from its photo and words, ranked most critical first, with the
// same trade grouped into one route. Opens and ranks on its own.
import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getAccessToken } from '../lib/store';
import { ui } from '../lib/ui';

type Item = { rank: number; reportId: string; location: string; issue: string; trade: string; level: 'Emergency' | 'High' | 'Medium' | 'Low'; risk: string; action: string; status: string; reportStatus: string };
type Building = { building: string; items: Item[]; routes: Array<{ trade: string; stops: string[] }> };
type Queue = { buildings: Building[]; analyzed: number; pending: number };

const NAVY = '#0B2A4A';
const BLUE = '#1C4E86';
const LEVEL_COLOR: Record<string, string> = { Emergency: '#b91c1c', High: '#c2410c', Medium: '#b45309', Low: '#166534' };
const ROUTE_ICON: Record<string, string> = { Plumber: '🔧', Electrician: '⚡', Painter: '🎨', Carpenter: '🪚', Mason: '🧱', Exterminator: '🐜', Locksmith: '🔑', HVAC: '🌡️', 'Elevator Service': '🛗', Glazier: '🪟', Roofer: '🏠', 'Fire Safety': '🧯' };
const routeName = (trade: string) => ({ Plumber: 'Plumbing', Electrician: 'Electrical', Painter: 'Painting', Carpenter: 'Carpentry', Mason: 'Masonry', Exterminator: 'Extermination', Locksmith: 'Locksmith', Roofer: 'Roofing', Glazier: 'Glazing' } as Record<string, string>)[trade] || trade;

async function loadQueue(): Promise<Queue> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const token = await getAccessToken();
  if (!domain || !token) throw new Error('Sign in first.');
  const res = await fetch(`https://${domain}/api/v1/priority-queue`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' });
  if (!res.ok) { const t = await res.json().catch(() => null); throw new Error((t && t.error) || 'Priority queue unavailable (' + res.status + ')'); }
  return res.json();
}

export default function PriorityQueue() {
  const router = useRouter();
  const [q, setQ] = useState<Queue | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<string | null>(null);

  const run = useCallback(() => {
    setBusy(true); setErr('');
    loadQueue().then((r) => { setQ(r); setSel((cur) => (cur && r.buildings.some((b) => b.building === cur) ? cur : r.buildings[0]?.building ?? null)); })
      .catch((e) => setErr(String(e?.message || e))).finally(() => setBusy(false));
  }, []);
  useFocusEffect(run);

  const b = q?.buildings.find((x) => x.building === sel) || null;
  return (
    <ScrollView style={{ backgroundColor: '#eef2f7' }} contentContainerStyle={{ padding: 12, gap: 10 }} refreshControl={<RefreshControl refreshing={busy && !!q} onRefresh={run} />}>
      <View style={{ backgroundColor: NAVY, borderRadius: 10, padding: 14, gap: 4 }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>FIAREP Multi-Complaint Priority Engine</Text>
        <Text style={{ color: '#cbd5e1', fontSize: 12 }}>Photo In → AI Analysis → Location Found → Repair Instructions → Tools & Materials → Ranked by Priority → Work Orders Assigned</Text>
      </View>

      {busy && !q && <View style={{ padding: 24, alignItems: 'center', gap: 8 }}><ActivityIndicator /><Text style={ui.listSub}>FIAREP is reading each complaint's photo and ranking them…</Text></View>}
      {!!err && <Text style={{ color: '#b91c1c' }}>{err}</Text>}
      {q && q.buildings.length === 0 && <Text style={ui.empty}>No open resident complaints.</Text>}
      {q && q.pending > 0 && <Text style={ui.listSub}>{q.pending} more complaint{q.pending === 1 ? '' : 's'} still to read — pull down to continue.</Text>}

      {q && q.buildings.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {q.buildings.map((x) => (
            <Pressable key={x.building} onPress={() => setSel(x.building)} style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: x.building === sel ? BLUE : '#cbd5e1', backgroundColor: x.building === sel ? BLUE : '#fff' }}>
              <Text style={{ color: x.building === sel ? '#fff' : '#0f172a', fontSize: 13 }}>{x.building} ({x.items.length})</Text>
            </Pressable>
          ))}
        </View>
      )}

      {b && (
        <>
          <Text style={{ fontWeight: '800', fontSize: 12, color: BLUE, letterSpacing: 0.4 }}>PRIORITIZED WORK QUEUE — tap one to open and assign</Text>
          {b.items.map((it) => (
            <Pressable key={it.reportId} onPress={() => router.push(('/report-detail?id=' + encodeURIComponent(it.reportId)) as any)} style={{ backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#dbe3ee' }}>
              <View style={{ backgroundColor: LEVEL_COLOR[it.level] || '#475569', paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Priority {it.rank} — {it.level}</Text>
              </View>
              <View style={{ padding: 12, gap: 2 }}>
                <Text style={{ fontSize: 14 }}>📍 {it.location}</Text>
                <Text style={{ fontSize: 14 }}>⚠ {it.issue}</Text>
                <Text style={{ fontSize: 14 }}>👷 Trade: {it.trade}</Text>
                {!!it.risk && <Text style={{ fontSize: 14 }}>🚨 Risk: {it.risk}</Text>}
                <Text style={{ fontSize: 14 }}>🔧 Action: <Text style={{ fontWeight: '700' }}>{it.action}</Text></Text>
                {!!it.reportStatus && <Text style={ui.listSub}>Complaint status: {it.reportStatus.replace('_', ' ')}</Text>}
              </View>
            </Pressable>
          ))}

          {b.routes.length > 0 && <Text style={{ fontWeight: '800', fontSize: 12, color: BLUE, letterSpacing: 0.4, marginTop: 4 }}>SMART GROUPING — one trip per trade</Text>}
          {b.routes.map((r) => (
            <View key={r.trade} style={{ backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#dbe3ee', padding: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '700' }}>{ROUTE_ICON[r.trade] || '🛠️'} {routeName(r.trade)} Route <Text style={{ fontWeight: '400' }}>({r.stops.length} stop{r.stops.length === 1 ? '' : 's'})</Text></Text>
              <Text style={{ fontSize: 14, marginTop: 2 }}>{r.stops.join(' · ')}</Text>
            </View>
          ))}

          <Text style={{ fontWeight: '800', fontSize: 12, color: BLUE, letterSpacing: 0.4, marginTop: 4 }}>MANAGEMENT VIEW</Text>
          <View style={{ backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#dbe3ee' }}>
            <View style={{ flexDirection: 'row', backgroundColor: BLUE, paddingVertical: 6, paddingHorizontal: 6 }}>
              {['#', 'Location', 'Issue', 'Trade', 'Status'].map((h, i) => <Text key={h} style={{ color: '#fff', fontWeight: '700', fontSize: 12, flex: [0.4, 1.1, 1.6, 1.2, 0.9][i] }}>{h}</Text>)}
            </View>
            {b.items.map((it) => (
              <View key={it.reportId} style={{ flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: '#eef2f7' }}>
                <Text style={{ flex: 0.4, fontSize: 12 }}>{it.rank}</Text>
                <Text style={{ flex: 1.1, fontSize: 12 }}>{it.location.split(' · ')[0]}</Text>
                <Text style={{ flex: 1.6, fontSize: 12 }}>{it.issue}</Text>
                <Text style={{ flex: 1.2, fontSize: 12 }}>{it.trade}</Text>
                <Text style={{ flex: 0.9, fontSize: 12, fontWeight: '700', color: LEVEL_COLOR[it.level] }}>{it.status}</Text>
              </View>
            ))}
          </View>
          <Text style={ui.listSub}>Risk and priority are FIAREP's reading of each photo and the resident's words — look at Emergency items right away.</Text>
        </>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
