import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { customFetch } from '@workspace/api-client-react';
import { getResidentCode } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

// The resident line: no code needed. The Command Center reports the repair,
// checks a complaint, and sets up the visit. This phone keeps the conversation.
type Msg = { id: string; from: 'you' | 'office'; text: string; at: string };
type View_ = { messages: Msg[]; complaintNo: string | null; company: string | null; appointment: { label: string } | null };
const KEY = 'fiarep.residentDesk';

export default function ResidentDesk() {
  const [desk, setDesk] = useState<{ id: string; token: string } | null>(null);
  const [view, setView] = useState<View_ | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const start = useCallback(async () => {
    const company = await getResidentCode().catch(() => null);
    const r = await customFetch<View_ & { id: string; token: string }>('/api/v1/public/resident-desk', { method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyCode: company?.code || '' }) } as never);
    const d = { id: r.id, token: r.token };
    await AsyncStorage.setItem(KEY, JSON.stringify(d)).catch(() => undefined);
    setDesk(d); setView(r);
  }, []);
  const load = useCallback(async (d: { id: string; token: string }) => {
    try { setView(await customFetch<View_>(`/api/v1/public/resident-desk/${d.id}`, { responseType: 'json', headers: { 'x-desk-token': d.token } } as never)); }
    catch { await AsyncStorage.removeItem(KEY).catch(() => undefined); setDesk(null); void start(); }
  }, [start]);
  useEffect(() => {
    void (async () => {
      try { const v = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null'); if (v?.id && v?.token) { setDesk(v); await load(v); return; } } catch { /* start fresh */ }
      await start().catch((e: any) => setError(e?.data?.error || 'Could not connect. Try again.'));
    })();
  }, [load, start]);
  useFocusEffect(useCallback(() => { if (!desk) return; const t = setInterval(() => void load(desk), 15000); return () => clearInterval(t); }, [desk, load]));
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); }, [view?.messages.length]);
  async function send() {
    const t = text.trim(); if (!t || !desk) return;
    setSending(true); setError(''); setText('');
    setView((v) => v && { ...v, messages: [...v.messages, { id: 'pending', from: 'you', text: t, at: new Date().toISOString() }] });
    try { setView(await customFetch<View_>(`/api/v1/public/resident-desk/${desk.id}/messages`, { method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json', 'x-desk-token': desk.token }, body: JSON.stringify({ text: t }) } as never)); }
    catch (e: any) { setError(e?.data?.error || 'Could not send. Try again.'); setText(t); }
    finally { setSending(false); }
  }
  async function newConversation() { await AsyncStorage.removeItem(KEY).catch(() => undefined); setDesk(null); setView(null); void start(); }
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: view?.company || 'Talk to us' }} />
      <View style={{ flex: 1, padding: 12, gap: 8 }}>
        {!!view?.complaintNo && <Text style={{ padding: 10, borderRadius: 8, backgroundColor: '#eff6ff', color: '#1e3a8a' }}>Your complaint number: <Text style={{ fontWeight: '700' }}>{view.complaintNo}</Text>{view.company ? ` · ${view.company}` : ''}</Text>}
        {!!view?.appointment && <Text style={{ padding: 10, borderRadius: 8, backgroundColor: '#e9f7ef', color: '#1F5C45' }}>Visit booked: <Text style={{ fontWeight: '700' }}>{view.appointment.label}</Text></Text>}
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
          {!view && <Text style={{ color: '#666' }}>Connecting…</Text>}
          {view?.messages.map((m) => (
            <View key={m.id} style={{ alignItems: m.from === 'you' ? 'flex-end' : 'flex-start' }}>
              <View style={{ maxWidth: '85%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: m.from === 'you' ? ACCENT : '#fff', borderWidth: m.from === 'you' ? 0 : 1, borderColor: '#e5e7eb' }}>
                <Text style={{ color: m.from === 'you' ? '#fff' : '#111', fontSize: 15 }}>{m.text}</Text>
              </View>
            </View>
          ))}
          {sending && <Text style={{ color: '#666', fontSize: 12 }}>Writing…</Text>}
        </ScrollView>
        {!!error && <Text style={{ color: '#c00', fontSize: 12 }}>{error}</Text>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={[ui.input, { flex: 1 }]} value={text} onChangeText={setText} placeholder="Write a message" editable={!sending && !!view} onSubmitEditing={() => void send()} returnKeyType="send" />
          <Pressable style={[ui.btn, { paddingHorizontal: 16 }, (!text.trim() || sending) && { opacity: 0.5 }]} disabled={!text.trim() || sending} onPress={() => void send()}><Text style={ui.btnText}>Send</Text></Pressable>
        </View>
        <Pressable onPress={() => void newConversation()}><Text style={{ fontSize: 12, color: '#666', textAlign: 'center' }}>Start a new conversation</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
