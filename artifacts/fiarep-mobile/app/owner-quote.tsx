import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';
import { ui, ACCENT, money } from '../lib/ui';

// A quote FIAREP sent this company: every part, how many, the price, and
// Approve / Turn down. Opened from the "FIAREP needs approval" alert.
type Line = { id: string; label: string; unit: string; qty: number; unitPrice: number; amount: number; note: string };
type Quote = { id?: string; lines: Line[]; total: number; status: string; building: string; note: string; sentAt: string; sentBy: string; decidedBy: string; decidedAt: string };
type Row = { projectId: string; quote: Quote };

const STATUS: Record<string, string> = { pending: 'Waiting for your approval', approved: 'Approved', declined: 'Turned down' };

export default function OwnerQuote() {
  const router = useRouter();
  const { project, quote: quoteId } = useLocalSearchParams<{ project?: string; quote?: string }>();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await customFetch<Row[]>(`/api/v1/owner/quotes${project ? `?project=${encodeURIComponent(String(project))}` : ''}`, { responseType: 'json' } as never);
      // The quote the alert was about first, then the rest on that building.
      setRows(quoteId ? [...list.filter((r) => r.quote.id === quoteId), ...list.filter((r) => r.quote.id !== quoteId)] : list);
    } catch (e: any) { setRows([]); Alert.alert('Quote', e?.data?.error || e?.message || 'Check your connection and try again.'); }
  }, [project, quoteId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function decide(r: Row, decision: 'approve' | 'decline') {
    if (!r.quote.id) return;
    setBusy(r.quote.id + decision);
    try {
      await customFetch(`/api/v1/owner/quotes/${encodeURIComponent(r.projectId)}/${encodeURIComponent(r.quote.id)}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, responseType: 'json',
        body: JSON.stringify({ decision, note: (notes[r.quote.id] || '').trim() }),
      } as never);
      await load();
    } catch (e: any) { Alert.alert('Not done', e?.data?.error || e?.message || 'Try again.'); }
    finally { setBusy(''); }
  }

  if (rows === null) return <View style={[ui.wrap, { alignItems: 'center' }]}><ActivityIndicator /></View>;
  return (
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      {rows.length === 0 && <Text style={ui.label}>No quote from FIAREP here.</Text>}
      {rows.map((r) => (
        <View key={r.quote.id || r.quote.sentAt} style={[ui.card, { gap: 8, marginBottom: 14 }]}>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{r.quote.building}</Text>
          <Text style={{ fontWeight: '700', color: r.quote.status === 'approved' ? '#047857' : r.quote.status === 'declined' ? '#991b1b' : '#b45309' }}>{STATUS[r.quote.status] || r.quote.status}</Text>
          {r.quote.lines.map((l) => (
            <View key={l.id} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>{l.qty} × {l.label}</Text>
                <Text style={ui.listSub}>{money(l.unitPrice)} {l.unit}{l.note ? ` · ${l.note}` : ''}</Text>
              </View>
              <Text style={{ fontWeight: '700' }}>{money(l.amount)}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row' }}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>Total</Text>
            <Text style={{ marginLeft: 'auto', fontWeight: '800', fontSize: 16 }}>{money(r.quote.total)}</Text>
          </View>
          {!!r.quote.note && <Text style={ui.listSub}>FIAREP: {r.quote.note}</Text>}
          {r.quote.status === 'pending' && r.quote.id ? (
            <>
              <TextInput style={ui.input} value={notes[r.quote.id] || ''} onChangeText={(v) => setNotes((n) => ({ ...n, [r.quote.id!]: v }))} placeholder="Note to FIAREP (optional)" />
              <Pressable style={[ui.btn, !!busy && ui.btnMuted]} disabled={!!busy} onPress={() => void decide(r, 'approve')}>
                <Text style={ui.btnText}>{busy === r.quote.id + 'approve' ? 'Approving…' : `Approve ${money(r.quote.total)}`}</Text>
              </Pressable>
              <Pressable style={{ paddingVertical: 8 }} disabled={!!busy} onPress={() => void decide(r, 'decline')}>
                <Text style={{ color: '#991b1b', fontWeight: '700', textAlign: 'center' }}>{busy === r.quote.id + 'decline' ? 'Turning it down…' : 'Turn it down'}</Text>
              </Pressable>
            </>
          ) : r.quote.decidedBy ? <Text style={ui.listSub}>{STATUS[r.quote.status]} by {r.quote.decidedBy}{r.quote.decidedAt ? ` · ${new Date(r.quote.decidedAt).toLocaleString()}` : ''}</Text> : null}
        </View>
      ))}
      <Pressable onPress={() => router.back()} style={{ padding: 14 }}><Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Back</Text></Pressable>
    </ScrollView>
  );
}
