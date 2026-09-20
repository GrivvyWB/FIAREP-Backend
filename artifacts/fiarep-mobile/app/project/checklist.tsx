import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getChecklist, setChecklist } from '../../lib/store';
import { CHECKLIST_TEMPLATE, checklistProgress, type ChecklistState } from '../../lib/checklist';
import { ui } from '../../lib/ui';
import { useAppMode } from '../_layout';

export default function Checklist() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { mode } = useAppMode();
  const readOnly = mode === 'administrator';
  const [state, setState] = useState<ChecklistState>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    if (projectId) getChecklist(projectId).then(setState);
  }, [projectId]);
  useFocusEffect(load);

  const save = (next: ChecklistState) => {
    setState(next);
    if (projectId) setChecklist(projectId, next);
  };
  const toggle = (id: string) => {
    const cur = state[id] ?? { done: false };
    save({ ...state, [id]: { ...cur, done: !cur.done } });
  };
  const setNote = (id: string, note: string) => {
    const cur = state[id] ?? { done: false };
    save({ ...state, [id]: { ...cur, note } });
  };
  const toggleSection = (title: string) => setOpen(o => ({ ...o, [title]: !o[title] }));

  const prog = checklistProgress(state);

  const sectionDone = (items: { id: string }[]) =>
    items.filter(i => state[i.id]?.done).length;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap}>
      <View style={[ui.card, { borderColor: '#185FA5' }]}>
        <View style={ui.totalRow}>
          <Text style={ui.totalK}>Progress</Text>
          <Text style={ui.totalV}>{prog.done} / {prog.total}</Text>
        </View>
        <View style={{ height: 8, backgroundColor: '#eee', borderRadius: 4, marginTop: 8, overflow: 'hidden' }}>
          <View style={{ height: 8, width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%`, backgroundColor: '#185FA5' }} />
        </View>
      </View>

      {CHECKLIST_TEMPLATE.map(section => {
        const isOpen = open[section.title] ?? false;
        const done = sectionDone(section.items);
        return (
          <View key={section.title} style={ui.card}>
            <Pressable onPress={() => toggleSection(section.title)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '500' }}>{section.icon}  {section.title}</Text>
              <Text style={{ color: '#666', fontSize: 13 }}>{done}/{section.items.length}  {isOpen ? '▾' : '▸'}</Text>
            </Pressable>

            {isOpen && (
              <View style={{ marginTop: 10, gap: 12 }}>
                {section.items.map(item => {
                  const st = state[item.id] ?? { done: false };
                  return (
                    <View key={item.id}>
                      <Pressable onPress={() => { if (readOnly) return; toggle(item.id); }} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                        <View style={{
                          width: 22, height: 22, borderRadius: 5, borderWidth: 2,
                          borderColor: st.done ? '#185FA5' : '#bbb',
                          backgroundColor: st.done ? '#185FA5' : 'transparent',
                          alignItems: 'center', justifyContent: 'center', marginTop: 1,
                        }}>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, color: st.done ? '#999' : '#1a1a1a', textDecorationLine: st.done ? 'line-through' : 'none' }}>{item.label}</Text>
                          {!!item.hint && <Text style={{ fontSize: 12, color: '#999' }}>{item.hint}</Text>}
                        </View>
                      </Pressable>
                      <TextInput editable={!readOnly}
                        style={[ui.input, { marginTop: 6, marginLeft: 32, fontSize: 13, paddingVertical: 6 }]}
                        value={st.note ?? ''}
                        onChangeText={t => setNote(item.id, t)}
                        placeholder="Note (optional)"
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
