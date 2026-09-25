import { requireNativeModule } from 'expo-modules-core';

export type ARMeasureResult = {
  points: { x: number; y: number; z: number }[];
  distancesFt: number[];   // distances between consecutive points
  areaSqFt: number;        // polygon area if 3+ points
  widthFt?: number;        // bounding width
  heightFt?: number;       // bounding height
  imagePath?: string;
};

type ARMeasureModule = { isSupported(): boolean; measure(): Promise<ARMeasureResult> };

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
export function measureArea(): Promise<ARMeasureResult> {
  if (!Native) return Promise.reject(new Error('AR measure unavailable.'));
  return Native.measure();
}
