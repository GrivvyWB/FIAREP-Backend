// The resident signs on the member's phone that the job inside their home is
// done. If the resident isn't home or won't sign, the member picks why, records
// up to a minute of video at the door (knocking, what the resident says) and
// takes a photo; the office is told.
import { useRef, useState } from 'react';
import { Alert, Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { takePhotoWithGeo, type PhotoEvidence } from '../lib/photos';
import RemotePhoto from './RemotePhoto';
import { ui, ACCENT } from '../lib/ui';

export type SignOffSignature = { d: string; w: number; h: number };
export type ResidentSignOff =
  | { status: 'signed'; name: string; signature: SignOffSignature; at: string }
  | { status: 'not_home' | 'refused'; note: string; at: string; photo: PhotoEvidence; video: DoorVideo };
/** Up to a minute at the door. objectPath is set once it's uploaded. */
export type DoorVideo = { uri: string; seconds: number; contentType: string; objectPath?: string };

/** Record up to 60 seconds of video (sound included), kept in the app's folder until it's uploaded. */
export async function recordDoorVideo(): Promise<DoorVideo | null> {
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) throw new Error('Allow the camera for FIAREP in Settings.');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 60, videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium, allowsEditing: false });
  const a = res.canceled ? null : res.assets?.[0];
  if (!a?.uri) return null;
  const ext = (a.uri.split('.').pop() || 'mov').toLowerCase();
  const dir = FileSystem.documentDirectory + 'photos/';
  try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch {}
  const dest = dir + 'door-' + Date.now().toString(36) + '.' + ext;
  await FileSystem.copyAsync({ from: a.uri, to: dest });
  return { uri: dest, seconds: Math.round((a.duration || 0) / 1000), contentType: ext === 'mp4' ? 'video/mp4' : 'video/quicktime' };
}

export const signOffLabel = (s: ResidentSignOff | null | undefined): string =>
  !s ? '' : s.status === 'signed' ? `Signed by resident: ${s.name}` : s.status === 'not_home' ? 'Resident not home — not signed' : 'Resident refused to sign';

/** Finger signature: strokes kept as one SVG path (small, shows the same on the website). */
function SignaturePad({ onChange, height = 180 }: { onChange: (sig: SignOffSignature | null) => void; height?: number }) {
  const [d, setD] = useState('');
  const [w, setW] = useState(0);
  const path = useRef('');
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const wRef = useRef(0); wRef.current = w;
  const pt = (x: number, y: number) => `${Math.round(x)} ${Math.round(y)}`;
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { path.current += `M${pt(e.nativeEvent.locationX, e.nativeEvent.locationY)} `; setD(path.current); },
    onPanResponderMove: (e) => { path.current += `L${pt(e.nativeEvent.locationX, e.nativeEvent.locationY)} `; setD(path.current); },
    onPanResponderRelease: () => { onChangeRef.current(path.current.trim() ? { d: path.current.trim(), w: wRef.current, h: height } : null); },
  })).current;
  return (
    <View>
      <View
        onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}
        style={{ height, borderWidth: 1, borderColor: '#94a3b8', borderRadius: 10, backgroundColor: '#fff', overflow: 'hidden' }}
        {...responder.panHandlers}
      >
        <Svg width="100%" height={height}>
          <Path d={d || 'M0 0'} stroke="#0f172a" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        {!d && <Text pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: height / 2 - 10, textAlign: 'center', color: '#94a3b8' }}>Resident signs here with a finger</Text>}
        <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 34, borderBottomWidth: 1, borderColor: '#cbd5e1' }} />
      </View>
      <Pressable onPress={() => { path.current = ''; setD(''); onChange(null); }} style={{ alignSelf: 'flex-end', paddingVertical: 6 }}>
        <Text style={{ color: ACCENT, fontWeight: '600' }}>Clear</Text>
      </Pressable>
    </View>
  );
}

/** A signature drawn earlier (for the office / supervisor to see). */
export function SignatureView({ signature, height = 90 }: { signature: SignOffSignature; height?: number }) {
  return (
    <View style={{ height, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, backgroundColor: '#fff' }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${signature.w || 300} ${signature.h || 180}`} preserveAspectRatio="xMidYMid meet">
        <Path d={signature.d} stroke="#0f172a" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

export function ResidentSignOffSheet({ visible, jobLine, onDone, onCancel }: {
  visible: boolean; jobLine: string; onDone: (s: ResidentSignOff) => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState<'sign' | 'not_home' | 'refused'>('sign');
  const [name, setName] = useState('');
  const [sig, setSig] = useState<SignOffSignature | null>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<PhotoEvidence | null>(null);
  const [video, setVideo] = useState<DoorVideo | null>(null);
  const reset = () => { setMode('sign'); setName(''); setSig(null); setNote(''); setPhoto(null); setVideo(null); };
  const finish = () => {
    const at = new Date().toISOString();
    if (mode === 'sign') {
      if (!name.trim() || !sig) { Alert.alert('Signature needed', "Type the resident's name and have them sign."); return; }
      onDone({ status: 'signed', name: name.trim(), signature: sig, at });
    } else {
      if (!video) { Alert.alert('Video needed', mode === 'refused' ? 'Record a short video at the door showing the resident would not sign.' : 'Record a short video of you knocking at the door.'); return; }
      if (!photo) { Alert.alert('Photo needed', 'Take a photo (the door or the finished work) before finishing without a signature.'); return; }
      onDone({ status: mode, note: note.trim(), at, photo, video });
    }
    reset();
  };
  const tab = (m: typeof mode, label: string) => (
    <Pressable onPress={() => setMode(m)} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: mode === m ? ACCENT : '#f1f5f9' }}>
      <Text style={{ textAlign: 'center', fontWeight: '700', fontSize: 13, color: mode === m ? '#fff' : '#334155' }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <ScrollView contentContainerStyle={[ui.wrap, { gap: 10 }]} scrollEnabled={mode !== 'sign'} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 20, fontWeight: '800' }}>Resident sign-off</Text>
        <Text style={{ color: '#475569' }}>{jobLine}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {tab('sign', 'Resident signs')}{tab('not_home', 'Not home')}{tab('refused', 'Refused')}
        </View>
        {mode === 'sign' ? (
          <>
            <Text style={{ color: '#0f172a' }}>I confirm the work in my home is complete.</Text>
            <Text style={ui.label}>Resident's name</Text>
            <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="words" />
            <SignaturePad onChange={setSig} />
          </>
        ) : (
          <>
            <Text style={{ color: '#0f172a' }}>{mode === 'not_home' ? 'Nobody was home to sign. Record yourself knocking at the door (up to 1 minute).' : "The resident would not sign. Record up to 1 minute at the door — what the resident says, or that they won't let you in."} Then take a photo. The office is told.</Text>
            <Pressable style={ui.btnOutline} onPress={async () => { try { const v = await recordDoorVideo(); if (v) setVideo(v); } catch (e: any) { Alert.alert('Video', String(e?.message ?? e)); } }}>
              <Text style={ui.btnOutlineText}>{video ? `Video recorded (${Math.floor(video.seconds / 60)}:${String(video.seconds % 60).padStart(2, '0')}) — record again` : 'Record video (up to 1 min)'}</Text>
            </Pressable>
            {photo && <RemotePhoto localUri={photo.uri} style={{ width: 120, height: 120, borderRadius: 8, backgroundColor: '#eee' }} />}
            <Pressable style={ui.btnOutline} onPress={async () => { try { const p = await takePhotoWithGeo(); if (p) setPhoto(p); } catch (e: any) { Alert.alert('Camera', String(e?.message ?? e)); } }}>
              <Text style={ui.btnOutlineText}>{photo ? 'Retake photo' : 'Take photo'}</Text>
            </Pressable>
            <Text style={ui.label}>Note (optional)</Text>
            <TextInput style={[ui.input, { minHeight: 60, textAlignVertical: 'top' }]} value={note} onChangeText={setNote} multiline placeholder={mode === 'refused' ? 'What the resident said' : 'e.g. Knocked twice, left a notice'} />
          </>
        )}
        <Pressable style={ui.btn} onPress={finish}><Text style={ui.btnText}>Finish</Text></Pressable>
        <Pressable onPress={() => { reset(); onCancel(); }}><Text style={{ color: ACCENT, fontWeight: '600', textAlign: 'center' }}>Cancel</Text></Pressable>
      </ScrollView>
    </Modal>
  );
}
