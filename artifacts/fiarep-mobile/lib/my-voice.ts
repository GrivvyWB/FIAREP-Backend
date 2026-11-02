// Saved Voice Recorder voices (kept on the phone, per person) and the one the Command Center talks in.
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSessionIdentity } from './store';

export type SavedVoice = { id: string; name: string; gender: 'man' | 'woman'; hz: number | null; file: string; createdAt: string };
// Average speaking pitch of adult voices, to tune the phone voice toward the person's.
const TYPICAL = { man: 120, woman: 210 };
const MALE = /aaron|fred|alex|tom|nathan|evan|daniel|rishi|arthur|oliver|gordon|reed|rocko|grandpa|eddy|ralph|albert/i;
const FEMALE = /samantha|nicky|allison|ava|susan|victoria|karen|moira|tessa|zoe|serena|kate|martha|catherine|fiona|veena|flo|shelley|sandy|grandma|kathy|joelle|noelle/i;

const me = async () => (await getSessionIdentity().catch(() => null))?.staffId || 'me';
export const voicesKey = async () => `voice-studio:${await me()}`;
const ccKey = async () => `voice-studio-cc:${await me()}`;

export async function savedVoices(): Promise<SavedVoice[]> {
  try { return JSON.parse((await AsyncStorage.getItem(await voicesKey())) || '[]'); } catch { return []; }
}
/** The voice the Command Center talks in (and how much higher or lower), or null for its own voice. */
export async function commandVoice(): Promise<{ voice: SavedVoice; k: number } | null> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(await ccKey())) || 'null') as { id: string; k: number } | null;
    if (!v) return null;
    const voice = (await savedVoices()).find((x) => x.id === v.id);
    return voice ? { voice, k: v.k || 1 } : null;
  } catch { return null; }
}
export async function setCommandVoice(id: string | null, k = 1): Promise<void> {
  if (id) await AsyncStorage.setItem(await ccKey(), JSON.stringify({ id, k })); else await AsyncStorage.removeItem(await ccKey());
}

async function phoneVoice(g: 'man' | 'woman'): Promise<string | undefined> {
  // Right after the app opens the phone can still be loading its voices (empty list → its default voice): wait for them.
  let all: Speech.Voice[] = [];
  for (let i = 0; i < 10 && !all.length; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, 200));
    all = await Speech.getAvailableVoicesAsync().catch(() => []);
  }
  const want = g === 'man' ? MALE : FEMALE;
  // The most natural voice on the phone first: Premium, then Enhanced (free downloads from Apple),
  // then the basic one. US English before other English.
  const rank = (v: { identifier: string; quality?: unknown; language: string }) =>
    (/premium/i.test(v.identifier) ? 0 : /enhanced/i.test(v.identifier) || String(v.quality).toLowerCase().includes('enhanced') ? 1 : 2) * 2 + (/en-us/i.test(v.language) ? 0 : 1);
  const match = all.filter((v) => /^en/i.test(v.language) && want.test(v.name || v.identifier)).sort((a, b) => rank(a) - rank(b));
  return match[0]?.identifier;
}
/** Says the words in this saved voice; resolves when it has finished (or was stopped). */
export async function speakIn(v: SavedVoice, words: string, k = 1): Promise<void> {
  // Small pitch moves only: big ones make a phone voice sound artificial.
  const base = v.hz ? Math.min(1.1, Math.max(0.9, v.hz / TYPICAL[v.gender])) : 1;
  const pitch = Math.min(1.25, Math.max(0.8, base * (1 + (k - 1) * 0.6)));
  const voice = await phoneVoice(v.gender);
  await new Promise<void>((resolve) => {
    Speech.speak(words, { voice, pitch, rate: 1, onDone: () => resolve(), onStopped: () => resolve(), onError: () => resolve() });
  });
}
export const stopVoice = () => Speech.stop();
