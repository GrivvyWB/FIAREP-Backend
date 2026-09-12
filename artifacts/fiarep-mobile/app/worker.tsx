import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import PhotoViewer from '../components/PhotoViewer';
import { useFocusEffect } from 'expo-router';
import {
  listResidentReports,
  assignmentUrgency,
  sortByUrgency,
  assignmentIdleDays,
  addResidentUpdate,
  listStaffAccounts,
  type ResidentReport,
  type StaffAccount,
} from '../lib/store';
import { takePhotoWithGeo, pickPhotoWithGeo, type PhotoEvidence } from '../lib/photos';
import { captureGeo } from '../lib/geo';
import RemotePhoto from '../components/RemotePhoto';
import { ui, ACCENT } from '../lib/ui';

const STATUS_LABEL: Record<ResidentReport['status'], string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function Worker() {
  const [name, setName] = useState('');
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [reports, setReports] = useState<ResidentReport[]>([]);
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [staged, setStaged] = useState<Record<string, PhotoEvidence[]>>({});

  const load = useCallback(() => {
    listResidentReports().then(setReports);
    listStaffAccounts('approved').then(setStaff).catch(() => {});
  }, []);
  useFocusEffect(load);

  const myName = name.trim();
  const suggestions = (() => {
    const q = myName.toLowerCase();
    if (!q) return [] as string[];
    const names = Array.from(
      new Set(
        staff.map((a) => (a.name || '').trim()).filter(Boolean)
      )
    );
    // Hide the list once the box exactly matches a name (already picked).
    if (names.some((n) => n.toLowerCase() === q)) return [] as string[];
    return names.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
  })();
  const jobs = myName
    ? sortByUrgency(
        reports.filter(
          (r) =>
            r.status !== 'resolved' &&
            (r.assignedTo || '').trim().toLowerCase() === myName.toLowerCase()
        )
      )
    : [];

  async function addPhoto(id: string, mode: 'take' | 'pick') {
    try {
      const photo = mode === 'take' ? await takePhotoWithGeo() : await pickPhotoWithGeo();
      if (photo) setStaged((m) => ({ ...m, [id]: [...(m[id] || []), photo] }));
    } catch (e: any) {
      Alert.alert('Photo error', e?.message ?? 'Could not add photo.');
    }
  }

  async function send(r: ResidentReport, status: ResidentReport['status'], note: string) {
    if (!myName) { Alert.alert('Name required', 'Enter your worker name first.'); return; }
    const photos = staged[r.id] || [];
    try {
      const geo = await captureGeo();
      await addResidentUpdate(r.id, status, note, myName, photos, geo);
      setStaged((m) => ({ ...m, [r.id]: [] }));
      load();
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? 'Could not send update.');
    }
  }

  function completeNotDone(r: ResidentReport) {
    Alert.prompt?.(
      'Not complete',
      'Reason (optional):',
      (reason?: string) => send(r, 'in_progress', 'Not complete' + (reason && reason.trim() ? ` — ${reason.trim()}` : '')),
      'plain-text'
    ) ?? send(r, 'in_progress', 'Not complete');
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>Staff Member Jobs</Text>
      <View>
        <Text style={ui.label}>Your name</Text>
        <TextInput
          style={ui.input}
          value={name}
          onChangeText={setName}
          placeholder="Enter your name to see assigned jobs"
          autoCapitalize="words"
        />
        {suggestions.length > 0 && (
          <View style={{ borderWidth: 1, borderColor: '#e2e2e2', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
            {suggestions.map((n) => (
              <Pressable
                key={n}
                onPress={() => setName(n)}
                style={{ paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}
              >
                <Text style={{ fontSize: 16, color: '#111' }}>{n}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {!myName && (
        <Text style={ui.empty}>Enter your name above to see your assigned jobs.</Text>
      )}
      {myName && jobs.length === 0 && (
        <Text style={ui.empty}>No open jobs assigned to {myName}.</Text>
      )}

      {jobs.map((r) => {
        const s = staged[r.id] || [];
        const started = r.status === 'in_progress';
        const urgency = assignmentUrgency(r);
        const idle = assignmentIdleDays(r);
        // Started work gets a square accent border. Unstarted work reddens as
        // it ages: 1 day pale, 2 days stronger, 3+ days full red.
        const edge =
          started
            ? { borderWidth: 2, borderRadius: 0, borderColor: ACCENT }
            : urgency === 'day3'
            ? { borderWidth: 2, borderColor: '#B23A2F', backgroundColor: '#FBEDEB' }
            : urgency === 'day2'
            ? { borderWidth: 2, borderColor: '#D08074', backgroundColor: '#FDF4F2' }
            : urgency === 'day1'
            ? { borderWidth: 1, borderColor: '#E3B3AA' }
            : null;
        return (
          <View key={r.id} style={[ui.card, { gap: 8 }, edge]}>
            <View style={ui.line}>
              <Text style={ui.lineK}>Unit</Text>
              <Text style={ui.lineV}>{r.unit}</Text>
            </View>
            <View style={ui.line}>
              <Text style={ui.lineK}>Address</Text>
              <Text style={ui.lineV}>{r.address}</Text>
            </View>
            <View style={ui.line}>
              <Text style={ui.lineK}>Status</Text>
              <Text style={[ui.lineV, { color: urgency === 'none' ? ACCENT : '#B23A2F' }]}>
                {STATUS_LABEL[r.status]}
                {started ? '  (started)' : ''}
                {!started && idle >= 1 ? `  ${idle}d not started` : ''}
              </Text>
            </View>
            <View style={{ paddingVertical: 4 }}>
              <Text style={ui.label}>Issue</Text>
              <Text>{r.description}</Text>
            </View>

            {r.photos.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {r.photos.map((uri, i) => (
                  <Pressable key={`${uri}-${i}`} onPress={() => setViewerUri(uri)}><RemotePhoto localUri={uri} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#eee' }} /></Pressable>
                ))}
              </View>
            )}

            <View style={ui.row}>
              {!started && (
                <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => send(r, 'in_progress', 'Started job')}>
                  <Text style={ui.btnText}>Start</Text>
                </Pressable>
              )}
              <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => send(r, 'in_progress', 'On my way')}>
                <Text style={ui.btnText}>On my way</Text>
              </Pressable>
            </View>

            <Text style={[ui.label, { marginTop: 4 }]}>Progress photos ({s.length})</Text>
            <View style={ui.row}>
              <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => addPhoto(r.id, 'take')}>
                <Text style={ui.btnOutlineText}>Take Photo</Text>
              </Pressable>
              <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => addPhoto(r.id, 'pick')}>
                <Text style={ui.btnOutlineText}>Choose Photo</Text>
              </Pressable>
            </View>
            {s.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {s.map((uri, i) => (
                  <Pressable key={`${uri.uri}-${i}`} onPress={() => setViewerUri(uri.uri)}><RemotePhoto localUri={uri.uri} style={{ width: 56, height: 56, borderRadius: 6, backgroundColor: '#eee' }} /></Pressable>
                ))}
              </View>
            )}

            <View style={[ui.row, { marginTop: 4 }]}>
              <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => send(r, 'resolved', 'Job complete')}>
                <Text style={ui.btnText}>Complete — Done</Text>
              </Pressable>
              <Pressable style={[ui.btn, ui.btnMuted, { flex: 1 }]} onPress={() => completeNotDone(r)}>
                <Text style={ui.btnText}>Not Done</Text>
              </Pressable>
            </View>

            {r.updates.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text style={ui.label}>History</Text>
                {r.updates.slice().reverse().map((u, i) => (
                  <View key={i} style={{ paddingVertical: 3 }}>
                    <Text style={ui.lineV}>{STATUS_LABEL[u.status]}{u.note ? ` — ${u.note}` : ''}</Text>
                    <Text style={ui.listSub}>{fmt(u.at)}{u.by ? ` · ${u.by}` : ''}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    <PhotoViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
