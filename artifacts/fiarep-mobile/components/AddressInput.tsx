import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { searchNychaAddresses, type NychaAddress } from '@workspace/api-client-react';
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
  useCurrentLocation?: boolean;
}) {
  const [all, setAll] = useState<string[]>([]);
  const [official, setOfficial] = useState<NychaAddress[]>([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const dev = (props.development || '').trim();
    if (dev) { listAddressesForDevelopment(dev).then(setAll).catch(() => {}); }
    else { listAllAddresses().then(setAll).catch(() => {}); }
  }, [props.development]);

  useEffect(() => {
    const query = (props.value || '').trim();
    const development = (props.development || '').trim();
    if (!development && query.length < 2) {
      setOfficial([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchNychaAddresses({
        query: query || undefined,
        development: development || undefined,
        limit: 10,
      })
        .then((rows) => {
          if (!cancelled) setOfficial(rows);
        })
        .catch(() => {
          if (!cancelled) setOfficial([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [props.development, props.value]);

  useEffect(() => {
    if (!props.useCurrentLocation || props.value.trim()) return;
    let cancelled = false;

    const fillFromCurrentLocation = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted' || cancelled || props.value.trim()) return;
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const [place] = await Location.reverseGeocodeAsync(current.coords);
        if (!place || cancelled || props.value.trim()) return;
        const street = [place.streetNumber, place.street].filter(Boolean).join(' ');
        const city = place.city || place.subregion || place.district;
        const region = place.region;
        const postalCode = place.postalCode;
        const country = place.country;
        const address = [street, city, region, postalCode, country].filter(Boolean).join(', ');
        if (address) props.onChangeText(address);
      } catch {
        // Manual address entry remains available when location is unavailable.
      }
    };

    void fillFromCurrentLocation();
    return () => {
      cancelled = true;
    };
  }, [props.useCurrentLocation]);

  const q = (props.value || '').trim().toLowerCase();
  const hasDev = !!(props.development || '').trim();
  // With a development set, show its addresses on tap (even before typing);
  // otherwise require 2+ typed characters (general recent-address autocomplete).
  const officialAddresses = official.map((item) => item.address);
  const candidates = [...officialAddresses, ...all.filter((address) => !officialAddresses.some((officialAddress) => officialAddress.toLowerCase() === address.toLowerCase()))];
  const matches = focused && (hasDev || q.length >= 2)
    ? candidates.filter(a => (!q || a.toLowerCase().includes(q)) && a.toLowerCase() !== q).slice(0, 40)
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
        <View style={{ borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, marginTop: 2, overflow: 'hidden', maxHeight: 240 }}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {matches.map((a, i) => (
            <Pressable
              key={i}
              onPress={() => { props.onChangeText(a); setFocused(false); }}
              style={{ paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: '#f2f2f2', backgroundColor: '#fafafa' }}
            >
              <Text style={{ fontSize: 14, color: ACCENT }}>{a}</Text>
            </Pressable>
          ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
