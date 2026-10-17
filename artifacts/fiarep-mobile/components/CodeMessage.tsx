// Message FIAREP with a code. A client who is not on the plan or the platform
// gets a code from a FIAREP Services member (or FIAREP's administrator); they
// type it here and text that member freely - nobody else, never a technician
// or a worker. No account. Only the two of them see it, and the member can
// block them at any time.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ui } from '../lib/ui';
import ChatThread from './ChatThread';
import { msgPost, type ChatMessage } from '../lib/fiarep-messaging';
import { registerForPush } from '../lib/push';

type View_ = { coordinator: string; unit: string; closed: boolean; messages: Array<{ id: string; mine: boolean; author: string; body: string; at: string }> };
const KEY = 'fiarep.message.code';
const PERSON_KEY = 'fiarep.message.person';
type Inbox = { name: string; apartment: string; building: string; conversations: Array<{ code: string; coordinator: string; last: string; lastAt: string; unread: number; closed: boolean }> };

export default function CodeMessage({ onBack, codeOnly = false, senderName = '' }: { onBack?: () => void; codeOnly?: boolean; senderName?: string }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [opened, setOpened] = useState<View_ | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearedKey, setClearedKey] = useState(0);
  // Signed up with first and last name: FIAREP Services finds them by name and
  // the conversation shows up here. No code to type.
  const [person, setPerson] = useState<{ id: string; secret: string } | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  // codeOnly: a signed-in member's screens - just the code box, no sign-up.
  const [mode, setMode] = useState<'start' | 'code'>(codeOnly ? 'code' : 'start');
  const [first, setFirst] = useState(''); const [last, setLast] = useState('');
  const [apt, setApt] = useState(''); const [building, setBuilding] = useState('');

  // The code is kept on this phone (in the keychain) so they do not retype it.
  useEffect(() => { SecureStore.getItemAsync(KEY).then((c) => { if (c) setCode(c); }).catch(() => undefined); }, []);
  const loadInbox = useCallback(async (p: { id: string; secret: string }) => {
    const pushToken = await registerForPush().catch(() => '');
    try { setInbox(await msgPost<Inbox>('/api/v1/public/messages/me', { ...p, pushToken })); }
    catch { setInbox(null); }
  }, []);
  useEffect(() => { SecureStore.getItemAsync(PERSON_KEY).then((v) => { if (v) { const p = JSON.parse(v); setPerson(p); void loadInbox(p); } }).catch(() => undefined); }, [loadInbox]);

  async function signUp() {
    if (!first.trim() || !last.trim()) { Alert.alert('Type your first and last name'); return; }
    setBusy(true);
    try {
      const pushToken = await registerForPush().catch(() => '');
      const p = await msgPost<{ id: string; secret: string }>('/api/v1/public/messages/signup', { firstName: first.trim(), lastName: last.trim(), apartment: apt.trim(), building: building.trim(), pushToken });
      await SecureStore.setItemAsync(PERSON_KEY, JSON.stringify(p)).catch(() => undefined);
      setPerson(p); await loadInbox(p);
    } catch (e: any) { Alert.alert('Could not sign up', e?.data?.error || 'Try again.'); }
    finally { setBusy(false); }
  }

  async function open(withCode?: string) {
    const c = (withCode ?? code).trim();
    if (c.length < 4) return;
    if (withCode) setCode(withCode);
    setBusy(true);
    try {
      // Replies come to this phone as notifications: ask once, send the token along.
      const pushToken = await registerForPush().catch(() => '');
      const v = await msgPost<View_>('/api/v1/public/messages/open', { code: c, pushToken });
      setOpened(v);
      await SecureStore.setItemAsync(KEY, c).catch(() => undefined);
    } catch (e: any) {
      Alert.alert('That code does not open anything', e?.data?.error || 'Check it with the person who gave it to you.');
    } finally { setBusy(false); }
  }

  const load = useCallback(async (): Promise<ChatMessage[]> => {
    const v = await msgPost<View_>('/api/v1/public/messages/open', { code: code.trim() });
    setOpened(v);
    return v.messages;
  }, [code]);
  const send = useCallback(async (body: string) => {
    await msgPost('/api/v1/public/messages/send', { code: code.trim(), name: name.trim() || inbox?.name || senderName, body });
  }, [code, name, inbox, senderName]);

  if (!opened && mode === 'start') {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', textAlign: 'center' }}>Message FIAREP</Text>
        {!person ? (
          <>
            <Text style={[ui.label, { textAlign: 'center' }]}>Sign up with your name so FIAREP Services can find you and text you here.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[ui.input, { flex: 1 }]} value={first} onChangeText={setFirst} placeholder="First name" />
              <TextInput style={[ui.input, { flex: 1 }]} value={last} onChangeText={setLast} placeholder="Last name" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[ui.input, { flex: 1 }]} value={building} onChangeText={setBuilding} placeholder="Building (optional)" />
              <TextInput style={[ui.input, { width: 90 }]} value={apt} onChangeText={setApt} placeholder="Apt" />
            </View>
            <Pressable style={[ui.btn, (busy || !first.trim() || !last.trim()) && ui.btnMuted]} disabled={busy || !first.trim() || !last.trim()} onPress={() => void signUp()}>
              <Text style={ui.btnText}>{busy ? 'Signing up…' : 'Sign up'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[ui.label, { textAlign: 'center' }]}>Signed up as {inbox?.name || '…'}{inbox?.apartment ? ` · Apt ${inbox.apartment}` : ''}</Text>
            {(inbox?.conversations ?? []).length === 0 && <Text style={[ui.listSub, { textAlign: 'center' }]}>When FIAREP Services messages you it shows up here, and your phone gets a notification.</Text>}
            {(inbox?.conversations ?? []).map((c) => (
              <Pressable key={c.code} style={[ui.card, { gap: 4 }]} disabled={c.closed} onPress={() => void open(c.code)}>
                <Text style={{ fontWeight: '700' }}>{c.coordinator || 'FIAREP Services'}{c.unread > 0 ? `  · ${c.unread} new` : ''}{c.closed ? '  · closed' : ''}</Text>
                {!!c.last && <Text style={ui.listSub} numberOfLines={1}>{c.last}</Text>}
              </Pressable>
            ))}
            <Pressable onPress={() => person && void loadInbox(person)} style={{ padding: 6 }}><Text style={{ textAlign: 'center', color: '#185FA5', fontWeight: '600' }}>Refresh</Text></Pressable>
          </>
        )}
        <Pressable onPress={() => setMode('code')} style={{ padding: 10 }}><Text style={{ textAlign: 'center', color: '#666' }}>I have a code</Text></Pressable>
        {onBack && <Pressable onPress={onBack} style={{ padding: 10 }}><Text style={{ textAlign: 'center', color: '#666' }}>Back</Text></Pressable>}
      </View>
    );
  }
  if (!opened) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: codeOnly ? 17 : 22, fontWeight: '700', textAlign: codeOnly ? 'left' : 'center' }}>{codeOnly ? 'Have a code?' : 'Message FIAREP'}</Text>
        <Text style={[ui.label, { textAlign: codeOnly ? 'left' : 'center' }]}>Type the code someone gave you. You text the person who made it, and nobody else.</Text>
        <TextInput style={[ui.input, { fontSize: 22, letterSpacing: 4, textAlign: 'center' }]} value={code} onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder="ABCD-EFGH" autoCapitalize="characters" autoCorrect={false} />
        {!senderName && <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="Your name (optional)" />}
        <Pressable style={[ui.btn, (busy || code.trim().length < 4) && ui.btnMuted]} disabled={busy || code.trim().length < 4} onPress={() => void open()}>
          <Text style={ui.btnText}>{busy ? 'Opening…' : 'Open'}</Text>
        </Pressable>
        {!codeOnly && <Pressable onPress={() => setMode('start')} style={{ padding: 10 }}><Text style={{ textAlign: 'center', color: '#666' }}>Back</Text></Pressable>}
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>{opened.coordinator || opened.unit}</Text>
      <Text style={ui.listSub}>{opened.unit} · only the two of you see this</Text>
      <ChatThread key={clearedKey} load={load} send={send} closed={opened.closed} />
      {/* On the phone the messages stay until the person deletes them. */}
      <Pressable onPress={() => Alert.alert('Delete these messages?', 'They are removed from this conversation on your side. The other person still has them.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void (async () => {
          try { await msgPost('/api/v1/public/messages/clear', { code: code.trim() }); setClearedKey((k) => k + 1); }
          catch (e: any) { Alert.alert('Could not delete', e?.data?.error || 'Try again.'); }
        })() },
      ])} style={{ padding: 6 }}><Text style={{ textAlign: 'center', color: '#b91c1c', fontWeight: '600' }}>Delete messages</Text></Pressable>
      <Pressable onPress={() => { setOpened(null); setMode(codeOnly ? 'code' : 'start'); if (person) void loadInbox(person); }} style={{ padding: 10 }}><Text style={{ textAlign: 'center', color: '#666' }}>{codeOnly ? 'Close' : 'Back'}</Text></Pressable>
    </View>
  );
}
