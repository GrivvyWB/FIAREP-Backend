import { Linking } from 'react-native';
import { customFetch } from '@workspace/api-client-react';

// Open fiarep.com already signed in as the same person: the server issues a
// single-use, 90-second code and the website redeems it on load
// (#handoff=<code>). Falls back to the plain site if the code can't be issued
// (offline, signed out) — they can sign in there as usual.
export async function openWebsiteSignedIn(path: string = '/'): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN || 'fiarep.com';
  const base = `https://${domain}${path.startsWith('/') ? path : '/' + path}`;
  let url = base;
  try {
    const { code } = await customFetch<{ code: string; expiresIn: number }>('/api/v1/auth/web-handoff', { method: 'POST' });
    // After '#': the browser never sends it to the server, so it can't land in logs.
    if (code) url = `${base}#handoff=${encodeURIComponent(code)}`;
  } catch { /* open the site without a code */ }
  await Linking.openURL(url);
}
