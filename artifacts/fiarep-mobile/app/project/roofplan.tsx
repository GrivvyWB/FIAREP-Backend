import { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, PanResponder, KeyboardAvoidingView, Platform } from 'react-native';
import Svg, { Polygon, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getRoofPlan, setRoofPlan } from '../../lib/store';
import { ui } from '../../lib/ui';
import { useAppMode } from '../_layout';

type Pt = { x: number; y: number };
type Marker = { id: string; type: string; x: number; y: number };
type EdgeLabel = { edgeIndex: number; text: string };
type SideLabel = { id: string; x: number; y: number; text: string };

const MARKER_TYPES = ['Bulkhead', 'Skylight', 'Waste stack', 'Fire escape', 'Chimney', 'Vent'];
const MARKER_COLORS: Record<string, string> = {
  'Bulkhead': '#8e44ad', 'Skylight': '#2980b9', 'Waste stack': '#c0392b',
  'Fire escape': '#e67e22', 'Chimney': '#7f8c8d', 'Vent': '#16a085',
};
const C = 1000;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// preset shapes in 0..1000 canvas coords
const PRESETS: Record<string, Pt[]> = {
  Rectangle: [ {x:250,y:200},{x:750,y:200},{x:750,y:800},{x:250,y:800} ],
  L: [ {x:250,y:200},{x:550,y:200},{x:550,y:550},{x:750,y:550},{x:750,y:800},{x:250,y:800} ],
  T: [ {x:250,y:200},{x:750,y:200},{x:750,y:400},{x:600,y:400},{x:600,y:800},{x:400,y:800},{x:400,y:400},{x:250,y:400} ],
  Cross: [ {x:400,y:150},{x:600,y:150},{x:600,y:400},{x:850,y:400},{x:850,y:600},{x:600,y:600},{x:600,y:850},{x:400,y:850},{x:400,y:600},{x:150,y:600},{x:150,y:400},{x:400,y:400} ],
};

export default function RoofPlan() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { mode: appMode } = useAppMode();
  const readOnly = appMode === 'administrator';
  const [points, setPoints] = useState<Pt[]>(PRESETS.Rectangle);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [edgeLabels, setEdgeLabels] = useState<EdgeLabel[]>([]);
  const [sideLabels, setSideLabels] = useState<SideLabel[]>([]);
  const [areaFt, setAreaFt] = useState('');
  const [mode, setMode] = useState<'shape' | 'marker' | 'edge' | 'side'>('shape');
  const [placingMarker, setPlacingMarker] = useState<string | null>(null);
  const [layout, setLayout] = useState({ w: 320, h: 320 });
  const dragIndex = useRef<number | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const load = useCallback(() => {
    if (!projectId) return;
    getRoofPlan(projectId).then((d) => {
      if (d && d.points && d.points.length) {
        setPoints(d.points); setMarkers(d.markers || []);
        setEdgeLabels(d.edgeLabels || []); setSideLabels(d.sideLabels || []);
        setAreaFt(d.areaFt ? String(d.areaFt) : '');
      }
    });
  }, [projectId]);
  useFocusEffect(load);

  const toC = (lx: number, ly: number): Pt => ({
    x: (lx / layoutRef.current.w) * C,
    y: (ly / layoutRef.current.h) * C,
  });

  // PanResponder: drag the nearest corner in shape mode; tap actions in other modes
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !readOnly,
      onMoveShouldSetPanResponder: () => !readOnly,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        const p = toC(locationX, locationY);
        if (modeRef.current === 'shape') {
          // grab nearest corner within threshold
          let best = -1, bestD = Infinity;
          pointsRef.current.forEach((pt, i) => {
            const d = Math.hypot(pt.x - p.x, pt.y - p.y);
            if (d < bestD) { bestD = d; best = i; }
          });
          dragIndex.current = bestD < 90 ? best : null;
        }
      },
      onPanResponderMove: (e) => {
        if (modeRef.current !== 'shape' || dragIndex.current == null) return;
        const { locationX, locationY } = e.nativeEvent;
        const p = toC(locationX, locationY);
        setPoints((pts) => pts.map((pt, i) => i === dragIndex.current ? { x: Math.round(p.x), y: Math.round(p.y) } : pt));
      },
      onPanResponderRelease: () => { dragIndex.current = null; },
    })
  ).current;

  const applyPreset = (name: string) => { setPoints(PRESETS[name].map(p => ({ ...p }))); setEdgeLabels([]); };

  const distToSeg = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx*dx+dy*dy||1;
    let t = ((p.x-a.x)*dx+(p.y-a.y)*dy)/len2; t = Math.max(0,Math.min(1,t));
    return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
  };

  const onCanvasPress = (e: any) => {
    const { locationX, locationY } = e.nativeEvent;
    const p = toC(locationX, locationY);
    if (mode === 'marker' && placingMarker) {
      setMarkers(m => [...m, { id: uid(), type: placingMarker, x: p.x, y: p.y }]);
      setPlacingMarker(null);
    } else if (mode === 'side') {
      Alert.prompt?.('Side label', 'e.g. 52nd Street', (t?: string) => { if (t) setSideLabels(s => [...s, { id: uid(), x: p.x, y: p.y, text: t }]); });
    } else if (mode === 'edge') {
      let best = 0, bestD = Infinity; const n = points.length;
      for (let i=0;i<n;i++){ const d=distToSeg(p, points[i], points[(i+1)%n]); if(d<bestD){bestD=d;best=i;} }
      Alert.prompt?.('Edge length', "e.g. 27'", (t?: string) => { if (t) setEdgeLabels(el => [...el.filter(x=>x.edgeIndex!==best), { edgeIndex: best, text: t }]); });
    }
  };

  const removeMarker = (id: string) => setMarkers(m => m.filter(x => x.id !== id));
  const save = async () => {
    if (!projectId) return;
    await setRoofPlan(projectId, { points, markers, edgeLabels, sideLabels, areaFt: parseFloat(areaFt)||0 });
    Alert.alert('Saved', 'Roof plan saved.');
  };

  const sx = layout.w / C, sy = layout.h / C;
  const polyStr = points.map(p => `${p.x*sx},${p.y*sy}`).join(' ');
  const edgeMid = (i: number): Pt => { const a=points[i],b=points[(i+1)%points.length]; return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; };

  const MBtn = ({ m, label }: { m: typeof mode; label: string }) => (
    <Pressable onPress={() => { setMode(m); setPlacingMarker(null); }}
      style={[ui.btnOutline, { flex: 1, paddingVertical: 8 }, mode === m && { backgroundColor: '#185FA5' }]}>
      <Text style={[ui.btnOutlineText, mode === m && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Start from a shape</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {Object.keys(PRESETS).map(name => (
          <Pressable key={name} style={[ui.btnOutline, { paddingHorizontal: 16 }]} onPress={() => { if (readOnly) return; applyPreset(name); }}>
            <Text style={ui.btnOutlineText}>{name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
        Shape: drag the corner dots to match your roof. Edge: tap an edge to enter its length. Side: tap to add a street name. Marker: pick a type then tap.
      </Text>
      <View style={ui.row}>
        <MBtn m="shape" label="Shape" />
        <MBtn m="edge" label="Edge ft" />
        <MBtn m="side" label="Side" />
        <MBtn m="marker" label="Marker" />
      </View>

      {mode === 'marker' && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {MARKER_TYPES.map(t => (
            <Pressable key={t} onPress={() => setPlacingMarker(placingMarker===t?null:t)}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5,
                borderColor: MARKER_COLORS[t], backgroundColor: placingMarker===t?MARKER_COLORS[t]:'transparent' }}>
              <Text style={{ color: placingMarker===t?'#fff':MARKER_COLORS[t], fontSize: 13 }}>{t}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View
        onLayout={(e) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.width })}
        style={{ width: '100%', aspectRatio: 1, backgroundColor: '#fafafa', borderRadius: 12, borderWidth: 1, borderColor: '#e0e0e0', marginTop: 8 }}
      >
        {mode === 'shape' ? (
          <View style={{ flex: 1 }} {...pan.panHandlers}>
            <Svg width={layout.w} height={layout.h}>
              <Rect x={0} y={0} width={layout.w} height={layout.h} fill="#fafafa" />
              <Polygon points={polyStr} fill="rgba(24,95,165,0.05)" stroke="#185FA5" strokeWidth={2} />
              {edgeLabels.map((el, i) => { const m=edgeMid(el.edgeIndex); return <SvgText key={i} x={m.x*sx} y={m.y*sy-4} fontSize={13} fill="#c0392b" textAnchor="middle" fontWeight="bold">{el.text}</SvgText>; })}
              {sideLabels.map(sl => <SvgText key={sl.id} x={sl.x*sx} y={sl.y*sy} fontSize={13} fill="#333" textAnchor="middle">{sl.text}</SvgText>)}
              {markers.map(m => m.type==='Skylight'
                ? <Rect key={m.id} x={m.x*sx-10} y={m.y*sy-10} width={20} height={20} fill={MARKER_COLORS[m.type]} stroke="#fff" strokeWidth={1.5} />
                : <Circle key={m.id} cx={m.x*sx} cy={m.y*sy} r={8} fill={MARKER_COLORS[m.type]} stroke="#fff" strokeWidth={1.5} />)}
              {markers.map(m => <SvgText key={m.id+'t'} x={m.x*sx+13} y={m.y*sy+4} fontSize={11} fill={MARKER_COLORS[m.type]}>{m.type}</SvgText>)}
              {/* corner handles (draggable) */}
              {points.map((p, i) => <Circle key={i} cx={p.x*sx} cy={p.y*sy} r={9} fill="#fff" stroke="#185FA5" strokeWidth={3} />)}
            </Svg>
          </View>
        ) : (
          <Pressable style={{ flex: 1 }} onPress={(e) => { if (readOnly) return; onCanvasPress(e); }}>
            <Svg width={layout.w} height={layout.h}>
              <Rect x={0} y={0} width={layout.w} height={layout.h} fill="#fafafa" />
              <Polygon points={polyStr} fill="rgba(24,95,165,0.05)" stroke="#185FA5" strokeWidth={2} />
              {edgeLabels.map((el, i) => { const m=edgeMid(el.edgeIndex); return <SvgText key={i} x={m.x*sx} y={m.y*sy-4} fontSize={13} fill="#c0392b" textAnchor="middle" fontWeight="bold">{el.text}</SvgText>; })}
              {sideLabels.map(sl => <SvgText key={sl.id} x={sl.x*sx} y={sl.y*sy} fontSize={13} fill="#333" textAnchor="middle">{sl.text}</SvgText>)}
              {markers.map(m => m.type==='Skylight'
                ? <Rect key={m.id} x={m.x*sx-10} y={m.y*sy-10} width={20} height={20} fill={MARKER_COLORS[m.type]} stroke="#fff" strokeWidth={1.5} />
                : <Circle key={m.id} cx={m.x*sx} cy={m.y*sy} r={8} fill={MARKER_COLORS[m.type]} stroke="#fff" strokeWidth={1.5} />)}
              {markers.map(m => <SvgText key={m.id+'t'} x={m.x*sx+13} y={m.y*sy+4} fontSize={11} fill={MARKER_COLORS[m.type]}>{m.type}</SvgText>)}
            </Svg>
          </Pressable>
        )}
      </View>

      <View><Text style={ui.label}>Total area (sq ft)</Text>
        <TextInput style={ui.input} value={areaFt} onChangeText={setAreaFt} keyboardType="numeric" placeholder="e.g. 1604" /></View>

      {markers.length > 0 && (
        <View>
          <Text style={ui.h}>Markers ({markers.length})</Text>
          {markers.map(m => (
            <View key={m.id} style={ui.line}>
              <Text style={{ color: MARKER_COLORS[m.type] }}>{m.type}</Text>
              <Pressable onPress={() => { if (readOnly) return; removeMarker(m.id); }}><Text style={{ color: '#c0392b' }}>Remove</Text></Pressable>
            </View>
          ))}
        </View>
      )}

      <Pressable style={ui.btn} onPress={() => { if (readOnly) return; save(); }}><Text style={ui.btnText}>Save roof plan</Text></Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
