import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getRoofData, type RoofData } from '../../lib/roof';
import { addRoom, getGlobalRates, getProject } from '../../lib/store';
import type { LineItem } from '../../lib/catalog';
import { ui, money } from '../../lib/ui';
import { useAppMode } from '../_layout';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export default function RoofLookup() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { mode } = useAppMode();
  const readOnly = mode === 'administrator';
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [roof, setRoof] = useState<RoofData | null>(null);

  const lookup = async () => {
    if (!address.trim()) { Alert.alert('Enter an address'); return; }
    setLoading(true); setRoof(null);
    try { setRoof(await getRoofData(address.trim())); }
    catch (e: any) { Alert.alert('Lookup failed', e?.message ?? 'Unknown error'); }
    finally { setLoading(false); }
  };

  const addRoofingLines = async () => {
    if (!roof || !projectId) return;
    const rates = (await getProject(projectId))?.rates ?? await getGlobalRates();
    const sq = Math.ceil(roof.squares * 1.1); // 10% waste
    const lines: LineItem[] = [
      { id: uid(), category: 'Roofing', description: 'Tear-off existing roof', quantity: sq, unit: 'sq', unitPrice: 120 },
      { id: uid(), category: 'Roofing', description: 'Underlayment', quantity: sq, unit: 'sq', unitPrice: 60 },
      { id: uid(), category: 'Roofing', description: 'Asphalt shingle roofing', quantity: sq, unit: 'sq', unitPrice: 450 },
    ];
    await addRoom(projectId, `Roof — ${roof.address.split(',')[0]}`, lines);
    Alert.alert('Added', `Roof added as ${sq} squares (incl. 10% waste).`);
    router.back();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Roof from aerial data</Text>
      <Text style={{ color: '#666', fontSize: 13 }}>Enter the building address. Roof area comes from Google Solar API satellite imagery.</Text>
      <View><Text style={ui.label}>Address</Text>
        <TextInput editable={!readOnly} style={ui.input} value={address} onChangeText={setAddress} placeholder="1600 Amphitheatre Pkwy, Mountain View CA" autoCapitalize="words" /></View>
      <Pressable style={ui.btn} onPress={lookup}><Text style={ui.btnText}>Look up roof</Text></Pressable>

      {loading && <ActivityIndicator style={{ marginTop: 16 }} />}

      {roof && (
        <View style={[ui.card, { marginTop: 12 }]}>
          <Text style={ui.cardTitle}>{roof.address}</Text>
          <View style={ui.line}><Text style={ui.lineK}>Total roof area</Text><Text style={ui.lineV}>{Math.round(roof.wholeRoofFt2).toLocaleString()} ft²</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>Footprint</Text><Text style={ui.lineV}>{Math.round(roof.groundFt2).toLocaleString()} ft²</Text></View>
          <View style={ui.line}><Text style={ui.lineK}>Roofing squares</Text><Text style={ui.lineV}>{roof.squares.toFixed(1)}</Text></View>
          {!!roof.imageryDate && <View style={ui.line}><Text style={ui.lineK}>Imagery date</Text><Text style={ui.lineV}>{roof.imageryDate}</Text></View>}
          {roof.segments.length > 0 && (
            <>
              <Text style={[ui.label, { marginTop: 10 }]}>Roof planes</Text>
              {roof.segments.map((s, i) => (
                <View key={i} style={ui.line}>
                  <Text style={ui.lineK}>{s.facing} · {Math.round(s.pitchDegrees)}° pitch</Text>
                  <Text style={ui.lineV}>{Math.round(s.areaFt2).toLocaleString()} ft²</Text>
                </View>
              ))}
            </>
          )}
          <Text style={{ color: '#888', fontSize: 11, marginTop: 10 }}>Aerial estimate — verify on site. Detected area can differ from measured.</Text>
          <Pressable style={[ui.btn, { marginTop: 10 }]} onPress={() => { if (readOnly) return; addRoofingLines(); }}><Text style={ui.btnText}>Add roofing to project</Text></Pressable>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
