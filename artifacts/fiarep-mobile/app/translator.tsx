import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Switch, ActivityIndicator } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder, type AudioPlayer,
} from 'expo-audio';
import { customFetch } from '@workspace/api-client-react';
import { ui } from '../lib/ui';
import { LANGUAGES, STAFF_LANGUAGE } from '../lib/languages';
import { Chips } from '../lib/community-ui';

const ACCENT = '#F2C14E';
type Turn = { who: 'resident' | 'me'; heard: string; said: string; from: string; to: string; audioUri?: string };

async function post<T>(path: string, body: unknown): Promise<T> {
  return customFetch<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), responseType: 'json' } as never);
}

/** Voice-to-voice interpreter through the phone: the resident talks into the
 * phone, you read / hear it in English; you answer, the phone says it back in
 * their language through the speaker. Nothing is saved. */
export default function Translator() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [residentLang, setResidentLang] = useState(LANGUAGES[0]!.name);
  const [customLang, setCustomLang] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [recording, setRecording] = useState<'resident' | 'me' | null>(null);
  const [busy, setBusy] = useState('');
  const [typed, setTyped] = useState('');
  const [autoSpeak, setAutoSpeak] = useState(true);
  const playerRef = useRef<AudioPlayer | null>(null);
  const countRef = useRef(0);
  const language = customLang.trim() || residentLang;
  const langCode = LANGUAGES.find((l) => l.name === residentLang)?.code || '';

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) Alert.alert('Microphone needed', 'Allow the microphone in Settings to use the translator.');
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    })();
    return () => { playerRef.current?.remove(); };
  }, []);

  async function start(who: 'resident' | 'me') {
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(who);
    } catch (e: any) {
      Alert.alert('Could not start recording', e?.message || 'Try again.');
    }
  }

  async function stop() {
    const who = recording; if (!who) return;
    setRecording(null);
    setBusy('Listening…');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording');
      const audio = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as never });
      const { text } = await post<{ text: string }>('/api/ai/transcribe', { audio, mimeType: 'audio/mp4', language: who === 'resident' ? (customLang ? '' : langCode) : 'en' });
      if (!text) { Alert.alert('Nothing heard', 'Hold the phone closer and try again.'); return; }
      await handleText(who, text);
    } catch (e: any) {
      Alert.alert('Could not translate', e?.message || 'Check your connection and try again.');
    } finally { setBusy(''); }
  }

  async function handleText(who: 'resident' | 'me', text: string) {
    setBusy('Translating…');
    const from = who === 'resident' ? (customLang ? 'auto' : language) : STAFF_LANGUAGE.name;
    const to = who === 'resident' ? STAFF_LANGUAGE.name : language;
    const result = await post<{ translation: string; detectedLanguage: string }>('/api/ai/translate', { text, to, from });
    const turn: Turn = { who, heard: text, said: result.translation, from: who === 'resident' ? (result.detectedLanguage || language) : 'English', to };
    const idx = countRef.current++;
    setTurns((t) => [...t, turn]);
    if (autoSpeak) await speak(result.translation, idx);
  }

  async function speak(text: string, index: number, existingUri?: string) {
    setBusy('Speaking…');
    try {
      let uri = existingUri;
      if (!uri) {
        const { audioBase64 } = await post<{ audioBase64: string; mimeType: string }>('/api/ai/speak', { text });
        uri = `${FileSystem.cacheDirectory}say-${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(uri, audioBase64, { encoding: 'base64' as never });
        setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, audioUri: uri } : turn)));
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      playerRef.current?.remove();
      const player = createAudioPlayer({ uri });
      playerRef.current = player;
      player.volume = 1;
      player.play();
    } catch (e: any) {
      Alert.alert('Translated', 'Could not play the audio: ' + (e?.message || 'try again'));
    } finally { setBusy(''); }
  }

  async function sendTyped() {
    const text = typed.trim(); if (!text) return;
    setTyped('');
    try { await handleText('me', text); } catch (e: any) { Alert.alert('Could not translate', e?.message || 'Try again.'); } finally { setBusy(''); }
  }

  const big = (who: 'resident' | 'me', label: string, sub: string) => {
    const active = recording === who;
    const disabled = !!busy || (recording !== null && !active);
    return (
      <Pressable
        disabled={disabled}
        onPress={() => (active ? void stop() : void start(who))}
        style={{ flex: 1, minHeight: 120, borderRadius: 18, borderWidth: 2, borderColor: active ? '#dc2626' : '#111', backgroundColor: active ? '#fee2e2' : '#fff', alignItems: 'center', justifyContent: 'center', padding: 12, opacity: disabled ? 0.5 : 1 }}
      >
        <Text style={{ fontSize: 34 }}>{active ? '⏹' : '🎙'}</Text>
        <Text style={{ fontWeight: '700', fontSize: 16, textAlign: 'center' }}>{active ? 'Tap to stop' : label}</Text>
        <Text style={{ fontSize: 11, color: '#666', textAlign: 'center', marginTop: 2 }}>{sub}</Text>
      </Pressable>
    );
  };

  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.label}>The resident talks into the phone — you see it in English. You answer — the phone says it in their language through the speaker.</Text>
      <Text style={ui.label}>Resident speaks</Text>
      <Chips options={LANGUAGES.map((l) => l.name)} value={customLang ? '' : residentLang} onChange={(v) => { setResidentLang(v); setCustomLang(''); }} wrap />
      <TextInput style={ui.input} value={customLang} onChangeText={setCustomLang} placeholder="Other language — type it (e.g. Uzbek)" />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text>Say translations out loud</Text>
        <Switch value={autoSpeak} onValueChange={setAutoSpeak} />
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {big('resident', `Resident (${language})`, 'Tap, let them talk, tap to stop')}
        {big('me', 'Me (English)', `Said back in ${language}`)}
      </View>
      {!!busy && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator /><Text style={ui.label}>{busy}</Text></View>}

      <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline value={typed} onChangeText={setTyped} placeholder={`Or type in English — said in ${language}`} />
      <Pressable style={[ui.btn, (!!busy || !typed.trim()) && ui.btnMuted]} disabled={!!busy || !typed.trim()} onPress={() => void sendTyped()}>
        <Text style={ui.btnText}>Translate & say</Text>
      </Pressable>

      {turns.length === 0 && <Text style={ui.empty}>Nothing yet. Tap a button and talk.</Text>}
      {turns.map((t, i) => (
        <View key={i} style={[ui.card, t.who === 'resident' ? { backgroundColor: '#fffbeb', borderColor: ACCENT } : null]}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#666', textTransform: 'uppercase' }}>{t.who === 'resident' ? `Resident · ${t.from}` : 'You · English'}</Text>
          <Text style={{ color: '#666', marginTop: 4 }}>{t.heard}</Text>
          <Text style={{ fontSize: 18, fontWeight: '600', marginTop: 4 }}>{t.said}</Text>
          <Pressable onPress={() => void speak(t.said, i, t.audioUri)} style={{ marginTop: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#eee' }}>
            <Text style={{ fontWeight: '600' }}>🔊 Play</Text>
          </Pressable>
        </View>
      ))}
      {turns.length > 0 && (
        <Pressable style={ui.btnOutline} onPress={() => { setTurns([]); countRef.current = 0; }}><Text style={ui.btnOutlineText}>Clear conversation</Text></Pressable>
      )}
      <Text style={ui.label}>Nothing here is saved. Copy anything important into the resident's notes.</Text>
    </ScrollView>
  );
}
