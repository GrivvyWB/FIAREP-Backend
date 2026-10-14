// One conversation, the same bubbles whichever side you are on.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { ui, ACCENT } from '../lib/ui';
import type { ChatMessage } from '../lib/fiarep-messaging';

const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function ChatThread({ load, send, closed, footer }: {
  load: () => Promise<ChatMessage[]>;
  send: (body: string) => Promise<void>;
  closed?: boolean;
  footer?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const refresh = useCallback(async () => {
    try { setMessages(await load()); } catch (e: any) { Alert.alert('Could not open the conversation', e?.data?.error || e?.message || 'Try again.'); }
  }, [load]);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 15000); return () => clearInterval(t); }, [refresh]);

  async function onSend() {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try { await send(text); setBody(''); await refresh(); }
    catch (e: any) { Alert.alert('Not sent', e?.data?.error || e?.message || 'Try again.'); }
    finally { setSending(false); }
  }

  return (
    <View style={{ gap: 10 }}>
      <ScrollView ref={scroller} style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
        {messages.length === 0 && <Text style={[ui.listSub, { textAlign: 'center', paddingVertical: 20 }]}>No messages yet.</Text>}
        {messages.map((m) => (
          <View key={m.id} style={{ alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
            <View style={{ maxWidth: '82%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: m.mine ? ACCENT : '#e5e7eb' }}>
              <Text style={{ color: m.mine ? '#fff' : '#111', fontSize: 15 }}>{m.body}</Text>
              <Text style={{ color: m.mine ? '#dbeafe' : '#6b7280', fontSize: 11, marginTop: 3 }}>{m.mine ? '' : `${m.author} · `}{when(m.at)}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      {closed ? (
        <Text style={ui.listSub}>This conversation is blocked.</Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <TextInput style={[ui.input, { flex: 1, minHeight: 44 }]} value={body} onChangeText={setBody} placeholder="Write a message" multiline />
          <Pressable style={[ui.btn, { paddingHorizontal: 16 }, (sending || !body.trim()) && ui.btnMuted]} disabled={sending || !body.trim()} onPress={() => void onSend()}>
            <Text style={ui.btnText}>{sending ? '…' : 'Send'}</Text>
          </Pressable>
        </View>
      )}
      {footer}
    </View>
  );
}
