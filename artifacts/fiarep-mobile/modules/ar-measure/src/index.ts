import { requireNativeModule } from 'expo-modules-core';

export type ARMeasureResult = {
  points: { x: number; y: number; z: number }[];
  distancesFt: number[];   // distances between consecutive points
  areaSqFt: number;        // polygon area if 3+ points
  widthFt?: number;        // bounding width
  heightFt?: number;       // bounding height
  imagePath?: string;
};

type ARMeasureModule = { isSupported(): boolean; measure(steps: string[]): Promise<ARMeasureResult> };

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

/** Door / window opening: three corners give width (side 1) and height (side 2). */
export const OPENING_STEPS = [
  'Stand back so the whole opening is in view. Put the + on the BOTTOM-LEFT corner of the opening (where the left jamb meets the floor / sill) and tap.',
  'Move the + to the BOTTOM-RIGHT corner of the opening and tap. That is the width.',
  'Move the + up to the TOP-RIGHT corner (right jamb meets the head) and tap. That is the height.',
];
