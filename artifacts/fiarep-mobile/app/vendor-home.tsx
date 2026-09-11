import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppMode } from './_layout';
import {
  getProcurementByTracking,
  submitBid,
  vendorStartProcurement,
  vendorCompleteProcurement,
  clearAppMode,
  type ProcurementRequest,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

const STATUS_LABEL: Record<ProcurementRequest['status'], string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  pending: 'Pending',
  bidding: 'Open for bid',
  awarded: 'Awarded to you',
  closed: 'Closed',
};

function fmt(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function VendorHome() {
  const { refresh } = useAppMode();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [job, setJob] = useState<ProcurementRequest | null>(null);
  const [note, setNote] = useState('');
  const [bidName, setBidName] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [bidNote, setBidNote] = useState('');
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);

  async function lookup() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    try {
      const r = await getProcurementByTracking(q);
      setJob(r);
      setSearched(true);
      setNote('');
    } catch (e: any) {
      Alert.alert('Lookup failed', e?.message ?? 'Could not find that job.');
    } finally {
      setBusy(false);
    }
  }

  async function onStart() {
    if (!job) return;
    setBusy(true);
    try {
      const next = await vendorStartProcurement(job.id);
      if (next) setJob(next);
    } finally {
      setBusy(false);
    }
  }

  async function onComplete() {
    if (!job) return;
    setBusy(true);
    try {
      const next = await vendorCompleteProcurement(job.id, note.trim());
      if (next) { setJob(next); setNote(''); }
      Alert.alert('Marked complete', 'The supervisor has been notified.');
    } finally {
      setBusy(false);
    }
  }

  function openQuote() {
    if (!job) return;
    Alert.prompt('Your company name', 'Enter your company name for this quote.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: (nm?: string) => {
        const v = (nm || '').trim();
        if (!v) { Alert.alert('Name required', 'Enter your company name.'); return; }
        router.push('/vendor-quote?trackingId=' + encodeURIComponent(job.trackingId) + '&vendor=' + encodeURIComponent(v) + '&address=' + encodeURIComponent(job.address || '') + '&scope=' + encodeURIComponent(job.scope || '') + '&projectId=' + encodeURIComponent(job.projectId || '') + '&jobId=' + encodeURIComponent(job.id || ''));
      } },
    ], 'plain-text', bidName || '');
  }
  async function onBid() {
    if (!job) return;
    const nm = bidName.trim();
    const amt = parseFloat(bidAmount.replace(/[^0-9.]/g, ''));
    if (!nm) { Alert.alert('Name required', 'Enter your company or contact name.'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { Alert.alert('Amount required', 'Enter a valid bid amount.'); return; }
    setBusy(true);
    try {
      const b = await submitBid(job.trackingId, nm, amt, bidNote.trim());
      if (b) {
        setBidName(''); setBidAmount(''); setBidNote('');
        Alert.alert('Bid submitted', 'Your bid of $' + amt + ' was sent to procurement.');
      } else {
        Alert.alert('Not found', 'Could not submit a bid for that job.');
      }
    } finally {
      setBusy(false);
    }
  }

  function onExit() {
    Alert.alert('Exit?', 'Return to the role selection screen.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Exit', style: 'destructive', onPress: async () => { await clearAppMode(); refresh(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Your Assigned Work</Text>

      <Text style={ui.label}>Enter your job ID</Text>
      <TextInput
        style={ui.input}
        value={query}
        onChangeText={setQuery}
        placeholder="e.g. sr-24513"
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={lookup}
        returnKeyType="search"
      />
      <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} onPress={lookup} disabled={busy}>
        <Text style={ui.btnText}>Find my job</Text>
      </Pressable>

      {searched && !job && (
        <Text style={ui.empty}>No job found for that ID. Check the number procurement gave you.</Text>
      )}

      {job && (
        <View style={{ marginTop: 18, borderWidth: 1, borderColor: '#e2e2e2', borderRadius: 12, padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, color: ACCENT }}>ID: {job.trackingId}</Text>
            <Text style={{ fontSize: 13, color: '#666' }}>{STATUS_LABEL[job.status]}</Text>
          </View>

          <View>
            <Text style={ui.label}>Address</Text>
            <Text style={{ fontSize: 15 }}>{job.address || '\u2014'}</Text>
          </View>

          <View>
            <Text style={ui.label}>Scope of work</Text>
            <Text style={{ fontSize: 15, lineHeight: 21 }}>{job.scope || '\u2014'}</Text>
          </View>

          {(!!job.walkthroughAt || !!job.walkthroughNote || !!job.bidCloseAt) && (
            <View style={{ backgroundColor: '#eef4ea', borderRadius: 8, padding: 10, gap: 4 }}>
              {!!job.walkthroughAt && (
                <View>
                  <Text style={ui.label}>Walkthrough</Text>
                  <Text style={{ fontSize: 15, fontWeight: '600' }}>{job.walkthroughAt}</Text>
                </View>
              )}
              {!!job.walkthroughNote && <Text style={{ fontSize: 14 }}>{job.walkthroughNote}</Text>}
              {!!job.bidCloseAt && (
                <View>
                  <Text style={ui.label}>Bids close</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#c0392b' }}>{job.bidCloseAt}</Text>
                </View>
              )}
            </View>
          )}

          <Text style={[ui.label, { marginTop: 4 }]}>Your quote</Text>
          <View style={{ gap: 8 }}>
            <Pressable style={ui.btn} onPress={openQuote}>
              <Text style={ui.btnText}>Fill out your quote</Text>
            </Pressable>
          </View>

          {!!job.startedAt && <Text style={{ fontSize: 12, color: '#888' }}>Started {fmt(job.startedAt)}</Text>}
          {!!job.completedAt && <Text style={{ fontSize: 12, color: '#888' }}>Completed {fmt(job.completedAt)}</Text>}

          {job.status === 'awarded' && !job.completedAt && (
            <View style={{ gap: 10, marginTop: 6 }}>
              {!job.startedAt && (
                <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} onPress={onStart} disabled={busy}>
                  <Text style={ui.btnText}>Start work</Text>
                </Pressable>
              )}
              {!!job.startedAt && (
                <>
                  <Text style={ui.label}>Completion note (optional)</Text>
                  <TextInput
                    style={[ui.input, { height: 90, textAlignVertical: 'top' }]}
                    value={note}
                    onChangeText={setNote}
                    placeholder="What was done"
                    multiline
                  />
                  <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} onPress={onComplete} disabled={busy}>
                    <Text style={ui.btnText}>Mark complete</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}

          {job.status === 'bidding' && (
            <View style={{ gap: 8, marginTop: 6 }}>
              <Text style={ui.label}>Your name</Text>
              <TextInput style={ui.input} value={bidName} onChangeText={setBidName} placeholder="Company or contact name" autoCapitalize="words" />
              <Text style={ui.label}>Your bid amount</Text>
              <TextInput style={ui.input} value={bidAmount} onChangeText={setBidAmount} placeholder="$" keyboardType="numeric" />
              <Text style={ui.label}>Note (optional)</Text>
              <TextInput style={[ui.input, { height: 70, textAlignVertical: 'top' }]} value={bidNote} onChangeText={setBidNote} placeholder="Anything procurement should know" multiline />
              <Pressable style={[ui.btn, busy && { opacity: 0.6 }]} onPress={onBid} disabled={busy}>
                <Text style={ui.btnText}>Submit bid</Text>
              </Pressable>
            </View>
          )}

          {job.status === 'pending' && (
            <Text style={ui.empty}>This job has not been awarded yet. Check back once procurement awards it.</Text>
          )}
          {job.status === 'closed' && (
            <Text style={ui.empty}>This job is closed.</Text>
          )}
        </View>
      )}

      <Pressable style={[ui.btnOutline, { marginTop: 24 }]} onPress={onExit}>
        <Text style={ui.btnOutlineText}>Exit</Text>
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
