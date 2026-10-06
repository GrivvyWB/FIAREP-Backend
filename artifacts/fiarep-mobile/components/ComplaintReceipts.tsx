import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert } from 'react-native';
import { customFetch, getEntityRecord } from '@workspace/api-client-react';
import { ui, ACCENT } from '../lib/ui';
import { getCurrentActor } from '../lib/store';
import { Chips } from '../lib/community-ui';

type Receipt = { id: string; name: string; position: string; at: string };
type Eta = { eta: string; crew: string; note: string; byName: string; byPosition: string; at: string };
const list = (v: unknown): Receipt[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : []);
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/**
 * Who was told, who opened it (green / red light), and "on my way".
 * Showing it marks the complaint as opened by this person; whoever sent it
 * is told. Reads the live record from the server (the phone's offline copy
 * doesn't carry receipts).
 */
export default function ComplaintReceipts({ entity, reportId, canSendEta, readOnly }: {
  entity: 'resident-reports' | 'building-violations';
  reportId: string;
  canSendEta: boolean;
  readOnly?: boolean;
}) {
  const [role, setRole] = useState('');
  const [notified, setNotified] = useState<Receipt[]>([]);
  const [opens, setOpens] = useState<Receipt[]>([]);
  const [eta, setEta] = useState<Eta | null>(null);
  const [options, setOptions] = useState<{ eta: string[]; crew: string[] }>({ eta: [], crew: [] });
  const [pickEta, setPickEta] = useState('');
  const [pickCrew, setPickCrew] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const actor = await getCurrentActor().catch(() => ({ role: '' } as any));
      if (alive) setRole(actor.role || '');
      try {
        const live = await getEntityRecord(entity, reportId) as any;
        if (!alive) return;
        setNotified(list(live?.state?.notifiedStaff));
        setOpens(list(live?.state?.opens));
        setEta((live?.state?.eta as Eta) || null);
      } catch { /* offline: nothing to show */ }
      try {
        const r = await customFetch<{ opens: Receipt[] }>(`/api/v1/${entity}/${encodeURIComponent(reportId)}/opened`, { method: 'POST', responseType: 'json' } as never);
        if (alive && Array.isArray(r?.opens) && r.opens.length) setOpens(r.opens);
      } catch { /* offline */ }
      if (canSendEta) {
        try { const o = await customFetch<{ eta: string[]; crew: string[] }>('/api/v1/eta-options', { responseType: 'json' } as never); if (alive) setOptions(o); } catch { /* offline */ }
      }
    })();
    return () => { alive = false; };
  }, [entity, reportId, canSendEta]);

  async function sendEta() {
    if (!pickEta && !pickCrew) { Alert.alert('Pick a time or a crew'); return; }
    setBusy(true);
    try {
      const r = await customFetch<{ eta: Eta }>(`/api/v1/${entity}/${encodeURIComponent(reportId)}/eta`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eta: pickEta, crew: pickCrew, note: note.trim() }), responseType: 'json',
      } as never);
      setEta(r.eta); setPickEta(''); setPickCrew(''); setNote('');
      Alert.alert('Sent', [r.eta.eta, r.eta.crew ? `${r.eta.crew} on the way` : ''].filter(Boolean).join(' · '));
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Check your connection and try again.');
    } finally { setBusy(false); }
  }

  const isManagement = role === 'management' || role === 'administrator';
  const openedBy = (id: string) => opens.find((o) => o.id === id);
  const people = [...notified, ...opens.filter((o) => !notified.some((n) => n.id === o.id)).map((o) => ({ ...o, at: '' }))];
  if (!isManagement && !canSendEta && !eta) return null;

  return (
    <View style={[ui.card, { gap: 10 }]}>
      {eta && (
        <View style={{ borderWidth: 1, borderColor: '#6ee7b7', backgroundColor: '#ecfdf5', borderRadius: 8, padding: 8 }}>
          <Text style={{ fontWeight: '700', color: '#065f46' }}>⏱ {eta.eta}{eta.crew ? ` · ${eta.crew} on the way` : ''}</Text>
          <Text style={{ fontSize: 12, color: '#065f46' }}>{eta.byName} ({eta.byPosition}) · {when(eta.at)}{eta.note ? ` · ${eta.note}` : ''}</Text>
        </View>
      )}
      {isManagement && (
        <View>
          <Text style={ui.cardTitle}>Who opened it</Text>
          {people.length === 0 ? <Text style={ui.listSub}>Nobody has been sent this yet.</Text> : people.map((p) => {
            const o = openedBy(p.id);
            return (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: o ? '#10b981' : '#ef4444' }} />
                <Text style={{ fontWeight: '600' }}>{p.name}</Text>
                <Text style={{ color: '#666', flex: 1 }} numberOfLines={1}>{p.position}</Text>
                <Text style={{ fontSize: 12, color: o ? '#065f46' : '#991b1b' }}>{o ? `opened ${when(o.at)}` : 'never opened'}</Text>
              </View>
            );
          })}
        </View>
      )}
      {canSendEta && !readOnly && (
        <View style={{ gap: 8 }}>
          <Text style={ui.cardTitle}>Let them know you're coming</Text>
          <Text style={ui.label}>When</Text>
          <Chips options={options.eta} value={pickEta} onChange={(v) => setPickEta(v === pickEta ? '' : v)} wrap />
          <Text style={ui.label}>Who's coming (optional)</Text>
          <Chips options={options.crew} value={pickCrew} onChange={(v) => setPickCrew(v === pickCrew ? '' : v)} wrap />
          <TextInput style={ui.input} value={note} onChangeText={setNote} placeholder="Note (optional)" />
          <Pressable style={[ui.btn, (busy || (!pickEta && !pickCrew)) && ui.btnMuted]} disabled={busy || (!pickEta && !pickCrew)} onPress={() => void sendEta()}>
            <Text style={ui.btnText}>{busy ? 'Sending…' : 'Send — on the way'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
