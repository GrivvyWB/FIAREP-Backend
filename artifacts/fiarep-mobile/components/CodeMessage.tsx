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

export default function CodeMessage({ onBack }: { onBack?: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [opened, setOpened] = useState<View_ | null>(null);
  const [busy, setBusy] = useState(false);

  // The code is kept on this phone (in the keychain) so they do not retype it.
  useEffect(() => { SecureStore.getItemAsync(KEY).then((c) => { if (c) setCode(c); }).catch(() => undefined); }, []);

  async function open() {
    if (code.trim().length < 4) return;
    setBusy(true);
    try {
      // Replies come to this phone as notifications: ask once, send the token along.
      const pushToken = await registerForPush().catch(() => '');
      const v = await msgPost<View_>('/api/v1/public/messages/open', { code: code.trim(), pushToken });
      setOpened(v);
      await SecureStore.setItemAsync(KEY, code.trim()).catch(() => undefined);
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
    await msgPost('/api/v1/public/messages/send', { code: code.trim(), name: name.trim(), body });
  }, [code, name]);

  if (!opened) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', textAlign: 'center' }}>Message FIAREP</Text>
        <Text style={[ui.label, { textAlign: 'center' }]}>Type the code a FIAREP Services member gave you. You text that member, and nobody else.</Text>
        <TextInput style={[ui.input, { fontSize: 22, letterSpacing: 4, textAlign: 'center' }]} value={code} onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder="ABCD-EFGH" autoCapitalize="characters" autoCorrect={false} />
        <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="Your name (optional)" />
        <Pressable style={[ui.btn, (busy || code.trim().length < 4) && ui.btnMuted]} disabled={busy || code.trim().length < 4} onPress={() => void open()}>
          <Text style={ui.btnText}>{busy ? 'Opening…' : 'Open'}</Text>
        </Pressable>
        {onBack && <Pressable onPress={onBack} style={{ padding: 10 }}><Text style={{ textAlign: 'center', color: '#666' }}>Back</Text></Pressable>}
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>{opened.coordinator || opened.unit}</Text>
      <Text style={ui.listSub}>{opened.unit} · only the two of you see this</Text>
      <ChatThread load={load} send={send} closed={opened.closed} />
      {onBack && <Pressable onPress={onBack} style={{ padding: 10 }}><Text style={{ textAlign: 'center', color: '#666' }}>Back</Text></Pressable>}
    </View>
  );
}
