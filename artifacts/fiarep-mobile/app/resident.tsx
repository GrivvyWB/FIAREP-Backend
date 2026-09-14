import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import PhotoViewer from '../components/PhotoViewer';
import { useRouter } from 'expo-router';
import { createResidentReport, LOCATION_CATEGORIES } from '../lib/store';
import { takePhoto, pickPhoto, photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';

export default function ResidentScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [location, setLocation] = useState('Apartment/Unit');
  // Resident form: drop Cellar + Roof, rename 'Compactor Room' to 'Compactor'.
  const RESIDENT_LOCATIONS = LOCATION_CATEGORIES
    .filter((c) => c !== 'Cellar' && c !== 'Roof')
    .map((c) => (c === 'Compactor Room' ? 'Compactor' : c));
  const [locationOther, setLocationOther] = useState('');
  const [unit, setUnit] = useState('');
  const [development, setDevelopment] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function onTakePhoto() {
    try {
      const uri = await takePhoto();
      if (uri) setPhotos((p) => [...p, uri]);
    } catch (e: any) {
      Alert.alert('Camera error', e?.message ?? 'Could not take photo.');
    }
  }

  async function onPickPhoto() {
    try {
      const uri = await pickPhoto();
      if (uri) setPhotos((p) => [...p, uri]);
    } catch (e: any) {
      Alert.alert('Photo error', e?.message ?? 'Could not pick photo.');
    }
  }

  function removePhoto(idx: number) {
    setPhotos((p) => p.filter((_, i) => i !== idx));
  }

  async function onSubmit() {
    if (!development.trim()) {
      Alert.alert('Development required', 'Please enter your development.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Description required', 'Please describe the issue.');
      return;
    }
    setSubmitting(true);
    try {
      const effLoc = location === 'Other' ? (locationOther.trim() || 'Other') : location;
      const report = await createResidentReport(unit.trim(), development.trim(), description.trim(), photos, name.trim(), effLoc);
      const failures = (report as any).photoUploadFailures as string[] | undefined;
      Alert.alert('Report submitted', `Complaint number: ${report.complaintNo}\n\nThis report is saved on this device for status checks.${failures?.length ? `\n\n${failures.length} photo(s) could not be uploaded.` : ''}`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message ?? 'Could not submit report.');
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Report an Issue</Text>
      <Text style={styles.subtitle}>
        Submit a maintenance or building issue to management.
      </Text>

      <Text style={styles.label}>Your Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. John Smith"
        placeholderTextColor="#999"
        autoCapitalize="words"
      />

      <Text style={styles.label}>Location</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {RESIDENT_LOCATIONS.map((c) => (
          <TouchableOpacity
            key={c}
            style={{ borderWidth: 1, borderColor: location === c ? '#0a7ea4' : '#ddd', backgroundColor: location === c ? '#0a7ea4' : '#fafafa', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
            onPress={() => setLocation(c)}
          >
            <Text style={{ color: location === c ? '#fff' : '#333', fontWeight: '600' }}>{c}</Text>
          </TouchableOpacity>
        ))}
        {location === 'Other' && (
          <TextInput value={locationOther} onChangeText={setLocationOther} placeholder="Type a location" placeholderTextColor="#999" style={styles.input} />
        )}
      </View>

      <Text style={styles.label}>Unit / Apartment</Text>
      <TextInput
        style={styles.input}
        value={unit}
        onChangeText={setUnit}
        placeholder="e.g. 4B"
        placeholderTextColor="#999"
        autoCapitalize="characters"
      />

      <Text style={styles.label}>Development</Text>
      <TextInput
        value={development}
        onChangeText={setDevelopment}
        style={styles.input}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        placeholder="Describe the issue..."
        placeholderTextColor="#999"
        multiline
        numberOfLines={5}
        textAlignVertical="top"
      />

      <Text style={styles.label}>Photos</Text>
      <View style={styles.photoRow}>
        <TouchableOpacity style={styles.photoBtn} onPress={onTakePhoto}>
          <Text style={styles.photoBtnText}>Take Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.photoBtn} onPress={onPickPhoto}>
          <Text style={styles.photoBtnText}>Choose Photo</Text>
        </TouchableOpacity>
      </View>

      {photos.length > 0 && (
        <View style={styles.photoGrid}>
          {photos.map((uri, idx) => (
            <View key={`${uri}-${idx}`} style={styles.thumbWrap}>
              <TouchableOpacity onPress={() => setViewerUri(uri)}><RemotePhoto localUri={uri} style={styles.thumb} /></TouchableOpacity>
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => removePhoto(idx)}
              >
                <Text style={styles.removeBtnText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
        onPress={onSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>Submit Report</Text>
        )}
      </TouchableOpacity>

    <PhotoViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', color: '#111', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111',
    backgroundColor: '#fafafa',
    marginBottom: 12,
    justifyContent: 'center',
    minHeight: 44,
  },
  textArea: { minHeight: 120 },
  photoRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  photoBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#0a7ea4',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  photoBtnText: { color: '#0a7ea4', fontWeight: '600', fontSize: 15 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 90, height: 90, borderRadius: 8, backgroundColor: '#eee' },
  removeBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#c00',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20 },
  submitBtn: {
    backgroundColor: '#0a7ea4',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  modalWrap: { flex: 1, padding: 20, backgroundColor: '#fff', paddingTop: 60 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#111' },
  modalClose: { fontSize: 16, color: '#0a7ea4', fontWeight: '600' },
  devRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  devRowText: { fontSize: 16, color: '#111' },
  emptyText: { color: '#999', textAlign: 'center', marginTop: 30 },
});
