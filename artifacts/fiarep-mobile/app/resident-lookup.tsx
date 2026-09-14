import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import PhotoViewer from '../components/PhotoViewer';
import { photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import { findResidentReports, listSavedResidentReports, type ResidentReport, type SavedResidentReport } from '../lib/store';
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
  const [results, setResults] = useState<ResidentReport[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<SavedResidentReport[]>([]);
  useEffect(() => { listSavedResidentReports().then(setSaved).catch(() => undefined); }, []);

  async function onLookup() {
    if (!complaintNo.trim()) {
      Alert.alert('Missing info', 'Enter your complaint number.');
      return;
    }
    const savedReport = saved.find(
      (item) => item.complaintNo.trim().toUpperCase() === complaintNo.trim().toUpperCase(),
    );
    setSearching(true);
    try {
      const found = await findResidentReports(complaintNo.trim(), savedReport?.statusToken || '');
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
      {saved.length > 0 && (
        <View style={{ gap: 8, marginBottom: 8 }}>
          <Text style={ui.label}>Saved reports</Text>
          {saved.map((item) => (
            <Pressable key={item.complaintNo} style={ui.btnOutline} onPress={() => {
               setComplaintNo(item.complaintNo);
            }}>
              <Text style={ui.btnOutlineText}>{item.complaintNo}</Text>
            </Pressable>
          ))}
        </View>
      )}

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

      <Pressable style={ui.btn} onPress={onLookup} disabled={searching}>
        <Text style={ui.btnText}>{searching ? 'Looking up…' : 'Look Up'}</Text>
      </Pressable>

      {results !== null && results.length === 0 && (
        <Text style={ui.empty}>No report matched that complaint number.</Text>
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
