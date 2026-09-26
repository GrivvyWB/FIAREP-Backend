import { isCpmSupervisorTitle } from '../lib/titles';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, Alert, Modal } from 'react-native';
import * as Sharing from 'expo-sharing';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  getCurrentActor,
  getCurrentPosition,
  getProcurementRequest,
  getCostEstimate,
  getProjectScopeForm,
  listProcurementRequests,
  performEntityAction,
  type ProcurementRequest,
  listStaffAccounts,
  listCpmReviewViolations,
  assignViolationToCpm,
  type BuildingViolation,
  type StaffAccount,
} from '../lib/store';
import { COST_CATEGORIES } from '../lib/costEstimate';
import { lineAmount, sectionTotal, grandTotal as scopeGrandTotal, costPerDU, type VendorScope } from '../lib/vendorScope';
import { fileUri } from '../lib/files';
import { exportScopeExcel } from '../lib/scopeExcel';
import { ui, ACCENT } from '../lib/ui';

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ScopeReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [req, setReq] = useState<ProcurementRequest | null>(null);
  const [est, setEst] = useState<any>(null);
  const [divScope, setDivScope] = useState<VendorScope | null>(null);
  const [queue, setQueue] = useState<ProcurementRequest[]>([]);
  const [note, setNote] = useState('');
  const [trade, setTrade] = useState('');
  const [receiver, setReceiver] = useState<StaffAccount | null>(null);
  const [receiverOpen, setReceiverOpen] = useState(false);
  const [receivers, setReceivers] = useState<StaffAccount[]>([]);
  const [violations, setViolations] = useState<BuildingViolation[]>([]);
  const [violationCpm, setViolationCpm] = useState<BuildingViolation | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([getCurrentActor(), getCurrentPosition()]).then(([actor, position]) => {
      if (!mounted) return;
       const allowed = actor?.role === 'management' &&
          isCpmSupervisorTitle(position);
      setAuthorized(allowed);
      if (!allowed) {
          Alert.alert('Access denied', 'Scope review is available only to the CPM Supervisor.');
         router.replace('/management-home');
      }
    }).catch(() => {
      if (!mounted) return;
      setAuthorized(false);
      router.replace('/');
    });
    return () => { mounted = false; };
  }, [router]);

  const load = useCallback(async () => {
     if (!authorized) return;
     await import('../lib/sync').then(({ syncAllEntities }) => syncAllEntities()).catch(() => undefined);
     if (!id) {
       listProcurementRequests('submitted').then(setQueue).catch(() => setQueue([]));
       return;
     }
    getProcurementRequest(id).then(async (r) => {
      setReq(r || null);
      // The Divisions scope (and the old cost estimate) may be keyed by the
      // project id OR by the procurement record's own id. Try both.
      const key = (r && r.projectId && r.projectId.trim()) ? r.projectId.trim() : id;
      const div = await getProjectScopeForm(key).catch(() => null)
        || await getProjectScopeForm(id).catch(() => null);
      if (div && Array.isArray(div.divisions) && div.divisions.length > 0) setDivScope(div);
      else setDivScope(null);
      const e = await getCostEstimate(key).catch(() => null);
      setEst(e || null);
    });
     // The server remains authoritative for eligibility; this list is only a
     // picker and the handoff action is still validated by the API.
      listStaffAccounts('approved').then(setReceivers).catch(() => setReceivers([]));
      listCpmReviewViolations().then(setViolations).catch(() => setViolations([]));
  }, [authorized, id]);
  useFocusEffect(() => { void load(); });

  if (authorized !== true) {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.empty}>{authorized === null ? 'Checking access…' : 'Access denied.'}</Text>
      </ScrollView>
    );
  }

  if (!id) {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.h}>CPM Supervisor Scope Review</Text>
        <Text style={ui.label}>Submitted scopes awaiting CPM Supervisor approval.</Text>
        {violations.length > 0 && <>
          <Text style={[ui.label, { fontWeight: '700', marginTop: 12 }]}>Inspector violations</Text>
          {violations.map((v) => <View key={v.id} style={[ui.card, { gap: 4, marginTop: 8 }]}>
            <Text style={{ color: ACCENT, fontWeight: '700' }}>Violation {v.violationNo || '(no number)'}</Text>
            <Text style={{ fontWeight: '700' }}>{v.building}</Text>
            {!!v.notes && <Text style={ui.listSub}>{v.notes}</Text>}
            <Text style={ui.listSub}>Development: {v.development || '—'}</Text>
            <Pressable style={ui.btn} onPress={() => setViolationCpm(v)}><Text style={ui.btnText}>Assign to CPM</Text></Pressable>
          </View>)}
        </>}
        {queue.filter((item) => item.sourceEntity !== 'building-violations' || item.scopeSubmittedByCpm).length === 0 && <Text style={ui.empty}>No submitted scopes.</Text>}
          {queue.filter((item) => item.sourceEntity !== 'building-violations' || item.scopeSubmittedByCpm).map((item) => (
          <Pressable key={item.id} style={ui.card} onPress={() => router.push(`/scope-review?id=${encodeURIComponent(item.id)}`)}>
            {item.sourceEntity === 'building-violations' && <Text style={{ color: ACCENT, fontWeight: '700' }}>Source: Inspector violation</Text>}
            {item.sourceEntity === 'building-violations' && !!item.violationNo && <Text style={ui.listSub}>Violation {item.violationNo}</Text>}
            <Text style={{ fontWeight: '700' }}>{item.address || 'Scope'}</Text>
            <Text style={ui.listSub}>{item.scope}</Text>
            {item.sourceEntity === 'building-violations' && !!item.violationNotes && <Text style={ui.listSub}>Inspector notes: {item.violationNotes}</Text>}
            <Text style={ui.listSub}>Submitted {fmt(item.requestedAt)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  if (!req) {
    return (
      <ScrollView contentContainerStyle={ui.wrap}>
        <Text style={ui.empty}>Scope not found.</Text>
      </ScrollView>
    );
  }

  // The stored address is occasionally a raw record/project id on legacy scopes.
  // When it has no spaces (id-like) or matches the projectId, show the real
  // address from the Divisions header instead.
  const headerAddr = (divScope && divScope.header && divScope.header.address) ? String(divScope.header.address) : '';
  const storedAddr = String(req.address || '');
  const addrLooksLikeId = !!storedAddr && (!storedAddr.includes(' ') || storedAddr === String(req.projectId || ''));
  const displayAddress = (addrLooksLikeId && headerAddr) ? headerAddr : storedAddr;

  // ── old cost-estimate path (fallback) ──
  const rows = (est && est.rows) || {};
  const parseNum = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
  const costEstimate = COST_CATEGORIES.reduce((sum, c) => sum + parseNum((rows[c.id] || {}).cost), 0);
  const contingency = costEstimate * 0.10;
  const grandTotal = costEstimate + contingency;
  const filled = COST_CATEGORIES
    .map((c) => ({ c, row: rows[c.id] }))
    .filter(({ row }) => row && (String(row.location || '').trim() || String(row.description || '').trim() || String(row.cost || '').trim()));

  async function exportExcel() {
    if (!req) return;
    try { await exportScopeExcel(req, est, divScope); }
    catch (e: any) { Alert.alert('Export failed', String(e && e.message ? e.message : e)); }
  }

  async function openFile() {
    if (!req || !req.scopeFile) { Alert.alert('No file', 'No scope document is attached.'); return; }
    try {
      const uri = fileUri(req.scopeFile);
      const ok = await Sharing.isAvailableAsync();
      if (!ok) { Alert.alert('Unavailable', 'File preview is not available on this device.'); return; }
      await Sharing.shareAsync(uri, { UTI: 'public.item', mimeType: 'application/pdf' });
    } catch (e: any) {
      Alert.alert('Could not open', String(e && e.message ? e.message : e));
    }
  }

  async function review(action: 'approve' | 'reject') {
    if (!req) return;
    try {
      const updated = await performEntityAction('procurement', req.id, action, note.trim() ? { note: note.trim() } : {});
      setReq({ ...(updated.state as object), id: updated.id } as ProcurementRequest);
      Alert.alert(action === 'approve' ? 'Approved' : 'Returned', action === 'approve' ? 'Sent to Procurement.' : 'Returned to the originating CPM.');
      router.back();
    } catch (e: any) {
      Alert.alert('Action failed', e?.message || 'Could not update this scope.');
    }
  }

  async function handOffInHouse() {
    if (!req) return;
    if (!trade.trim() || !receiver?.id) {
      Alert.alert('Handoff details required', 'Select the requested trade and an eligible receiving supervisor.');
      return;
    }
    try {
      const updated = await performEntityAction('procurement', req.id, 'handoff-inhouse', {
        requestedTrade: trade.trim(),
        receiverSupervisorId: receiver.id,
      });
      setReq({ ...(updated.state as object), id: updated.id } as ProcurementRequest);
      Alert.alert('Handed off', 'The in-house manpower request was sent to the receiving supervisor.');
      router.back();
    } catch (e: any) {
      Alert.alert('Handoff failed', e?.message || 'The server did not accept this handoff.');
    }
  }

  async function assignCpm(v: BuildingViolation, cpm: StaffAccount) {
    try {
      await assignViolationToCpm(v.id, cpm.id);
      setViolationCpm(null);
      setViolations((all) => all.filter((item) => item.id !== v.id));
      Alert.alert('Assigned to CPM', 'The CPM can now build and submit the violation scope.');
    } catch (e: any) {
      Alert.alert('Assignment failed', e?.message || 'Could not assign this violation.');
    }
  }

  return (
    <ScrollView contentContainerStyle={ui.wrap}>
      <Text style={ui.h}>CPM Supervisor Scope Review</Text>
      <Text style={ui.label}>Full scope and quote, read-only.</Text>
      <TextInput style={ui.input} placeholder="Optional review note" value={note} onChangeText={setNote} multiline />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pressable style={[ui.btn, { flex: 1 }]} onPress={() => review('approve')}><Text style={ui.btnText}>Approve for Procurement</Text></Pressable>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => review('reject')}><Text style={ui.btnOutlineText}>Return to CPM</Text></Pressable>
        <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => setReceiverOpen(true)}><Text style={ui.btnOutlineText}>Hand off in-house</Text></Pressable>
      </View>
      <Text style={[ui.label, { marginTop: 8 }]}>In-house requested trade</Text>
      <TextInput style={ui.input} value={trade} onChangeText={setTrade} placeholder="e.g. Plumber" />
      <Pressable style={ui.input} onPress={() => setReceiverOpen(true)}>
        <Text style={{ color: receiver ? '#000' : '#999' }}>{receiver?.name || 'Select receiving trade supervisor'}</Text>
      </Pressable>
      <Modal visible={receiverOpen} animationType="slide" onRequestClose={() => setReceiverOpen(false)}>
        <ScrollView contentContainerStyle={ui.wrap}>
          <Text style={ui.h}>Receiving trade supervisor</Text>
          {receivers.filter((person) => /supervisor/i.test(person.position || '')).map((person) => (
            <Pressable key={person.id} style={ui.card} onPress={() => { setReceiver(person); setReceiverOpen(false); }}>
              <Text style={{ fontWeight: '700' }}>{person.name}</Text>
              <Text style={ui.listSub}>{person.position || 'Supervisor'}</Text>
            </Pressable>
          ))}
          {receivers.length === 0 && <Text style={ui.empty}>No eligible supervisors available offline.</Text>}
          <Pressable style={ui.btnOutline} onPress={() => setReceiverOpen(false)}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
        </ScrollView>
      </Modal>
      <Modal visible={!!violationCpm} transparent animationType="slide" onRequestClose={() => setViolationCpm(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>Select assigned CPM</Text>
            <ScrollView>
              {violationCpm && receivers
                .filter((s) => s.role === 'inspector' && String(s.position || '').trim().toLowerCase() === 'cpm'
                  && (!violationCpm.development || (s.developments || []).some((d) => d.trim().toLowerCase() === violationCpm!.development!.trim().toLowerCase())))
                .map((person) => <Pressable key={person.id} style={ui.card} onPress={() => assignCpm(violationCpm, person)}>
                  <Text style={{ fontWeight: '700' }}>{person.name}</Text><Text style={ui.listSub}>CPM · {person.developments?.join(', ') || '—'}</Text>
                </Pressable>)}
            </ScrollView>
            <Pressable style={ui.btnOutline} onPress={() => setViolationCpm(null)}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={exportExcel}>
        <Text style={[ui.btnOutlineText, { color: ACCENT }]}>Export to Excel</Text>
      </Pressable>

      <View style={[ui.card, { gap: 6 }]}>
        {req.sourceEntity === 'building-violations' && <Text style={{ color: ACCENT, fontWeight: '700' }}>Source: Inspector violation</Text>}
        {req.sourceEntity === 'building-violations' && !!req.violationNo && <View style={ui.line}><Text style={ui.lineK}>Violation number</Text><Text style={ui.lineV}>{req.violationNo}</Text></View>}
        <View style={ui.line}><Text style={ui.lineK}>Address</Text><Text style={ui.lineV}>{displayAddress}</Text></View>
        <Text style={ui.label}>Scope</Text>
        <Text>{req.scope}</Text>
        {req.sourceEntity === 'building-violations' && !!req.violationNotes && <><Text style={ui.label}>Inspector notes</Text><Text>{req.violationNotes}</Text></>}
        {!!req.scopeFileName && (
          <Pressable onPress={openFile}>
            <Text style={[ui.listSub, { color: ACCENT, fontWeight: '600' }]}>Open file: {req.scopeFileName}</Text>
          </Pressable>
        )}
        <Text style={ui.listSub}>From {req.requestedBy || 'CPM'}  {fmt(req.requestedAt)}</Text>
      </View>

      {/* ── Divisions scope ── */}
      {divScope ? (
        <>
          <Text style={[ui.h, { fontSize: 18, marginTop: 16 }]}>Scope of Work</Text>
          {!!divScope.header && (
            <View style={[ui.card, { gap: 3 }]}>
              {!!divScope.header.contractor && <View style={ui.line}><Text style={ui.lineK}>Contractor</Text><Text style={ui.lineV}>{divScope.header.contractor}</Text></View>}
              {!!divScope.header.projectManager && <View style={ui.line}><Text style={ui.lineK}>CPM</Text><Text style={ui.lineV}>{divScope.header.projectManager}</Text></View>}
              {!!divScope.header.numDUs && <View style={ui.line}><Text style={ui.lineK}># of DUs</Text><Text style={ui.lineV}>{divScope.header.numDUs}</Text></View>}
              {!!divScope.header.date && <View style={ui.line}><Text style={ui.lineK}>Date</Text><Text style={ui.lineV}>{divScope.header.date}</Text></View>}
            </View>
          )}
          {divScope.divisions.map((d) => (
            <View key={d.id} style={{ marginTop: 10 }}>
              <Text style={{ backgroundColor: '#d9ead3', fontWeight: '800', padding: 8, borderRadius: 6 }}>{d.title}</Text>
              {d.sections.map((sec) => (
                <View key={sec.id} style={[ui.card, { marginTop: 6, gap: 4 }]}>
                  <Text style={{ fontWeight: '700' }}>{sec.code}</Text>
                  {sec.lines.map((l) => (
                    <View key={l.id} style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 4 }}>
                      <Text>{l.description || '(no description)'}</Text>
                      <View style={ui.line}>
                        <Text style={ui.listSub}>{(l.quantity || '—')} {l.unit || ''} @ {l.unitCost ? money(parseNum(l.unitCost)) : '—'}</Text>
                        <Text style={{ fontWeight: '600' }}>{money(lineAmount(l))}</Text>
                      </View>
                    </View>
                  ))}
                  <View style={ui.line}><Text style={{ fontWeight: '700' }}>Sub-Total</Text><Text style={{ fontWeight: '700' }}>{money(sectionTotal(sec))}</Text></View>
                </View>
              ))}
            </View>
          ))}
          <View style={[ui.card, { borderColor: ACCENT, borderWidth: 1.5, marginTop: 12, gap: 6 }]}>
            <View style={ui.line}><Text style={[ui.lineK, { fontWeight: '700', color: '#000' }]}>Grand Total Construction Cost</Text><Text style={[ui.lineV, { fontWeight: '700' }]}>{money(scopeGrandTotal(divScope))}</Text></View>
            <View style={ui.line}><Text style={ui.lineK}>Cost Per D.U.</Text><Text style={ui.lineV}>{money(costPerDU(divScope))}</Text></View>
          </View>
        </>
      ) : (
        <>
          {/* ── old cost-estimate quote (fallback) ── */}
          <Text style={[ui.h, { fontSize: 18, marginTop: 16 }]}>Quote</Text>
          {filled.length === 0 && <Text style={ui.empty}>No line items entered.</Text>}
          {filled.map(({ c, row }) => (
            <View key={c.id} style={[ui.card, { gap: 4 }]}>
              <Text style={{ fontWeight: '700' }}>{c.title}</Text>
              {!!String(row.location || '').trim() && <Text style={ui.listSub}>Location: {row.location}</Text>}
              {!!String(row.description || '').trim() && <Text>{row.description}</Text>}
              {!!String(row.cost || '').trim() && <Text style={{ fontWeight: '600' }}>Cost: {row.cost}</Text>}
            </View>
          ))}
          {filled.length > 0 && (
            <View style={[ui.card, { gap: 6, marginTop: 8 }]}>
              <Text style={{ fontWeight: '700' }}>Totals</Text>
              <View style={ui.line}><Text style={ui.lineK}>Cost estimate</Text><Text style={ui.lineV}>{money(costEstimate)}</Text></View>
              <View style={ui.line}><Text style={ui.lineK}>Contingency (10%)</Text><Text style={ui.lineV}>{money(contingency)}</Text></View>
              <View style={ui.line}><Text style={[ui.lineK, { fontWeight: '700', color: '#000' }]}>Total</Text><Text style={[ui.lineV, { fontWeight: '700' }]}>{money(grandTotal)}</Text></View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
