// FIAREP Smart Repair — AI Powered Repair Assistant.
// Photo in. Repair instructions out. Identify • Locate • Instruct • Prepare • Repair.
// Eleven panels: photo · location · issue · instructions · diagram · tools ·
// materials · specifications · reference image · replacement part · verification.
import { useEffect, useState, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { takePhoto, pickPhoto, photoBase64, takePhotoWithGeo, type PhotoEvidence } from '../lib/photos';
import { ResidentSignOffSheet, signOffLabel, type ResidentSignOff } from '../components/ResidentSignOff';
import RemotePhoto from '../components/RemotePhoto';
import RepairReferenceImage from '../components/RepairReferenceImage';
import { readHeading, facingLabel, gpsAddress, requestSmartTicket, requestVerification, requestDrawings, saveRemotePhoto, ticketText, summaryCard, listSavedRepairs, syncSavedRepairs, saveRepair, deleteSavedRepair, reportRepairComplete, type SmartTicket, type RepairVerification, type SmartDrawings, type SavedRepair } from '../lib/smartRepair';
import { createManagementReport, getResidentReport, listResidentReportPhotoUrls, addResidentUpdate, getCurrentActor, signOffForServer } from '../lib/store';
import { ui } from '../lib/ui';

const NAVY = '#0B2A4A';
const BLUE = '#1C4E86';
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const PRIORITY_COLOR: Record<string, string> = { High: '#b91c1c', Medium: '#b45309', Low: '#166534' };
const when = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + '  ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function Panel({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#dbe3ee' }}>
      <View style={{ backgroundColor: BLUE, paddingHorizontal: 12, paddingVertical: 7 }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.4 }}>{n}.  {title.toUpperCase()}</Text>
      </View>
      <View style={{ padding: 12, gap: 6 }}>{children}</View>
    </View>
  );
}

function CompassRose({ heading }: { heading: number | null }) {
  const s = 74, c = s / 2;
  const a = ((heading ?? 0) - 90) * Math.PI / 180;
  return (
    <Svg width={s} height={s}>
      <Circle cx={c} cy={c} r={c - 12} stroke="#334155" strokeWidth={1.5} fill="#fff" />
      <SvgText x={c} y={10} fontSize={11} fontWeight="bold" textAnchor="middle" fill="#0f172a">N</SvgText>
      <SvgText x={c} y={s - 1} fontSize={11} fontWeight="bold" textAnchor="middle" fill="#0f172a">S</SvgText>
      <SvgText x={s - 4} y={c + 4} fontSize={11} fontWeight="bold" textAnchor="middle" fill="#0f172a">E</SvgText>
      <SvgText x={5} y={c + 4} fontSize={11} fontWeight="bold" textAnchor="middle" fill="#0f172a">W</SvgText>
      {heading != null && <Line x1={c} y1={c} x2={c + (c - 16) * Math.cos(a)} y2={c + (c - 16) * Math.sin(a)} stroke="#dc2626" strokeWidth={3} />}
      {heading != null && <Polygon points={`${c + (c - 13) * Math.cos(a)},${c + (c - 13) * Math.sin(a)} ${c + (c - 22) * Math.cos(a - 0.35)},${c + (c - 22) * Math.sin(a - 0.35)} ${c + (c - 22) * Math.cos(a + 0.35)},${c + (c - 22) * Math.sin(a + 0.35)}`} fill="#dc2626" />}
      <Circle cx={c} cy={c} r={3} fill="#0f172a" />
    </Svg>
  );
}

function Drawing({ uri, loading, label, height = 92 }: { uri: string | null | undefined; loading: boolean; label?: string; height?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: '100%', height, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height }} resizeMode="contain" />
          : loading ? <ActivityIndicator /> : <Ionicons name="construct-outline" size={30} color="#94a3b8" />}
      </View>
      {!!label && <Text style={{ fontSize: 12, textAlign: 'center', color: '#0f172a' }} numberOfLines={2}>{label}</Text>}
    </View>
  );
}

function Grid({ items, drawings, loading }: { items: string[]; drawings: SmartDrawings | null; loading: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
      {items.map((name) => (
        <View key={name} style={{ width: '33.33%', padding: 4 }}>
          <View style={{ borderWidth: 1, borderColor: '#eef2f7', borderRadius: 8, padding: 6 }}>
            <Drawing uri={drawings?.items[name]} loading={loading} label={name} height={70} />
          </View>
        </View>
      ))}
    </View>
  );
}

const STEPS: Array<{ label: string; icon: any }> = [
  { label: 'Complain', icon: 'camera' }, { label: 'Analyze', icon: 'search' }, { label: 'Locate', icon: 'location' },
  { label: 'Instruct', icon: 'document-text' }, { label: 'Repair', icon: 'construct' }, { label: 'Verify', icon: 'checkmark-circle' },
];

export default function SmartRepair() {
  const { reportId } = useLocalSearchParams<{ reportId?: string }>();
  const fromComplaint = !!reportId;
  const [photo, setPhoto] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState<Date | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [apt, setApt] = useState('');
  const [room, setRoom] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<SmartTicket | null>(null);
  const [drawings, setDrawings] = useState<SmartDrawings | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(reportId ? String(reportId) : null);
  const [ordered, setOrdered] = useState(false);
  const [saved, setSaved] = useState('');
  const [after, setAfter] = useState<string | null>(null);
  const [check, setCheck] = useState<RepairVerification | null>(null);
  const [checking, setChecking] = useState(false);
  // Every photo and its repair directions are kept on the phone until deleted.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedList, setSavedList] = useState<SavedRepair[]>([]);
  const refreshSaved = () => { void listSavedRepairs().then(setSavedList); void syncSavedRepairs().then((changed) => { if (changed) void listSavedRepairs().then(setSavedList); }); };
  useEffect(() => { refreshSaved(); }, []);
  const persist = async (over: Partial<SavedRepair> & { ticket: SmartTicket }, id = savedId) => {
    const item: SavedRepair = {
      id: id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(),
      photo, heading, address: address.trim(), apt: apt.trim(), room: room.trim(), note: note.trim(),
      reportId: reportId ? String(reportId) : undefined, jobId, ordered, after, check, ...over,
    };
    await saveRepair(item).catch(() => undefined);
    setSavedId(item.id); refreshSaved();
  };
  function openSaved(it: SavedRepair) {
    setSavedId(it.id); setPhoto(it.photo); setHeading(it.heading); setAddress(it.address); setApt(it.apt); setRoom(it.room); setNote(it.note);
    setTakenAt(new Date(it.at)); setTicket(it.ticket); setJobId(it.jobId ?? (it.reportId || null)); setOrdered(!!it.ordered);
    setAfter(it.after ?? null); setCheck(it.check ?? null); setSaved('');
    setDrawing(true); setDrawings(null);
    requestDrawings(it.ticket).then(setDrawings).catch(() => setDrawings({ diagram: null, part: null, items: {} })).finally(() => setDrawing(false));
  }
  function startOver() {
    setSavedId(null); setPhoto(null); setTicket(null); setDrawings(null); setOrdered(false); setAfter(null); setCheck(null); setSaved('');
    setJobId(reportId ? String(reportId) : null); setHeading(null); setTakenAt(null);
  }
  function confirmDelete(id: string, then?: () => void) {
    Alert.alert('Delete this repair?', 'The photo and its repair directions are deleted. A work order already created stays in the jobs list.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSavedRepair(id); refreshSaved(); then?.(); } },
    ]);
  }

  // From a resident complaint: its photo, address, apartment and words come along.
  useEffect(() => {
    if (!reportId) { void gpsAddress().then((a) => { if (a) setAddress((cur) => cur || a); }); return; }
    void (async () => {
      const r = await getResidentReport(String(reportId));
      if (!r) return;
      setAddress(r.address || ''); setApt(r.unit || ''); setRoom(r.location || ''); setNote(r.description || '');
      setTakenAt(r.createdAt ? new Date(r.createdAt) : null);
      const local = (r.photos || []).find((x) => x.startsWith('photos/') || x.startsWith('file:'));
      if (local) { setPhoto(local); return; }
      const urls = await listResidentReportPhotoUrls(String(reportId)).catch(() => [] as string[]);
      if (urls[0]) { const p = await saveRemotePhoto(urls[0]); if (p) setPhoto(p); }
    })();
  }, [reportId]);

  const area = [apt.trim() ? (/^apt/i.test(apt.trim()) ? apt.trim() : 'Apt ' + apt.trim()) : '', room.trim()].filter(Boolean).join(' · ');

  async function shoot(fn: () => Promise<string | null>) {
    try {
      const u = await fn();
      if (!u) return;
      setSavedId(null); setPhoto(u); setTakenAt(new Date()); setTicket(null); setDrawings(null); setSaved(''); setOrdered(false); setAfter(null); setCheck(null);
      setHeading(await readHeading());
    } catch (e: any) { Alert.alert('Photo', String(e?.message || e)); }
  }

  async function analyze() {
    if (!photo) { Alert.alert('Photo needed', 'Take or upload a photo first.'); return; }
    setBusy(true);
    try {
      const b64 = await photoBase64(photo);
      if (!b64) throw new Error('Could not read the photo.');
      const t = await requestSmartTicket({ image: b64, heading, address: address.trim(), area, note: note.trim() });
      setTicket(t);
      await persist({ ticket: t, at: new Date().toISOString() });
      // The drawings come in after the ticket; each panel fills as they arrive.
      setDrawing(true); setDrawings(null);
      requestDrawings(t).then(setDrawings).catch(() => setDrawings({ diagram: null, part: null, items: {} })).finally(() => setDrawing(false));
    } catch (e: any) { Alert.alert('Smart Repair', String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function makeWorkOrder() {
    if (!ticket) return;
    try {
      const text = ticketText(ticket, fromComplaint) + '\n\nFIAREP SUMMARY CARD\n' + summaryCard(ticket, area, 'Ready For Repair');
      if (jobId) {
        const r = await getResidentReport(jobId);
        const a = await getCurrentActor();
        await addResidentUpdate(jobId, (r?.status || 'submitted') as any, text, a.name || 'FIAREP');
        setSaved('Repair plan added to the complaint.');
      } else {
        const r = await createManagementReport(area, '', address.trim(), text, photo ? [photo] : []);
        setJobId(r.id);
        await persist({ ticket, ordered: true, jobId: r.id });
        setSaved('Work order created — it is in the jobs list to assign.');
      }
      setOrdered(true);
      await persist({ ticket, ordered: true, jobId: jobId || undefined });
    } catch (e: any) { Alert.alert('Work order', String(e?.message || e)); }
  }

  async function verify() {
    if (!jobId) { Alert.alert('Work order first', 'Create the work order, complete the repair, then upload the after-repair photo.'); return; }
    try {
      const ev = await takePhotoWithGeo();
      if (!ev) return;
      setAfter(ev.uri); setCheck(null); setChecking(true);
      let result: RepairVerification | null = null;
      try {
        const before = photo ? await photoBase64(photo) : null;
        const afterB64 = await photoBase64(ev.uri);
        if (before && afterB64) result = await requestVerification(before, afterB64, ticket?.issueFound || '');
      } catch (e: any) { Alert.alert('Verification', String(e?.message || e)); }
      setCheck(result); setChecking(false);
      if (ticket) await persist({ ticket, after: ev.uri, check: result });
      // Repair inside an apartment: the resident signs on this phone before the job closes.
      if (result?.compliant && apt.trim()) { setSignFor({ ev, result }); setSignOpen(true); return; }
      await finishVerified(ev, result);
    } catch (e: any) { setChecking(false); Alert.alert('After-repair photo', String(e?.message || e)); }
  }
  const [signFor, setSignFor] = useState<{ ev: PhotoEvidence; result: RepairVerification } | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  async function finishVerified(ev: PhotoEvidence, result: RepairVerification | null, signOff?: ResidentSignOff) {
    if (!jobId) return;
    try {
      const a = await getCurrentActor();
      const r = await getResidentReport(jobId);
      const noteText = 'After-repair photo (Smart Repair)'
        + (result ? '\nBefore: ' + result.before.join('; ') + '\nAfter: ' + result.after.join('; ') + '\n' + (result.compliant ? '✅ Repair appears compliant' : '⚠ Needs another look') + (result.summary ? ' — ' + result.summary : '') : '');
      // Marked complete only when the after photo shows the repair done.
      const evidence = signOff && signOff.status !== 'signed' ? [ev, signOff.photo] : [ev];
      await addResidentUpdate(jobId, result?.compliant ? 'resolved' : ((r?.status || 'in_progress') as any), noteText, a.name || 'FIAREP', evidence, ev.geo, signOff);
      if (signOff && ticket) await persist({ ticket, after: ev.uri, check: result, signOff: signOffForServer(signOff) } as never);
      let sent = '';
      if (result?.compliant && ticket) {
        // Once complete it goes to management (and an emailed copy) per Platform Control.
        const summary = ticketText(ticket, fromComplaint) + '\n\nFIAREP SUMMARY CARD\n' + summaryCard(ticket, area, 'Repaired — verified')
          + '\n\nCOMPLETION VERIFICATION\nBefore: ' + result.before.join('; ') + '\nAfter: ' + result.after.join('; ')
          + (signOff ? '\n\nRESIDENT SIGN-OFF\n' + signOffLabel(signOff) + (signOff.status !== 'signed' && signOff.note ? ' — ' + signOff.note : '') + ' · ' + new Date(signOff.at).toLocaleString('en-US') : '');
        const out = await reportRepairComplete({ jobId, issue: ticket.issueFound, address: [address.trim(), area].filter(Boolean).join(', '), summary });
        sent = [out.notified ? 'sent to management' : '', out.emailed ? 'emailed a copy' : ''].filter(Boolean).join(' and ');
      }
      setSaved(result?.compliant ? 'Repair verified — the job is marked complete' + (sent ? ', ' + sent : '') + '.' : 'After-repair photo added. FIAREP could not confirm the repair from the photo, so the job stays open.');
    } catch (e: any) { setChecking(false); Alert.alert('After-repair photo', String(e?.message || e)); }
  }

  const facing = facingLabel(heading);
  const wall = ticket?.facing ? ticket.facing.charAt(0).toUpperCase() + ticket.facing.slice(1) + ' Wall' : facing ? facing + ' Wall' : '';
  const stepReached = check?.compliant ? 6 : ordered ? 5 : ticket ? 4 : photo ? 1 : 0;
  const materials = ticket ? [...ticket.fixtures, ...ticket.supplies] : [];
  const kv = (k: string, v: string) => !!v && <Text style={{ fontSize: 14 }}><Text style={{ fontWeight: '700' }}>{k}: </Text>{v}</Text>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#eef2f7' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={{ backgroundColor: NAVY, borderRadius: 10, padding: 14, gap: 4 }}>
          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: 1 }}>FIAREP</Text>
          <Text style={{ color: '#cbd5e1', fontWeight: '700', fontSize: 11, letterSpacing: 0.6 }}>PHOTO IN. REPAIR INSTRUCTIONS OUT.</Text>
          <Text style={{ color: '#fff', fontWeight: '800', marginTop: 6 }}>AI POWERED REPAIR ASSISTANT</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Identify • Locate • Instruct • Prepare • Repair</Text>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12, marginTop: 4 }}>RIGHT REPAIR. RIGHT TOOLS. FIRST TIME. ✅</Text>
        </View>

        {!fromComplaint && !ticket && !photo && savedList.length > 0 && (
          <View style={{ backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#dbe3ee', overflow: 'hidden' }}>
            <View style={{ backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>SAVED REPAIRS ({savedList.length})</Text></View>
            {savedList.map((it) => (
              <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderTopWidth: 1, borderTopColor: '#eef2f7' }}>
                <Pressable style={{ flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' }} onPress={() => openSaved(it)}>
                  {it.photo ? <RemotePhoto localUri={it.photo} style={{ width: 54, height: 54, borderRadius: 6, backgroundColor: '#111' }} resizeMode="cover" /> : <View style={{ width: 54, height: 54, borderRadius: 6, backgroundColor: '#e2e8f0' }} />}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }} numberOfLines={1}>{it.ticket.issueFound}</Text>
                    <Text style={ui.listSub} numberOfLines={1}>{when(new Date(it.at))}{it.address ? ' · ' + it.address : ''}</Text>
                    <Text style={[ui.listSub, { color: it.check?.compliant ? '#166534' : it.ordered ? BLUE : '#64748b' }]}>{it.check?.compliant ? 'Repaired — verified' : it.ordered ? 'Work order created' : 'Ready for repair'}</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => confirmDelete(it.id)} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#dc2626' }}>
                  <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 13 }}>Delete</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Panel n={1} title={fromComplaint ? 'Resident complaint photo' : 'Photo'}>
          {!fromComplaint && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => shoot(takePhoto)}><Text style={ui.btnText}>Take photo</Text></Pressable>
              <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => shoot(pickPhoto)}><Text style={ui.btnOutlineText}>Upload</Text></Pressable>
            </View>
          )}
          {!!photo && <RemotePhoto localUri={photo} style={{ width: '100%', height: 220, borderRadius: 8, backgroundColor: '#111' }} resizeMode="cover" />}
          {!!takenAt && <Text style={ui.listSub}>{fromComplaint ? 'Received from Resident' : 'Taken'}{'\n'}{when(takenAt)}</Text>}
          {fromComplaint && !!note && <Text style={ui.listSub}>“{note}”</Text>}
        </Panel>

        <Panel n={2} title="Location (GPS & details)">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <TextInput style={ui.input} value={address} onChangeText={setAddress} placeholder="Address (from GPS)" />
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TextInput style={[ui.input, { flex: 1 }]} value={apt} onChangeText={setApt} placeholder="Apartment" />
                <TextInput style={[ui.input, { flex: 1 }]} value={room} onChangeText={setRoom} placeholder="Room" />
              </View>
            </View>
            <View style={{ alignItems: 'center' }}><CompassRose heading={heading} /></View>
          </View>
          {ticket ? (
            <View style={{ gap: 2 }}>
              {kv('Room', ticket.room || room)}
              {kv('Area', ticket.spot)}
              {kv('Wall', wall)}
              {kv('Distance', ticket.distance)}
            </View>
          ) : (!!photo && <Text style={ui.listSub}>{facing ? `Camera facing ${facing} (${heading}°)` : 'No compass reading on this photo.'}</Text>)}
        </Panel>

        <Pressable style={[ui.btn, { backgroundColor: BLUE }, (busy || !photo) && { opacity: 0.6 }]} onPress={analyze} disabled={busy || !photo}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.btnText}>{ticket ? 'Analyze again' : 'Analyze photo'}</Text>}
        </Pressable>

        {ticket && (
          <>
            <Panel n={3} title="Issue identified">
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <View style={{ width: 46, height: 46, borderRadius: 8, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="construct" size={26} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 17, fontWeight: '800' }}>{ticket.issueFound}</Text>
                  {!!ticket.issueDetail && <Text style={{ fontSize: 13, color: '#334155' }}>{ticket.issueDetail}</Text>}
                </View>
              </View>
              <Text style={{ fontSize: 14 }}><Ionicons name="person" size={14} color={BLUE} />  <Text style={{ fontWeight: '700' }}>Trade:</Text> {ticket.trade}</Text>
              <Text style={{ fontSize: 14 }}><Ionicons name="warning" size={14} color="#dc2626" />  <Text style={{ fontWeight: '700' }}>Priority:</Text> <Text style={{ color: PRIORITY_COLOR[ticket.priority], fontWeight: '700' }}>{ticket.priority}{ticket.priorityNote ? ' — ' + ticket.priorityNote : ''}</Text></Text>
              <Text style={{ fontSize: 14 }}><Ionicons name="time-outline" size={14} color="#0f172a" />  <Text style={{ fontWeight: '700' }}>Estimated Repair Time:</Text> {ticket.estimatedTime}</Text>
            </Panel>

            <Panel n={4} title="Repair instructions">
              {ticket.steps.map((st, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{i + 1}</Text></View>
                  <Text style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>{st}</Text>
                </View>
              ))}
            </Panel>

            <Panel n={5} title="Diagram (exploded view)">
              {drawings?.diagram ? <Image source={{ uri: drawings.diagram }} style={{ width: '100%', height: 300 }} resizeMode="contain" />
                : drawing ? <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /><Text style={ui.listSub}>FIAREP is drawing the diagram…</Text></View>
                : !!ticket.diagram && <Text style={{ fontFamily: MONO, fontSize: 13, lineHeight: 17 }}>{ticket.diagram}</Text>}
            </Panel>

            <Panel n={6} title="Tools to bring">
              <Grid items={ticket.tools.slice(0, 6)} drawings={drawings} loading={drawing} />
            </Panel>

            <Panel n={7} title="Materials & fixtures to bring">
              <Grid items={materials.slice(0, 6)} drawings={drawings} loading={drawing} />
            </Panel>

            {ticket.specs.length > 0 && (
              <Panel n={8} title="Specifications">
                {ticket.specs.map((sp, i) => (
                  <View key={i} style={{ flexDirection: 'row', borderTopWidth: i ? 1 : 0, borderTopColor: '#eef2f7', paddingVertical: 5 }}>
                    <Text style={{ width: 110, fontWeight: '700', fontSize: 13 }}>{sp.label}:</Text>
                    <Text style={{ flex: 1, fontSize: 13 }}>{sp.value}</Text>
                  </View>
                ))}
              </Panel>
            )}

            {!!photo && (
              <Panel n={9} title="Reference image (close-up)">
                <RepairReferenceImage photo={photo} mark={ticket.mark} arrow={ticket.arrow} facing={ticket.facing} partLabel={ticket.partLabel || ticket.issueFound} />
                <Text style={ui.listSub}>Red circle: the damaged part · arrow: the leak source / worst damage · positions are FIAREP's estimate.</Text>
              </Panel>
            )}

            {!!ticket.partLabel && (
              <Panel n={10} title="Replacement part image">
                <Drawing uri={drawings?.part} loading={drawing} height={200} />
                <Text style={{ fontWeight: '800', fontSize: 15, textAlign: 'center' }}>{ticket.partLabel.replace(/^replace\s+/i, '')}{ticket.spec ? `\n(${ticket.spec})` : ''}</Text>
              </Panel>
            )}

            <Pressable style={[ui.btn, { backgroundColor: BLUE }, !fromComplaint && ordered && { opacity: 0.6 }]} onPress={makeWorkOrder} disabled={!fromComplaint && ordered}>
              <Text style={ui.btnText}>{fromComplaint ? (ordered ? 'Repair plan added ✓' : 'Add repair plan to this complaint') : ordered ? 'Work order created ✓' : 'Create work order'}</Text>
            </Pressable>

            <Panel n={11} title="Completion verification">
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden' }}>
                  <Text style={{ backgroundColor: '#dc2626', color: '#fff', fontWeight: '800', textAlign: 'center', paddingVertical: 4 }}>BEFORE</Text>
                  {!!photo && <RemotePhoto localUri={photo} style={{ width: '100%', height: 120, backgroundColor: '#111' }} resizeMode="cover" />}
                </View>
                <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden' }}>
                  <Text style={{ backgroundColor: '#16a34a', color: '#fff', fontWeight: '800', textAlign: 'center', paddingVertical: 4 }}>AFTER</Text>
                  {after ? <RemotePhoto localUri={after} style={{ width: '100%', height: 120, backgroundColor: '#111' }} resizeMode="cover" />
                    : <View style={{ height: 120, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="camera-outline" size={28} color="#94a3b8" /></View>}
                  {check?.compliant && <View style={{ position: 'absolute', right: 6, bottom: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark" size={20} color="#fff" /></View>}
                </View>
              </View>
              {checking && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Text style={ui.listSub}>Comparing before and after…</Text></View>}
              {!!check && (
                <View>
                  <Text style={{ fontWeight: '700' }}>Before</Text>
                  {check.before.map((x, i) => <Text key={'b' + i} style={{ fontSize: 13 }}>•  {x}</Text>)}
                  <Text style={{ fontWeight: '700', marginTop: 4 }}>After</Text>
                  {check.after.map((x, i) => <Text key={'a' + i} style={{ fontSize: 13 }}>•  {x}</Text>)}
                  <Text style={{ marginTop: 6, fontWeight: '800', color: check.compliant ? '#166534' : '#b45309' }}>{check.compliant ? '✅ Repair appears compliant' : '⚠ Needs another look'}</Text>
                </View>
              )}
              <Pressable style={[ui.btnOutline, !jobId && { opacity: 0.6 }]} onPress={verify}><Text style={ui.btnOutlineText}>Upload after-repair photo for verification</Text></Pressable>
            </Panel>

            <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#dbe3ee' }}>
              <Text style={{ fontWeight: '800', fontSize: 12, color: BLUE, letterSpacing: 0.4, marginBottom: 6 }}>FIAREP SUMMARY CARD</Text>
              <Text style={{ fontFamily: MONO, fontSize: 13, lineHeight: 18 }}>{summaryCard(ticket, area, check?.compliant ? 'Repaired — verified' : 'Ready For Repair')}</Text>
            </View>

            {!fromComplaint && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => { startOver(); refreshSaved(); }}><Text style={ui.btnOutlineText}>New repair / saved list</Text></Pressable>
                {!!savedId && (
                  <Pressable style={[ui.btnOutline, { flex: 1, borderColor: '#dc2626' }]} onPress={() => confirmDelete(savedId, startOver)}>
                    <Text style={{ color: '#dc2626', fontWeight: '600', textAlign: 'center' }}>Delete this repair</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}

        {!!saved && <Text style={{ padding: 12, borderRadius: 10, backgroundColor: '#dcfce7', color: '#166534', fontWeight: '700' }}>{saved}</Text>}
        {!!signFor && !signOpen && (
          <Pressable style={ui.btn} onPress={() => setSignOpen(true)}><Text style={ui.btnText}>Resident sign-off</Text></Pressable>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Complain → Analyze → Locate → Instruct → Repair → Verify */}
      <View style={{ flexDirection: 'row', backgroundColor: NAVY, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 22 : 8 }}>
        {STEPS.map((st, i) => {
          const on = i < stepReached || (i === 0 && !!photo);
          return (
            <View key={st.label} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <Ionicons name={st.icon} size={20} color={on ? '#fff' : '#64748b'} />
              <Text style={{ color: on ? '#fff' : '#64748b', fontSize: 11, fontWeight: '700' }}>{st.label}</Text>
            </View>
          );
        })}
      </View>
      <ResidentSignOffSheet
        visible={signOpen && !!signFor}
        jobLine={`${[address.trim(), apt.trim() ? `apt ${apt.trim()}` : ''].filter(Boolean).join(' · ')} — ${ticket?.issueFound || 'Repair'}`}
        onCancel={() => { setSignOpen(false); setSaved('Repair verified. The job closes once the resident signs (or you mark why they could not).'); }}
        onDone={(so) => { const f = signFor; setSignOpen(false); setSignFor(null); if (f) void finishVerified(f.ev, f.result, so); }}
      />
    </KeyboardAvoidingView>
  );
}
