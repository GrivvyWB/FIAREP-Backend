import { View, Text, Pressable } from 'react-native';

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
