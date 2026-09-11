import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

export type PickedFile = { path: string; name: string };

// Copy a picked document into permanent app storage, mirroring photos.ts.
// The picker returns a temporary URI that iOS may later delete, so we copy it
// into documentDirectory and keep a relative path plus the original filename.
async function persist(uri: string, originalName: string): Promise<string> {
  const dir = FileSystem.documentDirectory + 'files/';
  try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch {}
  const safe = (originalName || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  const name = Date.now().toString(36) + '_' + safe;
  const dest = dir + name;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return 'files/' + name;
}

// Pick a document. Returns the stored relative path and the display name, or
// null if the user cancels. NOTE: the file lives only on THIS device. Until a
// backend exists, it cannot reach another phone.
export async function pickDocument(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const path = await persist(a.uri, a.name || 'document');
  return { path, name: a.name || 'document' };
}

// Pick a CSV/text file and return its text content plus the display name, or
// null if cancelled. Used for uploading an address/violation list.
export async function pickTextFile(): Promise<{ text: string; name: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: ['text/csv', 'text/plain', 'text/comma-separated-values', 'public.comma-separated-values-text', 'public.plain-text', '*/*'] });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const text = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.UTF8 });
  return { text, name: a.name || 'list.csv' };
}

export function fileUri(stored: string): string {
  if (!stored) return stored;
  if (stored.startsWith('file:') || stored.startsWith('/')) return stored;
  return FileSystem.documentDirectory + stored;
}
