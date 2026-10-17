import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Switch, ActivityIndicator, Share } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder, type AudioPlayer } from 'expo-audio';
import { customFetch } from '@workspace/api-client-react';
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
  const [recording, setRecording] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [threadId, setThreadId] = useState(newThread);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
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

  async function speak(line: string) {
    if (!speakReplies || !line) return;
    try {
      const { audioBase64 } = await post<{ audioBase64: string }>('/api/ai/speak', { text: line.slice(0, 600) });
      const uri = `${FileSystem.cacheDirectory}cmd-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(uri, audioBase64, { encoding: 'base64' as never });
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      playerRef.current?.remove();
      const player = createAudioPlayer({ uri }); playerRef.current = player; player.play();
    } catch { /* the reply is on screen either way */ }
  }

  async function send(command: string) {
    const t = command.trim(); if (!t) return;
    setText(''); setBusy('Working…');
    try {
      const run = await commandFetch<CommandRun>('POST', '/v1/command/runs', { text: t, threadId });
      setRuns((rs) => [run, ...rs.filter((r) => r.id !== run.id)]);
      setPending((p) => [...p, ...run.actions.filter((a) => a.status === 'proposed' && !p.some((x) => x.id === a.id))]);
      void speak(run.reply || '');
    } catch (e) { Alert.alert('Command failed', errText(e)); }
    finally { setBusy(''); }
  }

  async function startRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Microphone needed', 'Allow the microphone in Settings.'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(); recorder.record(); setRecording(true);
    } catch (e) { Alert.alert('Could not record', errText(e)); }
  }
  async function stopRecording() {
    setRecording(false); setBusy('Listening…');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!recorder.uri) throw new Error('No recording');
      const audio = await FileSystem.readAsStringAsync(recorder.uri, { encoding: 'base64' as never });
      const { text: heard } = await post<{ text: string }>('/api/ai/transcribe', { audio, mimeType: 'audio/mp4', language: 'en' });
      if (!heard?.trim()) { Alert.alert('Nothing heard', 'Try again a little closer.'); setBusy(''); return; }
      await send(heard);
    } catch (e) { Alert.alert('Could not hear that', errText(e)); setBusy(''); }
  }

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
  if (device === undefined) return <View style={[ui.wrap, { alignItems: 'center' }]}><ActivityIndicator /></View>;
  if (!device || device.status === 'revoked') {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.cardTitle}>Set up this phone</Text>
        <Text style={ui.label}>This makes two keys that never leave the phone: one signs every command, the other sits behind Face ID and signs each approval. Then approve the phone on fiarep.com → Platform Control → Command Center.</Text>
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
        <Text style={ui.label}>Approve this phone on fiarep.com → Platform Control → Command Center → Phones. Nothing can be sent from it until then.</Text>
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
      {open[a.id] && (
        <Text selectable style={{ fontFamily: 'Menlo', fontSize: 11, color: '#333', marginTop: 4 }}>
          {a.error ? `Error: ${a.error}\n` : ''}{JSON.stringify(a.result ?? a.params, null, 1).slice(0, 3000)}
        </Text>
      )}
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
        {device.offline && (
          <View style={[ui.card, { borderColor: '#C0392B', backgroundColor: '#fdecea' }]}>
            <Text style={{ fontWeight: '700', color: '#C0392B' }}>fiarep.com is not answering</Text>
            <Text style={{ fontSize: 13, color: '#333', marginTop: 4 }}>Commands need fiarep.com. Outage approvals below go through the backup relay and still work.</Text>
          </View>
        )}
        {relayBase && (() => {
          const open = relay?.incidents.filter((i) => i.status === 'open') ?? [];
          const latest = relay?.incidents.find((i) => i.status !== 'open');
          const macMinutes = relay?.agentSeen ? Math.round((Date.now() - relay.agentSeen) / 60000) : null;
          return (
            <View style={ui.card}>
              <Text style={{ fontWeight: '700' }}>When FIAREP goes down</Text>
              <Text style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                {!relay ? 'Backup relay unreachable.' : macMinutes === null ? 'The Mac has not checked in with the backup relay yet.' : macMinutes <= 15 ? 'The Mac is watching fiarep.com.' : `The Mac last checked in ${macMinutes} min ago — is it asleep?`}
              </Text>
              {open.map((i) => (
                <View key={i.id} style={{ marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 2, borderColor: '#C0392B', backgroundColor: '#fdecea' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#C0392B' }}>FIAREP IS DOWN · {Math.max(0, Math.round((i.expiresAt - Date.now()) / 60000))} MIN TO APPROVE</Text>
                  <Text style={{ fontSize: 15, fontWeight: '600', marginTop: 4 }}>Republish FIAREP on Replit from the Mac</Text>
                  {!!i.detail && <Text style={{ fontSize: 12, color: '#333', marginTop: 2 }}>{i.detail}</Text>}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <Pressable style={[ui.btn, { flex: 1 }, !!busy && ui.btnMuted]} disabled={!!busy} onPress={() => void approveOutage(i)}><Text style={ui.btnText}>Republish with Face ID</Text></Pressable>
                    <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#C0392B' }]} onPress={() => void denyOutage(i)}><Text style={[ui.btnOutlineText, { color: '#C0392B' }]}>Not now</Text></Pressable>
                  </View>
                </View>
              ))}
              {latest && (
                <Text style={{ fontSize: 12, color: latest.status === 'done' ? '#1F5C45' : latest.status === 'failed' ? '#C0392B' : '#666', marginTop: 8 }}>
                  Last outage {new Date(latest.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: {latest.status}{latest.autoFixed ? ' (fixed without asking)' : ''}{latest.result?.detail ? ` — ${latest.result.detail}` : ''}
                </Text>
              )}
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

        {runs.length === 0 && <Text style={ui.empty}>Ask anything — “Check every building we manage”, “Is FIAREP up?”, “Git status on my Mac”.</Text>}
        {runs.map((r) => (
          <View key={r.id} style={ui.card}>
            <Text style={{ color: '#666' }}>{r.text}</Text>
            <Text style={{ fontSize: 17, fontWeight: '600', marginTop: 6, color: r.status === 'failed' ? '#C0392B' : '#111' }}>{r.reply || r.error || '…'}</Text>
            {r.actions.map(chip)}
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => { setThreadId(newThread()); Alert.alert('New conversation', 'Earlier commands won’t be used as context.'); }}><Text style={{ color: ACCENT }}>New conversation</Text></Pressable>
          <Pressable onPress={() => void shareKey()}><Text style={{ color: ACCENT }}>Share Face ID key (for the Mac)</Text></Pressable>
        </View>
      </ScrollView>

      <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e0e0e0', backgroundColor: '#fff', gap: 8 }}>
        {!!busy && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator /><Text style={ui.label}>{busy}</Text></View>}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput style={[ui.input, { flex: 1 }]} value={text} onChangeText={setText} placeholder="Type a command" returnKeyType="send" onSubmitEditing={() => void send(text)} editable={!busy} />
          <Pressable
            disabled={!!busy && !recording}
            onPress={() => void (recording ? stopRecording() : startRecording())}
            style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: recording ? '#dc2626' : ACCENT, opacity: busy && !recording ? 0.5 : 1 }}
          >
            <Text style={{ fontSize: 24, color: '#fff' }}>{recording ? '⏹' : '🎙'}</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={ui.label}>Say replies out loud</Text>
          <Switch value={speakReplies} onValueChange={setSpeakReplies} />
        </View>
      </View>
    </View>
  );
}
