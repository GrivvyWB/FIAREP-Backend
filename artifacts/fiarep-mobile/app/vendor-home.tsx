import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getProcurementByTracking,
  submitBid,
  vendorStartProcurement,
  vendorCompleteProcurement,
  checkInVendorWalkthrough,
  type ProcurementRequest,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';
import { captureGeo } from '../lib/geo';
import type { VendorWalkthroughCheckIn } from '@workspace/api-client-react';

const STATUS_LABEL: Record<ProcurementRequest['status'], string> = {
  draft: 'Draft',
  returned: 'Returned for revision',
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
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [job, setJob] = useState<ProcurementRequest | null>(null);
  const [note, setNote] = useState('');
  const [bidName, setBidName] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [bidNote, setBidNote] = useState('');
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [walkthroughCheckIn, setWalkthroughCheckIn] = useState<VendorWalkthroughCheckIn | null>(null);

  async function lookup() {
    const q = query.trim();
    const vendor = bidName.trim();
    if (!q || !vendor) {
      Alert.alert('Name and code required', 'Enter your vendor name and the code Procurement emailed you.');
      return;
    }
    setBusy(true);
    try {
      const r = await getProcurementByTracking(q, vendor);
      setJob(r);
      setSearched(true);
      setNote('');
      const priorCheckIns = Array.isArray(r?.walkthroughCheckIns) ? r.walkthroughCheckIns : [];
      setWalkthroughCheckIn(
        priorCheckIns.find((item) => item.vendorName.trim().toLowerCase() === vendor.toLowerCase()) ?? null,
      );
    } catch (e: any) {
      Alert.alert('Lookup failed', e?.message ?? 'Could not find that job.');
    } finally {
      setBusy(false);
    }
  }

  async function onWalkthroughCheckIn() {
    if (!job) return;
    setBusy(true);
    try {
      const geo = await captureGeo();
      if (geo.source !== 'gps' || geo.lat == null || geo.lng == null) {
        Alert.alert('Location required', 'Enable location access to check in.');
        return;
      }
      const checkIn = await checkInVendorWalkthrough(job.trackingId, bidName, {
        latitude: geo.lat,
        longitude: geo.lng,
        accuracy: geo.accuracy,
        capturedAt: geo.at,
      });
      setWalkthroughCheckIn(checkIn);
      Alert.alert('Checked in', 'Your time and location were sent to Procurement.');
    } catch (e: any) {
      Alert.alert('Check-in failed', e?.message ?? 'Your check-in could not be recorded.');
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
    Alert.prompt('Your company name', 'Enter the vendor name procurement has on file.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: (nm?: string) => {
        const vendor = (nm || '').trim();
        if (!vendor) { Alert.alert('Name required', 'Enter your vendor name.'); return; }
        setBidName(vendor);
        router.push('/vendor-quote?trackingId=' + encodeURIComponent(job.trackingId) + '&vendor=' + encodeURIComponent(vendor) + '&address=' + encodeURIComponent(job.address || '') + '&scope=' + encodeURIComponent(job.scope || '') + '&projectId=' + encodeURIComponent(job.projectId || '') + '&jobId=' + encodeURIComponent(job.id || ''));
      } },
    ], 'plain-text', bidName);
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
        setBidAmount(''); setBidNote('');
        Alert.alert('Bid submitted', 'Your bid of $' + amt + ' was sent to procurement.');
      } else {
        Alert.alert('Not found', 'Could not submit a bid for that job.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Your Assigned Work</Text>

      <Text style={ui.label}>Vendor name</Text>
      <TextInput
        style={ui.input}
        value={bidName}
        onChangeText={setBidName}
        placeholder="Company or contact name"
        autoCapitalize="words"
      />
      <Text style={ui.label}>Enter the code Procurement emailed you</Text>
      <TextInput
        style={ui.input}
        value={query}
        onChangeText={setQuery}
        placeholder="e.g. RC-46789"
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

          {!!job.walkthroughAt && (
            <View style={{ gap: 8 }}>
              <Pressable
                style={[ui.btn, busy && { opacity: 0.6 }]}
                onPress={onWalkthroughCheckIn}
                disabled={busy || !!walkthroughCheckIn}
              >
                <Text style={ui.btnText}>Walk-Through Check-In</Text>
              </Pressable>
              {!!walkthroughCheckIn && (
                <View>
                  <Text style={{ fontSize: 12, color: '#666' }}>
                    Captured {fmt(walkthroughCheckIn.capturedAt)}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#666' }}>
                    Recorded {fmt(walkthroughCheckIn.receivedAt)}
                  </Text>
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
              <Text style={ui.label}>Your vendor name</Text>
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

    </ScrollView>
    </KeyboardAvoidingView>
  );
}
