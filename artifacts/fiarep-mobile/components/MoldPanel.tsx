// Active mold in this apartment (CV-MOLD-001): shown as a priority item on the
// job. The member inspects and addresses it while there, then marks it Mold
// Removed — an after photo and the resident's sign-off (or not home / refused
// with the door video).
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { takePhotoWithGeo, uploadPhoto, type PhotoEvidence } from '../lib/photos';
import { uploadDoorVideo, signOffForServer } from '../lib/store';
import { ResidentSignOffSheet, type ResidentSignOff } from './ResidentSignOff';
import { ui } from '../lib/ui';

type MoldCase = { id: string; apartment: string; class: string; description: string; certifyBy: string | null };
const usDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${m}/${dd}/${y}`; };

export default function MoldPanel({ address, apartment, reportId, canRemove }: { address: string; apartment: string; reportId: string | null; canRemove: boolean }) {
  const [cases, setCases] = useState<MoldCase[]>([]);
  const [working, setWorking] = useState<{ c: MoldCase; photo: PhotoEvidence } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!address.trim() || !apartment.trim()) { setCases([]); return; }
    try { const r = await customFetch<{ cases: MoldCase[] }>(`/api/v1/mold/check?address=${encodeURIComponent(address)}&apartment=${encodeURIComponent(apartment)}`, { responseType: 'json' } as never); setCases(r.cases || []); }
    catch { setCases([]); }
  }, [address, apartment]);
  useEffect(() => { const t = setTimeout(() => void load(), 800); return () => clearTimeout(t); }, [load]); // typing: wait until they stop
  if (!cases.length) return null;

  async function start(c: MoldCase) {
    if (!reportId) { Alert.alert('Work order first', 'Create the work order for this apartment, then mark the mold removed.'); return; }
    try { const photo = await takePhotoWithGeo(); if (photo) setWorking({ c, photo }); }
    catch (e: any) { Alert.alert('Camera', String(e?.message ?? e)); }
  }
  async function finish(signOff: ResidentSignOff) {
    const w = working; setWorking(null);
    if (!w || !reportId) return;
    setBusy(true);
    try {
      const up = await uploadPhoto(w.photo.uri, 'completion-photo', { entity: 'resident-reports', recordId: reportId }, { capturedAt: w.photo.capturedAt, geo: w.photo.geo });
      let so = signOff;
      if (so.status !== 'signed') {
        await uploadPhoto(so.photo.uri, 'completion-photo', { entity: 'resident-reports', recordId: reportId }, { capturedAt: so.photo.capturedAt, geo: so.photo.geo }).catch(() => undefined);
        so = { ...so, video: { ...so.video, objectPath: await uploadDoorVideo(reportId, so.video) } };
      }
      const r = await customFetch<{ building?: { percentRemaining: number; inspectionRecommended: boolean } | null }>(`/api/v1/mold/cases/${encodeURIComponent(w.c.id)}/removed`, {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, photoObjectPath: up.objectPath, signOff: signOffForServer(so) }),
      } as never);
      await load();
      Alert.alert('Mold Removed', `Apt ${w.c.apartment} is off the active mold list.${r.building ? `\nBuilding: ${r.building.percentRemaining}% of mold violations remaining${r.building.inspectionRecommended ? ' — inspection recommended.' : '.'}` : ''}`);
    } catch (e: any) { Alert.alert('Not saved', e?.data?.error || e?.message || 'Check the connection and try again.'); }
    finally { setBusy(false); }
  }

  return (
    <View style={{ borderWidth: 2, borderColor: '#b91c1c', backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, gap: 8, marginBottom: 10 }}>
      <Text style={{ fontWeight: '800', color: '#991b1b' }}>PRIORITY — Active mold in apt {apartment}</Text>
      <Text style={{ color: '#7f1d1d' }}>Inspect and address the mold while doing this repair, then mark it Mold Removed (after photo + resident sign-off).</Text>
      {cases.map((c) => (
        <View key={c.id} style={{ gap: 6, borderTopWidth: 1, borderTopColor: '#fecaca', paddingTop: 8 }}>
          <Text style={{ color: '#111' }}>{c.class ? `Class ${c.class} · ` : ''}{c.description.replace(/^§\s*27-2017\.3\s*HMC:\s*/i, '').slice(0, 160)}{c.certifyBy ? ` · certify by ${usDate(c.certifyBy)}` : ''}</Text>
          {canRemove && (
            <Pressable style={[ui.btn, { backgroundColor: '#b91c1c' }, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => void start(c)}>
              <Text style={ui.btnText}>{busy ? 'Saving…' : 'Mold Removed — after photo'}</Text>
            </Pressable>
          )}
        </View>
      ))}
      <ResidentSignOffSheet
        visible={!!working}
        jobLine={`Mold removed · ${address} apt ${apartment}`}
        onCancel={() => setWorking(null)}
        onDone={(so) => void finish(so)}
      />
    </View>
  );
}
