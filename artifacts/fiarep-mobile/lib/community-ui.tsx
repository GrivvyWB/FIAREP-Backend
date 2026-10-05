import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { ui } from './ui';
import { DEVELOPMENT_NAMES } from './developments.seed';
import { getSessionIdentity } from './store';

/** Single-choice (value/onChange) or multi-choice (values/onToggle) chips. */
export function Chips(props: {
  options: string[];
  value?: string; onChange?: (v: string) => void;
  values?: string[]; onToggle?: (v: string) => void;
  wrap?: boolean;
}) {
  const active = (o: string) => props.values ? props.values.includes(o) : props.value === o;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {props.options.map((o) => (
        <Pressable
          key={o}
          onPress={() => (props.values ? props.onToggle?.(o) : props.onChange?.(o))}
          style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active(o) ? '#111' : '#eee', maxWidth: props.wrap ? '100%' : undefined }}
        >
          <Text style={{ color: active(o) ? '#fff' : '#333', fontWeight: '600', fontSize: 13 }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Development: the coordinator's own developments first, any NYCHA
 * development by typing, or none (a private building). */
export function DevelopmentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [own, setOwn] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => { getSessionIdentity().then((i) => setOwn((i?.developments || []).filter(Boolean))).catch(() => undefined); }, []);
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return DEVELOPMENT_NAMES.filter((d) => d.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);
  return (
    <View style={{ gap: 6 }}>
      <Text style={ui.label}>Development (if NYCHA)</Text>
      {value ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontWeight: '600', flex: 1 }}>{value}</Text>
          <Pressable onPress={() => onChange('')}><Text style={{ color: '#b91c1c', fontWeight: '600' }}>Clear</Text></Pressable>
        </View>
      ) : (
        <>
          {own.length > 0 && <Chips options={own} value={value} onChange={onChange} wrap />}
          <TextInput style={ui.input} value={query} onChangeText={setQuery} placeholder="Type a development name, or leave empty for a private building" autoCapitalize="characters" />
          {suggestions.map((d) => (
            <Pressable key={d} onPress={() => { onChange(d); setQuery(''); }} style={{ padding: 10, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8 }}>
              <Text>{d}</Text>
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}
