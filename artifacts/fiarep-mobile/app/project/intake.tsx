import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getIntake, setIntake } from '../../lib/store';
import { EMPTY_INTAKE, SCOPE_ITEMS, APT_CHECK_ITEMS, BUILDING_TYPE_OPTS, SYSTEM_SECTIONS, type IntakeState, type IntakeApartment } from '../../lib/intake';
import { ui } from '../../lib/ui';
import { useAppMode } from '../_layout';
import { captureGeo, geoLabel } from '../../lib/geo';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildIntakeHTML } from '../../lib/intakeReport';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export default function Intake() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { mode } = useAppMode();
  const readOnly = mode === 'administrator';
  const [s, setS] = useState<IntakeState>(EMPTY_INTAKE);
  const [open, setOpen] = useState<Record<string, boolean>>({ cover: true });

  const load = useCallback(() => {
    if (projectId) getIntake(projectId).then((v: any) => setS(v && v.header ? { ...EMPTY_INTAKE, ...v } : EMPTY_INTAKE));
  }, [projectId]);
  useFocusEffect(load);

  const save = (next: IntakeState) => { setS(next); if (projectId) setIntake(projectId, next); };
  const stampLocation = async () => {
    const geo = await captureGeo();
    save({ ...s, _geo: geo } as any);
    Alert.alert('Location stamped', geoLabel(geo) + (geo.source === 'none' ? '\n\n(GPS activates after the next app build; time recorded now.)' : ''));
  };
  const toggleSec = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const generatePDF = async () => {
    try {
      const html = buildIntakeHTML(s);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Intake Report' });
      } else { await Print.printAsync({ uri }); }
    } catch (e) {}
  };

  const setHeader = (k: string, v: string) => save({ ...s, header: { ...s.header, [k]: v } });
  const toggleMulti = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const toggleField = (fid: string, opt: string) => {
    const cur = s.fields[fid] ?? [];
    const next = cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt];
    save({ ...s, fields: { ...s.fields, [fid]: next } });
  };
  const setTotal = (fid: string, v: string) => save({ ...s, totals: { ...s.totals, [fid]: v } });
  const setDescribe = (sid: string, v: string) => save({ ...s, describe: { ...s.describe, [sid]: v } });

  const addApt = () => save({ ...s, apartments: [...s.apartments, { id: uid(), number: '', bedrooms: '', checks: {}, recommendations: [] } as IntakeApartment] });
  const setApt = (id: string, patch: Partial<IntakeApartment>) => save({ ...s, apartments: s.apartments.map(a => a.id === id ? { ...a, ...patch } : a) });
  const removeApt = (id: string) => save({ ...s, apartments: s.apartments.filter(a => a.id !== id) });
  const setAptCheck = (id: string, item: string, val: string) => {
    const a = s.apartments.find(x => x.id === id); if (!a) return;
    const checks = { ...a.checks, [item]: a.checks[item] === val ? '' : val };
    setApt(id, { checks });
  };
  const addRec = (id: string) => {
    const a = s.apartments.find(x => x.id === id); if (!a) return;
    setApt(id, { recommendations: [...a.recommendations, { id: uid(), condition: '', work: '' }] });
  };
  const setRec = (id: string, rid: string, patch: any) => {
    const a = s.apartments.find(x => x.id === id); if (!a) return;
    setApt(id, { recommendations: a.recommendations.map(r => r.id === rid ? { ...r, ...patch } : r) });
  };
  const removeRec = (id: string, rid: string) => {
    const a = s.apartments.find(x => x.id === id); if (!a) return;
    setApt(id, { recommendations: a.recommendations.filter(r => r.id !== rid) });
  };

  const chip = (lbl: string, sel: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key ?? lbl} onPress={() => { if (readOnly) return; onPress(); }} style={{
      borderWidth: 1, borderColor: sel ? '#185FA5' : '#ccc', backgroundColor: sel ? '#185FA5' : '#fff',
      borderRadius: 14, paddingVertical: 5, paddingHorizontal: 11, marginRight: 6, marginBottom: 6,
    }}><Text style={{ color: sel ? '#fff' : '#333', fontSize: 12 }}>{lbl}</Text></Pressable>
  );
  const field = (lbl: string, val: string, on: (t: string) => void, opts: any = {}) => (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>{lbl}</Text>
      <TextInput value={val} onChangeText={on} placeholder={opts.ph ?? ''} placeholderTextColor="#999"
        keyboardType={opts.num ? 'numeric' : 'default'} multiline={opts.multi}
        style={[ui.input, opts.multi ? { minHeight: opts.h ?? 60 } : null]} />
    </View>
  );
  const secHead = (key: string, title: string) => (
    <Pressable onPress={() => toggleSec(key)}><Text style={ui.cardTitle}>{title}  {(open[key] ?? false) ? '\u25be' : '\u25b8'}</Text></Pressable>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 17, fontWeight: '600' }}>Intake Report</Text>
      <Pressable style={[ui.btnOutline, { marginTop: 4 }]} onPress={generatePDF}>
        <Text style={ui.btnOutlineText}>Generate PDF</Text>
      </Pressable>
      <Pressable style={[ui.btnOutline, { marginTop: 6 }]} onPress={stampLocation}>
        <Text style={ui.btnOutlineText}>{(s as any)._geo ? 'Location Stamped \u2713' : 'Stamp Location & Time'}</Text>
      </Pressable>

      {/* COVER PAGE */}
      <View style={ui.card}>
        {secHead('cover', 'Cover / Building Overview')}
        {(open.cover ?? true) && (<View>
          {field('Building Address', s.header.address ?? '', t => setHeader('address', t))}
          {field('Inspection Date(s)', s.header.dates ?? '', t => setHeader('dates', t))}
          {field('Const. Project Manager(s)', s.header.cpm ?? '', t => setHeader('cpm', t))}
          {field('Date', s.header.date ?? '', t => setHeader('date', t))}

          <Text style={{ fontSize: 12, color: '#555', marginTop: 6, marginBottom: 4 }}>Building Type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {BUILDING_TYPE_OPTS.map(o => chip(o, s.buildingType.includes(o), () => save({ ...s, buildingType: toggleMulti(s.buildingType, o) }), o))}
          </View>

          {field('Number of Stories', s.stories, t => save({ ...s, stories: t }), { num: true })}
          <Text style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>Basement / Cellar</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {['Basement', 'Cellar'].map(o => chip(o, s.basementCellar.includes(o), () => save({ ...s, basementCellar: toggleMulti(s.basementCellar, o) }), o))}
          </View>
          {field('Total D.U.', s.duTotal, t => save({ ...s, duTotal: t }), { num: true })}
          {field('One bed', s.aptDist.oneBed ?? '', t => save({ ...s, aptDist: { ...s.aptDist, oneBed: t } }), { num: true })}
          {field('Two bed', s.aptDist.twoBed ?? '', t => save({ ...s, aptDist: { ...s.aptDist, twoBed: t } }), { num: true })}
          {field('Three bed', s.aptDist.threeBed ?? '', t => save({ ...s, aptDist: { ...s.aptDist, threeBed: t } }), { num: true })}
          {field('Apts / Areas Inspected', s.aptsInspected, t => save({ ...s, aptsInspected: t }), { multi: true, h: 40 })}
          {field('Noted Vacancies', s.vacancies, t => save({ ...s, vacancies: t }))}
        </View>)}
      </View>

      {/* VIOLATION SUMMARY */}
      <View style={ui.card}>
        {secHead('viol', 'Violation Summary Recorded to Date')}
        {(open.viol ?? false) && (<View>
          {field('Class "A" violations', s.violations.classA ?? '', t => save({ ...s, violations: { ...s.violations, classA: t } }), { num: true })}
          {field('Class "B" violations', s.violations.classB ?? '', t => save({ ...s, violations: { ...s.violations, classB: t } }), { num: true })}
          {field('Class "C" violations', s.violations.classC ?? '', t => save({ ...s, violations: { ...s.violations, classC: t } }), { num: true })}
          {field('# Lead violations', s.violations.lead ?? '', t => save({ ...s, violations: { ...s.violations, lead: t } }), { num: true })}
          {field('Apartments w/ Lead violation', s.violations.leadApts ?? '', t => save({ ...s, violations: { ...s.violations, leadApts: t } }))}
          {field('# Mold violations', s.violations.mold ?? '', t => save({ ...s, violations: { ...s.violations, mold: t } }), { num: true })}
          {field('Apartments w/ Mold violation', s.violations.moldApts ?? '', t => save({ ...s, violations: { ...s.violations, moldApts: t } }))}
          {field('# Building Dept. Violations', s.violations.dob ?? '', t => save({ ...s, violations: { ...s.violations, dob: t } }), { num: true })}
          {field('# Environmental Control Board Violations', s.violations.ecb ?? '', t => save({ ...s, violations: { ...s.violations, ecb: t } }), { num: true })}
        </View>)}
      </View>

      {/* SCOPE OF WORK */}
      <View style={ui.card}>
        {secHead('scope', 'Recommended Scope of Work (Priority)')}
        {(open.scope ?? false) && (<View>
          {SCOPE_ITEMS.map((it, i) => (
            <Pressable key={it.id} onPress={() => { if (readOnly) return; save({ ...s, scopeOfWork: { ...s.scopeOfWork, [it.id]: !s.scopeOfWork[it.id] } }); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
              <Text style={{ fontSize: 16, marginRight: 8 }}>{s.scopeOfWork[it.id] ? '\u2611' : '\u2610'}</Text>
              <Text style={{ fontSize: 14 }}>{i + 1}. {it.label}</Text>
            </Pressable>
          ))}
        </View>)}
      </View>

      {/* HIGHLIGHTS */}
      <View style={ui.card}>
        {secHead('hl', 'Building Highlights')}
        {(open.hl ?? false) && (<View>
          {field('Building Highlights (narrative)', s.highlights, t => save({ ...s, highlights: t }), { multi: true, h: 120 })}
          {field('Lead (children under 6?)', s.leadNote, t => save({ ...s, leadNote: t }), { multi: true, h: 40 })}
          {field('Mold', s.moldNote, t => save({ ...s, moldNote: t }), { multi: true, h: 40 })}
          {field('Structural', s.structuralNote, t => save({ ...s, structuralNote: t }), { multi: true, h: 40 })}
        </View>)}
      </View>

      {/* BUILDING / SYSTEMS SECTIONS */}
      {SYSTEM_SECTIONS.map(sec => (
        <View key={sec.id} style={ui.card}>
          {secHead('sys-' + sec.id, sec.title)}
          {(open['sys-' + sec.id] ?? false) && (<View>
            {sec.fields.map(fld => (
              <View key={fld.id} style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: '500', marginBottom: 4 }}>{fld.label}</Text>
                {fld.options.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {fld.options.map(opt => chip(opt, (s.fields[fld.id] ?? []).includes(opt), () => toggleField(fld.id, opt), opt))}
                  </View>
                )}
                {fld.total && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <TextInput editable={!readOnly} value={s.totals[fld.id] ?? ''} onChangeText={t => setTotal(fld.id, t)} placeholder="—" placeholderTextColor="#999" style={[ui.input, { flex: 1 }]} />
                    <Text style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>{fld.total}</Text>
                  </View>
                )}
              </View>
            ))}
            <Text style={{ fontSize: 12, color: '#555', marginTop: 4, marginBottom: 3 }}>Describe / Recommend</Text>
            <TextInput editable={!readOnly} value={s.describe[sec.id] ?? ''} onChangeText={t => setDescribe(sec.id, t)} placeholder="Describe / recommend…" placeholderTextColor="#999" style={[ui.input, { minHeight: 60 }]} multiline />
          </View>)}
        </View>
      ))}

      {/* APARTMENT CHECKLISTS */}
      <View style={ui.card}>
        <Text style={ui.cardTitle}>Apartment Checklists</Text>
        {s.apartments.length === 0 && <Text style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>No apartments yet. Add each unit inspected.</Text>}
        <Pressable style={[ui.btnOutline, { marginBottom: 8 }]} onPress={addApt}><Text style={ui.btnOutlineText}>+ Add apartment</Text></Pressable>
      </View>

      {s.apartments.map(a => (
        <View key={a.id} style={ui.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={ui.cardTitle}>Apartment {a.number || '(new)'}</Text>
            <Pressable onPress={() => removeApt(a.id)}><Text style={{ color: '#c00', fontSize: 13 }}>Remove</Text></Pressable>
          </View>
          {field('Apartment No.', a.number, t => setApt(a.id, { number: t }), { ph: 'e.g. 2R' })}
          {field('No. of bedrooms', a.bedrooms, t => setApt(a.id, { bedrooms: t }), { num: true })}
          {APT_CHECK_ITEMS.map(item => (
            <View key={item.id} style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 13, marginBottom: 4 }}>{item.label}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {item.options.map(opt => chip(opt, a.checks[item.id] === opt, () => setAptCheck(a.id, item.id, opt), opt))}
              </View>
            </View>
          ))}
          <Text style={{ fontSize: 13, fontWeight: '600', marginTop: 6, marginBottom: 4 }}>Recommendations</Text>
          {a.recommendations.map(r => (
            <View key={r.id} style={{ padding: 8, backgroundColor: '#f7f7f7', borderRadius: 8, marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable onPress={() => removeRec(a.id, r.id)}><Text style={{ color: '#c00', fontSize: 12 }}>Remove</Text></Pressable>
              </View>
              <TextInput editable={!readOnly} value={r.condition} onChangeText={t => setRec(a.id, r.id, { condition: t })} placeholder="Condition and location" placeholderTextColor="#999" style={[ui.input, { marginBottom: 6, minHeight: 40, backgroundColor: '#fff' }]} multiline />
              <TextInput editable={!readOnly} value={r.work} onChangeText={t => setRec(a.id, r.id, { work: t })} placeholder="Work required to remedy" placeholderTextColor="#999" style={[ui.input, { minHeight: 40, backgroundColor: '#fff' }]} multiline />
            </View>
          ))}
          <Pressable style={[ui.btnOutline, { paddingVertical: 8 }]} onPress={() => addRec(a.id)}><Text style={[ui.btnOutlineText, { fontSize: 13 }]}>+ Add recommendation</Text></Pressable>
        </View>
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
