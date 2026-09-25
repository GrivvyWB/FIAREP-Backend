import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { customFetch } from '@workspace/api-client-react';
import { computeMeasurement, MATERIAL_LABELS, type MaterialKind } from '../lib/measurements';
import { isARMeasureSupported, measureArea } from '../modules/ar-measure/src';
import { getCurrentPosition } from '../lib/store';
import { useRawModules } from '../lib/module-access';
import { allowedMaterialsForTrade } from '../lib/measurement-access';

const ACCENT = '#1E7D4F';

const MATERIALS: MaterialKind[] = [
  'concrete', 'sheetrock', 'plywood', 'floor-tile', 'wall-tile', 'wood-floor', 'paint', 'window', 'door', 'room',
];
const CHIP: Record<MaterialKind, string> = {
  concrete: 'Concrete', sheetrock: 'Sheetrock', plywood: 'Plyboard', 'floor-tile': 'Floor tile',
  'wall-tile': 'Wall tile', 'wood-floor': 'Wood floor', paint: 'Paint', window: 'Window', door: 'Door', room: 'Room',
};
const DIM_LABELS: Record<MaterialKind, { a: string; b: string }> = {
  concrete: { a: 'Length (ft)', b: 'Width (ft)' },
  sheetrock: { a: 'Width (ft)', b: 'Height (ft)' },
  plywood: { a: 'Width (ft)', b: 'Height (ft)' },
  window: { a: 'Width (ft)', b: 'Height (ft)' },
  door: { a: 'Opening width (ft)', b: 'Opening height (ft)' },
  room: { a: 'Length (ft)', b: 'Width (ft)' },
  'floor-tile': { a: 'Length (ft)', b: 'Width (ft)' },
  'wall-tile': { a: 'Wall width (ft)', b: 'Wall height (ft)' },
  'wood-floor': { a: 'Length (ft)', b: 'Width (ft)' },
  paint: { a: 'Surface width (ft)', b: 'Surface height (ft)' },
};

export default function Measurement() {
  const router = useRouter();
  const [material, setMaterial] = useState<MaterialKind>('concrete');
  const [photo, setPhoto] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [thickness, setThickness] = useState('');
  const [tileW, setTileW] = useState('12');
  const [tileH, setTileH] = useState('12');
  const [boxSqFt, setBoxSqFt] = useState('20');
  const [coats, setCoats] = useState('2');
  const [coverage, setCoverage] = useState('350');
  const [position, setPosition] = useState('');
  const rawModules = useRawModules();
  useEffect(() => { getCurrentPosition().then((p: any) => setPosition(String(p || ''))).catch(() => {}); }, []);
  const allowed = allowedMaterialsForTrade(position, rawModules);
  const visibleMaterials = allowed.length ? allowed : MATERIALS;
  useEffect(() => { if (visibleMaterials.length && !visibleMaterials.includes(material)) setMaterial(visibleMaterials[0]); }, [visibleMaterials.join(',')]);
  const [arSupported, setArSupported] = useState(false);
  const [arBusy, setArBusy] = useState(false);
  useEffect(() => { try { setArSupported(isARMeasureSupported()); } catch { setArSupported(false); } }, []);

  const runAR = async () => {
    setArBusy(true);
    try {
      const r = await measureArea();
      const round1 = (n?: number) => (typeof n === 'number' ? String(Math.round(n * 100) / 100) : '');
      if (r.widthFt) setA(round1(r.widthFt));
      if (r.heightFt) setB(round1(r.heightFt));
      setAiNote(r.areaSqFt ? `AR measured ${Math.round(r.areaSqFt * 100) / 100} sq ft — adjust below if needed.` : 'AR measurement captured.');
    } catch (e: any) {
      Alert.alert('AR measure', e?.message ? String(e.message) : 'Could not measure. Enter the dimensions manually.');
    } finally { setArBusy(false); }
  };

  const result = useMemo(() => computeMeasurement({
    material,
    lengthFt: parseFloat(a) || 0,
    widthFt: parseFloat(b) || 0,
    thicknessIn: parseFloat(thickness) || 0,
    tileWidthIn: parseFloat(tileW) || 0,
    tileHeightIn: parseFloat(tileH) || 0,
    boxSqFt: parseFloat(boxSqFt) || 0,
    coats: parseFloat(coats) || 0,
    coverageSqFt: parseFloat(coverage) || 0,
  }), [material, a, b, thickness, tileW, tileH, boxSqFt, coats, coverage]);

  const capture = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Camera needed', 'Allow camera access to identify the material.'); return; }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true, allowsEditing: false });
      if (shot.canceled || !shot.assets?.[0]) return;
      const asset = shot.assets[0];
      setPhoto(asset.uri);
      if (!asset.base64) return;
      setClassifying(true); setAiNote('');
      try {
        const res = await customFetch<{ material: MaterialKind; confidence: number; note: string }>(
          '/api/ai/classify-material',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: `data:image/jpeg;base64,${asset.base64}` }), responseType: 'json' },
        );
        if (res?.material && (MATERIALS as string[]).includes(res.material)) {
          setMaterial(res.material);
          setAiNote(`Detected ${MATERIAL_LABELS[res.material]}${res.confidence ? ` (${Math.round(res.confidence * 100)}%)` : ''}. ${res.note || ''}`.trim());
        } else {
          setAiNote("Couldn't identify the material — pick it below.");
        }
      } catch {
        setAiNote('Material auto-detect unavailable — pick it below.');
      } finally { setClassifying(false); }
    } catch { setClassifying(false); }
  };

  const dims = DIM_LABELS[material];
  const isTile = material === 'floor-tile' || material === 'wall-tile';
  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 12, color: '#4A5560', marginBottom: 4 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder="0"
        style={{ borderWidth: 1.5, borderColor: '#D3DAD5', borderRadius: 12, padding: 12, fontSize: 16, backgroundColor: '#fff' }} />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F7F6' }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={{ color: ACCENT, fontWeight: '600', fontSize: 16 }}>‹ Back</Text></Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 18, marginRight: 40 }}>Measurement</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Pressable onPress={capture} style={{ borderRadius: 16, backgroundColor: ACCENT, paddingVertical: 16, alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{photo ? 'Retake photo' : 'Point camera & take photo'}</Text>
        </Pressable>
        {arSupported && (
          <Pressable onPress={runAR} disabled={arBusy} style={{ borderRadius: 16, borderWidth: 2, borderColor: ACCENT, paddingVertical: 14, alignItems: 'center', marginBottom: 12, opacity: arBusy ? 0.6 : 1 }}>
            <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 15 }}>{arBusy ? 'Measuring…' : 'AR Measure (LiDAR) — tap the corners'}</Text>
          </Pressable>
        )}
        {photo && <Image source={{ uri: photo }} style={{ width: '100%', height: 200, borderRadius: 16, marginBottom: 12, backgroundColor: '#E4E9E6' }} resizeMode="cover" />}
        {classifying && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><ActivityIndicator color={ACCENT} /><Text style={{ color: '#4A5560' }}>Identifying material…</Text></View>}
        {!!aiNote && <Text style={{ color: '#4A5560', marginBottom: 12, fontSize: 13 }}>{aiNote}</Text>}

        <Text style={{ fontSize: 12, color: '#4A5560', marginBottom: 6 }}>Material</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
          {visibleMaterials.map((m, i) => (
            <Pressable key={m} onPress={() => setMaterial(m)}
              style={{ width: '31.5%', marginRight: (i % 3) === 2 ? 0 : '2.75%', marginBottom: 8, borderRadius: 12, borderWidth: 1.5, borderColor: ACCENT, backgroundColor: material === m ? ACCENT : 'transparent', paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: material === m ? '#fff' : ACCENT, fontWeight: '600', fontSize: 12 }}>{CHIP[m]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          {field(dims.a, a, setA)}
          {field(dims.b, b, setB)}
        </View>
        {material === 'concrete' && <View style={{ marginBottom: 12 }}>{field('Thickness / depth (inches)', thickness, setThickness)}</View>}
        {isTile && <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>{field('Tile width (in)', tileW, setTileW)}{field('Tile height (in)', tileH, setTileH)}</View>}
        {material === 'wood-floor' && <View style={{ marginBottom: 12 }}>{field('Box coverage (sq ft / box)', boxSqFt, setBoxSqFt)}</View>}
        {material === 'paint' && <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>{field('Coats', coats, setCoats)}{field('Coverage (sq ft / gal)', coverage, setCoverage)}</View>}

        <View style={{ borderRadius: 16, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#D3DAD5', padding: 16, marginTop: 4 }}>
          <Text style={{ fontSize: 12, color: '#4A5560', marginBottom: 6 }}>Result</Text>
          <Text style={{ fontSize: 15, marginBottom: 2 }}>Area: <Text style={{ fontWeight: '700' }}>{result.areaSqFt} sq ft</Text></Text>
          {material === 'concrete' && <>
            <Text style={{ fontSize: 15, marginBottom: 2 }}>Volume: <Text style={{ fontWeight: '700' }}>{result.cubicYards ?? 0} cubic yards</Text></Text>
            <Text style={{ fontSize: 15 }}>Order: <Text style={{ fontWeight: '700', color: ACCENT }}>~{result.orderCubicYards ?? 0} cu yd</Text></Text>
          </>}
          {(material === 'sheetrock' || material === 'plywood') && <Text style={{ fontSize: 15 }}>Sheets (4×8): <Text style={{ fontWeight: '700', color: ACCENT }}>{result.sheets ?? 0}</Text></Text>}
          {isTile && <Text style={{ fontSize: 15 }}>Tiles (incl 10% waste): <Text style={{ fontWeight: '700', color: ACCENT }}>{result.tiles ?? 0}</Text></Text>}
          {material === 'wood-floor' && <Text style={{ fontSize: 15 }}>Boxes (incl 10% waste): <Text style={{ fontWeight: '700', color: ACCENT }}>{result.boxes ?? 0}</Text></Text>}
          {material === 'paint' && <Text style={{ fontSize: 15 }}>Paint: <Text style={{ fontWeight: '700', color: ACCENT }}>{result.gallons ?? 0} gallon(s)</Text></Text>}
          {material === 'door' && !!result.doorSize && <Text style={{ fontSize: 15 }}>Nearest standard door: <Text style={{ fontWeight: '700', color: ACCENT }}>{result.doorSize}</Text></Text>}
        </View>

        <Text style={{ color: '#8A928C', fontSize: 12, marginTop: 16, textAlign: 'center' }}>
          Auto-measure (point & tap the corners) arrives with LiDAR AR — for now enter the dimensions.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
