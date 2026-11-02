import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioModule, AudioQuality, IOSOutputFormat, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder, type AudioPlayer, type RecordingOptions } from 'expo-audio';
import { getSessionIdentity } from '../lib/store';
import { voicePitch } from '../lib/voice-pitch';
import { commandVoice, setCommandVoice, speakIn } from '../lib/my-voice';
import { ui, ACCENT } from '../lib/ui';

// Voice Recorder: record a voice; the phone measures how high or deep it is and talks back with its own
// speech engine tuned to sound close to it, higher or lower as you like. Everything stays on the phone.
type Voice = { id: string; name: string; gender: 'man' | 'woman'; hz: number | null; file: string; createdAt: string };
const PITCH = [{ label: 'Much lower', k: 0.8 }, { label: 'Lower', k: 0.9 }, { label: 'Normal', k: 1 }, { label: 'Higher', k: 1.1 }, { label: 'Much higher', k: 1.25 }];

// iPhone records WAV so the pitch can be measured on the phone.
const REC: RecordingOptions = Platform.OS === 'ios'
  ? { ...RecordingPresets.HIGH_QUALITY, extension: '.wav', sampleRate: 16000, numberOfChannels: 1, bitRate: 256000,
      ios: { outputFormat: IOSOutputFormat.LINEARPCM, audioQuality: AudioQuality.HIGH, sampleRate: 16000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false } }
  : RecordingPresets.HIGH_QUALITY;

export default function VoiceStudio() {
  const recorder = useAudioRecorder(REC);
  const player = useRef<AudioPlayer | null>(null);
  const [store, setStore] = useState('');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'man' | 'woman'>('man');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState('');
  const [text, setText] = useState<Record<string, string>>({});
  const [pitch, setPitch] = useState<Record<string, number>>({});
  const [ccId, setCcId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = (await getSessionIdentity().catch(() => null))?.staffId || 'me';
    const k = `voice-studio:${id}`; setStore(k);
    try { setVoices(JSON.parse((await AsyncStorage.getItem(k)) || '[]')); } catch { setVoices([]); }
    const cc = await commandVoice(); setCcId(cc?.voice.id ?? null); if (cc) setPitch((x) => ({ ...x, [cc.voice.id]: cc.k }));
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => () => { player.current?.remove(); void Speech.stop(); }, []);
  useEffect(() => {
    if (!recording) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  const keep = async (list: Voice[]) => { setVoices(list); await AsyncStorage.setItem(store, JSON.stringify(list)); };

  async function start() {
    if (!name.trim()) { Alert.alert('Whose voice is it?', 'Type the name first.'); return; }
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
    if (seconds < 10) { Alert.alert('A little longer', 'Record at least 10 seconds of talking.'); return; }
    setBusy('save');
    try {
      const id = `${Date.now()}`;
      const file = `${FileSystem.documentDirectory}voice-${id}${uri.endsWith('.wav') ? '.wav' : '.m4a'}`;
      await FileSystem.copyAsync({ from: uri, to: file });
      let hz: number | null = null;
      if (file.endsWith('.wav')) hz = voicePitch(await FileSystem.readAsStringAsync(file, { encoding: 'base64' as never }));
      await keep([...voices, { id, name: name.trim(), gender, hz, file, createdAt: new Date().toISOString() }]);
      setUri(''); setSeconds(0);
      Alert.alert('Saved', `${name.trim()}'s voice is saved under Voices.`);
    } catch (e: any) { Alert.alert('Not saved', String(e?.message || e)); }
    finally { setBusy(''); }
  }
  async function say(v: Voice) {
    const words = (text[v.id] || '').trim();
    if (!words) { Alert.alert('What should it say?'); return; }
    await Speech.stop();
    player.current?.remove();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    // Tuned toward this person's own pitch, then higher or lower as picked.
    await speakIn(v, words, pitch[v.id] ?? 1);
  }
  async function listen(v: Voice) {
    await Speech.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    player.current?.remove();
    const pl = createAudioPlayer({ uri: v.file }); player.current = pl;
    pl.shouldCorrectPitch = false; pl.setPlaybackRate(pitch[v.id] ?? 1); pl.play();
  }
  function remove(v: Voice) {
    Alert.alert(`Delete ${v.name}'s voice?`, undefined, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void (async () => { await FileSystem.deleteAsync(v.file, { idempotent: true }).catch(() => undefined); await keep(voices.filter((x) => x.id !== v.id)); })() },
    ]);
  }

  const chip = (on: boolean, label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: on ? ACCENT : '#ccc', backgroundColor: on ? ACCENT : '#fff' }}>
      <Text style={{ color: on ? '#fff' : '#333', fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 17, fontWeight: '800' }}>Record a voice</Text>
      <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="Name only (e.g. Tim)" editable={!recording} />
      <View style={{ flexDirection: 'row', gap: 6 }}>{chip(gender === 'man', 'Man', () => setGender('man'))}{chip(gender === 'woman', 'Woman', () => setGender('woman'))}</View>
      <Text style={ui.listSub}>Talk naturally for 10 seconds or more.</Text>
      {!recording ? (
        <Pressable style={[ui.btn, !!busy && ui.btnMuted]} disabled={!!busy} onPress={() => void start()}><Text style={ui.btnText}>{uri ? 'Record again' : 'Start recording'}</Text></Pressable>
      ) : (
        <Pressable style={[ui.btn, { backgroundColor: '#B91C1C' }]} onPress={() => void stop()}><Text style={ui.btnText}>Stop · {seconds}s</Text></Pressable>
      )}
      <Pressable style={[ui.btn, { backgroundColor: '#1a8f4c' }, (!uri || recording || !!busy) && ui.btnMuted]} disabled={!uri || recording || !!busy} onPress={() => void save()}>
        <Text style={ui.btnText}>{busy === 'save' ? 'Saving…' : uri && !recording ? `Save ${name.trim() || 'this'} voice (${seconds}s)` : 'Save voice'}</Text>
      </Pressable>

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
            {PITCH.map((p) => chip((pitch[v.id] ?? 1) === p.k, p.label, () => { setPitch((x) => ({ ...x, [v.id]: p.k })); if (ccId === v.id) void setCommandVoice(v.id, p.k); }))}
          </View>
          <Pressable style={ui.btn} onPress={() => void say(v)}><Text style={ui.btnText}>Say it</Text></Pressable>
          <Pressable style={[ccId === v.id ? ui.btn : ui.btnOutline, ccId === v.id && { backgroundColor: '#1a8f4c' }]} onPress={() => void (async () => {
            if (ccId === v.id) { await setCommandVoice(null); setCcId(null); Alert.alert('Command Center', 'Back to its own voice.'); }
            else { await setCommandVoice(v.id, pitch[v.id] ?? 1); setCcId(v.id); Alert.alert('Command Center', `The Command Center now talks in ${v.name}'s voice.`); }
          })()}>
            <Text style={ccId === v.id ? ui.btnText : ui.btnOutlineText}>{ccId === v.id ? 'Command Center voice ✓' : 'Use for the Command Center'}</Text>
          </Pressable>
          <Pressable style={{ paddingVertical: 6 }} onPress={() => void listen(v)}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Play the recording</Text></Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
