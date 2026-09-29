import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { queueVendorChangeOrder, flushVendorOutbox } from '../lib/vendorChangeOrders';
import { ui, ACCENT } from '../lib/ui';

// Vendor raises a change work order from the job site. Everything is required
// (what changed, why, measurements, notes, photos) so there is never a mix-up.
// Saved on the phone first, then pushed when there is service.

export default function VendorChangeOrder() {
  const router = useRouter();
  const { trackingId, vendor, address } = useLocalSearchParams<{ trackingId: string; vendor: string; address?: string }>();
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [measurements, setMeasurements] = useState('');
  const [notes, setNotes] = useState('');
  const [cost, setCost] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function takePhoto() {
    if (photos.length >= 6) { Alert.alert('Photo limit', 'Up to 6 photos per change work order.'); return; }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera needed', 'Allow camera access to add photos.'); return; }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.3, base64: true, allowsEditing: false });
    if (shot.canceled || !shot.assets?.[0]?.base64) return;
    const data = `data:image/jpeg;base64,${shot.assets[0].base64}`;
    if (data.length > 700_000) { Alert.alert('Photo too large', 'Try again a little further back — the photo must be under about 500 KB.'); return; }
    setPhotos((p) => [...p, data]);
  }

  async function submit() {
    const missing = [
      !description.trim() && 'what changed', !reason.trim() && 'why', !measurements.trim() && 'measurements',
      !notes.trim() && 'notes', !photos.length && 'at least one photo',
    ].filter(Boolean);
    if (missing.length) { Alert.alert('Change work order incomplete', 'Please add ' + missing.join(', ') + '.'); return; }
    if (!trackingId || !vendor) { Alert.alert('Missing job', 'Open the job from the Vendor screen first.'); return; }
    setBusy(true);
    try {
      await queueVendorChangeOrder({
        trackingId: String(trackingId), vendorName: String(vendor), description: description.trim(), reason: reason.trim(),
        measurements: measurements.trim(), notes: notes.trim(), cost: parseFloat(cost) || 0, photos,
      });
      const r = await flushVendorOutbox();
      if (r.left === 0) {
        Alert.alert('Sent', 'Your change work order went to the supervisor handling this scope. You\'ll see who received it and their decision on the Vendor screen.', [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        Alert.alert('Saved — waiting for service', 'No service right now. It is saved on this phone and will be sent automatically as soon as you have service (open the app again when you do).', [{ text: 'OK', onPress: () => router.back() }]);
      }
    } finally { setBusy(false); }
  }

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, multiline = true, keyboard: any = 'default') => (
    <View>
      <Text style={ui.label}>{label}</Text>
      <TextInput style={[ui.input, multiline && { height: 80, textAlignVertical: 'top' }]} value={value} onChangeText={set} placeholder={placeholder} multiline={multiline} keyboardType={keyboard} />
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.h}>Change work order</Text>
        <Text style={{ color: '#666', fontSize: 13 }}>Job {String(trackingId || '')}{address ? ' · ' + address : ''}. Goes to the supervisor handling this scope, who approves and sends it to Procurement. Everything below is required.</Text>
        {field('What changed / extra work needed', description, setDescription, 'Describe the extra work found on site')}
        {field('Why — reason it is outside the scope', reason, setReason, 'e.g. wall behind the tile is rotted; scope only covered tile')}
        {field('Measurements', measurements, setMeasurements, 'e.g. 12 ft × 8 ft wall, 96 sq ft', false)}
        {field('Notes', notes, setNotes, 'Anything the supervisor needs to know')}
        {field('Added cost $ (optional)', cost, setCost, '0.00', false, 'decimal-pad')}
        <Pressable style={[ui.btnOutline]} onPress={takePhoto}>
          <Text style={ui.btnOutlineText}>{photos.length ? `Add another photo (${photos.length}/6)` : 'Take a photo (required)'}</Text>
        </Pressable>
        {!!photos.length && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {photos.map((p, i) => (
              <Pressable key={i} onLongPress={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>
                <Image source={{ uri: p }} style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: '#eee' }} />
              </Pressable>
            ))}
            <Text style={{ width: '100%', color: '#888', fontSize: 12 }}>Hold a photo to remove it.</Text>
          </View>
        )}
        <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
          <Text style={ui.btnText}>{busy ? 'Sending…' : 'Send to supervisor'}</Text>
        </Pressable>
        <Text style={{ color: '#888', fontSize: 12, textAlign: 'center' }}>No service? It is saved on this phone and sent automatically when service returns.</Text>
        <Pressable style={ui.btnOutline} onPress={() => router.back()}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
