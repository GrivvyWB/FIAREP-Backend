import { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { createManagementReport, LOCATION_CATEGORIES, listDevelopmentNames } from '../lib/store';
import { takePhoto, pickPhoto, photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import PhotoViewer from '../components/PhotoViewer';
import { ui, ACCENT } from '../lib/ui';
import AddressInput from '../components/AddressInput';

export default function CreateReport() {
  const router = useRouter();
  const [location, setLocation] = useState('Building');
  const [locationOther, setLocationOther] = useState('');
  const [unit, setUnit] = useState('');
  const [address, setAddress] = useState('');
  const [development, setDevelopment] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [devPickerOpen, setDevPickerOpen] = useState(false);
  const [devQuery, setDevQuery] = useState('');
  const devNames = useMemo(() => listDevelopmentNames(), []);
  const devFiltered = useMemo(() => {
    const q = devQuery.trim().toLowerCase();
    return q ? devNames.filter((n) => n.toLowerCase().includes(q)) : devNames;
  }, [devQuery, devNames]);

  async function onTake() {
    try { const uri = await takePhoto(); if (uri) setPhotos((p) => [...p, uri]); }
    catch (e: any) { Alert.alert('Camera error', e?.message ?? 'Could not take photo.'); }
  }
  async function onPick() {
    try { const uri = await pickPhoto(); if (uri) setPhotos((p) => [...p, uri]); }
    catch (e: any) { Alert.alert('Photo error', e?.message ?? 'Could not pick photo.'); }
  }

  async function onSubmit() {
    if (!description.trim()) { Alert.alert('Description required', 'Describe what needs repair.'); return; }
    setSubmitting(true);
    try {
      const effLoc = location === 'Other' ? (locationOther.trim() || 'Other') : location;
      await createManagementReport(effLoc, unit.trim(), address.trim(), description.trim(), photos, development.trim());
      Alert.alert('Report created', 'The report has been created and can be assigned.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Could not create report.');
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Create Report</Text>

      <Text style={ui.label}>Location</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {LOCATION_CATEGORIES.map((c) => (
          <TouchableOpacity key={c} style={[ui.btnOutline, location === c && { backgroundColor: ACCENT }]} onPress={() => setLocation(c)}>
            <Text style={location === c ? ui.btnText : ui.btnOutlineText}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {location === 'Other' && (
        <TextInput style={ui.input} value={locationOther} onChangeText={setLocationOther} placeholder="Type a location" autoCapitalize="words" />
      )}

      <Text style={ui.label}>Unit / Apartment (optional)</Text>
      <TextInput style={ui.input} value={unit} onChangeText={setUnit} placeholder="e.g. 4B" autoCapitalize="characters" />

      <Text style={ui.label}>Address (optional)</Text>
      <AddressInput value={address} onChangeText={setAddress} placeholder="e.g. 123 Main St" />

      <Text style={ui.label}>Development</Text>
      <Pressable style={ui.input} onPress={() => setDevPickerOpen(true)}>
        <Text style={{ color: development ? '#000' : '#999' }}>{development || 'Select development'}</Text>
      </Pressable>

      <Text style={ui.label}>Description</Text>
      <TextInput style={[ui.input, { minHeight: 100 }]} value={description} onChangeText={setDescription} placeholder="What needs repair or inspection?" multiline textAlignVertical="top" />

      <Text style={ui.label}>Photos</Text>
      <View style={ui.row}>
        <TouchableOpacity style={[ui.btnOutline, { flex: 1 }]} onPress={onTake}><Text style={ui.btnOutlineText}>Take Photo</Text></TouchableOpacity>
        <TouchableOpacity style={[ui.btnOutline, { flex: 1 }]} onPress={onPick}><Text style={ui.btnOutlineText}>Choose Photo</Text></TouchableOpacity>
      </View>
      {photos.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {photos.map((uri, i) => (
            <TouchableOpacity key={`${uri}-${i}`} onPress={() => setViewerUri(uri)}>
              <RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity style={[ui.btn, { marginTop: 16 }, submitting && { opacity: 0.6 }]} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={ui.btnText}>Create Report</Text>}
      </TouchableOpacity>

      <PhotoViewer uri={viewerUri} onClose={() => setViewerUri(null)} />

      <Modal visible={devPickerOpen} animationType="slide" onRequestClose={() => setDevPickerOpen(false)}>
        <View style={{ flex: 1, padding: 16, paddingTop: 60, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={ui.h}>Select development</Text>
            <Pressable onPress={() => setDevPickerOpen(false)}><Text style={{ color: ACCENT, fontWeight: '600', fontSize: 16 }}>Close</Text></Pressable>
          </View>
          <TextInput style={ui.input} value={devQuery} onChangeText={setDevQuery} placeholder="Search developments..." autoFocus />
          <FlatList
            data={devFiltered}
            keyExtractor={(n) => n}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => { setDevelopment(item); setDevPickerOpen(false); setDevQuery(''); }}>
                <Text style={{ fontSize: 16 }}>{item}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={ui.empty}>No matches.</Text>}
          />
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
