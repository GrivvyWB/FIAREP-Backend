import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';
import { getCurrentActor } from '../lib/store';
import { ACCENT } from '../lib/ui';

// Every measurement and material list saved from the Measurement screen, with
// the picture it was taken from, so it can be looked at again later.

type Rec = { id: string; development?: string | null; createdAt?: string; state: any };

function fmt(iso?: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function SavedMeasurements() {
  const router = useRouter();
  const [items, setItems] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mineOnly, setMineOnly] = useState(true);
  const [me, setMe] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const actor = await getCurrentActor();
        if (active) setMe(actor.id || '');
        const rows = await customFetch<Rec[]>('/api/v1/measurements', { responseType: 'json' });
        if (!active) return;
        const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.state);
        list.sort((x, y) => String(y.state?.createdAt || y.createdAt || '').localeCompare(String(x.state?.createdAt || x.createdAt || '')));
        setItems(list);
      } catch (e: any) {
        if (active) setError(e?.message ? String(e.message) : 'Could not load saved measurements.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []));

  const shown = items.filter((r) => !mineOnly || !me || r.state?.byId === me);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F7F6' }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={{ color: ACCENT, fontWeight: '600', fontSize: 16 }}>‹ Back</Text></Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 18, marginRight: 40 }}>Saved measurements</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {[['Mine', true], ['Everyone', false]].map(([label, value]) => (
            <Pressable key={String(label)} onPress={() => setMineOnly(value as boolean)} style={{ flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: ACCENT, backgroundColor: mineOnly === value ? ACCENT : '#fff', paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: mineOnly === value ? '#fff' : ACCENT, fontWeight: '700' }}>{String(label)}</Text>
            </Pressable>
          ))}
        </View>
        {loading && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color={ACCENT} /><Text style={{ color: '#4A5560' }}>Loading…</Text></View>}
        {!!error && <Text style={{ color: '#c00' }}>{error}</Text>}
        {!loading && !error && shown.length === 0 && (
          <Text style={{ color: '#8A928C', textAlign: 'center', marginTop: 40 }}>No saved measurements yet. Take a photo on the Measurement screen, enter or accept the size, and press Save.</Text>
        )}
        {shown.map((r) => {
          const st = r.state || {};
          const pic = st.photoDataUrl || st.photoLocalUri || '';
          const isOpen = open === r.id;
          const dims = st.material === 'materials'
            ? ''
            : [st.lengthFt ? `${st.lengthFt} ft` : '', st.widthFt ? `${st.widthFt} ft` : ''].filter(Boolean).join(' × ');
          return (
            <Pressable key={r.id} onPress={() => setOpen(isOpen ? null : r.id)} style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E4E9E6', padding: 12, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {pic ? <Image source={{ uri: pic }} style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: '#E4E9E6' }} resizeMode="cover" />
                     : <View style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: '#E4E9E6', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#8A928C', fontSize: 11 }}>no photo</Text></View>}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15 }}>{st.materialLabel || st.material || 'Measurement'}{dims ? ` · ${dims}` : ''}</Text>
                  {!!st.summary && <Text style={{ color: '#4A5560', marginTop: 2 }} numberOfLines={isOpen ? undefined : 2}>{st.summary}</Text>}
                  <Text style={{ color: '#8A928C', fontSize: 12, marginTop: 4 }}>{[st.development || r.development, st.by, fmt(st.createdAt || r.createdAt)].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
              {isOpen && (
                <View style={{ marginTop: 12 }}>
                  {!!pic && <Image source={{ uri: pic }} style={{ width: '100%', height: 240, borderRadius: 12, backgroundColor: '#E4E9E6', marginBottom: 10 }} resizeMode="contain" />}
                  {[
                    ['Area', st.areaSqFt ? `${st.areaSqFt} sq ft` : ''],
                    ['Thickness', st.thicknessIn ? `${st.thicknessIn} in` : ''],
                    ['Concrete', st.orderCubicYards ? `${st.orderCubicYards} cu yd to order (${st.cubicYards} exact)` : ''],
                    ['Sheets', st.sheets ? String(st.sheets) : ''],
                    ['Tiles', st.tiles ? `${st.tiles} (${st.tileWidthIn}×${st.tileHeightIn} in)` : ''],
                    ['Boxes', st.boxes ? String(st.boxes) : ''],
                    ['Paint', st.gallons ? `${st.gallons} gal (${st.coats} coats)` : ''],
                    ['Door size', st.doorSize || ''],
                    ['Note', st.note || ''],
                  ].filter(([, v]) => v).map(([k, v]) => (
                    <View key={String(k)} style={{ flexDirection: 'row', marginBottom: 4 }}>
                      <Text style={{ width: 90, color: '#8A928C', fontSize: 13 }}>{k}</Text>
                      <Text style={{ flex: 1, color: '#1F2A24', fontSize: 13 }}>{String(v)}</Text>
                    </View>
                  ))}
                  {Array.isArray(st.items) && st.items.length > 0 && (
                    <View style={{ marginTop: 4 }}>
                      {st.items.map((it: any, i: number) => <Text key={i} style={{ color: '#1F2A24', fontSize: 13 }}>• {it.qty}× {it.name}</Text>)}
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
