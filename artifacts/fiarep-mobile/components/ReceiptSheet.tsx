// The quote receipt, drawn on the screen. Tapping Receipt used to go straight
// to the share sheet, so the only way to look at it was to send it somewhere
// first. Now it opens here; Share or print is a button on the sheet.
import { useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  quoteReceiptHtml, receiptNumber, receiptStatus, receiptMoney, receiptDay,
  RECEIPT_TAGLINE, RECEIPT_FOOTER, type Receipt,
} from '../lib/quote-receipt';
import { ACCENT } from '../lib/ui';

const NAVY = '#0B1F3A';
const GREY = '#475569';
const TONES = {
  ok: { bg: '#ECFDF5', border: '#059669', fg: '#065F46' },
  no: { bg: '#FEF2F2', border: '#DC2626', fg: '#991B1B' },
  wait: { bg: '#FFFBEB', border: '#F59E0B', fg: '#92400E' },
} as const;

export default function ReceiptSheet({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  const [sharing, setSharing] = useState(false);
  const r = receipt;

  async function share() {
    if (!r) return;
    setSharing(true);
    try {
      const html = quoteReceiptHtml(r);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Quote receipt', UTI: 'com.adobe.pdf' });
      } else {
        await Print.printAsync({ html });
      }
    } catch (e: any) {
      Alert.alert('Could not make the receipt', String(e?.message || e));
    } finally { setSharing(false); }
  }

  const status = r ? receiptStatus(r) : null;
  const tone = status ? TONES[status.tone] : TONES.wait;

  return (
    <Modal visible={!!r} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={st.bar}>
          <Text style={st.barTitle}>Receipt</Text>
          <Pressable onPress={onClose} hitSlop={12} style={st.done}><Text style={st.doneText}>Done</Text></Pressable>
        </View>
        {r && status && (
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
            <View style={st.head}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={st.brand}>FIA<Text style={{ color: '#D97706' }}>REP</Text></Text>
                <Text style={st.small}>{RECEIPT_TAGLINE}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[st.small, { fontWeight: '700', color: NAVY }]}>{receiptNumber(r)}</Text>
                {!!r.sentAt && <Text style={st.small}>{receiptDay(r.sentAt)}</Text>}
              </View>
            </View>

            <Text style={st.h1}>{r.building || 'Receipt'}</Text>
            <Text style={st.meta}>{r.clientCompany ? `${r.clientCompany} · ` : ''}Priced by {r.sentBy || 'FIAREP'}</Text>
            <View style={[st.pill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
              <Text style={{ color: tone.fg, fontWeight: '700', fontSize: 14 }}>
                {status.text}{r.decidedAt ? ` · ${receiptDay(r.decidedAt)}` : ''}
              </Text>
            </View>

            <View style={[st.row, { borderBottomColor: NAVY, marginTop: 14 }]}>
              <Text style={[st.th, { flex: 1 }]}>What the job needs</Text>
              <Text style={[st.th, st.qty]}>Qty</Text>
              <Text style={[st.th, st.each]}>Each</Text>
              <Text style={[st.th, st.amt]}>Amount</Text>
            </View>
            {r.lines.map((l) => (
              <View key={l.id} style={st.row}>
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={st.td}>{l.label}</Text>
                  {!!l.note && <Text style={st.note}>{l.note}</Text>}
                </View>
                <Text style={[st.td, st.qty]}>{l.qty}</Text>
                <View style={st.each}>
                  <Text style={[st.td, { textAlign: 'right' }]}>{receiptMoney(l.unitPrice)}</Text>
                  {!!l.unit && <Text style={[st.note, { textAlign: 'right' }]}>{l.unit}</Text>}
                </View>
                <Text style={[st.td, st.amt, { fontWeight: '700' }]}>{receiptMoney(l.amount)}</Text>
              </View>
            ))}
            <View style={st.total}>
              <Text style={st.totalText}>Total</Text>
              <Text style={st.totalText}>{receiptMoney(r.total)}</Text>
            </View>

            {!!r.note && <Text style={[st.td, { marginTop: 12 }]}>{r.note}</Text>}

            <View style={st.foot}>
              <Text style={st.small}>{RECEIPT_FOOTER}</Text>
              <Text style={[st.small, { marginTop: 6 }]}>fiarep@outlook.com · fiarep.com</Text>
            </View>
          </ScrollView>
        )}
        <View style={st.actions}>
          <Pressable onPress={() => void share()} disabled={sharing} style={[st.shareBtn, sharing && { opacity: 0.6 }]}>
            <Text style={st.shareText}>{sharing ? 'Making it…' : 'Share or print'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  barTitle: { fontSize: 17, fontWeight: '600', color: NAVY },
  done: { position: 'absolute', right: 16, top: 14 },
  doneText: { color: ACCENT, fontSize: 17, fontWeight: '600' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 2, borderBottomColor: NAVY, paddingBottom: 10 },
  brand: { fontSize: 26, fontWeight: '800', color: NAVY, letterSpacing: 0.5 },
  small: { fontSize: 13, color: GREY, lineHeight: 18 },
  h1: { fontSize: 19, fontWeight: '700', color: NAVY, marginTop: 18 },
  meta: { fontSize: 14, color: GREY, marginTop: 2, marginBottom: 12 },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  th: { fontSize: 12, fontWeight: '600', color: GREY, textTransform: 'uppercase', letterSpacing: 0.6 },
  td: { fontSize: 15, color: NAVY },
  note: { fontSize: 13, color: '#64748b', marginTop: 2 },
  qty: { width: 40, textAlign: 'right' },
  each: { width: 88, alignItems: 'flex-end', textAlign: 'right' },
  amt: { width: 92, textAlign: 'right' },
  total: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: NAVY, paddingVertical: 10, marginTop: 2 },
  totalText: { fontSize: 19, fontWeight: '800', color: NAVY },
  foot: { marginTop: 22, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 10 },
  actions: { padding: 16, paddingBottom: 34, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  shareBtn: { backgroundColor: ACCENT, padding: 14, borderRadius: 10, alignItems: 'center' },
  shareText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
