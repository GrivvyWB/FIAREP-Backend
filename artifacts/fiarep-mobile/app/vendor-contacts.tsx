import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  listVendorContacts,
  addVendorContact,
  updateVendorContact,
  deleteVendorContact,
  type VendorContact,
} from '../lib/store';
import { ui, ACCENT } from '../lib/ui';

export default function VendorContacts() {
  const [contacts, setContacts] = useState<VendorContact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => { listVendorContacts().then(setContacts); }, []);
  useFocusEffect(load);

  function reset() {
    setName(''); setPhone(''); setEmail(''); setEditingId(null);
  }

  async function onSave() {
    const nm = name.trim();
    if (!nm) { Alert.alert('Name required', 'Enter the vendor name.'); return; }
    if (editingId) {
      await updateVendorContact(editingId, nm, phone.trim(), email.trim());
    } else {
      await addVendorContact(nm, phone.trim(), email.trim());
    }
    reset();
    load();
  }

  function onEdit(c: VendorContact) {
    setEditingId(c.id);
    setName(c.name);
    setPhone(c.phone);
    setEmail(c.email);
  }

  function onDelete(c: VendorContact) {
    Alert.alert('Remove vendor?', 'Remove ' + c.name + ' from the contact list.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteVendorContact(c.id); if (editingId === c.id) reset(); load(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
    <ScrollView contentContainerStyle={ui.wrap} keyboardShouldPersistTaps="handled">
      <Text style={ui.h}>Vendor Contacts</Text>
      <Text style={ui.label}>Contractors procurement broadcasts bid invitations to.</Text>

      <Text style={ui.label}>Name</Text>
      <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="Company or contact name" autoCapitalize="words" />

      <Text style={ui.label}>Phone</Text>
      <TextInput style={ui.input} value={phone} onChangeText={setPhone} placeholder="Phone" keyboardType="phone-pad" />

      <Text style={ui.label}>Email</Text>
      <TextInput style={ui.input} value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

      <Pressable style={[ui.btn, { marginTop: 10 }]} onPress={onSave}>
        <Text style={ui.btnText}>{editingId ? 'Save changes' : 'Add vendor'}</Text>
      </Pressable>
      {editingId && (
        <Pressable style={[ui.btnOutline, { marginTop: 8 }]} onPress={reset}>
          <Text style={ui.btnOutlineText}>Cancel edit</Text>
        </Pressable>
      )}

      <Text style={[ui.h, { fontSize: 18, marginTop: 22 }]}>Contacts ({contacts.length})</Text>
      {contacts.length === 0 && <Text style={ui.empty}>No vendors yet.</Text>}

      {contacts.map((c) => (
        <View key={c.id} style={{ borderWidth: 1, borderColor: '#e2e2e2', borderRadius: 10, padding: 12, marginTop: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>{c.name}</Text>
          {!!c.phone && <Text style={{ fontSize: 14, color: '#444', marginTop: 2 }}>{c.phone}</Text>}
          {!!c.email && <Text style={{ fontSize: 14, color: '#444', marginTop: 2 }}>{c.email}</Text>}
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            <Pressable onPress={() => onEdit(c)}><Text style={{ color: ACCENT, fontWeight: '600' }}>Edit</Text></Pressable>
            <Pressable onPress={() => onDelete(c)}><Text style={{ color: '#c0392b', fontWeight: '600' }}>Remove</Text></Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
