import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';
import { ui, ACCENT, money } from '../lib/ui';

// Monthly bills. Every receipt FIAREP purchases is kept; every 30 days each
// client gets one bill, building by building, with the total owed. FIAREP
// sees every client's; a client sees its own.
type Item = { projectId: string; quoteId: string; building: string; purchasedAt: string; lines: Array<{ qty: number; label: string; amount: number }>; total: number; paid: boolean; carried: boolean };
type Statement = {
  id: string; clientTenantId: string; clientCompany: string; periodStart: string; periodEnd: string;
  buildings: Array<{ building: string; items: Item[]; spent: number; owed: number }>;
  spent: number; paidBack: number; carried: number; owed: number;
};
type Open = { clientTenantId: string; clientCompany: string; owed: number; receipts: number; billDue: string | null };

const day = (iso: string) => new Date(iso).toLocaleDateString();

export default function Bills() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [statements, setStatements] = useState<Statement[] | null>(null);
  const [open, setOpen] = useState<Open[]>([]);
  const [shown, setShown] = useState<string>(String(id || ''));
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const get = <T,>(url: string) => customFetch<T>(url, { responseType: 'json' } as never);
    try {
      const r = await get<{ statements: Statement[]; open: Open[] }>('/api/v1/fiarep/statements');
      setStatements(r.statements); setOpen(r.open);
    } catch {
      try {
        const r = await get<{ statements: Statement[]; open: Open | null }>('/api/v1/owner/statements');
        setStatements(r.statements); setOpen(r.open ? [r.open] : []);
      } catch { setStatements([]); setOpen([]); }
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (statements === null) return <View style={[ui.wrap, { alignItems: 'center' }]}><ActivityIndicator /></View>;
  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingBottom: 48 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {open.map((o) => (
        <View key={o.clientTenantId} style={[ui.card, { gap: 4, marginBottom: 10 }]}>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{o.clientCompany}</Text>
          <View style={{ flexDirection: 'row' }}>
            <Text style={ui.listSub}>Owed now · {o.receipts} receipt{o.receipts === 1 ? '' : 's'}</Text>
            <Text style={{ marginLeft: 'auto', fontWeight: '800', fontSize: 16 }}>{money(o.owed)}</Text>
          </View>
          {!!o.billDue && <Text style={ui.listSub}>Next bill {day(o.billDue)}</Text>}
        </View>
      ))}
      <Text style={[ui.label, { marginTop: 8 }]}>Bills</Text>
      {statements.length === 0 && <Text style={ui.listSub}>No bill yet.</Text>}
      {statements.map((s) => (
        <View key={s.id} style={[ui.card, { gap: 6, marginBottom: 12 }]}>
          <Pressable onPress={() => setShown(shown === s.id ? '' : s.id)} style={{ gap: 2 }}>
            <Text style={{ fontWeight: '800' }}>{s.clientCompany}</Text>
            <View style={{ flexDirection: 'row' }}>
              <Text style={ui.listSub}>{day(s.periodStart)} – {day(s.periodEnd)}</Text>
              <Text style={{ marginLeft: 'auto', fontWeight: '800', color: s.owed > 0 ? '#b45309' : '#047857' }}>{money(s.owed)} owed</Text>
            </View>
          </Pressable>
          {shown === s.id && (
            <>
              {s.buildings.map((b) => (
                <View key={b.building} style={{ gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#eee' }}>
                  <Text style={{ fontWeight: '700' }}>{b.building}</Text>
                  {b.items.map((i) => (
                    <View key={i.quoteId} style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text>{day(i.purchasedAt)}{i.carried ? ' · earlier bill' : ''}</Text>
                        <Text style={ui.listSub}>{i.lines.map((l) => `${l.qty} × ${l.label}`).join(', ')}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontWeight: '700' }}>{money(i.total)}</Text>
                        <Text style={{ fontSize: 12, color: i.paid ? '#047857' : '#b45309' }}>{i.paid ? 'Paid' : 'Owed'}</Text>
                      </View>
                    </View>
                  ))}
                  <Text style={[ui.listSub, { textAlign: 'right' }]}>Building owed {money(b.owed)}</Text>
                </View>
              ))}
              <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6, gap: 2 }}>
                <Row k="Spent this period" v={money(s.spent)} />
                <Row k="Paid back" v={money(s.paidBack)} />
                {s.carried > 0 && <Row k="From earlier bills" v={money(s.carried)} />}
                <Row k="Total owed" v={money(s.owed)} bold />
              </View>
            </>
          )}
          {shown !== s.id && <Pressable onPress={() => setShown(s.id)}><Text style={{ color: ACCENT, fontWeight: '700' }}>Open</Text></Pressable>}
        </View>
      ))}
    </ScrollView>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <Text style={bold ? { fontWeight: '800' } : ui.listSub}>{k}</Text>
      <Text style={[{ marginLeft: 'auto' }, bold ? { fontWeight: '800', fontSize: 16 } : null]}>{v}</Text>
    </View>
  );
}
