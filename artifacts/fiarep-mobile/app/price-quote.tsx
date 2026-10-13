import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, RefreshControl } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { customFetch } from '@workspace/api-client-react';
import { getCurrentActor, listResidentReports, type ResidentReport } from '../lib/store';
import { takePhoto, pickPhoto, photoUri, uploadPhoto } from '../lib/photos';
import { PickOne } from '../lib/community-ui';
import { ui, ACCENT, money } from '../lib/ui';

// What the job needs bought, priced on the spot and sent to the CLIENT for
// approval — never to the resident. The phone sends the item and how many;
// the server prices it from the repair price book, so a price can never be
// typed in here. Work on the job is blocked until the client approves.

type CatalogLine = { key: string; label: string; price: number; unit: string; group: string };
type QuoteLine = { id: string; label: string; unit: string; qty: number; unitPrice: number; amount: number; note?: string };
type Quote = { lines: QuoteLine[]; total: number; status: 'pending' | 'approved' | 'declined'; sentBy?: string; sentAt?: string; decidedBy?: string; decidedAt?: string; note?: string };
type Draft = { key: string; label: string; unit: string; price: number; qty: string; note: string; photo: string };

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const quoteOf = (r: any): Quote | null => (r && typeof r.quote === 'object' && !Array.isArray(r.quote) ? r.quote as Quote : null);

export default function PriceQuote() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const [jobs, setJobs] = useState<ResidentReport[]>([]);
  const [jobId, setJobId] = useState(String(params.id || ''));
  const [catalog, setCatalog] = useState<CatalogLine[]>([]);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const me = await getCurrentActor();
      const all = await listResidentReports();
      // Jobs of mine that came from a client company: those are the only ones
      // there is anybody to send a price to.
      const mine = all.filter((r) => r.assignedStaffId === me.id && (r as any).fiarepClient && r.status !== 'resolved');
      setJobs(mine);
      if (!jobId && mine.length === 1) setJobId(mine[0]!.id);
      try {
        const p = await customFetch<{ catalog: CatalogLine[] }>('/api/v1/pricing', { responseType: 'json' } as never);
        setCatalog(Array.isArray(p?.catalog) ? p.catalog : []);
      } catch { setError('Could not load the price book. Connect to the internet and pull down to refresh.'); }
    } catch (e: any) {
      setError(e?.message || 'Could not load your jobs.');
    } finally { setLoading(false); }
  }, [jobId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const job = jobs.find((j) => j.id === jobId) || null;
  const sent = quoteOf(job);
  const total = drafts.reduce((n, d) => n + d.price * (Number(d.qty) || 0), 0);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as CatalogLine[];
    return catalog.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)).slice(0, 12);
  }, [catalog, search]);

  function add(item: CatalogLine) {
    setDrafts((d) => [...d, { key: item.key, label: item.label, unit: item.unit, price: item.price, qty: '1', note: '', photo: '' }]);
    setSearch('');
  }
  function set(i: number, patch: Partial<Draft>) {
    setDrafts((d) => d.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  }
  async function attach(i: number, from: 'camera' | 'library') {
    try {
      const stored = from === 'camera' ? await takePhoto() : await pickPhoto();
      if (stored) set(i, { photo: stored });
    } catch (e: any) { Alert.alert('Photo', String(e?.message || e)); }
  }

  async function send() {
    if (!job) { Alert.alert('Pick the job first'); return; }
    if (drafts.length === 0) { Alert.alert('Add at least one item'); return; }
    for (const d of drafts) {
      const n = Number(d.qty);
      if (!Number.isFinite(n) || n <= 0) { Alert.alert('How many?', `Enter a quantity for ${d.label}.`); return; }
    }
    setBusy(true);
    try {
      // Photos go up first so each line carries the proof with it.
      const lines = [] as Array<{ key: string; qty: number; note: string; photo: string }>;
      for (const d of drafts) {
        let objectPath = '';
        if (d.photo) {
          try {
            const f = await uploadPhoto(d.photo, 'inspection-evidence', { entity: 'resident-reports', recordId: job.id });
            objectPath = f.objectPath;
          } catch { /* the line still goes; the photo can be added again later */ }
        }
        lines.push({ key: d.key, qty: Number(d.qty), note: d.note.trim(), photo: objectPath });
      }
      await customFetch(`/api/v1/resident-reports/${encodeURIComponent(job.id)}/quote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }), responseType: 'json',
      } as never);
      setDrafts([]);
      await load();
      Alert.alert('Sent to the client', 'They approve it before the work starts. You will get an alert either way.');
    } catch (e: any) {
      Alert.alert('Not sent', e?.data?.error || e?.message || 'Check your connection and try again.');
    } finally { setBusy(false); }
  }

  const jobLabel = (r: ResidentReport) =>
    [r.complaintNo || r.id.slice(0, 6), r.address, r.unit ? `Apt ${r.unit}` : ''].filter(Boolean).join(' · ');

  return (
    <ScrollView
      contentContainerStyle={[ui.wrap, { paddingTop: 16, paddingBottom: 48 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
    >
      <Text style={ui.label}>
        What the job needs bought. Pick the item, say how many, take a picture — the price comes off FIAREP's book and the client approves it before you start.
      </Text>
      {!!error && <Text style={{ color: '#991b1b', marginTop: 8 }}>{error}</Text>}

      <Text style={[ui.label, { marginTop: 14 }]}>Job</Text>
      <PickOne
        options={jobs.map(jobLabel)}
        value={job ? jobLabel(job) : ''}
        onChange={(v) => { const found = jobs.find((r) => jobLabel(r) === v); setJobId(found?.id || ''); setDrafts([]); }}
        placeholder={jobs.length ? 'Pick the job' : 'No client jobs assigned to you'}
        title="Which job?"
        clearLabel="None"
      />

      {sent && (
        <View style={[ui.card, { marginTop: 14, gap: 4 }]}>
          <Text style={{ fontWeight: '700' }}>
            Already sent — {money(sent.total)} ·{' '}
            <Text style={{ color: sent.status === 'approved' ? '#065f46' : sent.status === 'declined' ? '#991b1b' : '#92400e' }}>
              {sent.status === 'approved' ? 'approved' : sent.status === 'declined' ? 'declined' : 'waiting for the client'}
            </Text>
          </Text>
          {sent.lines.map((l) => (
            <Text key={l.id} style={ui.listSub}>{l.qty} × {l.label} — {money(l.amount)}</Text>
          ))}
          {!!sent.decidedBy && <Text style={ui.listSub}>{sent.decidedBy} · {when(sent.decidedAt)}{sent.note ? ` · ${sent.note}` : ''}</Text>}
          {sent.status === 'pending' && <Text style={ui.listSub}>Do not start until they approve.</Text>}
        </View>
      )}

      {!!job && (
        <>
          <Text style={[ui.label, { marginTop: 14 }]}>Add what it needs</Text>
          <TextInput
            style={ui.input}
            value={search}
            onChangeText={setSearch}
            placeholder="Window, sink, leak, trap…"
            autoCorrect={false}
          />
          {matches.map((m) => (
            <Pressable key={m.key} onPress={() => add(m)} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
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
                <TextInput
                  style={[ui.input, { width: 90 }]}
                  value={d.qty}
                  onChangeText={(v) => set(i, { qty: v.replace(/[^0-9.]/g, '') })}
                  keyboardType="decimal-pad"
                />
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
              <Text style={ui.listSub}>FIAREP's price book. The server prices it again when it sends, so this is what the client sees.</Text>
              <Pressable style={[ui.btn, { marginTop: 10 }, busy && ui.btnMuted]} disabled={busy} onPress={() => void send()}>
                <Text style={ui.btnText}>{busy ? 'Sending…' : 'Send to the client for approval'}</Text>
              </Pressable>
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
