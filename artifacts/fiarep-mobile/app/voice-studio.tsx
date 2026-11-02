import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder, type AudioPlayer } from 'expo-audio';
import { customFetch } from '@workspace/api-client-react';
import { ui, ACCENT } from '../lib/ui';

// Voice Recorder: record a voice (yours, or someone else's with their consent said at the start),
// then type anything and hear it said back in that voice, higher or lower.
type Voice = { id: string; name: string; speaker: string; createdAt: string };
const PITCH = [{ label: 'Much lower', rate: 0.82 }, { label: 'Lower', rate: 0.91 }, { label: 'Normal', rate: 1 }, { label: 'Higher', rate: 1.09 }, { label: 'Much higher', rate: 1.18 }];
const api = <T,>(url: string, init: Record<string, unknown> = {}) => customFetch<T>(url, { responseType: 'json', ...init } as never);
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function VoiceStudio() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useRef<AudioPlayer | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [speaker, setSpeaker] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState('');
  const [text, setText] = useState<Record<string, string>>({});
  const [pitch, setPitch] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try { const r = await api<{ ready: boolean; voices: Voice[] }>('/api/ai/voices'); setReady(r.ready); setVoices(r.voices); }
    catch { setReady(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => () => { player.current?.remove(); }, []);
  useEffect(() => {
    if (!recording) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  async function start() {
    if (!speaker.trim()) { Alert.alert('Whose voice is it?', 'Type the name of the person recording.'); return; }
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { Alert.alert('Microphone needed', 'Allow the microphone in Settings.'); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync(); recorder.record();
    setUri(''); setSeconds(0); setRecording(true);
  }
  async function stop() {
    try { await recorder.stop(); } catch { /* already stopped */ }
    setRecording(false);
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (recorder.uri) setUri(recorder.uri);
  }
  async function save() {
    if (!uri) return;
    if (seconds < 30) { Alert.alert('A little longer', 'Record at least 30 seconds so the copy sounds right.'); return; }
    setBusy('save');
    try {
      const audio = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as never });
      await api('/api/ai/voices', json('POST', { audio, mimeType: 'audio/mp4', speaker: speaker.trim(), name: speaker.trim() }));
      setUri(''); setSeconds(0); await load();
      Alert.alert('Voice saved', `Type something under ${speaker.trim()} and press Say it.`);
    } catch (e: any) { Alert.alert('Not saved', e?.data?.error || e?.message || 'Try again.'); }
    finally { setBusy(''); }
  }
  async function say(v: Voice) {
    const words = (text[v.id] || '').trim();
    if (!words) { Alert.alert('What should it say?'); return; }
    setBusy(v.id);
    try {
      const { audioBase64 } = await api<{ audioBase64: string }>(`/api/ai/voices/${encodeURIComponent(v.id)}/speak`, json('POST', { text: words }));
      const file = `${FileSystem.cacheDirectory}voice-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(file, audioBase64, { encoding: 'base64' as never });
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.current?.remove();
      const p = createAudioPlayer({ uri: file }); player.current = p;
      // Higher or lower: the pitch moves with the speed (no pitch correction).
      p.shouldCorrectPitch = false;
      p.setPlaybackRate(pitch[v.id] ?? 1);
      p.play();
    } catch (e: any) { Alert.alert('Not said', e?.data?.error || e?.message || 'Try again.'); }
    finally { setBusy(''); }
  }
  function remove(v: Voice) {
    Alert.alert(`Delete ${v.name}'s voice?`, 'The copy is removed and can’t be used again.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void api(`/api/ai/voices/${encodeURIComponent(v.id)}`, { method: 'DELETE' }).then(load).catch(() => Alert.alert('Not deleted', 'Try again.')) },
    ]);
  }

  if (ready === null) return <View style={[ui.wrap, { alignItems: 'center' }]}><ActivityIndicator /></View>;
  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      {!ready && <Text style={{ color: '#991b1b', fontWeight: '700' }}>Voice copying isn't switched on yet.</Text>}

      <Text style={{ fontSize: 17, fontWeight: '800' }}>Record a voice</Text>
      <TextInput style={ui.input} value={speaker} onChangeText={setSpeaker} placeholder="Whose voice (their name)" editable={!recording} />
      <View style={[ui.card, { gap: 4 }]}>
        <Text style={{ fontWeight: '700' }}>Start by saying:</Text>
        <Text style={{ fontSize: 16 }}>"I, {speaker.trim() || '(name)'}, agree to have my voice copied by FIAREP."</Text>
        <Text style={ui.listSub}>Then keep talking for 30 seconds or more, naturally.</Text>
      </View>
      {!recording ? (
        <Pressable style={[ui.btn, !ready && ui.btnMuted]} disabled={!ready || !!busy} onPress={() => void start()}><Text style={ui.btnText}>{uri ? 'Record again' : 'Start recording'}</Text></Pressable>
      ) : (
        <Pressable style={[ui.btn, { backgroundColor: '#B91C1C' }]} onPress={() => void stop()}><Text style={ui.btnText}>Stop · {seconds}s</Text></Pressable>
      )}
      {!!uri && !recording && (
        <Pressable style={[ui.btnOutline, busy === 'save' && { opacity: 0.5 }]} disabled={!!busy} onPress={() => void save()}>
          <Text style={ui.btnOutlineText}>{busy === 'save' ? 'Copying the voice…' : `Save ${speaker.trim() || 'this'} voice (${seconds}s)`}</Text>
        </Pressable>
      )}

      <Text style={{ fontSize: 17, fontWeight: '800', marginTop: 18 }}>Voices</Text>
      {voices.length === 0 && <Text style={ui.listSub}>No voices yet.</Text>}
      {voices.map((v) => (
        <View key={v.id} style={[ui.card, { gap: 8, marginTop: 8 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontWeight: '800', fontSize: 16 }}>{v.name}</Text>
            <Pressable onPress={() => remove(v)}><Text style={{ color: '#991b1b', fontWeight: '700' }}>Delete</Text></Pressable>
          </View>
          <TextInput style={[ui.input, { minHeight: 70 }]} multiline value={text[v.id] || ''} onChangeText={(t) => setText((x) => ({ ...x, [v.id]: t }))} placeholder="Type what it should say" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {PITCH.map((p) => {
              const on = (pitch[v.id] ?? 1) === p.rate;
              return (
                <Pressable key={p.label} onPress={() => setPitch((x) => ({ ...x, [v.id]: p.rate }))} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: on ? ACCENT : '#ccc', backgroundColor: on ? ACCENT : '#fff' }}>
                  <Text style={{ color: on ? '#fff' : '#333', fontWeight: '600', fontSize: 13 }}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={[ui.btn, !!busy && ui.btnMuted]} disabled={!!busy} onPress={() => void say(v)}><Text style={ui.btnText}>{busy === v.id ? 'Getting it…' : 'Say it'}</Text></Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
