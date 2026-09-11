import { Modal, View, Image, Pressable, Text } from 'react-native';
import { photoUri } from '../lib/photos';

export default function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}
        onPress={onClose}
      >
        {!!uri && (
          <Image source={{ uri: photoUri(uri) }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
        )}
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 60, right: 24, padding: 8 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Close</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
