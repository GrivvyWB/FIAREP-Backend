// A client company on the plan writes to FIAREP: to FIAREP Services, or - a
// separate conversation - to FIAREP's administrator. Never to a technician or
// a worker. Each conversation is seen only by its two sides.
import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ui, ACCENT } from '../lib/ui';
import ChatThread from '../components/ChatThread';
import { msgGet, msgPost, type ChatMessage } from '../lib/fiarep-messaging';

type Raw = { id: string; messages: Array<{ id: string; mine: boolean; authorName: string; body: string; at: string }> };

export default function ClientMessages() {
  const [to, setTo] = useState<'services' | 'admin'>('services');
  // ?member=1: this staff member's own conversation (every member has one), not the company's.
  const base = useLocalSearchParams<{ member?: string }>().member === '1' ? '/api/v1/member/messages' : '/api/v1/client/messages';
  const url = to === 'admin' ? `${base}?to=admin` : base;
  const load = useCallback(async (): Promise<ChatMessage[]> => {
    const r = await msgGet<Raw>(url);
    return (r.messages || []).map((m) => ({ id: m.id, mine: m.mine, author: m.authorName, body: m.body, at: m.at }));
  }, [url]);
  const send = useCallback(async (body: string) => { await msgPost(url, { body }); }, [url]);
  const tab = (key: 'services' | 'admin', label: string) => (
    <Pressable onPress={() => setTo(key)} style={[to === key ? ui.btn : ui.btnOutline, { flex: 1, paddingVertical: 10 }]}>
      <Text style={to === key ? ui.btnText : ui.btnOutlineText}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 16 }]} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Message FIAREP</Text>
      <Text style={ui.label}>Write to {to === 'admin' ? "FIAREP's administrator" : 'FIAREP Services'}. Only the two of you see it.</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {tab('services', 'FIAREP Services')}
        {tab('admin', 'Administrator')}
      </View>
      <View key={to} style={[ui.card, { borderColor: ACCENT + '33' }]}>
        <ChatThread load={load} send={send} />
      </View>
    </ScrollView>
  );
}
