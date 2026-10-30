// The phone never runs an older copy of the app than the newest one sent.
//
// A TestFlight install (or a new build) starts from the copy built into it, which can be older than
// the last update sent with `eas update`. Without this, the newest copy only came in after closing
// and reopening the app twice. Now: as soon as the app opens, and every time it comes back to the
// screen, it asks for the newest copy and switches to it right away.
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

let checking = false;
async function getNewest() {
  if (__DEV__ || !Updates.isEnabled || checking) return;
  checking = true;
  try {
    const found = await Updates.checkForUpdateAsync();
    if (!found.isAvailable) return;
    const got = await Updates.fetchUpdateAsync();
    if (got.isNew) await Updates.reloadAsync();
  } catch { /* no signal: the copy on the phone stays until next time */ } finally { checking = false; }
}

let started = false;
export function stayCurrent() {
  if (started) return; started = true;
  void getNewest();
  AppState.addEventListener('change', (s) => { if (s === 'active') void getNewest(); });
}
