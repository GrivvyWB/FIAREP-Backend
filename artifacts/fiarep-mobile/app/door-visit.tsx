// Door Visit: pressed on the home screen in front of a resident's door (or a building).
// The moment it opens: where the phone is, the time and the direction it faces are saved.
// Then the floor and which door, up to a minute of video (what the resident says, access
// or no access), and Send — to the administrator and management, emailed if asked.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { customFetch } from '@workspace/api-client-react';
import { captureGeo } from '../lib/geo';
import { readHeading, facingLabel, gpsAddress } from '../lib/smartRepair';
import { recordDoorVideo, type DoorVideo } from '../components/ResidentSignOff';
import { ui, ACCENT } from '../lib/ui';

type Outcome = 'access' | 'no_access' | 'not_home';
const OUTCOMES: { key: Outcome; label: string; color: string }[] = [
  { key: 'access', label: 'Access given', color: '#1E7D4F' },
  { key: 'no_access', label: 'No access', color: '#C0392B' },
  { key: 'not_home', label: 'Nobody home', color: '#4A5560' },
];

export default function DoorVisit() {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [stamp, setStamp] = useState<{ at: string; address: string; facing: string; gps: string } | null>(null);
  const [starting, setStarting] = useState(true);
  const [floor, setFloor] = useState('');
  const [unit, setUnit] = useState('');
  const [door, setDoor] = useState('');
  const [record, setRecord] = useState('');
  const [video, setVideo] = useState<DoorVideo | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState('');
  const [email, setEmail] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // The moment the button is pressed: location, time and direction.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const [geo, heading, addr] = await Promise.all([captureGeo(), readHeading(), gpsAddress().catch(() => '')]);
        const facing = facingLabel(heading) || '';
        const r = await customFetch<{ id: string; at: string; address: string }>('/api/v1/door-visits', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, responseType: 'json',
          body: JSON.stringify({ latitude: geo.lat ?? null, longitude: geo.lng ?? null, accuracy: geo.accuracy ?? null, heading, facing, deviceAddress: addr }),
        } as never);
        setId(r.id);
        setStamp({ at: r.at, address: r.address, facing, gps: geo.lat != null && geo.lng != null ? `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}` : 'No GPS' });
      } catch (e: any) {
        Alert.alert('Door Visit', `Could not start: ${e?.data?.error || e?.message || e}`);
      } finally { setStarting(false); }
    })();
    customFetch<{ email: string }>('/api/v1/door-visits/email-on-file', { responseType: 'json' } as never).then((r) => setEmailTo(r.email || '')).catch(() => undefined);
  }, []);

  async function record_() {
    try { const v = await recordDoorVideo(); if (v) setVideo(v); }
    catch (e: any) { Alert.alert('Video', String(e?.message ?? e)); }
  }

  async function send() {
    if (!id) return;
    if (!outcome) { Alert.alert('Access?', 'Pick Access given, No access or Nobody home.'); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+/.test(emailTo.trim())) { Alert.alert('Email', 'Type the email address to send it to.'); return; }
    setBusy(true);
    try {
      if (video) {
        const info = await FileSystem.getInfoAsync(video.uri);
        const size = info.exists && 'size' in info ? info.size : 0;
        const up = await customFetch<{ uploadUrl: string }>(`/api/v1/door-visits/${encodeURIComponent(id)}/video-url`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, responseType: 'json',
          body: JSON.stringify({ size, contentType: video.contentType, seconds: video.seconds }),
        } as never);
        const put = await FileSystem.uploadAsync(up.uploadUrl, video.uri, { httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, mimeType: video.contentType });
        if (put.status < 200 || put.status >= 300) throw new Error(`Video upload failed (${put.status}). Check the connection and press Send again.`);
      }
      const r = await customFetch<{ emailed: boolean }>(`/api/v1/door-visits/${encodeURIComponent(id)}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, responseType: 'json',
        body: JSON.stringify({ outcome, note, floor, unit, door, record, ...(email ? { emailTo: emailTo.trim() } : {}) }),
      } as never);
      Alert.alert('Sent', `Sent to the administrator and management${email ? (r.emailed ? ' and emailed' : ' (the email did not go — the office still has it)') : ''}.`, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) {
      Alert.alert('Not sent', String(e?.data?.error || e?.message || e));
    } finally { setBusy(false); }
  }

  const when = stamp ? new Date(stamp.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={[ui.wrap, { gap: 10 }]} keyboardShouldPersistTaps="handled">
        <View style={[ui.card, { gap: 4 }]}>
          {starting ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Text>Saving where you are…</Text></View> : stamp ? (
            <>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>{stamp.address || 'Location saved'}</Text>
              <Text style={{ color: '#475569' }}>{when}{stamp.facing ? ` · Facing ${stamp.facing}` : ''}</Text>
              <Text style={{ color: '#94a3b8', fontSize: 12 }}>GPS {stamp.gps}</Text>
            </>
          ) : <Text style={{ color: '#C0392B' }}>Not started — go back and press Door Visit again.</Text>}
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={ui.label}>Floor</Text>
            <TextInput style={ui.input} value={floor} onChangeText={setFloor} placeholder="e.g. 16" keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ui.label}>Apartment</Text>
            <TextInput style={ui.input} value={unit} onChangeText={setUnit} placeholder="e.g. 16C" autoCapitalize="characters" />
          </View>
        </View>
        <Text style={ui.label}>Which door</Text>
        <TextInput style={ui.input} value={door} onChangeText={setDoor} placeholder="e.g. 3rd door from the left, east hall" />
        <Text style={ui.label}>Complaint / violation # (optional)</Text>
        <TextInput style={ui.input} value={record} onChangeText={setRecord} placeholder="e.g. RC-12345" autoCapitalize="characters" />

        <Pressable style={[ui.btn, { backgroundColor: video ? '#1E7D4F' : ACCENT }]} onPress={() => void record_()}>
          <Text style={ui.btnText}>{video ? `Video recorded (${Math.floor(video.seconds / 60)}:${String(video.seconds % 60).padStart(2, '0')}) — record again` : '● Record at the door (up to 1 min)'}</Text>
        </Pressable>

        <Text style={ui.label}>Did the resident give access?</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {OUTCOMES.map((o) => (
            <Pressable key={o.key} onPress={() => setOutcome(o.key)} style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: outcome === o.key ? o.color : '#f1f5f9' }}>
              <Text style={{ textAlign: 'center', fontWeight: '700', color: outcome === o.key ? '#fff' : '#334155' }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={ui.label}>Note (optional)</Text>
        <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} value={note} onChangeText={setNote} multiline placeholder="What the resident said" />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '600' }}>Also email it</Text>
          <Switch value={email} onValueChange={setEmail} />
        </View>
        {email && <TextInput style={ui.input} value={emailTo} onChangeText={setEmailTo} placeholder="email@company.com" keyboardType="email-address" autoCapitalize="none" />}

        <Pressable style={[ui.btn, (!id || busy) && { opacity: 0.6 }]} disabled={!id || busy} onPress={() => void send()}>
          <Text style={ui.btnText}>{busy ? 'Sending…' : 'Send to management'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
