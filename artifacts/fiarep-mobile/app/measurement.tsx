import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { customFetch } from '@workspace/api-client-react';
import { computeMeasurement, MATERIAL_LABELS, type MaterialKind } from '../lib/measurements';
import { isARMeasureSupported, measureArea, scanOpening } from '../modules/ar-measure/src';
import * as FileSystem from 'expo-file-system/legacy';
import { getCurrentActor, getSessionIdentity } from '../lib/store';
import { useRawModules } from '../lib/module-access';
import { allowedMaterialsForTrade, tradeKeyForPosition } from '../lib/measurement-access';
import { catalogForTrade } from '../lib/trade-catalogs';

const ACCENT = '#1E7D4F';
const CHIP: Record<MaterialKind, string> = {
  concrete: 'Concrete', sheetrock: 'Sheetrock', plywood: 'Plyboard', 'floor-tile': 'Floor tile',
  'wall-tile': 'Wall tile', 'wood-floor': 'Wood floor', paint: 'Paint', window: 'Window', door: 'Door', room: 'Room',
  floor: 'Floor / joists', ceiling: 'Ceiling / rafters',
};
const DIM_LABELS: Record<MaterialKind, { a: string; b: string }> = {
  concrete: { a: 'Length (ft)', b: 'Width (ft)' }, sheetrock: { a: 'Width (ft)', b: 'Height (ft)' },
  plywood: { a: 'Width (ft)', b: 'Height (ft)' }, window: { a: 'Width (ft)', b: 'Height (ft)' },
  door: { a: 'Opening width (ft)', b: 'Opening height (ft)' }, room: { a: 'Length (ft)', b: 'Width (ft)' },
  'floor-tile': { a: 'Length (ft)', b: 'Width (ft)' }, 'wall-tile': { a: 'Wall width (ft)', b: 'Wall height (ft)' },
  'wood-floor': { a: 'Length (ft)', b: 'Width (ft)' }, paint: { a: 'Surface width (ft)', b: 'Surface height (ft)' },
  floor: { a: 'Length (ft) — joists run across this', b: 'Width / span (ft)' }, ceiling: { a: 'Length (ft) — rafters run across this', b: 'Width / span (ft)' },
};

export default function Measurement() {
  const router = useRouter();
  const [position, setPosition] = useState('');
  const [devs, setDevs] = useState<string[]>([]);
  const [development, setDevelopment] = useState('');
  const [devQuery, setDevQuery] = useState('');
  const rawModules = useRawModules();
  useEffect(() => {
    getSessionIdentity().then((si: any) => {
      setPosition(String(si?.position || ''));
      const d: string[] = Array.isArray(si?.developments) ? si.developments : [];
      setDevs(d);
      if (d.length) setDevelopment(d[0]);
    }).catch(() => {});
  }, []);

  const allowed = allowedMaterialsForTrade(position, rawModules);
  const showCalculators = allowed.length > 0;
  const catalog = catalogForTrade(tradeKeyForPosition(position));

  // ---- Measurement calculator state ----
  const [material, setMaterial] = useState<MaterialKind>('concrete');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [classifying, setClassifying] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  // Width ÷ height of the subject as the photo shows it, so a tape measurement of
  // one side corrects the other; and whether the AI only assumed a catalog size.
  const [aspect, setAspect] = useState(0);
  const [assumedStd, setAssumedStd] = useState(false);
  const [thickness, setThickness] = useState('');
  const [tileW, setTileW] = useState('12');
  const [tileH, setTileH] = useState('12');
  const [boxSqFt, setBoxSqFt] = useState('20');
  const [spacing, setSpacing] = useState('16');
  const [coats, setCoats] = useState('2');
  const [coverage, setCoverage] = useState('350');
  const [arSupported, setArSupported] = useState(false);
  const [arBusy, setArBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { try { setArSupported(isARMeasureSupported()); } catch { setArSupported(false); } }, []);
  useEffect(() => { setSaved(false); }, [material, a, b, thickness, tileW, tileH, boxSqFt, coats, coverage]);
  useEffect(() => { if (showCalculators && !allowed.includes(material)) setMaterial(allowed[0]); }, [allowed.join(',')]);

  const result = useMemo(() => computeMeasurement({
    material, lengthFt: parseFloat(a) || 0, widthFt: parseFloat(b) || 0, thicknessIn: parseFloat(thickness) || 0,
    tileWidthIn: parseFloat(tileW) || 0, tileHeightIn: parseFloat(tileH) || 0, boxSqFt: parseFloat(boxSqFt) || 0,
    coats: parseFloat(coats) || 0, coverageSqFt: parseFloat(coverage) || 0, spacingIn: parseFloat(spacing) || 0,
  }), [material, a, b, thickness, tileW, tileH, boxSqFt, coats, coverage, spacing]);

  const capture = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Camera needed', 'Allow camera access to identify the material.'); return; }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.3, base64: true, allowsEditing: false });
      if (shot.canceled || !shot.assets?.[0]) return;
      const asset = shot.assets[0];
      setPhoto(asset.uri);
      setSaved(false);
      // Keep the picture with the measurement so it can be looked at later
      // (kept small; a huge shot is saved by its local path only).
      setPhotoDataUrl(asset.base64 && asset.base64.length < 700_000 ? `data:image/jpeg;base64,${asset.base64}` : '');
      if (!asset.base64) return;
      setClassifying(true); setAiNote('');
      try {
        const res = await customFetch<{ material: MaterialKind; confidence: number; note: string; estimatedAFt?: number; estimatedBFt?: number; sizeBasis?: string; aspectRatio?: number; assumedStandard?: boolean }>(
          '/api/ai/classify-material',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: `data:image/jpeg;base64,${asset.base64}` }), responseType: 'json' });
        if (res?.material && allowed.includes(res.material)) {
          setMaterial(res.material);
          // Size estimate from the photo: pre-fill the dimensions (the user
          // can overwrite them) and say what it was judged from.
          const estA = Number(res.estimatedAFt) || 0;
          const estB = Number(res.estimatedBFt) || 0;
          let sizeNote = '';
          const ratio = Number(res.aspectRatio) || (estA > 0 && estB > 0 ? estA / estB : 0);
          setAspect(ratio > 0 ? ratio : 0);
          setAssumedStd(res.assumedStandard === true);
          if (estA > 0 && estB > 0) {
            setA(String(estA)); setB(String(estB));
            sizeNote = res.assumedStandard
              ? ` The photo had nothing to scale from, so a TYPICAL size was assumed (${estA} × ${estB} ft) — this is not a measurement. Tape one side and use "Set … from photo ratio" for the other.`
              : ` Measured about ${estA} × ${estB} ft from the photo${res.sizeBasis ? ` (${res.sizeBasis})` : ''} — expect ±10%; tape one side to correct the other.`;
          } else {
            sizeNote = ` Couldn't judge the size from this photo${res.sizeBasis ? ` (${res.sizeBasis})` : ''} — enter the dimensions below.`;
          }
          setAiNote(`Detected ${MATERIAL_LABELS[res.material]}${res.confidence ? ` (${Math.round(res.confidence * 100)}%)` : ''}. ${res.note || ''}`.trim() + sizeNote);
        } else if (res?.material && (res.material as string) !== 'unknown') {
          setAiNote(`Looks like ${MATERIAL_LABELS[res.material] || res.material}, but that's not enabled for you — pick below.`);
        } else { setAiNote("Couldn't identify the material — pick it below."); }
      } catch (e: any) {
        // Say why, so a missing AI key or an oversized photo is obvious.
        const status = e?.status || e?.response?.status;
        const serverMsg = String(e?.data?.error || e?.message || '').trim();
        setAiNote(
          status === 413 ? 'Photo too large for auto-detect — pick the material below.'
          : status === 503 ? 'Material auto-detect is turned off on the server (AI key not set) — pick it below.'
          : 'Material auto-detect unavailable' + (serverMsg ? ` (${serverMsg.slice(0, 80)})` : '') + ' — pick it below.');
      }
      finally { setClassifying(false); }
    } catch { setClassifying(false); }
  };

  const SCAN_LABEL: Partial<Record<MaterialKind, string>> = { door: 'door opening', window: 'window opening', concrete: 'concrete area', sheetrock: 'wall area', plywood: 'sheet area', room: 'floor area', 'floor-tile': 'floor area', 'wall-tile': 'wall area', 'wood-floor': 'floor area', paint: 'wall area', floor: 'floor', ceiling: 'ceiling' };
  const runAR = async (tapMode = false) => {
    setArBusy(true);
    try {
      const opening = material === 'door' || material === 'window';
      // Automatic for everything: the camera finds the outline (door or window
      // frame, slab, sidewalk, driveway, wall, facade) and measures it. The
      // separate "tap the corners" button covers odd shapes and short lengths.
      // Openings: the camera finds the frame. Surfaces: sweep the camera across
      // the area and the measurement grows with it — no edges or taps needed.
      const r = tapMode ? await measureArea() : await scanOpening(opening ? 'opening' : 'sweep', SCAN_LABEL[material] || 'area');
      const round1 = (n?: number) => (typeof n === 'number' ? String(Math.round(n * 100) / 100) : '');
      if (r.widthFt) setA(round1(r.widthFt));
      if (r.heightFt) setB(round1(r.heightFt));
      if (r.widthFt && r.heightFt) setAspect(r.widthFt / r.heightFt);
      setAssumedStd(false);
      if (r.imagePath) {
        const uri = (FileSystem.documentDirectory || '') + r.imagePath;
        setPhoto(uri);
        try { const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }); if (b64.length < 700_000) setPhotoDataUrl('data:image/jpeg;base64,' + b64); } catch {}
      }
      const inches = (ft: number) => Math.round(ft * 12 * 4) / 4;
      setAiNote(!tapMode && r.widthFt && r.heightFt
        ? `Scanned ${SCAN_LABEL[material] || 'area'}: ${inches(r.widthFt)}" × ${inches(r.heightFt)}" (${round1(r.widthFt)} × ${round1(r.heightFt)} ft = ${Math.round(r.widthFt * r.heightFt * 100) / 100} sq ft). This is the measured size — it replaces the photo estimate. Take your own photo if you want one on the record.`
        : r.areaSqFt ? `Measured ${Math.round(r.areaSqFt * 100) / 100} sq ft from the corners you tapped — adjust below if needed.` : 'Scan captured.');
    } catch (e: any) {
      if (/cancel/i.test(String(e?.message || e?.code || ''))) return;
      Alert.alert('Scan', e?.message ? String(e.message) : 'Could not measure. Enter the dimensions manually.');
    } finally { setArBusy(false); }
  };

  const saveMeasurement = async () => {
    const dev = development.trim();
    if (!dev) { Alert.alert('Development needed', 'Pick a development to save this measurement to.'); return; }
    if (!result.areaSqFt) { Alert.alert('Nothing to save', 'Enter the dimensions first.'); return; }
    setSaving(true);
    try {
      const actor = await getCurrentActor();
      const state = {
        material, materialLabel: MATERIAL_LABELS[material], development: dev,
        lengthFt: parseFloat(a) || 0, widthFt: parseFloat(b) || 0, thicknessIn: parseFloat(thickness) || 0,
        tileWidthIn: parseFloat(tileW) || 0, tileHeightIn: parseFloat(tileH) || 0, boxSqFt: parseFloat(boxSqFt) || 0,
        coats: parseFloat(coats) || 0, coverageSqFt: parseFloat(coverage) || 0, spacingIn: parseFloat(spacing) || 0,
        members: result.members, memberLengthFt: result.memberLengthFt,
        areaSqFt: result.areaSqFt, cubicYards: result.cubicYards, orderCubicYards: result.orderCubicYards,
        sheets: result.sheets, tiles: result.tiles, boxes: result.boxes, gallons: result.gallons, doorSize: result.doorSize,
        summary: result.summary, by: actor.name, byId: actor.id, position, status: 'saved', createdAt: new Date().toISOString(),
        note: aiNote, photoLocalUri: photo || '', photoDataUrl,
      };
      await customFetch('/api/v1/measurements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ development: dev, state }), responseType: 'json' });
      setSaved(true); setAiNote('Measurement saved — see Saved measurements.');
    } catch (e: any) { Alert.alert('Could not save', e?.message ? String(e.message) : 'Please try again.'); }
    finally { setSaving(false); }
  };

  // ---- Catalog state ----
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [savingList, setSavingList] = useState(false);
  const [savedList, setSavedList] = useState(false);
  const selectedCount = Object.values(selected).reduce((n, q) => n + (q > 0 ? 1 : 0), 0);
  const toggleItem = (item: string) => { setSavedList(false); setSelected((c) => { const n = { ...c }; if (n[item]) delete n[item]; else n[item] = 1; return n; }); };
  const setQty = (item: string, qty: number) => { setSavedList(false); setSelected((c) => { const n = { ...c }; if (qty <= 0) delete n[item]; else n[item] = qty; return n; }); };
  const saveMaterialList = async () => {
    const dev = development.trim();
    if (!dev) { Alert.alert('Development needed', 'Pick a development to save this list to.'); return; }
    if (!selectedCount) { Alert.alert('Nothing selected', 'Pick some materials first.'); return; }
    setSavingList(true);
    try {
      const actor = await getCurrentActor();
      const items = Object.entries(selected).filter(([, q]) => q > 0).map(([name, qty]) => ({ name, qty }));
      const state = {
        material: 'materials', materialLabel: catalog?.label || 'Materials', development: dev,
        items, itemCount: items.length,
        summary: `${items.length} material(s): ${items.slice(0, 4).map((i) => `${i.qty}x ${i.name}`).join(', ')}${items.length > 4 ? '…' : ''}`,
        by: actor.name, byId: actor.id, position, status: 'saved', createdAt: new Date().toISOString(),
      };
      await customFetch('/api/v1/measurements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ development: dev, state }), responseType: 'json' });
      setSavedList(true);
    } catch (e: any) { Alert.alert('Could not save', e?.message ? String(e.message) : 'Please try again.'); }
    finally { setSavingList(false); }
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
        <Text style={{ flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 18, marginRight: 40 }}>{catalog && !showCalculators ? 'Materials' : 'Measurement'}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {!showCalculators && !catalog && (
          <Text style={{ color: '#4A5560', textAlign: 'center', marginTop: 40 }}>No materials are assigned to your trade yet. Ask your administrator to enable them in the control panel.</Text>
        )}

        {showCalculators && (<>
          <Pressable onPress={() => router.push('/saved-measurements')} style={{ borderRadius: 16, borderWidth: 2, borderColor: ACCENT, paddingVertical: 12, alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 15 }}>Saved measurements</Text>
          </Pressable>
          <Pressable onPress={capture} style={{ borderRadius: 16, backgroundColor: ACCENT, paddingVertical: 16, alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{photo ? 'Retake photo' : 'Point camera & take photo'}</Text>
          </Pressable>
          {arSupported && (
            <>
            <Pressable onPress={() => runAR(false)} disabled={arBusy} style={{ borderRadius: 16, borderWidth: 2, borderColor: ACCENT, paddingVertical: 14, alignItems: 'center', marginBottom: 8, opacity: arBusy ? 0.6 : 1 }}>
              <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 15 }}>{arBusy ? 'Scanning…' : `Scan the ${SCAN_LABEL[material] || 'area'} (exact size)`}</Text>
              <Text style={{ color: '#4A5560', fontSize: 12, marginTop: 4, paddingHorizontal: 12, textAlign: 'center' }}>{(material === 'door' || material === 'window') ? 'No tapping: point the camera at the whole opening, hold still, and it measures width and height by itself.' : 'No tapping: sweep the camera slowly across the whole area, edge to edge — the measurement builds as you go and drops into the boxes.'}</Text>
            </Pressable>
            <Pressable onPress={() => runAR(true)} disabled={arBusy} style={{ alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: ACCENT, fontWeight: '600', fontSize: 13 }}>Odd shape or just a length? Tap the corners instead</Text>
            </Pressable>
            </>
          )}
          {photo && <Image source={{ uri: photo }} style={{ width: '100%', height: 200, borderRadius: 16, marginBottom: 12, backgroundColor: '#E4E9E6' }} resizeMode="cover" />}
          {classifying && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><ActivityIndicator color={ACCENT} /><Text style={{ color: '#4A5560' }}>Identifying material…</Text></View>}
          {!!aiNote && <Text style={{ color: '#4A5560', marginBottom: 12, fontSize: 13 }}>{aiNote}</Text>}

          <Text style={{ fontSize: 12, color: '#4A5560', marginBottom: 6 }}>Material</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
            {allowed.map((m, i) => (
              <Pressable key={m} onPress={() => setMaterial(m)} style={{ width: '31.5%', marginRight: (i % 3) === 2 ? 0 : '2.75%', marginBottom: 8, borderRadius: 12, borderWidth: 1.5, borderColor: ACCENT, backgroundColor: material === m ? ACCENT : 'transparent', paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: material === m ? '#fff' : ACCENT, fontWeight: '600', fontSize: 12 }}>{CHIP[m]}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>{field(dims.a, a, setA)}{field(dims.b, b, setB)}</View>
          {aspect > 0 && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <Pressable onPress={() => { const h = parseFloat(b); if (h > 0) setA(String(Math.round(h * aspect * 100) / 100)); }} style={{ borderWidth: 1, borderColor: ACCENT, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 }}>
                <Text style={{ color: ACCENT, fontWeight: '600', fontSize: 13 }}>Set {dims.a.toLowerCase()} from {dims.b.toLowerCase()} (photo ratio)</Text>
              </Pressable>
              <Pressable onPress={() => { const w = parseFloat(a); if (w > 0) setB(String(Math.round(w / aspect * 100) / 100)); }} style={{ borderWidth: 1, borderColor: ACCENT, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 }}>
                <Text style={{ color: ACCENT, fontWeight: '600', fontSize: 13 }}>Set {dims.b.toLowerCase()} from {dims.a.toLowerCase()} (photo ratio)</Text>
              </Pressable>
              {assumedStd && <Text style={{ width: '100%', color: '#9a3412', fontSize: 12 }}>Sizes above are a typical guess, not a measurement — tape at least one side.</Text>}
            </View>
          )}
          {material === 'concrete' && <View style={{ marginBottom: 12 }}>{field('Thickness / depth (inches)', thickness, setThickness)}</View>}
          {isTile && <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>{field('Tile width (in)', tileW, setTileW)}{field('Tile height (in)', tileH, setTileH)}</View>}
          {material === 'wood-floor' && <View style={{ marginBottom: 12 }}>{field('Box coverage (sq ft / box)', boxSqFt, setBoxSqFt)}</View>}
          {(material === 'floor' || material === 'ceiling') && <View style={{ marginBottom: 12 }}>{field(`${material === 'floor' ? 'Joist' : 'Rafter'} spacing (inches on centre)`, spacing, setSpacing)}</View>}
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
            {(material === 'floor' || material === 'ceiling') && <Text style={{ fontSize: 15 }}>{material === 'floor' ? 'Floor joists' : 'Ceiling rafters'} @ {spacing || '16'}" OC: <Text style={{ fontWeight: '700', color: ACCENT }}>{result.members ?? 0}</Text>{result.memberLengthFt ? ` × ${result.memberLengthFt} ft each` : ''}</Text>}
            {material === 'door' && !!result.doorSize && <Text style={{ fontSize: 15 }}>Nearest standard door: <Text style={{ fontWeight: '700', color: ACCENT }}>{result.doorSize}</Text></Text>}
          </View>
        </>)}

        {catalog && (
          <View style={{ marginTop: showCalculators ? 24 : 0 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 4 }}>{catalog.label}</Text>
            <Text style={{ fontSize: 12, color: '#8A928C', marginBottom: 10 }}>Tap a category to open it, then tap items to add them to your list.</Text>
            {catalog.categories.map((cat) => {
              const open = expandedCat === cat.name;
              const catCount = cat.items.filter((it) => selected[it] > 0).length;
              return (
                <View key={cat.name} style={{ borderWidth: 1.5, borderColor: '#D3DAD5', borderRadius: 12, marginBottom: 8, overflow: 'hidden', backgroundColor: '#fff' }}>
                  <Pressable onPress={() => setExpandedCat(open ? null : cat.name)} style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
                    <Text style={{ flex: 1, fontWeight: '600', fontSize: 14 }}>{cat.name}{catCount ? `  (${catCount})` : ''}</Text>
                    <Text style={{ color: ACCENT, fontWeight: '700' }}>{open ? '▲' : '▼'}</Text>
                  </Pressable>
                  {open && cat.items.map((item) => {
                    const qty = selected[item] || 0;
                    return (
                      <View key={item} style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#EEF1EF', paddingHorizontal: 14, paddingVertical: 10 }}>
                        <Pressable onPress={() => toggleItem(item)} style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, color: qty > 0 ? ACCENT : '#2A3540', fontWeight: qty > 0 ? '700' : '400' }}>{qty > 0 ? '✓ ' : ''}{item}</Text>
                        </Pressable>
                        {qty > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Pressable onPress={() => setQty(item, qty - 1)} hitSlop={8}><Text style={{ fontSize: 22, color: ACCENT, width: 22, textAlign: 'center' }}>−</Text></Pressable>
                            <Text style={{ fontSize: 15, fontWeight: '700', minWidth: 20, textAlign: 'center' }}>{qty}</Text>
                            <Pressable onPress={() => setQty(item, qty + 1)} hitSlop={8}><Text style={{ fontSize: 22, color: ACCENT, width: 22, textAlign: 'center' }}>+</Text></Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
            {selectedCount > 0 && <Text style={{ fontSize: 13, color: '#4A5560', marginTop: 4 }}>{selectedCount} item(s) selected</Text>}
          </View>
        )}

        {(showCalculators || (catalog && selectedCount > 0)) && devs.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 12, color: '#4A5560', marginBottom: 6 }}>Save to development</Text>
            <TextInput value={devQuery} onChangeText={setDevQuery} placeholder="Search developments" autoCorrect={false} autoCapitalize="characters"
              style={{ borderWidth: 1.5, borderColor: '#D3DAD5', borderRadius: 12, padding: 12, fontSize: 16, backgroundColor: '#fff', marginBottom: 8 }} />
            {!!development && <Text style={{ fontSize: 13, marginBottom: 8 }}>Selected: <Text style={{ color: ACCENT, fontWeight: '700' }}>{development}</Text></Text>}
            <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {devs.filter((d) => d.toLowerCase().includes(devQuery.trim().toLowerCase())).map((d) => (
                  <Pressable key={d} onPress={() => { setDevelopment(d); setDevQuery(''); }} style={{ marginRight: 8, marginBottom: 8, borderRadius: 12, borderWidth: 1.5, borderColor: ACCENT, backgroundColor: development === d ? ACCENT : 'transparent', paddingVertical: 8, paddingHorizontal: 12 }}>
                    <Text style={{ color: development === d ? '#fff' : ACCENT, fontWeight: '600', fontSize: 12 }}>{d}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {showCalculators && (
          <Pressable onPress={saveMeasurement} disabled={saving || saved || !result.areaSqFt} style={{ borderRadius: 16, backgroundColor: saved ? '#8A928C' : ACCENT, paddingVertical: 14, alignItems: 'center', marginTop: 8, opacity: (saving || !result.areaSqFt) ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save measurement'}</Text>
          </Pressable>
        )}
        {catalog && selectedCount > 0 && (
          <Pressable onPress={saveMaterialList} disabled={savingList || savedList} style={{ borderRadius: 16, backgroundColor: savedList ? '#8A928C' : ACCENT, paddingVertical: 14, alignItems: 'center', marginTop: 8, opacity: savingList ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{savedList ? 'List saved ✓' : savingList ? 'Saving…' : `Save material list (${selectedCount})`}</Text>
          </Pressable>
        )}

        {showCalculators && (
          <Text style={{ color: '#8A928C', fontSize: 12, marginTop: 16, textAlign: 'center' }}>{arSupported ? 'AR Measure uses LiDAR for exact sizes; the photo estimate is a starting point.' : 'The photo gives an estimated size. Exact LiDAR measuring (AR Measure) is in the App Store / TestFlight build, not Expo Go — or enter the dimensions from a tape.'}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
