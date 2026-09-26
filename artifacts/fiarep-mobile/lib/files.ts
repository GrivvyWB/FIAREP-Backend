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

const DOC_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

/**
 * Upload an attached scope file so the CPM Supervisor and Procurement can open
 * it (it was device-only before). Allowed: PDF, Word, Excel, CSV and photos.
 */
export async function uploadScopeFile(
  stored: string,
  name: string,
  owner: { entity: string; recordId: string },
): Promise<{ id: string; objectPath: string; name: string; contentType: string; size: number }> {
  const { requestFileUploadUrl } = await import('@workspace/api-client-react');
  const uri = fileUri(stored);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !('size' in info) || !info.size) throw new Error('The attached scope file is no longer on this phone. Attach it again.');
  const ext = (name.split('.').pop() || '').toLowerCase();
  const contentType = DOC_TYPES[ext];
  if (!contentType) throw new Error('Attach the scope as a PDF, Word, Excel, CSV or photo file.');
  const requested = await requestFileUploadUrl({
    kind: 'procurement-scope',
    name,
    size: info.size,
    contentType,
    entity: owner.entity,
    recordId: owner.recordId,
  });
  const result = await FileSystem.uploadAsync(requested.uploadUrl, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    mimeType: contentType,
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`Scope file upload failed (${result.status}).`);
  return { id: requested.file.id, objectPath: requested.file.objectPath, name, contentType, size: info.size };
}
