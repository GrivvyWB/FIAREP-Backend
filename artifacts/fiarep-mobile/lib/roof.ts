import { GOOGLE_API_KEY } from './config';

const M2_TO_FT2 = 10.7639;

export type RoofSegment = {
  areaFt2: number;
  pitchDegrees: number;
  azimuthDegrees: number;
  facing: string; // N/NE/E/... derived from azimuth
};
export type RoofData = {
  address: string;
  lat: number;
  lng: number;
  wholeRoofFt2: number;      // actual surface area (pitch-adjusted)
  groundFt2: number;         // footprint
  squares: number;           // roofing squares (area / 100 ft²)
  segments: RoofSegment[];
  imageryDate?: string;
};

function azimuthToFacing(az: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((az % 360) / 45)) % 8];
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; formatted: string }> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.status !== 'OK' || !j.results?.length) {
    throw new Error(`Geocoding failed: ${j.status}${j.error_message ? ' — ' + j.error_message : ''}`);
  }
  const r = j.results[0];
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted: r.formatted_address };
}

export async function getRoofData(address: string): Promise<RoofData> {
  const { lat, lng, formatted } = await geocodeAddress(address);
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.error) {
    throw new Error(`Solar API: ${j.error.message ?? j.error.status ?? 'error'}`);
  }
  const sp = j.solarPotential;
  if (!sp?.wholeRoofStats) {
    throw new Error('No roof data available for this address.');
  }
  const wholeRoofFt2 = sp.wholeRoofStats.areaMeters2 * M2_TO_FT2;
  const groundFt2 = (sp.wholeRoofStats.groundAreaMeters2 ?? 0) * M2_TO_FT2;
  const segments: RoofSegment[] = (sp.roofSegmentStats ?? []).map((s: any) => ({
    areaFt2: (s.stats?.areaMeters2 ?? 0) * M2_TO_FT2,
    pitchDegrees: s.pitchDegrees ?? 0,
    azimuthDegrees: s.azimuthDegrees ?? 0,
    facing: azimuthToFacing(s.azimuthDegrees ?? 0),
  }));
  const imageryDate = j.imageryDate ? `${j.imageryDate.year}-${String(j.imageryDate.month).padStart(2, '0')}-${String(j.imageryDate.day).padStart(2, '0')}` : undefined;
  return {
    address: formatted,
    lat, lng,
    wholeRoofFt2,
    groundFt2,
    squares: wholeRoofFt2 / 100,
    segments,
    imageryDate,
  };
}
