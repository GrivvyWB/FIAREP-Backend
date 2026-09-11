import { Modal, Pressable, Text } from 'react-native';
import RemotePhoto from './RemotePhoto';
import type { StoredPhotoRef } from '../lib/photoResolver';

export default function PhotoViewer({ uri, remote, onClose }: { uri: string | null; remote?: StoredPhotoRef; onClose: () => void }) {
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}
        onPress={onClose}
      >
        {!!uri && (
          <RemotePhoto localUri={uri} remote={remote} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
        )}
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 60, right: 24, padding: 8 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Close</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
