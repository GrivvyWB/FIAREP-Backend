import { useEffect, useState, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
let Magnetometer: any = null;
try { Magnetometer = require('expo-sensors').Magnetometer; } catch (e) { Magnetometer = null; }
import { ui } from '../../lib/ui';

function headingFromMagnetometer(x: number, y: number): number {
  let angle = Math.atan2(y, x) * (180 / Math.PI);
  angle = angle - 90;
  if (angle < 0) angle += 360;
  return Math.round((360 - angle) % 360);
}

const dirLabel = (deg: number) => {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
};

export default function Compass() {
  const [heading, setHeading] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let sub: any;
    (async () => {
      const ok = Magnetometer ? await Magnetometer.isAvailableAsync().catch(() => false) : false;
      setAvailable(ok);
      if (!ok) return;
      Magnetometer.setUpdateInterval(120);
      sub = Magnetometer.addListener(({ x, y }: { x: number; y: number }) => {
        const h = headingFromMagnetometer(x, y);
        setHeading(h);
        Animated.timing(rotate, { toValue: -h, duration: 120, easing: Easing.linear, useNativeDriver: true }).start();
      });
    })();
    return () => sub && sub.remove();
  }, []);

  const spin = rotate.interpolate({ inputRange: [-360, 0], outputRange: ['-360deg', '0deg'] });

  if (available === false) {
    return <View style={ui.wrap}><Text style={ui.empty}>Compass needs a native rebuild to activate (or isn't available on this device).</Text></View>;
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
      <Text style={{ fontSize: 64, fontWeight: '200' }}>{heading}°</Text>
      <Text style={{ fontSize: 28, fontWeight: '600', color: '#185FA5', marginBottom: 24 }}>{dirLabel(heading)}</Text>

      <Animated.View style={{ width: 260, height: 260, borderRadius: 130, borderWidth: 2, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}>
        <Text style={{ position: 'absolute', top: 8, fontSize: 22, fontWeight: '700', color: '#c0392b' }}>N</Text>
        <Text style={{ position: 'absolute', right: 12, fontSize: 20, fontWeight: '600' }}>E</Text>
        <Text style={{ position: 'absolute', bottom: 8, fontSize: 20, fontWeight: '600' }}>S</Text>
        <Text style={{ position: 'absolute', left: 12, fontSize: 20, fontWeight: '600' }}>W</Text>
        <View style={{ width: 4, height: 110, backgroundColor: '#c0392b', position: 'absolute', top: 20 }} />
      </Animated.View>

      <Text style={{ marginTop: 24, color: '#666', fontSize: 13, textAlign: 'center' }}>
        Hold flat. Point the top of the phone at the wall or feature to read its bearing.
      </Text>
    </View>
  );
}
