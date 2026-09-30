import { requireNativeModule } from 'expo-modules-core';

export type ARMeasureResult = {
  points: { x: number; y: number; z: number }[];
  distancesFt: number[];   // distances between consecutive points
  areaSqFt: number;        // polygon area if 3+ points
  widthFt?: number;        // bounding width
  heightFt?: number;       // bounding height
  imagePath?: string;
};

type ARMeasureModule = { isSupported(): boolean; measure(steps: string[]): Promise<ARMeasureResult>; scanOpening(mode: string, label: string): Promise<ARMeasureResult> };

let Native: ARMeasureModule | null = null;
try {
  Native = requireNativeModule<ARMeasureModule>('ARMeasure');
  console.log('[ARMeasure] native module LOADED ok');
} catch (e) {
  console.log('[ARMeasure] FAILED to load:', String(e));
  Native = null;
}

export function isARMeasureSupported(): boolean {
  return !!Native && Native.isSupported();
}
/** Free tapping (2 points = length, 3+ = area), or guided: one prompt per corner. */
export function measureArea(steps: string[] = []): Promise<ARMeasureResult> {
  if (!Native) return Promise.reject(new Error('AR measure unavailable.'));
  return Native.measure(steps);
}

/** Automatic: point the camera at the thing; it finds its outline and measures
 * width × height by itself — no tapping. mode 'opening' = a door / window on a
 * wall (tall rectangle); 'surface' = any rectangle on any surface (a slab, a
 * sidewalk flag, a driveway, a wall, a facade). label = what to call it. */
export function scanOpening(mode: 'opening' | 'surface' = 'opening', label = 'opening'): Promise<ARMeasureResult> {
  if (!Native) return Promise.reject(new Error('AR scan unavailable.'));
  if (typeof Native.scanOpening !== 'function') return Promise.reject(new Error('This build cannot scan automatically yet — update the app.'));
  return Native.scanOpening(mode, label);
}

/** Door / window opening: three corners give width (side 1) and height (side 2). */
export const OPENING_STEPS = [
  'Stand back so the whole opening is in view. Put the + on the BOTTOM-LEFT corner of the opening (where the left jamb meets the floor / sill) and tap.',
  'Move the + to the BOTTOM-RIGHT corner of the opening and tap. That is the width.',
  'Move the + up to the TOP-RIGHT corner (right jamb meets the head) and tap. That is the height.',
];
