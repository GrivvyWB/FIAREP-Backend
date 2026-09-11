import { requireNativeModule } from 'expo-modules-core';
import type { RoomScan } from '../../../lib/takeoff';

type RoomScannerModule = { isSupported(): boolean; scanRoom(): Promise<RoomScan> };

let Native: RoomScannerModule | null = null;
try {
  Native = requireNativeModule<RoomScannerModule>('RoomScanner');
  console.log('[RoomScanner] native module LOADED ok');
} catch (e) {
  console.log('[RoomScanner] FAILED to load native module:', String(e));
  Native = null;
}

export function isRoomScanSupported(): boolean {
  return !!Native && Native.isSupported();
}
export function scanRoom(): Promise<RoomScan> {
  if (!Native) return Promise.reject(new Error('Native module unavailable.'));
  return Native.scanRoom();
}
