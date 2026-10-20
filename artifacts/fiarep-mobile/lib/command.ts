// Command Center on the phone: two Ed25519 keys kept in the Keychain.
//   device key  — signs every Command Center request (proves it's this phone)
//   confirm key — stored behind Face ID; reading it IS the Face ID prompt, so
//                 every approval needs your face (or fingerprint on Android)
// The strings signed here must match the API (api-server/src/lib/command/crypto.ts)
// and the desktop agent (fiarep-agent/agent.mjs) byte for byte.
import nacl from 'tweetnacl';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { registerForPush } from './push';

const K_DEVICE_ID = 'cmd.deviceId';
const K_DEVICE_SEED = 'cmd.deviceSeed';
const K_CONFIRM_SEED = 'cmd.confirmSeed';
const K_CONFIRM_PUB = 'cmd.confirmPub';
const K_STATUS = 'cmd.lastStatus';
const K_RELAY = 'cmd.relayUrl';
const plain = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const biometric = {
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: 'Approve FIAREP command',
};

// expo-crypto is a native module: only present in builds made after it was
// added (and in Expo Go). Loaded lazily so an older build never crashes.
type CryptoModule = { getRandomBytes(n: number): Uint8Array; digestStringAsync(alg: string, data: string): Promise<string>; CryptoDigestAlgorithm: { SHA256: string } };
function cryptoModule(): CryptoModule | null {
  try { return require('expo-crypto') as CryptoModule; } catch { return null; }
}

/** Can this build do the Command Center? (native crypto + Face ID in the Keychain) */
export function commandSupport(): { ok: true } | { ok: false; reason: string } {
  if (!cryptoModule()) return { ok: false, reason: 'This app build is too old for the Command Center. Install the next TestFlight build (or test in Expo Go).' };
  try {
    if (Platform.OS !== 'web' && !SecureStore.canUseBiometricAuthentication()) {
      return { ok: false, reason: 'Face ID / fingerprint is not set up on this phone, or this build is missing the Face ID permission.' };
    }
  } catch { return { ok: false, reason: 'Face ID check failed on this build.' }; }
  return { ok: true };
}

// ── encoding ─────────────────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '=');
  }
  return out;
}
export function fromB64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1]!) << 12) | ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) | (B64.indexOf(clean[i + 3] ?? 'A') & 63);
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}
function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return Uint8Array.from(out);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

async function sha256hex(s: string): Promise<string> {
  const c = cryptoModule();
  if (!c) throw new Error('This app build is too old for the Command Center.');
  return (await c.digestStringAsync(c.CryptoDigestAlgorithm.SHA256, s)).toLowerCase();
}

const signWithSeed = (seedB64: string, message: string) =>
  toB64(nacl.sign.detached(utf8(message), nacl.sign.keyPair.fromSeed(fromB64(seedB64)).secretKey));

// ── enrollment ───────────────────────────────────────────────────────────
/** approveWhere: where this phone gets approved (FIAREP: Platform Control; a client: its own Command Center page). */
export type DeviceState = { id: string; status: 'pending' | 'active' | 'revoked'; offline?: boolean; approveWhere?: string; platform?: boolean; greeting?: string } | null;

export async function storedDeviceId(): Promise<string | null> {
  return SecureStore.getItemAsync(K_DEVICE_ID, plain);
}

export async function enrollDevice(staffId: string, name: string): Promise<string> {
  const c = cryptoModule();
  if (!c) throw new Error('This app build is too old for the Command Center.');
  const deviceSeed = c.getRandomBytes(32);
  const confirmSeed = c.getRandomBytes(32);
  const deviceKey = toB64(nacl.sign.keyPair.fromSeed(deviceSeed).publicKey);
  const confirmKey = toB64(nacl.sign.keyPair.fromSeed(confirmSeed).publicKey);
  const proof = `FIAREP-CMD-ENROLL\n${staffId}\n${deviceKey}\n${confirmKey}`;
  const body = {
    name, deviceKey, confirmKey,
    deviceProof: signWithSeed(toB64(deviceSeed), proof),
    confirmProof: signWithSeed(toB64(confirmSeed), proof),
  };
  const res = await customFetch<{ id: string; status: string }>('/api/v1/command/devices/enroll', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), responseType: 'json',
  } as never);
  await SecureStore.setItemAsync(K_DEVICE_SEED, toB64(deviceSeed), plain);
  await SecureStore.setItemAsync(K_CONFIRM_SEED, toB64(confirmSeed), biometric);
  await SecureStore.setItemAsync(K_CONFIRM_PUB, confirmKey, plain);
  await SecureStore.setItemAsync(K_DEVICE_ID, res.id, plain);
  return res.id;
}

export async function deviceStatus(): Promise<DeviceState> {
  const id = await storedDeviceId();
  if (!id) return null;
  try {
    const r = await customFetch<{ id: string; status: 'pending' | 'active' | 'revoked'; approveWhere?: string; platform?: boolean; greeting?: string }>(`/api/v1/command/devices/${encodeURIComponent(id)}/status`, { responseType: 'json' } as never);
    await SecureStore.setItemAsync(K_STATUS, r.status, plain);
    return r;
  } catch (e: any) {
    if (e?.status === 404) { await forgetDevice(); return null; }
    // fiarep.com unreachable: keep working from the last known status so the
    // backup relay (outage approvals) still opens.
    const last = await SecureStore.getItemAsync(K_STATUS, plain);
    if (last === 'active' || last === 'pending') return { id, status: last, offline: true };
    throw e;
  }
}

export async function forgetDevice(): Promise<void> {
  for (const k of [K_DEVICE_ID, K_DEVICE_SEED, K_CONFIRM_PUB, K_STATUS]) await SecureStore.deleteItemAsync(k, plain).catch(() => undefined);
  await SecureStore.deleteItemAsync(K_CONFIRM_SEED, biometric).catch(() => undefined);
}

/** The Face ID key's public half, to paste into the Mac agent's trustedConfirmKeys. */
export async function confirmPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(K_CONFIRM_PUB, plain);
}

// ── signed requests ──────────────────────────────────────────────────────
export async function commandFetch<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const id = await storedDeviceId();
  const seed = await SecureStore.getItemAsync(K_DEVICE_SEED, plain);
  if (!id || !seed) throw new Error('This phone is not set up for the Command Center.');
  const fullPath = `/api${path}`;
  const bodyStr = body === undefined ? '' : JSON.stringify(body);
  const time = String(Date.now());
  const sig = signWithSeed(seed, `FIAREP-CMD-REQ\n${method}\n${fullPath}\n${time}\n${await sha256hex(bodyStr)}`);
  return customFetch<T>(fullPath, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Command-Device': id, 'X-Command-Time': time, 'X-Command-Sig': sig },
    body: body === undefined ? undefined : bodyStr,
    responseType: 'json',
  } as never);
}

export type CommandAction = {
  id: string; runId: string; action: string; label: string; summary: string; params: Record<string, unknown>;
  target: string; risk: 'read' | 'write'; needsConfirm: boolean; status: string; nonce: string; expiresAt: number;
  result: unknown; error: string | null; spoken: string | null;
};
export type CommandRun = { id: string; threadId: string; text: string; reply: string | null; status: string; error: string | null; createdAt: string; actions: CommandAction[] };

/** Face ID prompt → sign exactly this action (built from what the card shows). */
export async function approveAction(a: CommandAction): Promise<CommandAction> {
  const message = `FIAREP-CMD-CONFIRM\n${a.id}\n${a.action}\n${a.target}\n${await sha256hex(canonicalJson(a.params))}\n${a.nonce}\n${a.expiresAt}`;
  const seed = await SecureStore.getItemAsync(K_CONFIRM_SEED, biometric); // ← Face ID
  if (!seed) throw new Error('Face ID key missing — set this phone up again.');
  const signature = signWithSeed(seed, message);
  return commandFetch<CommandAction>('POST', `/v1/command/actions/${encodeURIComponent(a.id)}/confirm`, { signature });
}

// ── Backup relay (works when fiarep.com is down) ─────────────────────────
export type RelayIncident = {
  id: string; site?: string; kind: string; action: string; target: string; detail: string; status: string;
  nonce: string; expiresAt: number; createdAt: number; autoFixed?: boolean; approvedBy?: string; replitUrl?: string;
  result?: { ok: boolean; detail: string; at: number };
};
export type RelayState = { agentSeen: number; settings: { autoFix: boolean }; incidents: RelayIncident[] };

/** The relay's address: asked from fiarep.com when it's up, remembered for when it isn't. */
export async function relayUrl(): Promise<string | null> {
  try {
    const r = await commandFetch<{ url: string | null }>('GET', '/v1/command/relay');
    if (r.url) await SecureStore.setItemAsync(K_RELAY, r.url, plain); else await SecureStore.deleteItemAsync(K_RELAY, plain);
    return r.url;
  } catch {
    return SecureStore.getItemAsync(K_RELAY, plain);
  }
}

async function relayFetch<T>(base: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const id = await storedDeviceId();
  const seed = await SecureStore.getItemAsync(K_DEVICE_SEED, plain);
  if (!id || !seed) throw new Error('This phone is not set up for the Command Center.');
  const bodyStr = body === undefined ? '' : JSON.stringify(body);
  const time = String(Date.now());
  const sig = signWithSeed(seed, `FIAREP-CMD-REQ\n${method}\n${path}\n${time}\n${await sha256hex(bodyStr)}`);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Command-Device': id, 'X-Command-Time': time, 'X-Command-Sig': sig },
    body: body === undefined ? undefined : bodyStr,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || `Relay HTTP ${res.status}`), { status: res.status, data });
  return data as T;
}

export async function relayState(base: string): Promise<RelayState> {
  return relayFetch<RelayState>(base, 'GET', '/phone/state');
}

/** Give the relay this phone's push token, so an outage reaches the phone. */
export async function relayRegisterPush(base: string): Promise<boolean> {
  const token = await registerForPush();
  if (!token) return false;
  await relayFetch(base, 'POST', '/phone/push', { token });
  return true;
}

/** Face ID → approve the Mac republishing FIAREP on Replit. The Mac checks this signature too. */
export async function relayApprove(base: string, i: RelayIncident): Promise<RelayIncident> {
  const message = `FIAREP-CMD-CONFIRM\n${i.id}\n${i.action}\n${i.target}\n${await sha256hex(canonicalJson({ incident: i.id, kind: i.kind }))}\n${i.nonce}\n${i.expiresAt}`;
  const seed = await SecureStore.getItemAsync(K_CONFIRM_SEED, biometric); // ← Face ID
  if (!seed) throw new Error('Face ID key missing — set this phone up again.');
  return relayFetch<RelayIncident>(base, 'POST', `/phone/incidents/${encodeURIComponent(i.id)}/approve`, { signature: signWithSeed(seed, message) });
}

export async function relayDeny(base: string, i: RelayIncident): Promise<void> {
  await relayFetch(base, 'POST', `/phone/incidents/${encodeURIComponent(i.id)}/deny`, {});
}

/** Face ID → turn "fix outages without asking" on or off. The Mac checks this signature too. */
export async function relaySetAutoFix(base: string, autoFix: boolean): Promise<void> {
  const time = String(Date.now());
  const seed = await SecureStore.getItemAsync(K_CONFIRM_SEED, biometric); // ← Face ID
  if (!seed) throw new Error('Face ID key missing — set this phone up again.');
  await relayFetch(base, 'POST', '/phone/settings', { autoFix, time, signature: signWithSeed(seed, `FIAREP-RELAY-AUTOFIX\n${autoFix}\n${time}`) });
}
