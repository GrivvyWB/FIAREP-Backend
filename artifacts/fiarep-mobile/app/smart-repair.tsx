// FIAREP Smart Repair Instructions — Photo In. Repair Plan Out.
// Photo → issue found → exact location (GPS + compass) → tools, supplies,
// fixtures, repair steps, trade, priority, time → work order → verification photo.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { takePhoto, pickPhoto, photoBase64, takePhotoWithGeo } from '../lib/photos';
import RemotePhoto from '../components/RemotePhoto';
import { readHeading, facingLabel, gpsAddress, requestSmartTicket, requestVerification, saveRemotePhoto, ticketText, summaryCard, type SmartTicket, type RepairVerification } from '../lib/smartRepair';
import RepairReferenceImage from '../components/RepairReferenceImage';
import { createManagementReport, getResidentReport, listResidentReportPhotoUrls, addResidentUpdate, getCurrentActor } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const PRIORITY_COLOR: Record<string, string> = { High: '#b91c1c', Medium: '#b45309', Low: '#166534' };

export default function SmartRepair() {
  const { reportId } = useLocalSearchParams<{ reportId?: string }>();
  const fromComplaint = !!reportId;
  const [photo, setPhoto] = useState<string | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<SmartTicket | null>(null);
  const [jobId, setJobId] = useState<string | null>(reportId ? String(reportId) : null);
  const [saved, setSaved] = useState('');
  const [verified, setVerified] = useState<string | null>(null);
  const [check, setCheck] = useState<RepairVerification | null>(null);
  const [checking, setChecking] = useState(false);

  // From a resident complaint: its photo, address, apartment and words come along.
  useEffect(() => {
    if (!reportId) { void gpsAddress().then((a) => { if (a) setAddress((cur) => cur || a); }); return; }
    void (async () => {
      const r = await getResidentReport(String(reportId));
      if (!r) return;
      setAddress(r.address || '');
      setArea([r.unit, r.location].filter(Boolean).join(' · '));
      setNote(r.description || '');
      const local = (r.photos || []).find((x) => x.startsWith('photos/') || x.startsWith('file:'));
      if (local) { setPhoto(local); return; }
      const urls = await listResidentReportPhotoUrls(String(reportId)).catch(() => [] as string[]);
      if (urls[0]) { const p = await saveRemotePhoto(urls[0]); if (p) setPhoto(p); }
    })();
  }, [reportId]);

  async function shoot(fn: () => Promise<string | null>) {
    try {
      const u = await fn();
      if (!u) return;
      setPhoto(u); setTicket(null); setSaved('');
      // The way the camera faced when the photo was taken names the wall.
      setHeading(await readHeading());
    } catch (e: any) { Alert.alert('Photo', String(e?.message || e)); }
  }

  async function analyze() {
    if (!photo) { Alert.alert('Photo needed', 'Take or upload a photo first.'); return; }
    setBusy(true);
    try {
      const b64 = await photoBase64(photo);
      if (!b64) throw new Error('Could not read the photo.');
      setTicket(await requestSmartTicket({ image: b64, heading, address: address.trim(), area: area.trim(), note: note.trim() }));
    } catch (e: any) { Alert.alert('Smart Repair', String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function makeWorkOrder() {
    if (!ticket) return;
    try {
      if (jobId) {
        const r = await getResidentReport(jobId);
        const a = await getCurrentActor();
        await addResidentUpdate(jobId, (r?.status || 'submitted') as any, ticketText(ticket, true) + '\n\nFIAREP SUMMARY CARD\n' + summaryCard(ticket, area.trim(), 'Ready For Repair'), a.name || 'FIAREP');
        setSaved('Smart Field Ticket added to the complaint.');
      } else {
        const r = await createManagementReport(area.trim(), '', address.trim(), ticketText(ticket, false) + '\n\nFIAREP SUMMARY CARD\n' + summaryCard(ticket, area.trim(), 'Ready For Repair'), photo ? [photo] : []);
        setJobId(r.id);
        setSaved('Work order created — it is in the jobs list to assign.');
      }
    } catch (e: any) { Alert.alert('Work order', String(e?.message || e)); }
  }

  async function verify() {
    if (!jobId) { Alert.alert('Work order first', 'Create the work order, complete the repair, then upload the completion photo.'); return; }
    try {
      const ev = await takePhotoWithGeo();
      if (!ev) return;
      setVerified(ev.uri); setCheck(null); setChecking(true);
      // FIAREP compares the before photo with the after photo.
      let result: RepairVerification | null = null;
      try {
        const before = photo ? await photoBase64(photo) : null;
        const after = await photoBase64(ev.uri);
        if (before && after) result = await requestVerification(before, after, ticket?.issueFound || '');
      } catch (e: any) { Alert.alert('Verification', String(e?.message || e)); }
      setCheck(result); setChecking(false);
      const a = await getCurrentActor();
      const r = await getResidentReport(jobId);
      const note = 'Completion photo (Smart Repair)'
        + (result ? '\nBefore: ' + result.before.join('; ') + '\nAfter: ' + result.after.join('; ') + '\n' + (result.compliant ? '✅ Repair appears compliant' : '⚠ Needs another look') + (result.summary ? ' — ' + result.summary : '') : '');
      // Marked complete only when the after photo shows the repair done.
      await addResidentUpdate(jobId, result?.compliant ? 'resolved' : ((r?.status || 'in_progress') as any), note, a.name || 'FIAREP', [ev], ev.geo);
      setSaved(result?.compliant ? 'Repair verified — the job is marked complete.' : 'Completion photo added. FIAREP could not confirm the repair from the photo, so the job stays open.');
    } catch (e: any) { setChecking(false); Alert.alert('Completion photo', String(e?.message || e)); }
  }

  const facing = facingLabel(heading);
  const sec = (title: string, items: string[], numbered = false) => items.length ? (
    <View style={{ marginTop: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: ACCENT, letterSpacing: 0.4 }}>{title.toUpperCase()}</Text>
      {items.map((x, i) => <Text key={i} style={{ fontSize: 14, lineHeight: 21 }}>{numbered ? `${i + 1}. ` : '•  '}{x}</Text>)}
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 20, fontWeight: '800' }}>FIAREP Smart Repair</Text>
        <Text style={{ color: ACCENT, fontWeight: '700', marginTop: -6 }}>Photo In. Repair Plan Out.</Text>

        {!fromComplaint && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => shoot(takePhoto)}><Text style={ui.btnText}>Take photo</Text></Pressable>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => shoot(pickPhoto)}><Text style={ui.btnOutlineText}>Upload</Text></Pressable>
          </View>
        )}
        {!!photo && <RemotePhoto localUri={photo} style={{ width: '100%', height: 240, borderRadius: 12, backgroundColor: '#111' }} resizeMode="contain" />}
        {!!photo && !fromComplaint && <Text style={ui.listSub}>{facing ? `Camera facing ${facing} (${heading}°)` : 'No compass reading — the ticket will use "in front of you" / "to your left".'}</Text>}

        <Text style={ui.label}>Address {fromComplaint ? '' : '(from GPS — edit if needed)'}</Text>
        <TextInput style={ui.input} value={address} onChangeText={setAddress} placeholder="e.g. 125 Main Street" />
        <Text style={ui.label}>Apartment / area</Text>
        <TextInput style={ui.input} value={area} onChangeText={setArea} placeholder="e.g. Apt 4B · Bathroom" />
        {fromComplaint && !!note && <Text style={ui.listSub}>Complaint: {note}</Text>}

        <Pressable style={[ui.btn, (busy || !photo) && { opacity: 0.6 }]} onPress={analyze} disabled={busy || !photo}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.btnText}>Analyze photo</Text>}
        </Pressable>

        {ticket && (
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e5e7eb' }}>
            <Text style={{ fontSize: 14, lineHeight: 22 }}>{fromComplaint ? '📸 Resident Complaint Received' : '📸 Photo Uploaded'}</Text>
            <Text style={{ fontSize: 14, lineHeight: 22 }}>✅ <Text style={{ fontWeight: '700' }}>Issue Found:</Text> {ticket.issueFound}</Text>
            <Text style={{ fontSize: 14, lineHeight: 22 }}>📍 <Text style={{ fontWeight: '700' }}>Location:</Text> {ticket.location}</Text>
            <Text style={{ fontSize: 14, lineHeight: 22 }}>🎯 <Text style={{ fontWeight: '700' }}>Exact Area:</Text> {ticket.exactArea}</Text>
            <Text style={{ fontSize: 14, lineHeight: 22 }}>🔨 <Text style={{ fontWeight: '700' }}>Repair:</Text> {ticket.repairRequired}</Text>
            <Text style={{ fontSize: 14, lineHeight: 22 }}>⚠ <Text style={{ fontWeight: '700' }}>Priority:</Text> <Text style={{ color: PRIORITY_COLOR[ticket.priority], fontWeight: '700' }}>{ticket.priority}{ticket.priorityNote ? ' — ' + ticket.priorityNote : ''}</Text></Text>
            <Text style={{ fontSize: 14, lineHeight: 22 }}>📋 <Text style={{ fontWeight: '700' }}>Status:</Text> {ticket.status}</Text>
            {sec('Bring these tools', ticket.tools)}
            {sec('Bring these supplies', ticket.supplies)}
            {sec('Fixtures / parts', ticket.fixtures)}
            {sec('Repair instructions', ticket.steps, true)}
            <Text style={{ fontSize: 14, lineHeight: 22, marginTop: 10 }}>👷 <Text style={{ fontWeight: '700' }}>Trade Required:</Text> {ticket.trade}</Text>
            <Text style={{ fontSize: 14, lineHeight: 22 }}>⏱ <Text style={{ fontWeight: '700' }}>Estimated Repair Time:</Text> {ticket.estimatedTime}</Text>
            <Text style={[ui.listSub, { marginTop: 8 }]}>Distances are estimates from the photo.</Text>
          </View>
        )}

        {ticket && !!ticket.diagram && (
          <View style={{ backgroundColor: '#0f172a', borderRadius: 12, padding: 14 }}>
            <Text style={{ color: '#93c5fd', fontWeight: '800', fontSize: 12, letterSpacing: 0.4, marginBottom: 6 }}>REPAIR DIAGRAM</Text>
            <Text style={{ color: '#f8fafc', fontFamily: MONO, fontSize: 13, lineHeight: 17 }}>{ticket.diagram}</Text>
          </View>
        )}

        {ticket && !!photo && (
          <View style={{ gap: 6 }}>
            <Text style={{ fontWeight: '800', fontSize: 12, color: ACCENT, letterSpacing: 0.4 }}>📷 REFERENCE IMAGE</Text>
            <RepairReferenceImage photo={photo} mark={ticket.mark} arrow={ticket.arrow} facing={ticket.facing} partLabel={ticket.partLabel} />
            <Text style={ui.listSub}>Red circle: the damaged part · arrow: the leak source / worst damage · positions are FIAREP's estimate.</Text>
          </View>
        )}

        {ticket && (
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e5e7eb' }}>
            <Text style={{ fontWeight: '800', fontSize: 12, color: ACCENT, letterSpacing: 0.4, marginBottom: 6 }}>FIAREP SUMMARY CARD</Text>
            <Text style={{ fontFamily: MONO, fontSize: 13, lineHeight: 18 }}>{summaryCard(ticket, area.trim(), check?.compliant ? 'Repaired — verified' : 'Ready For Repair')}</Text>
          </View>
        )}

        {ticket && (
          <Pressable style={[ui.btn, !fromComplaint && !!jobId && { opacity: 0.6 }]} onPress={makeWorkOrder} disabled={!fromComplaint && !!jobId}>
            <Text style={ui.btnText}>{fromComplaint ? 'Add ticket to this complaint' : jobId ? 'Work order created ✓' : 'Create work order'}</Text>
          </Pressable>
        )}
        {(ticket || jobId) && (
          <Pressable style={ui.btnOutline} onPress={verify}><Text style={ui.btnOutlineText}>✅ Upload completion photo</Text></Pressable>
        )}
        {!!verified && <RemotePhoto localUri={verified} style={{ width: '100%', height: 200, borderRadius: 12, backgroundColor: '#111' }} resizeMode="contain" />}
        {checking && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Text style={ui.listSub}>Comparing before and after…</Text></View>}
        {!!check && (
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: check.compliant ? '#86efac' : '#fcd34d' }}>
            <Text style={{ fontWeight: '800', fontSize: 12, color: ACCENT, letterSpacing: 0.4 }}>COMPLETION VERIFICATION</Text>
            <Text style={{ fontWeight: '700', marginTop: 6 }}>Before</Text>
            {check.before.map((x, i) => <Text key={'b' + i} style={{ fontSize: 14 }}>•  {x}</Text>)}
            <Text style={{ fontWeight: '700', marginTop: 6 }}>After</Text>
            {check.after.map((x, i) => <Text key={'a' + i} style={{ fontSize: 14 }}>•  {x}</Text>)}
            <Text style={{ marginTop: 8, fontWeight: '800', color: check.compliant ? '#166534' : '#b45309' }}>{check.compliant ? '✅ Repair appears compliant' : '⚠ Needs another look'}</Text>
            {!!check.summary && <Text style={ui.listSub}>{check.summary}</Text>}
          </View>
        )}
        {!!saved && <Text style={{ padding: 12, borderRadius: 10, backgroundColor: '#dcfce7', color: '#166534', fontWeight: '700' }}>{saved}</Text>}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
