// Phrase help for complaint / report text boxes.
//  • As the person types, matching phrases appear as tappable chips.
//  • With `picker`, a collapsible "Pick an issue" drop-down lists every phrase
//    by trade (for workers, inspectors, carpenters, maintenance …).
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { PHRASE_GROUPS, suggestPhrases, applyPhrase, pickedPhraseIn } from '../lib/complaintPhrases';
import { ACCENT } from '../lib/ui';

type Props = {
  value: string;
  onChange: (next: string) => void;
  picker?: boolean;
  label?: string;
};

export default function PhraseHelper({ value, onChange, picker = false, label = 'Pick an issue' }: Props) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const suggestions = suggestPhrases(value || '');
  const picked = pickedPhraseIn(value || '');
  const pick = (phrase: string) => {
    onChange(applyPhrase(value || '', phrase));
    setOpen(false);
    setGroup(null);
  };
  return (
    <View style={{ gap: 6 }}>
      {suggestions.length > 0 && (
        <View>
          <Text style={s.hint}>Did you mean:</Text>
          <View style={s.chips}>
            {suggestions.map((p) => (
              <Pressable key={p} style={s.chip} onPress={() => pick(p)}>
                <Text style={s.chipText}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      {picker && (
        <View style={s.box}>
          <Pressable style={s.header} onPress={() => { setOpen(!open); setGroup(null); }}>
            <Text style={[s.headerText, { flex: 1 }]} numberOfLines={1}>{picked ? `Issue: ${picked}` : label}</Text>
            <Text style={s.headerText}>{open ? '▲' : '▼'}</Text>
          </Pressable>
          {open && PHRASE_GROUPS.map((g) => (
            <View key={g.label}>
              <Pressable style={s.groupRow} onPress={() => setGroup(group === g.label ? null : g.label)}>
                <Text style={s.groupText}>{g.label}</Text>
                <Text style={s.groupArrow}>{group === g.label ? '−' : '+'}</Text>
              </Pressable>
              {group === g.label && g.phrases.map((p) => (
                <Pressable key={g.label + p} style={[s.phraseRow, p === picked && { backgroundColor: '#EEF4FB' }]} onPress={() => pick(p)}>
                  <Text style={[s.phraseText, p === picked && { color: ACCENT, fontWeight: '700' }]}>{p === picked ? '\u2713 ' : ''}{p}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, color: '#666', marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: ACCENT, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#EEF4FB' },
  chipText: { color: ACCENT, fontSize: 13, fontWeight: '500' },
  box: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, backgroundColor: '#fff', overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 12 },
  headerText: { color: ACCENT, fontWeight: '600', fontSize: 15 },
  groupRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fafafa' },
  groupText: { fontWeight: '600', fontSize: 14, color: '#333' },
  groupArrow: { fontWeight: '700', fontSize: 16, color: '#666' },
  phraseRow: { paddingVertical: 10, paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: '#f2f2f2' },
  phraseText: { fontSize: 14, color: '#222' },
});
