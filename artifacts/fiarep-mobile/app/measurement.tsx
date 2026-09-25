import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { customFetch } from '@workspace/api-client-react';
import { computeMeasurement, MATERIAL_LABELS, type MaterialKind } from '../lib/measurements';

const ACCENT = '#1E7D4F';
const MATERIALS: MaterialKind[] = ['concrete', 'sheetrock', 'window'];

// Contextual labels for the two primary dimension inputs per material.
const DIM_LABELS: Record<MaterialKind, { a: string; b: string }> = {
  concrete: { a: 'Length (ft)', b: 'Width (ft)' },
  sheetrock: { a: 'Width (ft)', b: 'Height (ft)' },
  window: { a: 'Width (ft)', b: 'Height (ft)' },
};

export default function Measurement() {
  const router = useRouter();
  const [material, setMaterial] = useState<MaterialKind>('concrete');
  const [photo, setPhoto] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [aiNote, setAiNote] = useState<string>('');
  const [a, setA] = useState('');   // length / width (ft)
  const [b, setB] = useState('');   // width / height (ft)
  const [thickness, setThickness] = useState(''); // concrete only (in)

  const result = useMemo(() => computeMeasurement({
    material,
    lengthFt: parseFloat(a) || 0,
    widthFt: parseFloat(b) || 0,
    thicknessIn: parseFloat(thickness) || 0,
  }), [material, a, b, thickness]);

  const capture = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Camera needed', 'Allow camera access to identify the material.'); return; }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true, allowsEditing: false });
      if (shot.canceled || !shot.assets?.[0]) return;
      const asset = shot.assets[0];
      setPhoto(asset.uri);
      if (!asset.base64) return;
      setClassifying(true);
      setAiNote('');
      try {
        const res = await customFetch<{ material: MaterialKind; confidence: number; note: string }>(
          '/api/ai/classify-material',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: `data:image/jpeg;base64,${asset.base64}` }),
            responseType: 'json',
          },
        );
        if (res?.material && res.material !== 'unknown' && MATERIALS.includes(res.material)) {
          setMaterial(res.material);
          setAiNote(`Detected ${MATERIAL_LABELS[res.material]}${res.confidence ? ` (${Math.round(res.confidence * 100)}%)` : ''}. ${res.note || ''}`.trim());
        } else {
          setAiNote("Couldn't identify the material — pick it below.");
        }
      } catch {
        setAiNote('Material auto-detect unavailable — pick it below.');
      } finally {
        setClassifying(false);
      }
    } catch {
      setClassifying(false);
    }
  };

  const dims = DIM_LABELS[material];
  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 12, color: '#4A5560', marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        style={{ borderWidth: 1.5, borderColor: '#D3DAD5', borderRadius: 12, padding: 12, fontSize: 16, backgroundColor: '#fff' }}
      />
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

        {photo && <Image source={{ uri: photo }} style={{ width: '100%', height: 200, borderRadius: 16, marginBottom: 12, backgroundColor: '#E4E9E6' }} resizeMode="cover" />}
        {classifying && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><ActivityIndicator color={ACCENT} /><Text style={{ color: '#4A5560' }}>Identifying material…</Text></View>}
        {!!aiNote && <Text style={{ color: '#4A5560', marginBottom: 12, fontSize: 13 }}>{aiNote}</Text>}

        <Text style={{ fontSize: 12, color: '#4A5560', marginBottom: 6 }}>Material</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {MATERIALS.map((m) => (
            <Pressable key={m} onPress={() => setMaterial(m)} style={{ flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: ACCENT, backgroundColor: material === m ? ACCENT : 'transparent', paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: material === m ? '#fff' : ACCENT, fontWeight: '600', fontSize: 13 }}>{m === 'sheetrock' ? 'Sheetrock' : m === 'window' ? 'Window' : 'Concrete'}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          {field(dims.a, a, setA)}
          {field(dims.b, b, setB)}
        </View>
        {material === 'concrete' && (
          <View style={{ marginBottom: 12 }}>{field('Thickness / depth (inches)', thickness, setThickness)}</View>
        )}

        <View style={{ borderRadius: 16, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#D3DAD5', padding: 16, marginTop: 4 }}>
          <Text style={{ fontSize: 12, color: '#4A5560', marginBottom: 6 }}>Result</Text>
          {result.areaSqFt !== undefined && <Text style={{ fontSize: 15, marginBottom: 2 }}>Area: <Text style={{ fontWeight: '700' }}>{result.areaSqFt} sq ft</Text></Text>}
          {material === 'concrete' && (
            <>
              <Text style={{ fontSize: 15, marginBottom: 2 }}>Volume: <Text style={{ fontWeight: '700' }}>{result.cubicYards ?? 0} cubic yards</Text></Text>
              <Text style={{ fontSize: 15 }}>Order: <Text style={{ fontWeight: '700', color: ACCENT }}>~{result.orderCubicYards ?? 0} cu yd</Text></Text>
            </>
          )}
          {material === 'sheetrock' && <Text style={{ fontSize: 15 }}>Sheets (4×8): <Text style={{ fontWeight: '700', color: ACCENT }}>{result.sheets ?? 0}</Text></Text>}
          {material === 'window' && <Text style={{ fontSize: 15 }}>Opening: <Text style={{ fontWeight: '700', color: ACCENT }}>{result.areaSqFt ?? 0} sq ft</Text></Text>}
        </View>

        <Text style={{ color: '#8A928C', fontSize: 12, marginTop: 16, textAlign: 'center' }}>
          Auto-measure (point & tap the corners) arrives with LiDAR AR — for now enter the dimensions.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
