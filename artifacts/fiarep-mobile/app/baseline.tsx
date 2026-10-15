// FIAREP Building Baseline — list of baseline assessments. FIAREP staff start a
// new one for a client building; a client sees its own completed baselines.
import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getSessionIdentity } from '../lib/store';
import { listBaselines, baselineClients, createBaseline, BAND_ICON, type Assessment, type ClientOrg } from '../lib/baseline';
import { ui } from '../lib/ui';

const NAVY = '#0B2A4A';
const BLUE = '#1C4E86';

export default function Baseline() {
  const router = useRouter();
  const [fiarep, setFiarep] = useState(false);
  const [list, setList] = useState<Assessment[] | null>(null);
  const [err, setErr] = useState('');
  const [clients, setClients] = useState<ClientOrg[]>([]);
  const [making, setMaking] = useState(false);
  const [client, setClient] = useState<ClientOrg | null>(null);
  const [address, setAddress] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [ownerCompany, setOwnerCompany] = useState('');
  const [buildingType, setBuildingType] = useState('Residential');
  const [units, setUnits] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    void (async () => {
      const id = await getSessionIdentity().catch(() => null);
      const isFiarep = (id?.tenantId || 'default') === 'default';
      setFiarep(isFiarep);
      try { setList(await listBaselines()); setErr(''); } catch (e: any) { setErr(String(e?.message || e)); setList([]); }
      if (isFiarep) baselineClients().then(setClients).catch(() => undefined);
    })();
  }, []));

  async function start() {
    if (!client) { Alert.alert('Client', 'Pick the client.'); return; }
    if (!address.trim()) { Alert.alert('Address', 'Enter the building address.'); return; }
    setBusy(true);
    try {
      const a = await createBaseline({ clientOrgId: client.id, address: address.trim(), propertyName: propertyName.trim(), ownerCompany: ownerCompany.trim(), buildingType, units: units.trim() ? Number(units) || null : null });
      setMaking(false);
      router.push(('/baseline-assess?id=' + encodeURIComponent(a.id)) as any);
    } catch (e: any) { Alert.alert('Baseline', String(e?.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ backgroundColor: '#eef2f7' }} contentContainerStyle={{ padding: 12, gap: 10 }} keyboardShouldPersistTaps="handled">
      <View style={{ backgroundColor: NAVY, borderRadius: 10, padding: 14 }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{fiarep ? 'New Client Building Baseline' : 'Building Baseline'}</Text>
        <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2 }}>Inspect. Prioritize. Repair. Track.</Text>
      </View>

      {fiarep && !making && <Pressable style={ui.btn} onPress={() => setMaking(true)}><Text style={ui.btnText}>+ Start a baseline assessment</Text></Pressable>}

      {fiarep && making && (
        <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, gap: 6, borderWidth: 1, borderColor: '#dbe3ee' }}>
          <Text style={{ fontWeight: '800', color: BLUE }}>BUILDING INFORMATION</Text>
          <Text style={ui.label}>Client</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {clients.map((c) => (
              <Pressable key={c.id} onPress={() => { setClient(c); setOwnerCompany((cur) => cur || c.name); if (c.buildings[0] && !address) { setAddress(c.buildings[0].address); if (c.buildings[0].units) setUnits(String(c.buildings[0].units)); } }}
                style={{ borderRadius: 999, borderWidth: 1, borderColor: client?.id === c.id ? BLUE : '#cbd5e1', backgroundColor: client?.id === c.id ? BLUE : '#fff', paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ color: client?.id === c.id ? '#fff' : '#0f172a', fontSize: 13 }}>{c.name}</Text>
              </Pressable>
            ))}
            {clients.length === 0 && <Text style={ui.listSub}>No client organizations yet — add the client in Platform Control first.</Text>}
          </View>
          {!!client && client.buildings.length > 1 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {client.buildings.map((b) => <Pressable key={b.address} onPress={() => { setAddress(b.address); if (b.units) setUnits(String(b.units)); }} style={{ borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1', paddingHorizontal: 8, paddingVertical: 4 }}><Text style={{ fontSize: 12 }}>{b.address}</Text></Pressable>)}
            </View>
          )}
          <TextInput style={ui.input} value={address} onChangeText={setAddress} placeholder="Building address" />
          <TextInput style={ui.input} value={propertyName} onChangeText={setPropertyName} placeholder="Property name" />
          <TextInput style={ui.input} value={ownerCompany} onChangeText={setOwnerCompany} placeholder="Owner / management company" />
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['Residential', 'Mixed Use', 'Commercial'].map((t) => (
              <Pressable key={t} onPress={() => setBuildingType(t)} style={{ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: buildingType === t ? BLUE : '#cbd5e1', backgroundColor: buildingType === t ? '#e8f0fb' : '#fff', padding: 8 }}>
                <Text style={{ textAlign: 'center', fontSize: 13, fontWeight: buildingType === t ? '700' : '400' }}>{buildingType === t ? '☑ ' : '☐ '}{t}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput style={ui.input} value={units} onChangeText={setUnits} placeholder="Number of units" keyboardType="number-pad" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[ui.btnOutline, { flex: 1 }]} onPress={() => setMaking(false)}><Text style={ui.btnOutlineText}>Cancel</Text></Pressable>
            <Pressable style={[ui.btn, { flex: 1 }, busy && { opacity: 0.6 }]} onPress={start} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.btnText}>Start walk-through</Text>}</Pressable>
          </View>
        </View>
      )}

      {list === null && <ActivityIndicator />}
      {!!err && <Text style={{ color: '#b91c1c' }}>{err}</Text>}
      {list && list.length === 0 && !err && <Text style={ui.empty}>{fiarep ? 'No baseline assessments yet.' : 'Your building baseline will appear here once FIAREP completes the walk-through.'}</Text>}
      {list?.map((a) => (
        <Pressable key={a.id} onPress={() => router.push(('/baseline-assess?id=' + encodeURIComponent(a.id)) as any)} style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#dbe3ee', gap: 2 }}>
          <Text style={{ fontWeight: '800' }}>{a.propertyName || a.address}</Text>
          <Text style={ui.listSub}>{a.reportId} · {a.address}{fiarep ? ' · ' + a.clientName : ''}</Text>
          <Text style={{ fontSize: 13 }}>{BAND_ICON[a.band] || ''} Health score {a.score} — {a.band} · {a.findings.length} finding{a.findings.length === 1 ? '' : 's'}</Text>
          <Text style={{ fontSize: 12, fontWeight: '700', color: a.status === 'complete' ? '#166534' : '#b45309' }}>{a.status === 'complete' ? 'Complete' : 'Walk-through in progress'}</Text>
        </Pressable>
      ))}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
