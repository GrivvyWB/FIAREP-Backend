// The app in each person's language.
//
// Every screen is written in English. With another language picked, every <Text>
// on every screen, every input's placeholder and every alert is shown in that
// language. Each line is translated once per language on the server and kept
// (on the server and on this phone), so it comes straight back after that.
// What people type is never changed.
//
// This is installed once, first thing in app/_layout.tsx: react-native's Text and
// TextInput are swapped for versions that translate their words, so no screen
// has to change.
import { createElement, forwardRef, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { customFetch } from '@workspace/api-client-react';

export type ScreenLanguage = { code: string; name: string; rtl: boolean };

const KEY = 'fiarep.language';
/** Put nativeID={NO_TRANSLATE} on a <Text> whose words are somebody's own (a chat message): it is never translated. */
export const NO_TRANSLATE = 'notranslate';
const DICT_KEY = (lang: string) => `fiarep.language.dict.${lang}`;

let lang = 'en';
let dict: Record<string, string> = {};
let version = 0;
const listeners = new Set<() => void>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const snapshot = () => version;
const bump = () => { version += 1; listeners.forEach((f) => f()); };
export const currentLanguage = () => lang;
export const onLanguageChange = subscribe;

/** A line worth translating: has letters, is not a code, an email or a link, and is not a long piece of somebody's writing. */
function eligible(s: string): boolean {
  if (s.length < 2 || s.length > 300) return false;
  if (!/\p{L}/u.test(s)) return false;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s) || /^https?:\/\//i.test(s)) return false;
  if (!/\s/.test(s) && /\d/.test(s)) return false;
  return true;
}

async function fetchMissing() {
  const want = lang;
  const lines = [...pending].filter((l) => !(l in dict)).slice(0, 150);
  pending.clear();
  if (!lines.length || want === 'en') return;
  try {
    const got = await customFetch<Record<string, string>>(`/api/v1/public/i18n/${encodeURIComponent(want)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }), responseType: 'json' } as never);
    if (want !== lang) return;
    Object.assign(dict, got || {});
    for (const l of lines) if (!(l in dict)) dict[l] = l; // not translatable: stop asking for it this session
    bump();
    void AsyncStorage.setItem(DICT_KEY(want), JSON.stringify(dict)).catch(() => undefined);
  } catch { /* stays in English until the next screen */ }
}

/** The words in the picked language (the English while it is being translated). */
export function tr(s: string): string {
  if (lang === 'en' || typeof s !== 'string') return s;
  const key = s.trim();
  if (!eligible(key)) return s;
  const hit = dict[key];
  if (hit === undefined) {
    pending.add(key);
    if (!timer) timer = setTimeout(() => { timer = null; void fetchMissing(); }, 200);
    return s;
  }
  return key === s ? hit : s.replace(key, hit);
}

function trChildren(children: unknown): unknown {
  if (typeof children === 'string') return tr(children);
  if (Array.isArray(children)) return children.map((c) => (typeof c === 'string' ? tr(c) : c));
  return children;
}

/** Switch the app to this language ("en" = the original English). Kept on this phone. */
export async function setScreenLanguage(code: string, rtl = false) {
  lang = code || 'en';
  await AsyncStorage.setItem(KEY, JSON.stringify({ code: lang, rtl })).catch(() => undefined);
  if (lang === 'en') { dict = {}; bump(); return; }
  try { dict = JSON.parse((await AsyncStorage.getItem(DICT_KEY(lang))) || '{}') as Record<string, string>; } catch { dict = {}; }
  bump();
  try {
    const all = await customFetch<Record<string, string>>(`/api/v1/public/i18n/${encodeURIComponent(lang)}`, { responseType: 'json' } as never);
    if (lang === code && all) { dict = { ...dict, ...all }; bump(); void AsyncStorage.setItem(DICT_KEY(lang), JSON.stringify(dict)).catch(() => undefined); }
  } catch { /* the copy on the phone is used */ }
}

export async function screenLanguages(): Promise<ScreenLanguage[]> {
  try { return await customFetch<ScreenLanguage[]>('/api/v1/public/i18n/languages', { responseType: 'json' } as never); } catch { return [{ code: 'en', name: 'English', rtl: false }]; }
}

let installed = false;
/** Swap in the translating Text, TextInput and Alert, and restore the language picked last time. */
export function installScreenLanguage() {
  if (installed) return; installed = true;
  try {
    // The real module object every screen reads Text / TextInput from (not a copy).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as Record<string, unknown>;
    const BaseText = rn['Text'] as unknown as React.ComponentType<Record<string, unknown>>;
    const BaseInput = rn['TextInput'] as unknown as React.ComponentType<Record<string, unknown>> & Record<string, unknown>;
    const TText = (props: Record<string, unknown>) => {
      useSyncExternalStore(subscribe, snapshot);
      // nativeID="notranslate": people's own words (chat messages) stay exactly as written.
      if (lang === 'en' || props['nativeID'] === NO_TRANSLATE) return createElement(BaseText, props);
      return createElement(BaseText, { ...props, children: trChildren(props['children']) as never });
    };
    const TInput = forwardRef((props: Record<string, unknown>, ref) => {
      useSyncExternalStore(subscribe, snapshot);
      const placeholder = typeof props['placeholder'] === 'string' && lang !== 'en' ? tr(props['placeholder'] as string) : props['placeholder'];
      return createElement(BaseInput, { ...props, placeholder, ref });
    });
    // TextInput.State and the other statics (not React's own fields, which would replace ours).
    for (const k of Object.keys(BaseInput)) if (!['$$typeof', 'render', 'type', 'compare', 'displayName'].includes(k)) { try { (TInput as unknown as Record<string, unknown>)[k] = BaseInput[k]; } catch { /* read-only */ } }
    (TInput as unknown as { displayName: string }).displayName = 'TextInput';
    Object.defineProperty(rn, 'Text', { configurable: true, enumerable: true, get: () => TText });
    Object.defineProperty(rn, 'TextInput', { configurable: true, enumerable: true, get: () => TInput });
    const original = Alert.alert.bind(Alert);
    Alert.alert = (title, message, buttons, options) => original(
      typeof title === 'string' ? tr(title) : title,
      typeof message === 'string' ? tr(message) : message,
      buttons?.map((b) => ({ ...b, text: typeof b.text === 'string' ? tr(b.text) : b.text })),
      options,
    );
  } catch { /* the app stays in English */ }
  void AsyncStorage.getItem(KEY).then((v) => {
    const saved = v ? (JSON.parse(v) as { code?: string; rtl?: boolean }) : null;
    if (saved?.code && saved.code !== 'en') void setScreenLanguage(saved.code, !!saved.rtl);
  }).catch(() => undefined);
}
