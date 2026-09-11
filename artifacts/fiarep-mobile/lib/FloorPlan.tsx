import { View, Text } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

export type Wall2D = { x1: number; y1: number; x2: number; y2: number };

export function FloorPlan({ walls, size = 240 }: { walls: Wall2D[]; size?: number }) {
  if (!walls || walls.length === 0) {
    return <Text style={{ color: '#999', fontSize: 13 }}>No floor plan (scan a room with LiDAR to capture layout).</Text>;
  }
  // bounds
  const xs = walls.flatMap(w => [w.x1, w.x2]);
  const ys = walls.flatMap(w => [w.y1, w.y2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = 16;
  const scale = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
  const ox = pad - minX * scale;
  const oy = pad - minY * scale;
  const tx = (x: number) => x * scale + ox;
  const ty = (y: number) => y * scale + oy;

  const drawH = h * scale + pad * 2;
  return (
    <View>
      <Svg width={size} height={drawH}>
        <Rect x={0} y={0} width={size} height={drawH} fill="#f7f7f7" rx={8} />
        {walls.map((wall, i) => (
          <Line key={i} x1={tx(wall.x1)} y1={ty(wall.y1)} x2={tx(wall.x2)} y2={ty(wall.y2)}
            stroke="#185FA5" strokeWidth={3} strokeLinecap="round" />
        ))}
      </Svg>
    </View>
  );
}
