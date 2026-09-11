import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform, Modal, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { manualScan, floorAreaFromWalls2d, patchCost, measuredCost, measureCatById, MEASURE_CATEGORIES, type RoomScan, type Rates, DEFAULT_RATES } from '../../lib/takeoff';
import { isRoomScanSupported, scanRoom } from '../../modules/room-scanner/src';
import { isARMeasureSupported, measureArea } from '../../modules/ar-measure/src';
import { FloorPlan, type Wall2D } from '../../lib/FloorPlan';
import { Room3DView } from '../../lib/Room3DView';
import { addRoom, getRoom, updateRoom, getGlobalRates, getProject, getCurrentActor, getCurrentPosition } from '../../lib/store';
import { drywallLinesFromScan } from '../../lib/drywall';
import { CATALOG, CATEGORIES, UNIT_LABEL, lineTotal, type LineItem, type Category } from '../../lib/catalog';
import { ui, money } from '../../lib/ui';
import { useAppMode } from '../_layout';
import { takePhoto, pickPhoto, takePhotoWithGeo, pickPhotoWithGeo, photoUri, photoBase64 } from '../../lib/photos';
import { geoLabel } from '../../lib/geo';
import { buildRoomHTML } from '../../lib/roomReport';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Image } from 'react-native';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export default function RoomEditor() {
  const { projectId, roomId } = useLocalSearchParams<{ projectId: string; roomId?: string }>();
  const { mode } = useAppMode();
  const readOnly = mode === 'administrator';
  const router = useRouter();
  const [roomName, setRoomName] = useState('');
  const [unit, setUnit] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [actorName, setActorName] = useState('');
  const [scanWalls, setScanWalls] = useState<Wall2D[]>([]);
  const [scanInfo, setScanInfo] = useState<string>('');
  const [scanData, setScanData] = useState<any>(null);
  const [violations, setViolations] = useState<{ A: any[]; B: any[]; C: any[] }>({ A: [], B: [], C: [] });
  const [showViol, setShowViol] = useState(false);
  const [measuredAreas, setMeasuredAreas] = useState<any[]>([]);
  const [show3D, setShow3D] = useState(false);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [picking, setPicking] = useState<Category | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoGeo, setPhotoGeo] = useState<Record<string, any>>({});
  const [photoView, setPhotoView] = useState<string | null>(null);

  // manual scan inputs
  const [len, setLen] = useState('');
  const [wid, setWid] = useState('');
  const [hgt, setHgt] = useState('');
  const [open, setOpen] = useState('');

  const [position, setPosition] = useState('');
  const reloadRates = useCallback(() => {
    (async () => {
      const p = projectId ? await getProject(projectId) : null;
      setRates(p?.rates ?? await getGlobalRates());
      setPosition(await getCurrentPosition());
    })();
  }, [projectId]);
  useFocusEffect(reloadRates);

  useEffect(() => {
    (async () => {
      const p = projectId ? await getProject(projectId) : null;
      setRates(p?.rates ?? await getGlobalRates());
      if (roomId) {
        const r = await getRoom(roomId);
        if (r) {
          setRoomName(r.name); setUnit(r.unit ?? ''); setLines(r.lines); setPhotos(r.photos ?? []);
          setScanWalls((r.walls2d ?? []) as Wall2D[]);
          const sd = (r as any).scan ?? null;
          setScanData(sd);
          if (sd && sd.violations) setViolations(sd.violations);
          if (sd && sd.measuredAreas) setMeasuredAreas(sd.measuredAreas);
          if (sd && sd.photoGeo) setPhotoGeo(sd.photoGeo);
          if (sd) {
            if (sd.lengthFt != null) setLen(String(sd.lengthFt));
            if (sd.widthFt != null) setWid(String(sd.widthFt));
            if (sd.heightFt != null) setHgt(String(sd.heightFt));
            if (sd.openingAreaSqFt != null) setOpen(String(sd.openingAreaSqFt));
            setScanInfo(
              `${sd.lengthFt ?? '?'} \u00d7 ${sd.widthFt ?? '?'} ft \u00b7 ${sd.heightFt ?? '?'} ft ceiling\n` +
              `Floor ${(floorAreaFromWalls2d(r.walls2d) ?? sd.floorAreaSqFt) != null ? Math.round(floorAreaFromWalls2d(r.walls2d) ?? sd.floorAreaSqFt) : '?'} sq ft \u00b7 Walls ${sd.wallGrossSqFt ?? '?'} sq ft (${sd.wallNetSqFt ?? '?'} net)\n` +
              `${sd.doors ?? 0} door${(sd.doors ?? 0) === 1 ? '' : 's'}, ${sd.windows ?? 0} window${(sd.windows ?? 0) === 1 ? '' : 's'}`
            );
          }
        }
      }
    })();
  }, [projectId, roomId]);

  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

  const supported = isRoomScanSupported();
  const doScan = async () => {
    try {
      const scan = await scanRoom();
      // fill manual fields from the scan so the numbers are visible/editable
      if (scan.lengthFt) setLen(String(scan.lengthFt));
      if (scan.widthFt) setWid(String(scan.widthFt));
      if (scan.heightFt) setHgt(String(scan.heightFt));
      if (scan.openingAreaSqFt != null) setOpen(String(scan.openingAreaSqFt));
      // save the floor-plan outline
      if (scan.walls2d) setScanWalls(scan.walls2d as Wall2D[]);
      const doorsC = (scan.openings || []).filter((o: any) => o.kind === 'door').length;
      const windowsC = (scan.openings || []).filter((o: any) => o.kind === 'window').length;
      setScanData({ lengthFt: scan.lengthFt, widthFt: scan.widthFt, heightFt: scan.heightFt, floorAreaSqFt: (floorAreaFromWalls2d(scan.walls2d) ?? scan.floorAreaSqFt), wallGrossSqFt: scan.wallGrossSqFt, wallNetSqFt: scan.wallNetSqFt, doors: doorsC, windows: windowsC, geometry3d: (scan as any).geometry3d ?? [] });
      // build a measurements summary
      const doors = (scan.openings || []).filter((o: any) => o.kind === 'door').length;
      const windows = (scan.openings || []).filter((o: any) => o.kind === 'window').length;
      setScanInfo(
        `${scan.lengthFt} \u00d7 ${scan.widthFt} ft \u00b7 ${scan.heightFt} ft ceiling\n` +
        `Floor ${Math.round(floorAreaFromWalls2d(scan.walls2d) ?? scan.floorAreaSqFt)} sq ft \u00b7 Walls ${scan.wallGrossSqFt} sq ft (${scan.wallNetSqFt} net)\n` +
        `${doors} door${doors === 1 ? '' : 's'}, ${windows} window${windows === 1 ? '' : 's'}`
      );
    } catch (e: any) { Alert.alert('Scan unavailable', e?.message ?? 'Unknown error'); }
  };
  const shareRoomPDF = async () => {
    try {
      const b64s: string[] = [];
      const geoLabels: string[] = [];
      for (const p of photos) { const b = await photoBase64(p); if (b) { b64s.push(b); geoLabels.push(photoGeo[p] ? geoLabel(photoGeo[p]) : ''); } }
      const html = buildRoomHTML({
        name: roomName || 'Room',
        unit,
        scanInfo,
        walls: scanWalls as any,
        photosB64: b64s,
        photoGeoLabels: geoLabels,
        violations,
        measuredAreas,
      });
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: roomName || 'Room' });
      } else { await Print.printAsync({ uri }); }
    } catch (e) {}
  };
  const removeMeasured = (id: string) => setMeasuredAreas(prev => prev.filter(m => m.id !== id));
  const updateMeasured = (id: string, patch: any) => {
    setMeasuredAreas(prev => {
      const next = prev.map(m => m.id === id ? { ...m, ...patch } : m);
      const changed = next.find(m => m.id === id);
      // if this measurement already has line(s) in the quote, re-sync them to the new values
      setLines(pl => {
        const hasLines = (pl as any).some((l: any) => l.measureId === id);
        if (!hasLines || !changed) return pl;
        return [...(pl as any).filter((l: any) => l.measureId !== id), ...linesForMeasure(changed) as any];
      });
      return next;
    });
  };
  const linesForMeasure = (m: any) => {
    const cat = measureCatById(m.catId || 'wall');
    const area = (m.area != null ? m.area : m.areaSqFt) || (m.widthFt * m.heightFt) || 0;
    const uid2 = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (cat.method === 'drywall') {
      const pc = patchCost(area, rates);
      return [
        { id: uid2(), measureId: m.id, category: 'Drywall', description: `${m.label} — drywall sheets`, quantity: pc.sheets, unit: 'each', unitPrice: rates.sheetCost },
        { id: uid2(), measureId: m.id, category: 'Drywall', description: `${m.label} — hang + finish`, quantity: Math.round(area), unit: 'sqft', unitPrice: rates.laborPerSqFt },
        { id: uid2(), measureId: m.id, category: 'Drywall', description: `${m.label} — paint`, quantity: Math.round(area), unit: 'sqft', unitPrice: rates.paintPerSqFt },
      ];
    } else if (cat.method === 'flat') {
      const rate = (m.rate != null && !isNaN(m.rate)) ? m.rate : cat.rate;
      return [{ id: uid2(), measureId: m.id, category: cat.label, description: `${m.label} (${cat.label})`, quantity: 1, unit: 'each', unitPrice: rate }];
    } else {
      const rate = (m.rate != null && !isNaN(m.rate)) ? m.rate : cat.rate;
      return [{ id: uid2(), measureId: m.id, category: cat.label, description: `${m.label} (${cat.label})`, quantity: Math.round(area), unit: 'sqft', unitPrice: rate }];
    }
  };
  const addMeasuredAsLine = (m: any) => {
    setLines(prev => [...prev.filter((l: any) => l.measureId !== m.id), ...linesForMeasure(m) as any]);
  };
  const runARMeasure = async () => {
    try {
      const r = await measureArea();
      const w = r.widthFt ?? 0, h = r.heightFt ?? 0, a = r.areaSqFt ?? 0;
      const img = r.imagePath;
      const addEntry = (label?: string) => {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const entry = {
          id,
          label: (label && label.trim()) ? label.trim() : 'Measured area',
          widthFt: w, heightFt: h, areaSqFt: a,
          sides: r.distancesFt ?? [],
          photo: img || undefined,
          catId: 'wall',
          area: a,           // editable area (defaults to measured)
          rate: undefined,   // editable rate override
        };
        setMeasuredAreas(prev => [...prev, entry]);
        if (img) setPhotos(prev => [...prev, img]);
      };
      if (typeof Alert.prompt === 'function') {
        Alert.prompt('Label this measurement', 'e.g. Ceiling leak, Wall patch', addEntry);
      } else {
        addEntry();
      }
    } catch (e: any) {
      if (e?.message && !/cancel/i.test(e.message)) Alert.alert('AR measure', e.message);
    }
  };
  const addDrywallFromManual = () => {
    const scan: RoomScan = manualScan(parseFloat(len) || 0, parseFloat(wid) || 0, parseFloat(hgt) || 0, parseFloat(open) || 0);
    setLines(prev => [...prev, ...drywallLinesFromScan(scan, rates)]);
  };

  const onTakePhoto = async () => {
    try { const r = await takePhotoWithGeo(); if (r) { setPhotos(p => [...p, r.uri]); setPhotoGeo(g => ({ ...g, [r.uri]: r.geo })); } }
    catch (e: any) { Alert.alert('Camera', e?.message ?? 'Error'); }
  };
  const onPickPhoto = async () => {
    try { const r = await pickPhotoWithGeo(); if (r) { setPhotos(p => [...p, r.uri]); setPhotoGeo(g => ({ ...g, [r.uri]: r.geo })); } }
    catch (e: any) { Alert.alert('Photos', e?.message ?? 'Error'); }
  };
  const removePhoto = (uri: string) => setPhotos(p => p.filter(x => x !== uri));
  const vuid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const addViolation = (cls: 'A' | 'B' | 'C') =>
    setViolations(v => ({ ...v, [cls]: [...v[cls], { id: vuid(), title: '', desc: '' }] }));
  const setViolation = (cls: 'A' | 'B' | 'C', id: string, patch: any) =>
    setViolations(v => ({ ...v, [cls]: v[cls].map(x => x.id === id ? { ...x, ...patch } : x) }));
  const removeViolation = (cls: 'A' | 'B' | 'C', id: string) =>
    setViolations(v => ({ ...v, [cls]: v[cls].filter(x => x.id !== id) }));
  const addPreset = (p: typeof CATALOG[number]) => {
    setLines(prev => [...prev, { id: uid(), category: p.category, description: p.description, quantity: 1, unit: p.unit, unitPrice: p.unitPrice }]);
    setPicking(null);
  };
  const addCustom = () => setLines(prev => [...prev, { id: uid(), category: 'Other', description: '', quantity: 1, unit: 'flat', unitPrice: 0 }]);
  const upd = (id: string, patch: Partial<LineItem>) => setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  const del = (id: string) => setLines(prev => prev.filter(l => l.id !== id));
  const isSupervisor = mode === 'administrator' || mode === 'management';
  const WORKER_POSITIONS = ['Plumber', 'Electrician', 'Maintenance Worker', 'Carpenter', 'Staff Worker', 'Roofer', 'Elevator Service'];
  const hidePrice = position === 'Inspector' || WORKER_POSITIONS.includes(position);
  const updPrice = (l: LineItem, v: string) => {
    const np = parseFloat(v) || 0;
    if (isSupervisor && l.origPrice == null && np !== l.unitPrice) {
      upd(l.id, { unitPrice: np, origPrice: l.unitPrice, priceBy: actorName || 'Supervisor' });
    } else {
      upd(l.id, { unitPrice: np });
    }
  };
  useEffect(() => { getCurrentActor().then(a => setActorName(a.name || '')); }, []);


  const onSave = async () => {
    if (!roomName.trim()) { Alert.alert('Name the room', 'e.g. Kitchen, North bedroom.'); return; }
    if (lines.length === 0) { Alert.alert('Add a line', 'Add at least one line item.'); return; }
    const sdWithViol = { ...(scanData ?? {}), violations, measuredAreas, photoGeo };
    if (roomId) await updateRoom(roomId, roomName.trim(), lines, photos, scanWalls, unit.trim(), sdWithViol);
    else await addRoom(projectId!, roomName.trim(), lines, photos, scanWalls, unit.trim(), sdWithViol);
    router.back();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={[ui.wrap, { paddingBottom: 120 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <View><Text style={ui.label}>Room / area name</Text>
        <TextInput editable={!readOnly} style={ui.input} value={roomName} onChangeText={setRoomName} placeholder="North bedroom" /></View>
      <View><Text style={ui.label}>Unit (optional — e.g. Apt 2B)</Text>
        <TextInput editable={!readOnly} style={ui.input} value={unit} onChangeText={setUnit} placeholder="Leave blank for General" /></View>

      <Text style={ui.h}>Scan a room or area</Text>
      <Pressable style={[ui.btn, !supported && ui.btnMuted]} onPress={doScan}>
        <Text style={ui.btnText}>{supported ? 'Scan room' : 'LiDAR not available'}</Text>
      </Pressable>
      <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={runARMeasure}>
        <Text style={ui.btnOutlineText}>Measure small area (AR)</Text>
      </Pressable>

      {measuredAreas.length > 0 && (
        <View style={[ui.card, { marginTop: 8 }]}>
          <Text style={ui.cardTitle}>Measured Areas</Text>
          {measuredAreas.map(m => (
            <View key={m.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '600' }}>{m.label}</Text>
                <Pressable onPress={() => removeMeasured(m.id)}><Text style={{ color: '#c00', fontSize: 13 }}>Remove</Text></Pressable>
              </View>
              <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                Measured: {m.widthFt} × {m.heightFt} ft
              </Text>

              <Text style={{ fontSize: 11, color: '#666', marginTop: 8, marginBottom: 4 }}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                {MEASURE_CATEGORIES.map(c => {
                  const sel = (m.catId || 'wall') === c.id;
                  return (
                    <Pressable key={c.id} onPress={() => updateMeasured(m.id, { catId: c.id, rate: undefined })}
                      style={{ borderWidth: 1, borderColor: sel ? '#185FA5' : '#ccc', backgroundColor: sel ? '#185FA5' : '#fff', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 11, marginRight: 6 }}>
                      <Text style={{ color: sel ? '#fff' : '#333', fontSize: 12 }}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Sq ft</Text>
                  <TextInput editable={!readOnly} value={String(m.area != null ? m.area : m.areaSqFt)} onChangeText={t => updateMeasured(m.id, { area: parseFloat(t) || 0 })} keyboardType="numeric" style={ui.input} />
                </View>
                {!hidePrice && (() => { const cat = measureCatById(m.catId || 'wall'); if (cat.method === 'drywall') return null; return (
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>{cat.method === 'flat' ? '$/unit' : '$/sq ft'}</Text>
                    <TextInput editable={!readOnly} value={String(m.rate != null ? m.rate : cat.rate)} onChangeText={t => updateMeasured(m.id, { rate: parseFloat(t) || 0 })} keyboardType="numeric" style={ui.input} />
                  </View>
                ); })()}
              </View>

              {!hidePrice && (() => {
                const area = (m.area != null ? m.area : m.areaSqFt) || 0;
                const mc = measuredCost(m.catId || 'wall', area, rates, m.rate);
                if (mc.method === 'drywall' && mc.detail) {
                  const pc: any = mc.detail;
                  return <Text style={{ fontSize: 12, color: '#185FA5', marginTop: 6 }}>{pc.sheets} sheet{pc.sheets === 1 ? '' : 's'} · hang {money(pc.laborCost)} · paint {money(pc.paintCost)} · total {money(pc.total)}</Text>;
                }
                return <Text style={{ fontSize: 13, fontWeight: '600', color: '#185FA5', marginTop: 6 }}>Cost: {money(mc.total)}</Text>;
              })()}

              {(() => {
                const added = (lines as any).some((l: any) => l.measureId === m.id);
                return (
                  <Pressable
                    style={[ui.btnOutline, { paddingVertical: 6, marginTop: 8, backgroundColor: added ? '#e8f5e9' : undefined, borderColor: added ? '#2e7d32' : '#185FA5' }]}
                    onPress={() => addMeasuredAsLine(m)}>
                    <Text style={[ui.btnOutlineText, { fontSize: 13, color: added ? '#2e7d32' : '#185FA5' }]}>
                      {added ? '\u2713 Added to line items (tap to update)' : 'Add as line item'}
                    </Text>
                  </Pressable>
                );
              })()}
            </View>
          ))}
        </View>
      )}
      {(scanWalls.length > 0 || !!scanInfo) && (
        <View style={{ marginTop: 4 }}>
          {!!scanInfo && <Text style={{ fontSize: 13, color: '#333', marginBottom: 6 }}>Scan result:{'\n'}{scanInfo}</Text>}
          {scanWalls.length > 0 && <FloorPlan walls={scanWalls} />}
          {scanData?.geometry3d?.length > 0 && (
            <>
              <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={() => setShow3D(v => !v)}>
                <Text style={ui.btnOutlineText}>{show3D ? 'Hide 3D' : 'View 3D'}</Text>
              </Pressable>
              {show3D && <Room3DView geometry={scanData.geometry3d} />}
            </>
          )}
        </View>
      )}

      <View style={ui.row}>
        <Field label="L ft" value={len} onChange={setLen} />
        <Field label="W ft" value={wid} onChange={setWid} />
        <Field label="H ft" value={hgt} onChange={setHgt} />
        <Field label="Openings" value={open} onChange={setOpen} />
      </View>

      <View style={[ui.card, { marginTop: 8 }]}>
        <Pressable onPress={() => setShowViol(v => !v)}>
          <Text style={ui.cardTitle}>Violations  {showViol ? '\u25be' : '\u25b8'}</Text>
        </Pressable>
        {showViol && (['A', 'B', 'C'] as const).map(cls => (
          <View key={cls} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 4 }}>Class {cls}</Text>
            {violations[cls].map(v => (
              <View key={v.id} style={{ padding: 8, backgroundColor: '#f7f7f7', borderRadius: 8, marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                  <Pressable onPress={() => removeViolation(cls, v.id)}><Text style={{ color: '#c00', fontSize: 12 }}>Remove</Text></Pressable>
                </View>
                <TextInput editable={!readOnly} value={v.title} onChangeText={t => setViolation(cls, v.id, { title: t })}
                  placeholder="Violation (e.g. Missing smoke detector)" placeholderTextColor="#999"
                  style={[ui.input, { marginBottom: 6, backgroundColor: '#fff' }]} />
                <TextInput editable={!readOnly} value={v.desc} onChangeText={t => setViolation(cls, v.id, { desc: t })}
                  placeholder="Description / notes" placeholderTextColor="#999"
                  style={[ui.input, { minHeight: 50, backgroundColor: '#fff' }]} multiline />
              </View>
            ))}
            <Pressable style={[ui.btnOutline, { paddingVertical: 8, marginBottom: 4 }]} onPress={() => addViolation(cls)}>
              <Text style={[ui.btnOutlineText, { fontSize: 13 }]}>+ Add Class {cls} violation</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <Text style={ui.h}>Photos</Text>
      <View style={ui.row}>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={onTakePhoto}><Text style={ui.btnOutlineText}>Take photo</Text></Pressable>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={onPickPhoto}><Text style={ui.btnOutlineText}>Choose photo</Text></Pressable>
      </View>
      {(photos.length > 0 || scanWalls.length > 0) && (
        <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={shareRoomPDF}>
          <Text style={ui.btnOutlineText}>Share Room PDF (scan + photos)</Text>
        </Pressable>
      )}
      {photos.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {photos.map(uri => (
            <View key={uri} style={{ width: 80 }}>
              <Pressable onPress={() => setPhotoView(uri)}>
                <Image source={{ uri: photoUri(uri) }} style={{ width: 80, height: 80, borderRadius: 8 }} />
              </Pressable>
              <Pressable onPress={() => removePhoto(uri)} style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#c0392b', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 16 }}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {photos.length > 0 && <Text style={{ color: '#999', fontSize: 11 }}>Tap a photo to view · tap × to remove.</Text>}

      <Modal visible={!!photoView} transparent animationType="fade" onRequestClose={() => setPhotoView(null)}>
        <Pressable onPress={() => setPhotoView(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}>
          {photoView && <Image source={{ uri: photoUri(photoView) }} style={{ width: Dimensions.get('window').width, height: Dimensions.get('window').height * 0.8 }} resizeMode="contain" />}
          {photoView && photoGeo[photoView] && (
            <Text style={{ position: 'absolute', bottom: 60, color: '#fff', fontSize: 13, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 }}>
              {geoLabel(photoGeo[photoView])}
            </Text>
          )}
          <Pressable onPress={() => setPhotoView(null)} style={{ position: 'absolute', top: 50, right: 20, padding: 10 }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>Done</Text>
          </Pressable>
        </Pressable>
      </Modal>


      <Text style={ui.h}>Add trade line</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {CATEGORIES.map(c => (
          <Pressable key={c} style={[chip, picking === c && chipOn]} onPress={() => setPicking(picking === c ? null : c)}>
            <Text style={{ color: picking === c ? '#fff' : '#185FA5', fontSize: 13 }}>{c}</Text>
          </Pressable>
        ))}
      </View>
      {picking && (
        <View style={[ui.card, { gap: 6, marginTop: 8 }]}>
          {CATALOG.filter(p => p.category === picking).map((p, i) => (
            <Pressable key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }} onPress={() => addPreset(p)}>
              <Text>{p.description}</Text>
              {!hidePrice && <Text style={{ color: '#666' }}>{money(p.unitPrice)}/{UNIT_LABEL[p.unit]}</Text>}
            </Pressable>
          ))}
          {picking === 'Other' && <Pressable style={ui.btnOutline} onPress={addCustom}><Text style={ui.btnOutlineText}>Add blank custom line</Text></Pressable>}
        </View>
      )}

      {lines.length > 0 && (
        <View style={{ marginTop: 12, gap: 10 }}>
      <Pressable style={[ui.btnOutline, { marginTop: 10, marginBottom: 4 }]} onPress={addDrywallFromManual}>
        <Text style={ui.btnOutlineText}>Auto-calc drywall + paint from measurements</Text>
      </Pressable>
          <Text style={ui.h}>Line items</Text>
          {lines.map(l => (
            <View key={l.id} style={ui.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: '#185FA5' }}>{unit.trim() ? unit.trim() : l.category}</Text>
                <Pressable onPress={() => del(l.id)}><Text style={{ color: '#c0392b' }}>Remove</Text></Pressable>
              </View>
              <TextInput editable={!readOnly} style={[ui.input, { marginTop: 6 }]} value={l.description} onChangeText={v => upd(l.id, { description: v })} placeholder="Description" />
              <View style={[ui.row, { marginTop: 6, alignItems: 'flex-end' }]}>
                <Field label={UNIT_LABEL[l.unit] ?? 'qty'} value={String(l.quantity)} onChange={v => upd(l.id, { quantity: parseFloat(v) || 0 })} />
                {!hidePrice && (isSupervisor ? (
                  <View style={{ flex: 1 }}>
                    <Text style={ui.label}>{`$/${UNIT_LABEL[l.unit]}`}</Text>
                    <Text style={{ fontSize: 16, paddingVertical: 10 }}>{money(l.unitPrice)}</Text>
                    <Pressable onPress={() => { Alert.prompt('Change price', 'Enter the new price for this line.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: (v?: string) => { if (v != null) updPrice(l, v); } }], 'plain-text', String(l.unitPrice)); }}>
                      <Text style={{ color: '#185FA5', fontWeight: '600', marginTop: 2 }}>Change price</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Field label={`$/${UNIT_LABEL[l.unit]}`} value={String(l.unitPrice)} onChange={v => updPrice(l, v)} />
                ))}
                {!hidePrice && (
                <View style={{ flex: 1 }}>
                  <Text style={ui.label}>Line total</Text>
                  {!hidePrice && <Text style={{ fontSize: 16, fontWeight: '500', paddingVertical: 10 }}>{money(lineTotal(l))}</Text>}
                </View>
                )}
              </View>
              {!hidePrice && l.origPrice != null && l.origPrice !== l.unitPrice && (
                <Text style={{ fontSize: 12, color: '#b8860b', marginTop: 6 }}>Was {money(l.origPrice)} · now {money(l.unitPrice)}{l.priceBy ? ' · ' + l.priceBy : ''}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {!hidePrice && (
      <View style={[ui.card, { borderColor: '#185FA5', marginTop: 12 }]}>
        {!hidePrice && <View style={ui.totalRow}><Text style={ui.totalK}>Room total</Text><Text style={ui.totalV}>{money(total)}</Text></View>}
      </View>
      )}

      {!readOnly && (
        <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={addCustom}><Text style={ui.btnOutlineText}>+ Add line item</Text></Pressable>
      )}

      <Pressable style={[ui.btn, { marginTop: 8 }]} onPress={onSave}><Text style={ui.btnText}>{roomId ? 'Save changes' : 'Save room to project'}</Text></Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={ui.label}>{label}</Text>
      <TextInput style={ui.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" />
    </View>
  );
}

const chip = { borderWidth: 1, borderColor: '#185FA5', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 } as const;
const chipOn = { backgroundColor: '#185FA5' } as const;
