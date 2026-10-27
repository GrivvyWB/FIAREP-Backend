import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Switch, ActivityIndicator, Share, Linking, AppState, Modal, Animated } from 'react-native';
import VoiceOrb from '../components/VoiceOrb';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, Stack } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder, type AudioPlayer } from 'expo-audio';
import { customFetch } from '@workspace/api-client-react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ui, ACCENT } from '../lib/ui';
import { getCurrentActor } from '../lib/store';
import {
  approveAction, commandFetch, commandSupport, confirmPublicKey, deviceStatus, enrollDevice, forgetDevice,
  relayApprove, relayDeny, relayRegisterPush, relaySetAutoFix, relayState, relayUrl,
  type CommandAction, type CommandRun, type DeviceState, type RelayIncident, type RelayState,
} from '../lib/command';

const STATUS_COLOR: Record<string, string> = { done: '#1F5C45', failed: '#C0392B', proposed: '#B4741A', queued: '#185FA5', running: '#185FA5', denied: '#666', expired: '#666', approved: '#185FA5' };
const newThread = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function post<T>(path: string, body: unknown): Promise<T> {
  return customFetch<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), responseType: 'json' } as never);
}
const errText = (e: any) => e?.data?.error || e?.message || 'Try again.';

// ── Hands-free ──
// The phone listens; when you start talking it records, and when you stop (a short pause) it
// sends what you said, says the answer, then listens again. No button.
// Wake words: with "Hey FIAREP" on, it only acts on what starts with "Hey FIAREP"; after it
// answers, follow-ups for the next 20 seconds don't need the wake words.
const WAKE = /^\s*(?:hey|hi|ok(?:ay)?|a)[\s,.!-]+(?:fiarep|fia[\s-]?rep|fi[\s-]?a[\s-]?rep|fire[\s-]?rep|fear[\s-]?rep|via[\s-]?rep|fiery[\s-]?p|ferrep|fi[\s-]?rep|fia[\s-]?r[\s-]?e[\s-]?p)\b[\s,.!?:-]*/i;
const NOISE = /^\s*(?:thank you\.?|thanks for watching.*|you\.?|bye\.?|\.+|uh+\.?|um+\.?|hmm+\.?)\s*$/i;
const FOLLOW_UP_MS = 20_000;
/** Lower case, letters and numbers only: how heard words are compared with the ones taught. */
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
/** The wake words at the start of what was heard: the built-in "Hey FIAREP" spellings, or one taught on this phone. Returns what was said after them, or null. */
function afterWake(heard: string, taught: string[]): string | null {
  const m = heard.match(WAKE);
  if (m) return heard.slice(m[0].length).trim();
  const h = norm(heard);
  for (const w of [...taught].sort((a, b) => b.length - a.length)) if (w && (h === w || h.startsWith(`${w} `))) return h.slice(w.length).trim();
  return null;
}
/** The name said the way you set it (Voice settings → How FIAREP is said). */
const sayName = (text: string, sayAs: string) => (sayAs.trim() ? text.replace(/\bFIAREP\b/gi, sayAs.trim()) : text);
const SILENCE_MS = 900;      // this long quiet after talking = done talking
const MAX_TALK_MS = 30_000;  // one thing said is at most this long
const IDLE_RESTART_MS = 25_000; // nothing said: start a fresh recording (keeps it small)
const POLL_MS = 120;
// Only the name: a longer word list gets written back as if it were said when the room is quiet.
const PROMPT = 'FIAREP';
/** Heard only the name (or the old word list) with nothing asked: ignored. */
const ONLY_NAME = (t: string) => /^(hey |hi |ok |okay )?(fiarep|fia rep|fire rep)?( hpd| dob| nycha| oath| violation| complaint| work order| command center)*$/.test(norm(t));
/** Keep the screen on while hands-free (the phone stops listening when it locks). */
function keepAwake(on: boolean) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const k = require('expo-keep-awake');
    if (on) void k.activateKeepAwakeAsync?.('fiarep-hands-free'); else void k.deactivateKeepAwake?.('fiarep-hands-free');
  } catch { /* not in this build: the screen may lock on its own */ }
}
/** Split a reply into pieces of a sentence or two, so the first one is spoken while the rest are made. */
function speechChunks(text: string): string[] {
  const parts = (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text]).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) return parts;
  // The first sentence alone (it starts playing soonest), the rest in pieces of up to ~220 characters.
  const out = [parts[0]!];
  let cur = '';
  for (const p of parts.slice(1)) { if (cur && cur.length + p.length > 220) { out.push(cur); cur = p; } else cur = cur ? `${cur} ${p}` : p; }
  if (cur) out.push(cur);
  return out.slice(0, 12);
}

/** FIAREP Command Center: talk or type to FIAREP; reads answer right away,
 *  anything that changes something waits for your Face ID here. */
export default function CommandCenter() {
  const support = commandSupport();
  const [device, setDevice] = useState<DeviceState | undefined>(undefined);
  const [runs, setRuns] = useState<CommandRun[]>([]);
  const [pending, setPending] = useState<CommandAction[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [speakReplies, setSpeakReplies] = useState(true);
  // Voice settings, kept on this phone: wake words taught in your own voice, and how the name is said.
  const [taught, setTaught] = useState<string[]>([]);
  const taughtRef = useRef<string[]>([]); taughtRef.current = taught;
  const [sayAs, setSayAs] = useState('');
  const [sayAsDraft, setSayAsDraft] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  // Hands-free keeps the screen blank (only what needs you — an approval, a site down — shows). This turns the conversation back on.
  const [showConvo, setShowConvo] = useState(false);
  useEffect(() => { void AsyncStorage.getItem('cc.showConvo').then((v) => setShowConvo(v === '1')).catch(() => undefined); }, []);
  const insets = useSafeAreaInsets();
  const [teach, setTeach] = useState<{ n: number; heard: string[] } | null>(null);
  useEffect(() => { void AsyncStorage.multiGet(['cc.wakeWords', 'cc.sayAs']).then((kv) => { const m = Object.fromEntries(kv); try { const w = JSON.parse(m['cc.wakeWords'] || '[]'); if (Array.isArray(w)) setTaught(w.filter((x) => typeof x === 'string')); } catch { /* none yet */ } setSayAs(m['cc.sayAs'] || ''); setSayAsDraft(m['cc.sayAs'] || ''); }).catch(() => undefined); }, []);
  const [recording, setRecording] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [threadId, setThreadId] = useState(newThread);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const playerRef = useRef<AudioPlayer | null>(null);
  // Backup relay: outage alerts and republish approvals that work when fiarep.com is down.
  const [relayBase, setRelayBase] = useState<string | null>(null);
  const [relay, setRelay] = useState<RelayState | null>(null);
  const pushRegistered = useRef(false);

  const loadDevice = useCallback(async () => {
    try { setDevice(await deviceStatus()); } catch (e) { setDevice(null); Alert.alert('Command Center', errText(e)); }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        commandFetch<CommandRun[]>('GET', '/v1/command/runs?limit=15'),
        commandFetch<CommandAction[]>('GET', '/v1/command/actions/pending'),
      ]);
      setRuns(r); setPending(p);
    } catch (e: any) {
      if (e?.data?.code?.startsWith?.('device_')) await loadDevice();
    }
  }, [loadDevice]);

  const loadRelay = useCallback(async () => {
    try {
      const base = relayBase ?? (await relayUrl());
      setRelayBase(base);
      if (!base) return;
      setRelay(await relayState(base));
      if (!pushRegistered.current) { pushRegistered.current = true; await relayRegisterPush(base).catch(() => undefined); }
    } catch { /* shown as "relay unreachable" */ setRelay(null); }
  }, [relayBase]);

  useEffect(() => { if (support.ok) void loadDevice(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => {
    if (device?.status !== 'active') return undefined;
    void loadRelay();
    const t = setInterval(() => void loadRelay(), 15000);
    return () => clearInterval(t);
  }, [device?.status, loadRelay]));
  useFocusEffect(useCallback(() => {
    if (device?.status !== 'active') return undefined;
    void refresh();
    const t = setInterval(() => void refresh(), 5000); // agent results arrive in the background
    return () => clearInterval(t);
  }, [device?.status, refresh]));
  useEffect(() => () => { playerRef.current?.remove(); }, []);
  // Each time the Command Center opens it greets the person by name, out loud, at once: the greeting
  // and its recording are kept on the phone, so nothing waits for fiarep.com. A new greeting (another
  // name or language) is recorded once when fiarep.com sends it, and played then if it hasn't been yet.
  const GREET_TEXT = 'cmd.greeting.text';
  const greetFile = `${FileSystem.documentDirectory}cmd-greeting.mp3`;
  const greeted = useRef(false);
  const [savedGreeting, setSavedGreeting] = useState('');
  async function playGreetingFile() {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    playerRef.current?.remove();
    const player = createAudioPlayer({ uri: greetFile }); playerRef.current = player; player.play();
  }
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const text = (await AsyncStorage.getItem(GREET_TEXT)) || '';
        setSavedGreeting(text);
        if (!text || greeted.current || !speakReplies) return;
        if ((await FileSystem.getInfoAsync(greetFile)).exists) { greeted.current = true; await playGreetingFile(); }
      } catch { /* the greeting is on screen either way */ }
    })();
    return () => { greeted.current = false; };
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const text = device?.status === 'active' ? device.greeting : '';
    if (!text) return;
    (async () => {
      try {
        const stored = (await AsyncStorage.getItem(GREET_TEXT)) || '';
        const haveFile = (await FileSystem.getInfoAsync(greetFile)).exists;
        const said = (await AsyncStorage.getItem('cc.greeting.sayAs')) || '';
        if (stored === text && haveFile && said === sayAs) return;
        const { audioBase64 } = await post<{ audioBase64: string }>('/api/ai/speak', { text: sayName(text, sayAs).slice(0, 600) });
        await FileSystem.writeAsStringAsync(greetFile, audioBase64, { encoding: 'base64' as never });
        await AsyncStorage.setItem(GREET_TEXT, text); await AsyncStorage.setItem('cc.greeting.sayAs', sayAs); setSavedGreeting(text);
        if (!greeted.current && speakReplies) { greeted.current = true; await playGreetingFile(); }
      } catch { /* try again next time it opens */ }
    })();
  }, [device?.status, device?.greeting, sayAs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setUp() {
    setBusy('Setting up this phone…');
    try {
      const actor = await getCurrentActor();
      if (!actor.id) throw new Error('Sign in first.');
      await enrollDevice(actor.id, `${actor.name || 'Phone'}'s phone`);
      await loadDevice();
    } catch (e) { Alert.alert('Could not set up', errText(e)); }
    finally { setBusy(''); }
  }

  /** Says the reply; resolves when it has finished playing. The first sentence starts while the rest are still being made. */
  async function speak(line: string): Promise<void> {
    if (!speakReplies || !line) return;
    try {
      const pieces = speechChunks(sayName(line, sayAs).slice(0, 2000));
      const audio = pieces.map((t) => post<{ audioBase64: string }>('/api/ai/speak', { text: t }).catch(() => null));
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      stopSpeaking.current = false;
      for (let i = 0; i < audio.length; i += 1) {
        const got = await audio[i];
        if (!got?.audioBase64) continue;
        const uri = `${FileSystem.cacheDirectory}cmd-${Date.now()}-${i}.mp3`;
        await FileSystem.writeAsStringAsync(uri, got.audioBase64, { encoding: 'base64' as never });
        playerRef.current?.remove();
        const player = createAudioPlayer({ uri }); playerRef.current = player;
        if (stopSpeaking.current) break;
        await new Promise<void>((resolve) => {
          const finish = () => { clearTimeout(done); sub.remove(); cancelPlay.current = null; resolve(); };
          const done = setTimeout(finish, 60_000);
          const sub = player.addListener('playbackStatusUpdate', (st) => { if (st.didJustFinish) finish(); });
          cancelPlay.current = finish;
          player.play();
        });
        if (stopSpeaking.current) break;
      }
    } catch { /* the reply is on screen either way */ }
  }

  async function send(command: string, spoken = false) {
    const t = command.trim(); if (!t) return;
    setText(''); setBusy('Working…');
    let say = '';
    try {
      const run = await commandFetch<CommandRun>('POST', '/v1/command/runs', { text: t, threadId, spoken });
      setRuns((rs) => [run, ...rs.filter((r) => r.id !== run.id)]);
      setPending((p) => [...p, ...run.actions.filter((a) => a.status === 'proposed' && !p.some((x) => x.id === a.id))]);
      say = run.reply || '';
      // A new language: listen for it and greet in it from now on.
      if (run.actions.some((a) => a.action === 'set_language' && a.status === 'done')) void loadDevice();
    } catch (e) { say = `I couldn't get that. ${errText(e)}`; if (!spoken) Alert.alert('Command failed', errText(e)); }
    finally { setBusy(''); }
    if (spoken) { setPhase('speaking'); await speak(say); } else void speak(say);
  }

  // ── Hands-free / one-press listening ──
  // The Command Center screen is for talking to it: it listens as soon as it opens, no button and no wake words.
  // Both can be changed in ⚙️ settings.
  const [handsFree, setHandsFree] = useState(true);
  const [wakeOn, setWakeOn] = useState(false);
  const [phase, setPhase] = useState<'off' | 'waiting' | 'hearing' | 'thinking' | 'speaking'>('off');
  const loopGen = useRef(0);          // bumps to stop the current listening loop
  const awakeUntil = useRef(0);
  const stopSpeaking = useRef(false);
  const finishNow = useRef(false);
  const levelAnim = useRef(new Animated.Value(0)).current; // how loud you are, for the orb
  const cancelPlay = useRef<null | (() => void)>(null);
  /** Stop the answer being said. */
  function hush() { stopSpeaking.current = true; playerRef.current?.pause(); cancelPlay.current?.(); }
  const wakeRef = useRef(false); wakeRef.current = wakeOn && device?.platform !== false;
  // A client's Command Center is always: talk (no button, no wake words), answers said out loud.
  useEffect(() => { if (device?.platform === false) { setHandsFree(true); setWakeOn(false); setSpeakReplies(true); } }, [device?.platform]);
  useEffect(() => { void AsyncStorage.multiGet(['cc.handsFree2', 'cc.wake2']).then((kv) => { const m = Object.fromEntries(kv); if (m['cc.wake2'] === '1') setWakeOn(true); if (m['cc.handsFree2'] === '0') setHandsFree(false); }).catch(() => undefined); }, []);

  /** Records one thing said: starts when you talk, ends after a short pause. Returns the file, or null if stopped / nothing said. */
  async function hearOnce(gen: number): Promise<string | null> {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { Alert.alert('Microphone needed', 'Allow the microphone in Settings.'); return null; }
    for (;;) {
      if (gen !== loopGen.current) return null;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(); recorder.record();
      setRecording(true); setPhase('waiting');
      const started = Date.now();
      let floor: number | null = null; let loud = 0; let talkAt = 0; let quietSince = 0;
      let outcome: 'said' | 'idle' | 'stopped' = 'idle';
      finishNow.current = false;
      while (gen === loopGen.current) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (finishNow.current) { finishNow.current = false; outcome = 'said'; break; }
        const st = recorder.getStatus();
        const level = typeof st.metering === 'number' ? st.metering : -160;
        levelAnim.setValue(Math.max(0, Math.min(1, (level - (floor ?? level) - 4) / 28)));
        if (floor === null) floor = level;
        const threshold = Math.max(floor + 15, -42);
        if (!talkAt) {
          if (level > threshold) { loud += 1; if (loud >= 3) { talkAt = Date.now() - 2 * POLL_MS; setPhase('hearing'); } }
          else { loud = 0; floor = floor * 0.9 + level * 0.1; }
          if (Date.now() - started > IDLE_RESTART_MS) { outcome = 'idle'; break; }
        } else {
          if (level < threshold - 3) {
            if (!quietSince) quietSince = Date.now();
            if (Date.now() - quietSince >= SILENCE_MS) {
              // A bump or a cough (under 0.6 s of sound) is not talking: keep waiting.
              if (quietSince - talkAt < 600) { talkAt = 0; quietSince = 0; loud = 0; setPhase('waiting'); continue; }
              outcome = 'said'; break;
            }
          }
          else quietSince = 0;
          if (Date.now() - talkAt > MAX_TALK_MS) { outcome = 'said'; break; }
        }
      }
      if (gen !== loopGen.current) outcome = outcome === 'said' ? 'said' : 'stopped';
      try { await recorder.stop(); } catch { /* already stopped */ }
      levelAnim.setValue(0);
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (outcome === 'said' && recorder.uri) return recorder.uri;
      if (outcome === 'stopped') return null;
      // idle: nothing said in a while — start a fresh recording and keep waiting
    }
  }

  async function transcribe(uri: string): Promise<string> {
    const audio = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as never });
    const { text: heard } = await post<{ text: string }>('/api/ai/transcribe', { audio, mimeType: 'audio/mp4', language: device?.languageCode ?? 'en', prompt: PROMPT });
    return (heard || '').trim();
  }

  /** What was heard: with wake words on, only acts on "Hey FIAREP …" (or a follow-up within 20 seconds). */
  async function handleHeard(heard: string): Promise<void> {
    if (!heard || NOISE.test(heard)) return;
    if (!wakeRef.current && ONLY_NAME(heard)) return;
    let said = heard;
    if (wakeRef.current && Date.now() > awakeUntil.current) {
      const rest = afterWake(heard, taughtRef.current);
      if (rest === null) return; // not for FIAREP
      said = rest;
      if (!said) { awakeUntil.current = Date.now() + FOLLOW_UP_MS; setPhase('speaking'); await speak('Yes?'); awakeUntil.current = Date.now() + FOLLOW_UP_MS; return; }
    }
    setPhase('thinking');
    await send(said, true);
    awakeUntil.current = Date.now() + FOLLOW_UP_MS;
  }

  async function handsFreeLoop(gen: number) {
    keepAwake(true);
    // Let the greeting finish before listening (it would hear itself).
    for (let i = 0; i < 40 && playerRef.current?.playing && gen === loopGen.current; i += 1) await new Promise((r) => setTimeout(r, 200));
    try {
      while (gen === loopGen.current) {
        const uri = await hearOnce(gen);
        if (!uri || gen !== loopGen.current) break;
        setPhase('thinking');
        let heard = '';
        try { heard = await transcribe(uri); } catch { continue; }
        if (gen !== loopGen.current) break;
        await handleHeard(heard);
      }
    } finally { if (gen === loopGen.current) setPhase('off'); keepAwake(false); }
  }

  function stopListening() { loopGen.current += 1; hush(); setPhase('off'); setRecording(false); keepAwake(false); }
  function startHandsFree() { loopGen.current += 1; setRecording(false); const gen = loopGen.current; void handsFreeLoop(gen); }

  /** Teach my wake words: say "Hey FIAREP" 5 times; whatever the phone writes down for your voice wakes it from now on. */
  async function teachWakeWords() {
    stopListening();
    const gen = loopGen.current;
    const got: string[] = [];
    try {
      for (let n = 1; n <= 5 && gen === loopGen.current; n += 1) {
        setTeach({ n, heard: [...got] });
        const uri = await hearOnce(gen);
        if (!uri) break;
        setPhase('thinking');
        const heard = norm(await transcribe(uri).catch(() => ''));
        const words = heard.split(' ').slice(0, 4).join(' ');
        if (words && !NOISE.test(words)) got.push(words);
      }
    } finally { setPhase('off'); setTeach(null); }
    if (got.length) {
      const next = [...new Set([...taughtRef.current, ...got])].slice(0, 30);
      setTaught(next); await AsyncStorage.setItem('cc.wakeWords', JSON.stringify(next));
      Alert.alert('Wake words saved', `Any of these now wakes it:\n\n${[...new Set(got)].map((w) => `“${w}”`).join('\n')}`);
    }
    if (handsFree) startHandsFree();
  }
  async function removeTaught(w: string) {
    const next = taughtRef.current.filter((x) => x !== w);
    setTaught(next); await AsyncStorage.setItem('cc.wakeWords', JSON.stringify(next));
  }
  async function saveSayAs(v: string) {
    setSayAs(v.trim()); await AsyncStorage.setItem('cc.sayAs', v.trim());
  }
  async function playSayAs() {
    try {
      const { audioBase64 } = await post<{ audioBase64: string }>('/api/ai/speak', { text: sayName('Hey, this is FIAREP.', sayAsDraft) });
      const uri = `${FileSystem.cacheDirectory}cmd-sayas-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(uri, audioBase64, { encoding: 'base64' as never });
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      playerRef.current?.remove();
      const player = createAudioPlayer({ uri }); playerRef.current = player; player.play();
    } catch (e) { Alert.alert('Could not play', errText(e)); }
  }

  // Hands-free runs while this screen is open and the app is in front.
  useFocusEffect(useCallback(() => {
    if (!(handsFree || device?.platform === false) || device?.status !== 'active') return undefined;
    startHandsFree();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') startHandsFree(); else stopListening(); });
    return () => { sub.remove(); stopListening(); };
  }, [handsFree, device?.status, device?.platform])); // eslint-disable-line react-hooks/exhaustive-deps

  /** One press: it listens, and sends when you stop talking. Press again to send early. */
  async function startRecording() {
    hush(); loopGen.current += 1;
    const gen = loopGen.current;
    try {
      const uri = await hearOnce(gen);
      if (!uri) { setPhase('off'); return; }
      setPhase('thinking');
      const heard = await transcribe(uri);
      if (!heard || NOISE.test(heard)) { setPhase('off'); Alert.alert('Nothing heard', 'Try again a little closer.'); return; }
      await send(heard, true);
    } catch (e) { Alert.alert('Could not hear that', errText(e)); }
    finally { if (gen === loopGen.current) setPhase('off'); }
  }
  /** Press while listening: done talking now. */
  function stopRecording() { finishNow.current = true; }

  async function approve(a: CommandAction) {
    setBusy('Approving…');
    try {
      const done = await approveAction(a); // Face ID prompt happens here
      setPending((p) => p.filter((x) => x.id !== a.id));
      void speak(done.spoken || (done.status === 'queued' ? 'Sent to the computer.' : done.error || ''));
      await refresh();
    } catch (e: any) {
      if (!/cancel/i.test(String(e?.message))) Alert.alert('Not approved', errText(e));
    } finally { setBusy(''); }
  }
  async function deny(a: CommandAction) {
    try { await commandFetch('POST', `/v1/command/actions/${encodeURIComponent(a.id)}/deny`, {}); } catch { /* refresh corrects */ }
    setPending((p) => p.filter((x) => x.id !== a.id)); void refresh();
  }

  async function approveOutage(i: RelayIncident) {
    if (!relayBase) return;
    setBusy('Approving…');
    try { await relayApprove(relayBase, i); await loadRelay(); Alert.alert('Approved', 'The Mac will republish FIAREP on Replit within about a minute and tell you when it is back.'); }
    catch (e: any) { if (!/cancel/i.test(String(e?.message))) Alert.alert('Not approved', errText(e)); }
    finally { setBusy(''); }
  }
  async function denyOutage(i: RelayIncident) {
    if (!relayBase) return;
    try { await relayDeny(relayBase, i); } catch { /* reload corrects */ }
    void loadRelay();
  }
  async function toggleAutoFix(on: boolean) {
    if (!relayBase) return;
    setBusy('Saving…');
    try { await relaySetAutoFix(relayBase, on); await loadRelay(); }
    catch (e: any) { if (!/cancel/i.test(String(e?.message))) Alert.alert('Not changed', errText(e)); }
    finally { setBusy(''); }
  }

  async function shareKey() {
    const key = await confirmPublicKey();
    if (key) await Share.share({ message: key });
  }

  if (!support.ok) {
    return <View style={ui.wrap}><Text style={ui.cardTitle}>Command Center</Text><Text style={ui.label}>{support.reason}</Text></View>;
  }
  if (device === undefined) return <View style={[ui.wrap, { alignItems: 'center' }]}>{!!savedGreeting && <Text style={{ fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 8, alignSelf: 'stretch' }}>{savedGreeting}</Text>}<ActivityIndicator /></View>;
  if (!device || device.status === 'revoked') {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.cardTitle}>Set up this phone</Text>
        <Text style={ui.label}>This makes two keys that never leave the phone: one signs every command, the other sits behind Face ID and signs each approval. Then the phone is approved on fiarep.com → Command Center → Phones.</Text>
        {device?.status === 'revoked' && <Text style={{ color: '#C0392B' }}>This phone was revoked. Set it up again to request a new approval.</Text>}
        <Pressable style={[ui.btn, !!busy && ui.btnMuted]} disabled={!!busy} onPress={() => void (device?.status === 'revoked' ? forgetDevice().then(setUp) : setUp())}>
          <Text style={ui.btnText}>{busy || 'Set up this phone'}</Text>
        </Pressable>
      </ScrollView>
    );
  }
  if (device.status === 'pending') {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.cardTitle}>Waiting for approval</Text>
        <Text style={ui.label}>Approve this phone on {device.approveWhere || 'fiarep.com → Command Center → Phones'}. Nothing can be sent from it until then.</Text>
        <Pressable style={ui.btnOutline} onPress={() => void loadDevice()}><Text style={ui.btnOutlineText}>Check again</Text></Pressable>
      </ScrollView>
    );
  }

  const chip = (a: CommandAction) => (
    <Pressable key={a.id} onPress={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))} style={{ marginTop: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: STATUS_COLOR[a.status] || '#666' }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{a.status.toUpperCase()}</Text>
        </View>
        <Text style={{ fontSize: 13, flex: 1 }} numberOfLines={1}>{a.summary}</Text>
        <Text style={{ color: '#999' }}>{open[a.id] ? '▾' : '▸'}</Text>
      </View>
      {typeof (a.result as { url?: unknown } | null)?.url === 'string' && /^https:\/\//.test((a.result as { url: string }).url) && (
        <Pressable style={[ui.btn, { marginTop: 6 }]} onPress={() => void Linking.openURL((a.result as { url: string }).url)}>
          <Text style={ui.btnText}>Open file{(a.result as { name?: string }).name ? ` · ${(a.result as { name?: string }).name}` : ''}</Text>
        </Pressable>
      )}
      {open[a.id] && (
        <Text selectable style={{ fontFamily: 'Menlo', fontSize: 11, color: '#333', marginTop: 4 }}>
          {a.error ? `Error: ${a.error}\n` : ''}{JSON.stringify(a.result ?? a.params, null, 1).slice(0, 3000)}
        </Text>
      )}
    </Pressable>
  );

  // Hands-free: nothing on the screen. Talk; when you stop, it answers.
  // A client's Command Center (FIAREP switches it on for them): the conversation on screen and talking — no settings.
  const isClient = device.platform === false;
  const quiet = handsFree && !isClient;
  const sw = (label: string, value: boolean, onChange: (v: boolean) => void, note?: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}><Text style={{ fontSize: 16 }}>{label}</Text>{!!note && <Text style={{ fontSize: 12, color: '#64748b' }}>{note}</Text>}</View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerRight: isClient ? () => null : () => (
        <Pressable onPress={() => setVoiceOpen(true)} hitSlop={10} accessibilityLabel="Command Center settings" style={{ paddingHorizontal: 6 }}>
          <Text style={{ fontSize: 22 }}>⚙️</Text>
        </Pressable>
      ) }} />
      <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
        {device.offline && (
          <View style={[ui.card, { borderColor: '#C0392B', backgroundColor: '#fdecea' }]}>
            <Text style={{ fontWeight: '700', color: '#C0392B' }}>fiarep.com is not answering</Text>
            <Text style={{ fontSize: 13, color: '#333', marginTop: 4 }}>Commands need fiarep.com. Outage approvals below go through the backup relay and still work.</Text>
          </View>
        )}
        {relayBase && (() => {
          const open = relay?.incidents.filter((i) => i.status === 'open') ?? [];
          const fixing = relay?.incidents.find((i) => i.status === 'approved' || i.status === 'running');
          if (quiet && !open.length && !fixing) return null; // blank screen: only when a site is down
          const replitLink = (i?: RelayIncident) => i?.replitUrl ? (
            <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={() => void Linking.openURL(i.replitUrl!)}><Text style={ui.btnOutlineText}>Open Replit (republish from the phone)</Text></Pressable>
          ) : null;
          const latest = relay?.incidents.find((i) => ['done', 'failed', 'denied', 'expired'].includes(i.status));
          const macMinutes = relay?.agentSeen ? Math.round((Date.now() - relay.agentSeen) / 60000) : null;
          return (
            <View style={ui.card}>
              <Text style={{ fontWeight: '700' }}>When a site goes down</Text>
              <Text style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                {!relay ? 'Backup relay unreachable.' : macMinutes === null ? 'The Mac has not checked in with the backup relay yet.' : macMinutes <= 15 ? 'The Mac is watching your sites.' : `The Mac last checked in ${macMinutes} min ago — is it asleep?`}
              </Text>
              {open.map((i) => (
                <View key={i.id} style={{ marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 2, borderColor: '#C0392B', backgroundColor: '#fdecea' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#C0392B' }}>{(i.site || 'FIAREP').toUpperCase()} IS DOWN · {Math.max(0, Math.round((i.expiresAt - Date.now()) / 60000))} MIN TO APPROVE</Text>
                  <Text style={{ fontSize: 15, fontWeight: '600', marginTop: 4 }}>Republish {i.site || 'FIAREP'} on Replit from the Mac</Text>
                  {!!i.detail && <Text style={{ fontSize: 12, color: '#333', marginTop: 2 }}>{i.detail}</Text>}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <Pressable style={[ui.btn, { flex: 1 }, !!busy && ui.btnMuted]} disabled={!!busy} onPress={() => void approveOutage(i)}><Text style={ui.btnText}>Republish with Face ID</Text></Pressable>
                    <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#C0392B' }]} onPress={() => void denyOutage(i)}><Text style={[ui.btnOutlineText, { color: '#C0392B' }]}>Not now</Text></Pressable>
                  </View>
                  {replitLink(i)}
                </View>
              ))}
              {fixing && (
                <View style={{ marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 2, borderColor: '#185FA5', backgroundColor: '#eaf2fb' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#185FA5' }}>{(fixing.site || 'FIAREP').toUpperCase()} · {fixing.status === 'approved' ? 'APPROVED · THE MAC IS STARTING' : 'FIXING · REPLIT IS OPEN ON THE MAC'}</Text>
                  <Text style={{ fontSize: 13, color: '#333', marginTop: 4 }}>If Replit asks to sign in or "verify you are human", do it on the Mac — it carries on by itself. Not at the Mac? Republish from the phone.</Text>
                  {replitLink(fixing)}
                </View>
              )}
              {latest && (
                <Text style={{ fontSize: 12, color: latest.status === 'done' ? '#1F5C45' : latest.status === 'failed' ? '#C0392B' : '#666', marginTop: 8 }}>
                  Last outage ({latest.site || 'FIAREP'}) {new Date(latest.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: {latest.status}{latest.autoFixed ? ' (fixed without asking)' : ''}{latest.result?.detail ? ` — ${latest.result.detail}` : ''}
                </Text>
              )}
              {latest?.status === 'failed' && replitLink(latest)}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ fontSize: 14 }}>Fix outages without asking</Text>
                  <Text style={{ fontSize: 11, color: '#666' }}>The Mac republishes on its own and tells you after. Changing this needs Face ID.</Text>
                </View>
                <Switch value={!!relay?.settings.autoFix} disabled={!relay || !!busy} onValueChange={(v) => void toggleAutoFix(v)} />
              </View>
            </View>
          );
        })()}
        {pending.map((a) => {
          const minutes = Math.max(0, Math.round((a.expiresAt - Date.now()) / 60000));
          return (
            <View key={a.id} style={[ui.card, { borderColor: '#B4741A', borderWidth: 2, backgroundColor: '#fffbeb' }]}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#B4741A' }}>NEEDS YOUR APPROVAL · {minutes} MIN LEFT</Text>
              <Text style={{ fontSize: 17, fontWeight: '600', marginTop: 4 }}>{a.summary}</Text>
              <Text style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{a.label}{a.target !== 'server' ? ' · on the computer' : ''}</Text>
              {Object.keys(a.params).length > 0 && <Text selectable style={{ fontFamily: 'Menlo', fontSize: 11, color: '#333', marginTop: 6 }}>{JSON.stringify(a.params, null, 1)}</Text>}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <Pressable style={[ui.btn, { flex: 1 }, !!busy && ui.btnMuted]} disabled={!!busy} onPress={() => void approve(a)}><Text style={ui.btnText}>Approve with Face ID</Text></Pressable>
                <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#C0392B' }]} onPress={() => void deny(a)}><Text style={[ui.btnOutlineText, { color: '#C0392B' }]}>Deny</Text></Pressable>
              </View>
            </View>
          );
        })}

        {(!quiet || showConvo) && <>
        {!!(device.greeting || savedGreeting) && <Text style={{ fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 4 }}>{device.greeting || savedGreeting}</Text>}
        {runs.length === 0 && <Text style={ui.empty}>{device.platform === false ? 'Ask anything — “Check every building we manage”, “Any urgent violations?”, “What’s in the Documents folder on the office PC?”.' : 'Ask anything — “Check every building we manage”, “Is FIAREP up?”, “Git status on my Mac”.'}</Text>}
        {runs.map((r) => (
          <View key={r.id} style={ui.card}>
            <Text style={{ color: '#666' }}>{r.text}</Text>
            <Text style={{ fontSize: 17, fontWeight: '600', marginTop: 6, color: r.status === 'failed' ? '#C0392B' : '#111' }}>{r.reply || r.error || '…'}</Text>
            {r.actions.map(chip)}
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => { setThreadId(newThread()); Alert.alert('New conversation', 'Earlier commands won’t be used as context.'); }}><Text style={{ color: ACCENT }}>New conversation</Text></Pressable>
          <Pressable onPress={() => void shareKey()}><Text style={{ color: ACCENT }}>Share Face ID key (for your computers)</Text></Pressable>
        </View>
        </>}
      </ScrollView>

      {!quiet && !isClient && (
        <View style={{ padding: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderTopColor: '#e0e0e0', backgroundColor: '#fff', gap: 8 }}>
          <View style={{ alignItems: 'center', marginTop: -4, marginBottom: -8 }}>
            <VoiceOrb
              phase={phase === 'off' && recording ? 'waiting' : phase}
              level={levelAnim}
              size={76}
              disabled={(!!busy || phase === 'thinking') && !recording}
              onPress={() => { if (phase === 'speaking') { hush(); return; } if (recording) stopRecording(); else if (!handsFree) void startRecording(); }}
            />
          </View>
          <TextInput style={ui.input} value={text} onChangeText={setText} placeholder="Type a command" returnKeyType="send" onSubmitEditing={() => void send(text)} editable={!busy} />
        </View>
      )}
      <Modal visible={voiceOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVoiceOpen(false)}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 + insets.bottom, gap: 12 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '800' }}>Command Center settings</Text>
            <Pressable onPress={() => { if (teach) stopListening(); setVoiceOpen(false); }} hitSlop={10}><Text style={{ color: ACCENT, fontWeight: '700', fontSize: 17 }}>Done</Text></Pressable>
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', marginTop: 4 }}>Talking</Text>
          {sw('Say replies out loud', speakReplies, setSpeakReplies)}
          {sw('Hands-free', handsFree, (v) => { setHandsFree(v); void AsyncStorage.setItem('cc.handsFree2', v ? '1' : '0'); if (!v) stopListening(); }, 'On: the screen listens as soon as it opens — no buttons. Just talk; when you stop, it answers.')}
          {handsFree && sw('Only after “Hey FIAREP” (not needed on this screen)', wakeOn, (v) => { setWakeOn(v); void AsyncStorage.setItem('cc.wake2', v ? '1' : '0'); })}
          {handsFree && sw('Show the conversation on screen', showConvo, (v) => { setShowConvo(v); void AsyncStorage.setItem('cc.showConvo', v ? '1' : '0'); }, 'Off: the screen stays blank while you talk.')}
          <Text style={{ fontSize: 17, fontWeight: '700', marginTop: 12 }}>Wake words</Text>
          {teach ? (
            <View style={{ backgroundColor: '#f1f5f9', borderRadius: 8, padding: 10, gap: 4 }}>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>Say “Hey FIAREP” the way you say it — {teach.n} of 5</Text>
              <Text style={ui.label}>Then stop and wait. It moves to the next one on its own.</Text>
              {teach.heard.map((h, i) => <Text key={i} style={{ color: '#475569' }}>Heard: “{h}”</Text>)}
              <Pressable onPress={() => stopListening()}><Text style={{ color: '#C0392B', fontWeight: '600' }}>Stop</Text></Pressable>
            </View>
          ) : (
            <Pressable style={ui.btnOutline} onPress={() => void teachWakeWords()}><Text style={ui.btnOutlineText}>Teach my wake words (say “Hey FIAREP” 5 times)</Text></Pressable>
          )}
          {taught.length > 0 && (
            <View style={{ gap: 2 }}>
              <Text style={ui.label}>These also wake it on this phone:</Text>
              {taught.map((w) => (
                <View key={w} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text>“{w}”</Text>
                  <Pressable onPress={() => void removeTaught(w)} hitSlop={8}><Text style={{ color: '#C0392B', fontSize: 16 }}>✕</Text></Pressable>
                </View>
              ))}
            </View>
          )}
          <Text style={{ fontSize: 17, fontWeight: '700', marginTop: 12 }}>How FIAREP is said</Text>
          <Text style={ui.label}>Type it the way it sounds (e.g. Fee-uh-rep), press Play, then Save.</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput style={[ui.input, { flex: 1 }]} value={sayAsDraft} onChangeText={setSayAsDraft} placeholder="FIAREP" autoCapitalize="none" autoCorrect={false} />
            <Pressable style={[ui.btnOutline, { paddingHorizontal: 12 }]} onPress={() => void playSayAs()}><Text style={ui.btnOutlineText}>▶ Play</Text></Pressable>
            <Pressable style={[ui.btn, { paddingHorizontal: 12 }, sayAsDraft.trim() === sayAs && ui.btnMuted]} disabled={sayAsDraft.trim() === sayAs} onPress={() => void saveSayAs(sayAsDraft)}><Text style={ui.btnText}>Save</Text></Pressable>
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', marginTop: 12 }}>Conversation</Text>
          <Pressable style={ui.btnOutline} onPress={() => { setThreadId(newThread()); Alert.alert('New conversation', 'Earlier commands won’t be used as context.'); }}><Text style={ui.btnOutlineText}>New conversation</Text></Pressable>
          <Pressable style={ui.btnOutline} onPress={() => void shareKey()}><Text style={ui.btnOutlineText}>Share Face ID key (for your computers)</Text></Pressable>
        </ScrollView>
      </Modal>
    </View>
  );
}
