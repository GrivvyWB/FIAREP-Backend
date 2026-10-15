// FIAREP reference image: the member's own photo, marked up — red circle
// around the damaged part, arrow to the leak source / worst damage, the wall
// the camera faced, and the replacement part. Positions are the AI's estimate.
import { useEffect, useState } from 'react';
import { View, Image, Text } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import { photoUri } from '../lib/photos';

type Props = { photo: string; mark: { x: number; y: number; r: number }; arrow: { x: number; y: number }; facing: string | null; partLabel: string };

export default function RepairReferenceImage({ photo, mark, arrow, facing, partLabel }: Props) {
  const uri = photoUri(photo);
  const [w, setW] = useState(0);
  const [aspect, setAspect] = useState(4 / 3);
  useEffect(() => { Image.getSize(uri, (iw, ih) => { if (iw && ih) setAspect(iw / ih); }, () => {}); }, [uri]);
  const h = w ? w / aspect : 0;
  const cx = mark.x * w, cy = mark.y * h, r = Math.max(18, mark.r * w);
  const ax = arrow.x * w, ay = arrow.y * h;
  // The arrow comes in from whichever side has more room.
  const fromX = ax > w / 2 ? ax - w * 0.28 : ax + w * 0.28;
  const fromY = ay > h / 2 ? ay - h * 0.22 : ay + h * 0.22;
  const ang = Math.atan2(ay - fromY, ax - fromX);
  const head = 14;
  const p1 = `${ax},${ay}`;
  const p2 = `${ax - head * Math.cos(ang - 0.45)},${ay - head * Math.sin(ang - 0.45)}`;
  const p3 = `${ax - head * Math.cos(ang + 0.45)},${ay - head * Math.sin(ang + 0.45)}`;
  const labelTop = cy + r + 6 > h - 34 ? Math.max(4, cy - r - 34) : cy + r + 6;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ width: '100%' }}>
      {!!w && (
        <View style={{ width: w, height: h, borderRadius: 12, overflow: 'hidden', backgroundColor: '#111' }}>
          <Image source={{ uri }} style={{ width: w, height: h }} resizeMode="stretch" />
          <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }}>
            <Circle cx={cx} cy={cy} r={r} stroke="#ef4444" strokeWidth={4} fill="rgba(239,68,68,0.18)" />
            <Line x1={fromX} y1={fromY} x2={ax} y2={ay} stroke="#facc15" strokeWidth={4} />
            <Polygon points={`${p1} ${p2} ${p3}`} fill="#facc15" />
          </Svg>
          {!!facing && (
            <View style={{ position: 'absolute', top: 8, alignSelf: 'center', backgroundColor: 'rgba(17,24,39,0.85)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>▲ {facing.toUpperCase()} WALL</Text>
            </View>
          )}
          {!!partLabel && (
            <View style={{ position: 'absolute', top: labelTop, left: Math.min(Math.max(4, cx - 90), w - 184), width: 180, backgroundColor: '#ef4444', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, textAlign: 'center' }} numberOfLines={2}>{partLabel}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
