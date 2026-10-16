// FIAREP's side of messaging: FIAREP Services coordinators and FIAREP's
// administrators (Timothy Winn, Emily Winn). Each sees only the conversations
// they are part of - the codes they handed out, and the client companies
// writing to their side. Nobody reads anyone else's conversation.
import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ui } from '../lib/ui';
import ChatThread from '../components/ChatThread';
import { msgGet, msgPost, type ChatMessage } from '../lib/fiarep-messaging';

type Row = { id: string; kind: 'code' | 'client'; who: string; address: string; apartment: string; last: string; lastAt: string; unread: number; closed: boolean };
type Full = { id: string; closed: boolean; messages: Array<{ id: string; from: 'fiarep' | 'contact'; authorName: string; body: string; at: string }> };
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function FiarepMessages() {
  const [rows, setRows] = useState<Row[]>([]);
  const [openId, setOpenId] = useState('');
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [apartment, setApartment] = useState('');
  const [issued, setIssued] = useState<{ code: string; who: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Find someone who signed up in the app: type the name, tap it, the conversation lands on their phone.
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Array<{ id: string; name: string; apartment: string; building: string }>>([]);
  const [starting, setStarting] = useState('');
  async function find(text: string) {
    setQ(text);
    if (text.trim().length < 2) { setPeople([]); return; }
    try { setPeople(await msgGet(`/api/v1/fiarep/messages/people?q=${encodeURIComponent(text.trim())}`)); } catch { setPeople([]); }
  }
  async function start(id: string) {
    setStarting(id);
    try { const r = await msgPost<{ threadId: string }>(`/api/v1/fiarep/messages/people/${encodeURIComponent(id)}/start`, {}); setQ(''); setPeople([]); await load(); setOpenId(r.threadId); }
    catch (e: any) { Alert.alert('Could not start it', e?.data?.error || e?.message || 'Try again.'); }
    finally { setStarting(''); }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await msgGet<Row[]>('/api/v1/fiarep/messages')); }
    catch (e: any) { Alert.alert('Could not load messages', e?.data?.error || e?.message || 'Try again.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function issue() {
    if (!name.trim()) { Alert.alert('Who is the code for?'); return; }
    setBusy(true);
    try {
      const r = await msgPost<{ code: string }>('/api/v1/fiarep/messages/codes', { contactName: name.trim(), address: address.trim(), apartment: apartment.trim() });
      setIssued({ code: r.code, who: name.trim() }); setName(''); setAddress(''); setApartment('');
      await load();
    } catch (e: any) { Alert.alert('Could not make a code', e?.data?.error || e?.message || 'Try again.'); }
    finally { setBusy(false); }
  }

  async function close(id: string) {
    try { await msgPost(`/api/v1/fiarep/messages/${encodeURIComponent(id)}/close`, {}); if (openId === id) setOpenId(''); await load(); }
    catch (e: any) { Alert.alert('Could not block them', e?.data?.error || e?.message || 'Try again.'); }
  }


  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 16 }]} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
      <Text style={ui.label}>Hand someone a code and they can write to you - in the app or on the website - and to nobody else. Only you read it.</Text>
      <View style={[ui.card, { gap: 8 }]}>
        <Text style={{ fontWeight: '700' }}>Find a person</Text>
        <TextInput style={ui.input} value={q} onChangeText={(t) => void find(t)} placeholder="Type their name" autoCorrect={false} />
        {q.trim().length >= 2 && people.length === 0 && <Text style={ui.listSub}>Nobody signed up under that name yet.</Text>}
        {people.map((p) => (
          <Pressable key={p.id} onPress={() => void start(p.id)} disabled={!!starting} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#eee' }}>
            <Text style={{ fontWeight: '600' }}>{starting === p.id ? 'Opening…' : p.name}</Text>
            <Text style={ui.listSub}>{[p.building, p.apartment ? `Apt ${p.apartment}` : ''].filter(Boolean).join(' · ') || 'Signed up in the app'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[ui.card, { gap: 8 }]}>
        <Text style={{ fontWeight: '700' }}>Hand out a code</Text>
        <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="Who is it for" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={[ui.input, { flex: 1 }]} value={address} onChangeText={setAddress} placeholder="Address (optional)" />
          <TextInput style={[ui.input, { width: 80 }]} value={apartment} onChangeText={setApartment} placeholder="Apt" />
        </View>
        <Pressable style={[ui.btn, (busy || !name.trim()) && ui.btnMuted]} disabled={busy || !name.trim()} onPress={() => void issue()}>
          <Text style={ui.btnText}>{busy ? 'Making…' : 'Make a code'}</Text>
        </Pressable>
        {issued && (
          <View style={{ backgroundColor: '#f3f4f6', borderRadius: 10, padding: 14, alignItems: 'center', gap: 6 }}>
            <Text style={ui.label}>Code for {issued.who}</Text>
            <Text selectable style={{ fontSize: 28, fontWeight: '800', letterSpacing: 4 }}>{issued.code}</Text>
            <Text style={[ui.listSub, { textAlign: 'center' }]}>They open the FIAREP app, press Message FIAREP and type this in. It is shown once.</Text>
            <Pressable onPress={() => setIssued(null)}><Text style={{ color: '#666' }}>Done</Text></Pressable>
          </View>
        )}
      </View>

      {rows.length === 0 && !loading && <Text style={ui.empty}>Nobody has written yet.</Text>}
      {rows.map((r) => (
        <View key={r.id} style={[ui.card, { gap: 6 }]}>
          <Pressable onPress={() => setOpenId(openId === r.id ? '' : r.id)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontWeight: '700', flexShrink: 1 }}>{r.who || 'Unnamed'}</Text>
              {r.kind === 'client' && <Text style={{ backgroundColor: '#dbeafe', color: '#1e40af', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>Client company</Text>}
              {r.closed && <Text style={{ backgroundColor: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>Blocked</Text>}
              {r.unread > 0 && <Text style={{ backgroundColor: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>{r.unread} new</Text>}
            </View>
            <Text style={ui.listSub} numberOfLines={1}>{[r.address, r.apartment ? `Apt ${r.apartment}` : '', r.last].filter(Boolean).join(' · ')}</Text>
            <Text style={[ui.listSub, { fontSize: 11 }]}>{when(r.lastAt)}</Text>
          </Pressable>
          {openId === r.id && (
            <OpenThread id={r.id} onSent={load} closed={r.closed}
              footer={r.kind === 'code' && !r.closed ? (
                <Pressable onPress={() => Alert.alert(`Block ${r.who || 'this person'}?`, 'Their code stops working and they can no longer message you.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Block', style: 'destructive', onPress: () => void close(r.id) },
                ])}><Text style={{ color: '#b91c1c', fontWeight: '600' }}>Block this person</Text></Pressable>
              ) : null} />
          )}
        </View>
      ))}
    </ScrollView>
  );
}

/** One open conversation. Its load / send are stable so the thread does not refetch on every render. */
function OpenThread({ id, closed, onSent, footer }: { id: string; closed: boolean; onSent: () => Promise<void>; footer?: React.ReactNode }) {
  const load = useCallback(async (): Promise<ChatMessage[]> => {
    const r = await msgGet<Full>(`/api/v1/fiarep/messages/${encodeURIComponent(id)}`);
    return r.messages.map((m) => ({ id: m.id, mine: m.from === 'fiarep', author: m.authorName, body: m.body, at: m.at }));
  }, [id]);
  const send = useCallback(async (body: string) => { await msgPost(`/api/v1/fiarep/messages/${encodeURIComponent(id)}`, { body }); await onSent(); }, [id, onSent]);
  return <ChatThread load={load} send={send} closed={closed} footer={footer} />;
}
