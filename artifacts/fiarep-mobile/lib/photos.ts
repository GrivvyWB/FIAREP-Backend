import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { captureGeo, type GeoStamp } from './geo';
import { requestFileUploadUrl } from '@workspace/api-client-react';

export type PhotoEvidence = {
  uri: string;
  capturedAt: string;
  geo: GeoStamp;
};

// Copy a picked/captured image into permanent app storage so it survives
// app restarts (the picker returns a temporary URI that iOS later deletes).
async function persist(uri: string): Promise<string> {
  const dir = FileSystem.documentDirectory + 'photos/';
  try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch {}
  const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.jpg';
  const dest = dir + name;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return 'photos/' + name;
}

export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission denied.');
  const res = await ImagePicker.launchCameraAsync({ quality: 0.5, allowsEditing: false });
  if (res.canceled || !res.assets?.length) return null;
  return persist(res.assets[0].uri);
}

export async function pickPhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library permission denied.');
  const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, allowsEditing: false, mediaTypes: 'images' });
  if (res.canceled || !res.assets?.length) return null;
  return persist(res.assets[0].uri);
}


export function photoUri(stored: string): string {
  if (!stored) return stored;
  if (stored.startsWith('file:') || stored.startsWith('/')) return stored;
  return FileSystem.documentDirectory + stored;
}

/**
 * Upload a retained local photo through the authenticated presigned-url flow.
 * The local file is deliberately never removed here; callers can safely keep
 * it for offline viewing and retry failed uploads.
 */
export async function uploadPhoto(
  stored: string,
  kind: 'room-photo' | 'completion-photo' | 'inspection-evidence' = 'room-photo',
  owner: { entity: string; recordId: string },
): Promise<{ id: string; objectPath: string; name: string; contentType: string }> {
  const uri = photoUri(stored);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !('size' in info) || !info.size) throw new Error('Photo file is unavailable.');
  const name = stored.split('/').pop() || 'photo.jpg';
  const requested = await requestFileUploadUrl({
    kind,
    name,
    size: info.size,
    contentType: 'image/jpeg',
    entity: owner.entity,
    recordId: owner.recordId,
  });
  const result = await FileSystem.uploadAsync(requested.uploadUrl, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    mimeType: 'image/jpeg',
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Photo upload failed (${result.status}).`);
  }
  return requested.file;
}

// Read a stored photo and return a data: URI (base64) for embedding in PDF/HTML.
export async function photoBase64(stored: string): Promise<string | null> {
  try {
    const uri = photoUri(stored);
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
    return 'data:image/jpeg;base64,' + b64;
  } catch { return null; }
}

// Capture a photo AND its geo stamp together (for field chain-of-custody).
export async function takePhotoWithGeo(): Promise<PhotoEvidence | null> {
  const uri = await takePhoto();
  if (!uri) return null;
  const geo = await captureGeo();
  return { uri, geo, capturedAt: geo.at };
}
export async function pickPhotoWithGeo(): Promise<PhotoEvidence | null> {
  const uri = await pickPhoto();
  if (!uri) return null;
  const geo = await captureGeo();
  return { uri, geo, capturedAt: geo.at };
}

