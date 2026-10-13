import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';

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

/**
 * One choice out of a list, as a dropdown rather than a wall of chips: the
 * field shows what is picked, tapping it slides the list up from the bottom.
 * Long lists stay one tap away instead of filling the screen.
 */
export function PickOne(props: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  title?: string;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const empty = !props.value;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{ borderWidth: 1, borderColor: '#d8d8d8', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 12, backgroundColor: '#fff' }}
      >
        <Text style={{ fontWeight: empty ? '400' : '600', color: empty ? '#999' : '#111' }}>
          {props.value || props.placeholder || 'Pick one'}  {'\u25be'}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, padding: 16 }}>{props.title || 'Pick one'}</Text>
            <ScrollView>
              <Pressable
                onPress={() => { props.onChange(''); setOpen(false); }}
                style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}
              >
                <Text style={{ fontSize: 15, color: '#999' }}>{props.clearLabel || 'None'}</Text>
              </Pressable>
              {props.options.map((o) => (
                <Pressable
                  key={o}
                  onPress={() => { props.onChange(o); setOpen(false); }}
                  style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#eee' }}
                >
                  <Text style={{ fontSize: 15, fontWeight: props.value === o ? '700' : '400', color: props.value === o ? '#185FA5' : '#000' }}>{o}</Text>
                </Pressable>
              ))}
              {props.options.length === 0 && <Text style={{ padding: 16, color: '#999' }}>Nothing to pick yet — connect to the internet and try again.</Text>}
            </ScrollView>
            <Pressable onPress={() => setOpen(false)} style={{ padding: 16 }}>
              <Text style={{ color: '#185FA5', fontWeight: '700', textAlign: 'center' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
