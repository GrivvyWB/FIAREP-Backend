import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import PhotoViewer from '../components/PhotoViewer';
import { photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import { findResidentReports, type ResidentReport } from '../lib/store';
import AddressInput from '../components/AddressInput';
import { ui, ACCENT } from '../lib/ui';

const STATUS_LABEL: Record<ResidentReport['status'], string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function fmt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ResidentLookup() {
  const [complaintNo, setComplaintNo] = useState('');
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [results, setResults] = useState<ResidentReport[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function onLookup() {
    if (!complaintNo.trim() || !address.trim()) {
      Alert.alert('Missing info', 'Enter your complaint number and building address.');
      return;
    }
    setSearching(true);
    try {
      const found = await findResidentReports(complaintNo.trim(), address.trim());
      setResults(found);
    } catch (e: any) {
      Alert.alert('Lookup failed', e?.message ?? 'Could not look up reports.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Check Report Status</Text>
      <Text style={ui.label}>Enter the complaint number you received and the same building address used on the complaint.</Text>

      <View>
        <Text style={ui.label}>Complaint number</Text>
        <TextInput
          style={ui.input}
          value={complaintNo}
          onChangeText={setComplaintNo}
          placeholder="e.g. RC-46789"
          autoCapitalize="characters"
        />
      </View>

      <View>
        <Text style={ui.label}>Building address</Text>
        <AddressInput value={address} onChangeText={setAddress} placeholder="e.g. 123 Main St" style={ui.input} />
      </View>

      <Pressable style={ui.btn} onPress={onLookup} disabled={searching}>
        <Text style={ui.btnText}>{searching ? 'Looking up…' : 'Look Up'}</Text>
      </Pressable>

      {results !== null && results.length === 0 && (
        <Text style={ui.empty}>No report matched that complaint number and address.</Text>
      )}

      {results !== null && results.map((r) => (
        <View key={r.id} style={[ui.card, { gap: 8 }]}>
          <View style={ui.line}>
            <Text style={ui.lineK}>Status</Text>
            <Text style={[ui.lineV, { color: ACCENT }]}>{STATUS_LABEL[r.status]}</Text>
          </View>
          {!!r.assignedTo && (
            <View style={ui.line}>
              <Text style={ui.lineK}>Assigned to</Text>
              <Text style={ui.lineV}>{r.assignedTo}</Text>
            </View>
          )}
          <View style={{ paddingVertical: 4 }}>
            <Text style={ui.label}>Issue</Text>
            <Text>{r.description}</Text>
          </View>

          {r.photos.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {r.photos.map((uri, i) => (
                <Pressable key={`${uri}-${i}`} onPress={() => setViewerUri(uri)}><RemotePhoto localUri={uri} style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#eee' }} /></Pressable>
              ))}
            </View>
          )}

          <Text style={[ui.label, { marginTop: 6 }]}>Updates</Text>
          {r.updates.length === 0 ? (
            <Text style={ui.lineK}>No updates yet.</Text>
          ) : (
            r.updates
              .slice()
              .reverse()
              .map((u, i) => (
                <View key={i} style={{ paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
                  <Text style={ui.lineV}>{STATUS_LABEL[u.status]}{u.note ? ` — ${u.note}` : ''}</Text>
                  <Text style={ui.listSub}>{fmt(u.at)}{u.by ? ` · ${u.by}` : ''}</Text>
                </View>
              ))
          )}
        </View>
      ))}
    <PhotoViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
