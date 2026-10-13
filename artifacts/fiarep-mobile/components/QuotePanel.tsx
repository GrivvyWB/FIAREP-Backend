import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { ui, money } from '../lib/ui';

// What FIAREP's technician says the job needs bought, and the client's answer.
// The same panel the client has on the website, so management can approve from
// the phone without going to a desk. The resident never sees any of it: it is
// not in the status page's fields and never enters their updates.

type QuoteLine = { id: string; label: string; unit: string; qty: number; unitPrice: number; amount: number; note?: string };
type Quote = {
  lines: QuoteLine[]; total: number; status: 'pending' | 'approved' | 'declined';
  sentBy?: string; sentAt?: string; decidedBy?: string; decidedAt?: string; note?: string;
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const quoteOf = (record: unknown): Quote | null => {
  const q = (record as Record<string, unknown> | null)?.['quote'];
  return q && typeof q === 'object' && !Array.isArray(q) ? (q as Quote) : null;
};

export default function QuotePanel({ reportId, quote, canDecide, onChanged }: {
  reportId: string;
  quote: Quote;
  canDecide: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'approve' | 'decline') {
    setBusy(true);
    try {
      await customFetch(`/api/v1/resident-reports/${encodeURIComponent(reportId)}/quote/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }), responseType: 'json',
      } as never);
      setNote('');
      await onChanged();
      Alert.alert(decision === 'approve' ? 'Approved' : 'Declined', decision === 'approve'
        ? 'FIAREP can start. Their technician has been told.'
        : 'FIAREP has been told, with your reason.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.data?.error || e?.message || 'Check your connection and try again.');
    } finally { setBusy(false); }
  }

  const pending = quote.status === 'pending';
  const tone = quote.status === 'approved' ? '#065f46' : quote.status === 'declined' ? '#991b1b' : '#92400e';
  const bg = quote.status === 'approved' ? '#ecfdf5' : quote.status === 'declined' ? '#fef2f2' : '#fffbeb';

  return (
    <View style={[ui.card, { gap: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[ui.cardTitle, { marginBottom: 0, flex: 1 }]}>What FIAREP needs to buy</Text>
        <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ color: tone, fontWeight: '700', fontSize: 12 }}>
            {quote.status === 'approved' ? 'Approved' : quote.status === 'declined' ? 'Declined' : 'Waiting for you'}
          </Text>
        </View>
      </View>

      {quote.lines.map((l) => (
        <View key={l.id} style={ui.line}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={ui.lineV}>{l.label}</Text>
            <Text style={ui.listSub}>{l.qty} × {money(l.unitPrice)} {l.unit}{l.note ? ` · ${l.note}` : ''}</Text>
          </View>
          <Text style={ui.lineV}>{money(l.amount)}</Text>
        </View>
      ))}
      <View style={ui.totalRow}>
        <Text style={ui.totalK}>Total</Text>
        <Text style={ui.totalV}>{money(quote.total)}</Text>
      </View>
      <Text style={ui.listSub}>
        Priced by FIAREP{quote.sentBy ? ` · ${quote.sentBy}` : ''}{quote.sentAt ? ` · ${when(quote.sentAt)}` : ''}.
        {pending ? ' Work does not start until you approve.' : ''}
      </Text>

      {pending && canDecide && (
        <>
          <TextInput style={ui.input} value={note} onChangeText={setNote} placeholder="If you are declining, say why (optional)" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[ui.btn, { flex: 1 }, busy && ui.btnMuted]} disabled={busy} onPress={() => void decide('approve')}>
              <Text style={ui.btnText}>{busy ? 'Sending…' : `Approve ${money(quote.total)}`}</Text>
            </Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1 }, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => void decide('decline')}>
              <Text style={ui.btnOutlineText}>Decline</Text>
            </Pressable>
          </View>
        </>
      )}
      {!pending && (
        <Text style={ui.listSub}>
          {quote.status === 'approved' ? 'Approved' : 'Declined'}{quote.decidedBy ? ` by ${quote.decidedBy}` : ''}{quote.decidedAt ? ` · ${when(quote.decidedAt)}` : ''}{quote.note ? ` · ${quote.note}` : ''}
        </Text>
      )}
    </View>
  );
}
