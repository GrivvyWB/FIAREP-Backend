// The language the app shows in: a small button that opens the list of languages.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { currentLanguage, onLanguageChange, screenLanguages, setScreenLanguage, type ScreenLanguage } from '../lib/screen-language';
import { moduleEnabled } from '../lib/module-access';

export default function LanguageButton({ dark = false }: { dark?: boolean }) {
  const code = useSyncExternalStore(onLanguageChange, currentLanguage);
  const [open, setOpen] = useState(false);
  const [langs, setLangs] = useState<ScreenLanguage[]>([{ code: 'en', name: 'English', rtl: false }]);
  // Platform Control → Modules → "Your language" (company or this person). Off: back to English.
  const on = moduleEnabled('app-language');
  useEffect(() => { if (!on && currentLanguage() !== 'en') void setScreenLanguage('en'); }, [on]);
  useEffect(() => { void screenLanguages().then(setLangs); }, []);
  if (!on) return null;
  const name = langs.find((l) => l.code === code)?.name || (code === 'en' ? 'English' : code.toUpperCase());
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Language"
        style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: dark ? '#5EB3FF88' : '#cbd5e1', backgroundColor: dark ? '#0B1F45' : '#fff', minHeight: 32 }}>
        <Ionicons name="globe-outline" size={16} color={dark ? '#BFE0FF' : '#334155'} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: dark ? '#E6F2FF' : '#0f172a' }}>{name}</Text>
        <Ionicons name="chevron-down" size={14} color={dark ? '#BFE0FF' : '#64748b'} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#0008' }} onPress={() => setOpen(false)} />
        <View style={{ maxHeight: '70%', backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 14, paddingBottom: 30 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>Language</Text>
          <ScrollView>
            {langs.map((l) => (
              <Pressable key={l.code} onPress={() => { setOpen(false); void setScreenLanguage(l.code, l.rtl); }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 22, borderBottomWidth: 1, borderColor: '#f1f5f9' }}>
                <Text style={{ fontSize: 16, color: '#0f172a' }}>{l.name}</Text>
                {l.code === code ? <Ionicons name="checkmark" size={20} color="#185FA5" /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
