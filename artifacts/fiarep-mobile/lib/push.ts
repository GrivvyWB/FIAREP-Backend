import { Platform } from 'react-native';

// expo-notifications / expo-device are NATIVE modules. In Expo Go or before a
// development build includes them, importing at module scope crashes the app.
// So we load them lazily inside a try/catch: if the native module isn't present,
// these functions simply no-op instead of taking down the whole app.
function getNotifs(): any | null {
  try { return require('expo-notifications'); } catch (e) { return null; }
}
function getDevice(): any | null {
  try { return require('expo-device'); } catch (e) { return null; }
}
function getConstants(): any | null {
  try { return require('expo-constants').default; } catch (e) { return null; }
}

let handlerSet = false;
function ensureHandler(N: any) {
  if (handlerSet || !N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true,
        shouldShowBanner: true, shouldShowList: true,
      }),
    });
    handlerSet = true;
  } catch (e) {}
}

export async function requestNotificationPermission(): Promise<boolean> {
  const N = getNotifs();
  if (!N) return false;
  try {
    ensureHandler(N);
    const settings = await N.getPermissionsAsync();
    let status = settings.status;
    if (status !== 'granted') {
      const req = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
      status = req.status;
    }
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', {
        name: 'Alerts', importance: N.AndroidImportance?.HIGH ?? 4,
        sound: 'default', vibrationPattern: [0, 250, 250, 250],
      });
    }
    return status === 'granted';
  } catch (e) { return false; }
}

export async function registerForPush(): Promise<string> {
  const N = getNotifs(); const D = getDevice();
  if (!N) return '';
  try {
    if (D && D.isDevice === false) return '';
    const granted = await requestNotificationPermission();
    if (!granted) return '';
    const C = getConstants();
    const projectId = C?.easConfig?.projectId || C?.expoConfig?.extra?.eas?.projectId;
    const tok = await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return (tok && tok.data) || '';
  } catch (e) { return ''; }
}

export async function notifyLocal(title: string, body: string, urgent: boolean = false): Promise<void> {
  const N = getNotifs();
  if (!N) return;
  try {
    await requestNotificationPermission();
    await N.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        badge: 1,
        color: urgent ? '#c0392b' : undefined,
        interruptionLevel: urgent ? 'timeSensitive' : 'active',
      },
      trigger: null,
    });
  } catch (e) {}
}
