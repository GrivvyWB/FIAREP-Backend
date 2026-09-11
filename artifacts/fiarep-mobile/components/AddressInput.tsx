import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { listAllAddresses, listAddressesForDevelopment } from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

// Drop-in replacement for an address TextInput. As the user types, it suggests
// matching addresses already in the system; tapping one fills the field.
export default function AddressInput(props: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  style?: any;
  editable?: boolean;
  autoCapitalize?: any;
  development?: string;
}) {
  const [all, setAll] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const dev = (props.development || '').trim();
    if (dev) { listAddressesForDevelopment(dev).then(setAll).catch(() => {}); }
    else { listAllAddresses().then(setAll).catch(() => {}); }
  }, [props.development]);

  const q = (props.value || '').trim().toLowerCase();
  const hasDev = !!(props.development || '').trim();
  // With a development set, show its addresses on tap (even before typing);
  // otherwise require 2+ typed characters (general recent-address autocomplete).
  const matches = focused && (hasDev || q.length >= 2)
    ? all.filter(a => (!q || a.toLowerCase().includes(q)) && a.toLowerCase() !== q).slice(0, 10)
    : [];

  return (
    <View>
      <TextInput
        style={props.style || ui.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#999"
        editable={props.editable !== false}
        autoCapitalize={props.autoCapitalize}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {matches.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, marginTop: 2, overflow: 'hidden' }}>
          {matches.map((a, i) => (
            <Pressable
              key={i}
              onPress={() => { props.onChangeText(a); setFocused(false); }}
              style={{ paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: '#f2f2f2', backgroundColor: '#fafafa' }}
            >
              <Text style={{ fontSize: 14, color: ACCENT }}>{a}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
