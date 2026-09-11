// GPS + timestamp capture, guarded so it never crashes before the native rebuild.
let Location: any = null;
try { Location = require('expo-location'); } catch (e) { Location = null; }

export type GeoStamp = {
  lat?: number;
  lng?: number;
  accuracy?: number;   // meters
  at: string;          // ISO timestamp (always present)
  source: 'gps' | 'none';
};

// Capture current location + timestamp. Returns a stamp with just the timestamp
// if GPS isn't available (module missing pre-rebuild, or permission denied).
export async function captureGeo(): Promise<GeoStamp> {
  const at = new Date().toISOString();
  if (!Location) return { at, source: 'none' };
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm?.granted) return { at, source: 'none' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced ?? 3 });
    return {
      lat: pos?.coords?.latitude,
      lng: pos?.coords?.longitude,
      accuracy: pos?.coords?.accuracy,
      at,
      source: 'gps',
    };
  } catch {
    return { at, source: 'none' };
  }
}

// Human-readable one-liner for reports.
export function geoLabel(g?: GeoStamp): string {
  if (!g) return '';
  const d = new Date(g.at);
  const when = isNaN(d.getTime()) ? g.at : d.toLocaleString();
  if (g.source === 'gps' && g.lat != null && g.lng != null) {
    return `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} · ${when}`;
  }
  return when;
}
