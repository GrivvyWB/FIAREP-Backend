import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { takePhoto, pickPhoto, photoUri, uploadPhoto } from '../lib/photos';
import { quoteReceiptHtml, type Receipt } from '../lib/quote-receipt';
import { PickOne } from '../lib/community-ui';
import { ui, ACCENT, money } from '../lib/ui';

// Quick quote. Walk a building, see what has to be replaced, price it off the
// repair book and either send it to the owner or approve it on the spot.
//
// It is priced against a BUILDING, never a project: a project made on this
// phone may not have reached the server yet. The server opens or reuses a
// project behind the building so the photographs have somewhere to live.
//
// The phone sends the item and how many. The server prices it, so a price can
// never be typed in on site.

type CatalogLine = { key: string; label: string; price: number; unit: string; group: string };
type Building = { id: string; address: string; city: string | null; state: string | null; organizationId: string; company: string | null };
type Client = { id: string; name: string };
type Draft = { key: string; label: string; unit: string; price: number; qty: string; note: string; photo: string };
type QuickLine = { id: string; label: string; unit: string; qty: number; unitPrice: number; amount: number; note: string };
type QuickQuote = {
  lines: QuickLine[]; total: number; status: string; approvedBySelf: boolean; clientCompany: string;
  building: string; note: string; sentBy: string; sentAt: string; decidedBy: string; decidedAt: string;
};

const get = <T,>(url: string) => customFetch<T>(url, { responseType: 'json' } as never);
const post = <T,>(url: string, body: unknown) => customFetch<T>(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), responseType: 'json',
} as never);

export default function QuickQuoteScreen() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogLine[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [place, setPlace] = useState('');
  const [typed, setTyped] = useState('');
  const [company, setCompany] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState<QuickQuote | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = await get<{ catalog: CatalogLine[] }>('/api/v1/pricing');
      setCatalog(Array.isArray(p?.catalog) ? p.catalog : []);
    } catch { setError('Could not load the price book. Connect to the internet and pull down.'); }
    try { setBuildings(await get<Building[]>('/api/v1/fiarep/buildings')); } catch { /* an address can still be typed */ }
    try { setClients(await get<Client[]>('/api/v1/fiarep/clients')); } catch { /* sending needs it; approving does not */ }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const label = (b: Building) => [b.address, [b.city, b.state].filter(Boolean).join(', '), b.company].filter(Boolean).join(' · ');
  const total = drafts.reduce((n, d) => n + d.price * (Number(d.qty) || 0), 0);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as CatalogLine[];
    return catalog.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)).slice(0, 10);
  }, [catalog, search]);

  /** Open a project for this building so the photographs have a home. */
  async function startOn(address: string, forCompany: string, org: string) {
    if (address.trim().length < 3) return;
    setBusy('start');
    try {
      const r = await post<{ projectId: string }>('/api/v1/fiarep/quick-quote/start', { address: address.trim(), company: forCompany });
      setProjectId(r.projectId); setPlace(address.trim()); setCompany(forCompany); setSent(null);
      if (org) setClientId(org);
    } catch (e: any) {
      Alert.alert('Could not open the building', e?.data?.error || e?.message || 'Try again.');
    } finally { setBusy(''); }
  }

  const set = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  async function attach(i: number, from: 'camera' | 'library') {
    if (!projectId) return;
    try {
      const stored = from === 'camera' ? await takePhoto() : await pickPhoto();
      if (stored) set(i, { photo: stored });
    } catch (e: any) { Alert.alert('Photo', String(e?.message || e)); }
  }

  async function remove() {
    if (!projectId) return;
    Alert.alert('Delete this quote?', 'It goes for good. If this building was only opened for the quote, it goes too.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void (async () => {
        setBusy('delete');
        try {
          await customFetch(`/api/v1/fiarep/projects/${encodeURIComponent(projectId)}/quick-quote`, { method: 'DELETE', responseType: 'json' } as never);
          setSent(null); setDrafts([]); setProjectId(''); setPlace(''); setTyped('');
          await load();
        } catch (e: any) {
          Alert.alert('Could not delete it', e?.data?.error || e?.message || 'Try again.');
        } finally { setBusy(''); }
      })() },
    ]);
  }

  // The owner gets a piece of paper either way — including when FIAREP
  // approved it themselves, so there is a record to hand over.
  async function receipt() {
    if (!sent) return;
    setBusy('receipt');
    try {
      const html = quoteReceiptHtml({ ...sent, building: sent.building || place } as Receipt);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Quote receipt', UTI: 'com.adobe.pdf' });
      } else {
        await Print.printAsync({ html });
      }
    } catch (e: any) {
      Alert.alert('Could not make the receipt', String(e?.message || e));
    } finally { setBusy(''); }
  }

  async function send(mode: 'self' | 'client') {
    if (!projectId) { Alert.alert('Pick the building first'); return; }
    if (drafts.length === 0) { Alert.alert('Add at least one item'); return; }
    for (const d of drafts) {
      const n = Number(d.qty);
      if (!Number.isFinite(n) || n <= 0) { Alert.alert('How many?', `Enter a quantity for ${d.label}.`); return; }
    }
    if (mode === 'client' && !clientId) { Alert.alert('Pick the company that approves it'); return; }
    setBusy(mode);
    try {
      const lines = [] as Array<{ key: string; qty: number; note: string; photo: string }>;
      for (const d of drafts) {
        let objectPath = '';
        if (d.photo) {
          try { const f = await uploadPhoto(d.photo, 'room-photo', { entity: 'projects', recordId: projectId }); objectPath = f.objectPath; }
          catch { /* the line still goes; the photo can be added again */ }
        }
        lines.push({ key: d.key, qty: Number(d.qty), note: d.note.trim(), photo: objectPath });
      }
      const saved = await post<QuickQuote>(`/api/v1/fiarep/projects/${encodeURIComponent(projectId)}/quick-quote`, {
        mode, clientTenantId: mode === 'client' ? clientId : '', note: note.trim(), building: place, lines,
      });
      setDrafts([]); setNote(''); setSent(saved);
      Alert.alert(mode === 'self' ? 'Approved — go ahead' : 'Sent to the owner',
        mode === 'self' ? 'Recorded against the building in your name.' : 'Their management have been told.');
    } catch (e: any) {
      Alert.alert('Not sent', e?.data?.error || e?.message || 'Check your connection and try again.');
    } finally { setBusy(''); }
  }

  return (
    <ScrollView
      contentContainerStyle={[ui.wrap, { paddingTop: 16, paddingBottom: 48 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      <Text style={ui.label}>
        What this building needs replacing or fixing, priced off FIAREP's book. Send it to the owner, or approve it yourself when it is small enough to just do.
      </Text>
      {!!error && <Text style={{ color: '#991b1b' }}>{error}</Text>}

      <Text style={[ui.label, { marginTop: 12 }]}>Building</Text>
      <PickOne
        options={buildings.map(label)}
        value={buildings.find((b) => label(b) === place) ? place : ''}
        onChange={(v) => {
          const b = buildings.find((x) => label(x) === v);
          if (b) void startOn(label(b), b.company || '', b.organizationId);
        }}
        placeholder={buildings.length ? 'Pick a registered building' : 'No registered buildings'}
        title="Which building?"
        clearLabel="None"
      />
      <Text style={ui.listSub}>Not registered? Type the address.</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[ui.input, { flex: 1 }]} value={typed} onChangeText={setTyped} placeholder="1555 Grand Concourse" />
        <Pressable style={[ui.btnOutline, { justifyContent: 'center' }]} disabled={busy === 'start' || typed.trim().length < 3} onPress={() => void startOn(typed, '', '')}>
          <Text style={ui.btnOutlineText}>{busy === 'start' ? 'Opening…' : 'Use this'}</Text>
        </Pressable>
      </View>
      {!!projectId && <Text style={{ color: '#065f46', fontSize: 13 }}>Pricing {place}.</Text>}

      {sent && (
        <View style={[ui.card, { gap: 4, marginTop: 12 }]}>
          <Text style={{ fontWeight: '700' }}>
            Sent — {money(sent.total)} · {sent.status === 'approved' ? (sent.approvedBySelf ? 'approved by FIAREP' : 'approved') : `waiting for ${sent.clientCompany || 'the owner'}`}
          </Text>
          {sent.lines.map((l) => <Text key={l.id} style={ui.listSub}>{l.qty} × {l.label} — {money(l.amount)}</Text>)}
          <Pressable onPress={() => void receipt()} disabled={busy !== ''} style={[ui.btnOutline, { marginTop: 8 }]}>
            <Text style={ui.btnOutlineText}>{busy === 'receipt' ? 'Making it…' : 'Receipt'}</Text>
          </Pressable>
          <Pressable onPress={() => void remove()} disabled={busy !== ''} style={{ paddingVertical: 8 }}>
            <Text style={{ color: '#991b1b', fontWeight: '700' }}>{busy === 'delete' ? 'Deleting…' : 'Delete this quote'}</Text>
          </Pressable>
        </View>
      )}

      {!!projectId && (
        <>
          <Text style={[ui.label, { marginTop: 14 }]}>Add what it needs</Text>
          <TextInput style={ui.input} value={search} onChangeText={setSearch} placeholder="Window, sink, leak, fixture…" autoCorrect={false} />
          {matches.map((m) => (
            <Pressable
              key={m.key}
              onPress={() => { setDrafts((d) => [...d, { key: m.key, label: m.label, unit: m.unit, price: m.price, qty: '1', note: '', photo: '' }]); setSearch(''); }}
              style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' }}
            >
              <Text style={{ fontWeight: '600' }}>{m.label}</Text>
              <Text style={ui.listSub}>{money(m.price)} {m.unit} · {m.group}</Text>
            </Pressable>
          ))}

          {drafts.map((d, i) => (
            <View key={`${d.key}-${i}`} style={[ui.card, { marginTop: 12, gap: 8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }}>{d.label}</Text>
                  <Text style={ui.listSub}>{money(d.price)} {d.unit}</Text>
                </View>
                <Pressable onPress={() => setDrafts((x) => x.filter((_, n) => n !== i))} style={{ padding: 6 }}>
                  <Text style={{ color: '#991b1b', fontWeight: '700' }}>Remove</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={ui.label}>How many</Text>
                <TextInput style={[ui.input, { width: 90 }]} value={d.qty} onChangeText={(v) => set(i, { qty: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" />
                <Text style={{ marginLeft: 'auto', fontWeight: '700' }}>{money(d.price * (Number(d.qty) || 0))}</Text>
              </View>
              <TextInput style={ui.input} value={d.note} onChangeText={(v) => set(i, { note: v })} placeholder="Where it is / what is wrong (optional)" />
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Pressable style={[ui.btn, { paddingVertical: 10, paddingHorizontal: 14 }]} onPress={() => void attach(i, 'camera')}><Text style={ui.btnText}>Take a picture</Text></Pressable>
                <Pressable style={[ui.btn, ui.btnMuted, { paddingVertical: 10, paddingHorizontal: 14 }]} onPress={() => void attach(i, 'library')}><Text style={ui.btnText}>Choose</Text></Pressable>
                {!!d.photo && <Image source={{ uri: photoUri(d.photo) }} style={{ width: 44, height: 44, borderRadius: 6 }} />}
              </View>
            </View>
          ))}

          {drafts.length > 0 && (
            <>
              <View style={{ flexDirection: 'row', marginTop: 14 }}>
                <Text style={{ fontWeight: '700', fontSize: 16 }}>Total</Text>
                <Text style={{ marginLeft: 'auto', fontWeight: '700', fontSize: 16 }}>{money(total)}</Text>
              </View>
              <TextInput style={ui.input} value={note} onChangeText={setNote} placeholder="Anything the owner should know (optional)" />
              <Text style={[ui.label, { marginTop: 8 }]}>Company that approves it</Text>
              <PickOne
                options={clients.map((c) => c.name)}
                value={clients.find((c) => c.id === clientId)?.name || ''}
                onChange={(v) => setClientId(clients.find((c) => c.name === v)?.id || '')}
                placeholder="Pick a company"
                title="Who approves it?"
                clearLabel="None"
              />
              <Pressable style={[ui.btn, { marginTop: 10 }, busy !== '' && ui.btnMuted]} disabled={busy !== ''} onPress={() => void send('client')}>
                <Text style={ui.btnText}>{busy === 'client' ? 'Sending…' : `Send ${money(total)} to the owner`}</Text>
              </Pressable>
              <Pressable style={[ui.btnOutline, { marginTop: 8 }, busy !== '' && { opacity: 0.5 }]} disabled={busy !== ''} onPress={() => void send('self')}>
                <Text style={ui.btnOutlineText}>{busy === 'self' ? 'Saving…' : `Approve ${money(total)} myself`}</Text>
              </Pressable>
              <Text style={ui.listSub}>
                Approving it yourself records it in your name and nobody is asked. Sending it tells their management and waits.
              </Text>
            </>
          )}
        </>
      )}

      <Pressable onPress={() => router.back()} style={{ padding: 14, marginTop: 8 }}>
        <Text style={{ color: ACCENT, fontWeight: '700', textAlign: 'center' }}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}
