import { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, Modal, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import PhotoViewer from '../components/PhotoViewer';
import { photoUri } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import { findResidentReports, type ResidentReport, listDevelopmentNames } from '../lib/store';
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
  const [unit, setUnit] = useState('');
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [development, setDevelopment] = useState('');
  const [devPickerOpen, setDevPickerOpen] = useState(false);
  const [devQuery, setDevQuery] = useState('');
  const devNames = useMemo(() => listDevelopmentNames(), []);
  const devFiltered = useMemo(() => {
    const q = devQuery.trim().toLowerCase();
    return q ? devNames.filter((n) => n.toLowerCase().includes(q)) : devNames;
  }, [devQuery, devNames]);
  const [results, setResults] = useState<ResidentReport[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function onLookup() {
    if (!unit.trim() && !development.trim()) {
      Alert.alert('Missing info', 'Enter your unit and/or development to find your report.');
      return;
    }
    setSearching(true);
    try {
      const found = await findResidentReports(unit.trim(), development.trim());
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
      <Text style={ui.label}>Enter your unit and/or development. Address is not required.</Text>

      <View>
        <Text style={ui.label}>Unit / Apartment</Text>
        <TextInput
          style={ui.input}
          value={unit}
          onChangeText={setUnit}
          placeholder="e.g. 4B"
          autoCapitalize="characters"
        />
      </View>

      <View>
        <Text style={ui.label}>Development</Text>
        <Pressable style={ui.input} onPress={() => { setDevQuery(''); setDevPickerOpen(true); }}>
          <Text style={{ color: development ? '#000' : '#999' }}>{development || 'Select development'}</Text>
        </Pressable>
      </View>

      <Pressable style={ui.btn} onPress={onLookup} disabled={searching}>
        <Text style={ui.btnText}>{searching ? 'Looking up…' : 'Look Up'}</Text>
      </Pressable>

      {results !== null && results.length === 0 && (
        <Text style={ui.empty}>No reports found for that unit / development.</Text>
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
          <Modal visible={devPickerOpen} animationType="slide" onRequestClose={() => setDevPickerOpen(false)}>
        <View style={{ flex: 1, padding: 16, paddingTop: 60, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={ui.h}>Select development</Text>
            <Pressable onPress={() => setDevPickerOpen(false)}><Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>Close</Text></Pressable>
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
