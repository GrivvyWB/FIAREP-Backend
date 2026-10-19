import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';
import { ui, ACCENT } from '../lib/ui';

type Msg = { id: string; from: 'you' | 'office'; text: string; at: string };
type Chat = { messages: Msg[]; appointment: { start: string; end: string; label: string } | null; open: boolean };

/** Messages with the management office about one complaint (needs the status token saved when it was filed). */
export default function ResidentChat({ complaintNo, statusToken }: { complaintNo: string; statusToken: string }) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const path = `/api/v1/public/resident-reports/${encodeURIComponent(complaintNo)}/messages`;
  const load = useCallback(async () => {
    try { setChat(await customFetch<Chat>(path, { responseType: 'json', headers: { 'x-resident-token': statusToken } } as never)); } catch { setChat(null); }
  }, [path, statusToken]);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { const t = setInterval(() => void load(), 15000); return () => clearInterval(t); }, [load]));
  if (!chat?.open) return null;
  async function send() {
    const t = text.trim(); if (!t) return;
    setSending(true); setError('');
    try {
      setChat(await customFetch<Chat>(path, { method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json', 'x-resident-token': statusToken }, body: JSON.stringify({ text: t }) } as never));
      setText('');
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    } catch (e: any) { setError(e?.data?.error || 'Could not send. Try again.'); }
    finally { setSending(false); }
  }
  return (
    <View style={[ui.card, { gap: 8 }]}>
      <Text style={ui.label}>Messages with the management office</Text>
      {!!chat.appointment && (
        <View style={{ padding: 10, borderRadius: 8, backgroundColor: '#e9f7ef', borderWidth: 1, borderColor: '#9fd8b5' }}>
          <Text style={{ color: '#1F5C45' }}>Visit booked: <Text style={{ fontWeight: '700' }}>{chat.appointment.label}</Text></Text>
        </View>
      )}
      <ScrollView ref={scroll} style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 6 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {chat.messages.length === 0 && <Text style={ui.lineK}>Ask about your complaint or when someone can come.</Text>}
        {chat.messages.map((m) => (
          <View key={m.id} style={{ alignSelf: m.from === 'you' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: m.from === 'you' ? ACCENT : '#f2f2f2', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ color: m.from === 'you' ? '#fff' : '#111', fontSize: 15 }}>{m.text}</Text>
            <Text style={{ color: m.from === 'you' ? 'rgba(255,255,255,0.7)' : '#888', fontSize: 10, marginTop: 2 }}>{new Date(m.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput style={[ui.input, { flex: 1, minWidth: 0 }]} value={text} onChangeText={setText} placeholder="Write a message" editable={!sending} returnKeyType="send" onSubmitEditing={() => void send()} />
        <Pressable style={[ui.btn, { paddingHorizontal: 16, flexShrink: 0 }, (sending || !text.trim()) && ui.btnMuted]} disabled={sending || !text.trim()} onPress={() => void send()}>
          <Text style={ui.btnText}>{sending ? '…' : 'Send'}</Text>
        </Pressable>
      </View>
      {!!error && <Text style={{ color: '#C0392B', fontSize: 12 }}>{error}</Text>}
    </View>
  );
}
