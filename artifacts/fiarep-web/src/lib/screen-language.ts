// The website in each person's language.
//
// Every page is written in English. With another language picked, the words on
// the screen (text, placeholders, button labels, tooltips) are swapped for their
// translation as they appear. Each line is translated once per language on the
// server and kept, so it comes straight back after that. Nothing people type is
// touched, and anything marked translate="no" (or .notranslate) stays as written.

export type ScreenLanguage = { code: string; name: string; rtl: boolean };

const KEY = "fiarep.language";
const DICT_KEY = (lang: string) => `fiarep.language.dict.${lang}`;
const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "SVG", "INPUT"]);

let lang = "en";
let rtl = false;
let dict: Record<string, string> = {};
const listeners = new Set<() => void>();
const originals = new WeakMap<Text, string>();   // the English as the page wrote it
const written = new WeakMap<Text, string>();     // what we last put there
const touched = new Set<Text>();
const touchedEls = new Set<Element>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
export const currentLanguage = () => lang;
export function onLanguageChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** A line worth translating: has letters, is not a code, an email, a link or a long piece of somebody's writing. */
function eligible(s: string): boolean {
  if (s.length < 2 || s.length > 300) return false;
  if (!/\p{L}/u.test(s)) return false;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s) || /^https?:\/\//i.test(s)) return false;
  if (!/\s/.test(s) && /\d/.test(s)) return false;      // IDs and codes: ORG-7K2P, B12-0045
  return true;
}

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName.toUpperCase())) return true;
    if (e.getAttribute("translate") === "no" || e.classList.contains("notranslate") || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function queue(s: string) {
  pending.add(s);
  if (timer) return;
  timer = setTimeout(() => { timer = null; void fetchMissing(); }, 250);
}

async function fetchMissing() {
  const want = lang;
  const lines = [...pending].filter((l) => !(l in dict)).slice(0, 150);
  pending.clear();
  if (!lines.length || want === "en") return;
  try {
    const r = await fetch(`/api/v1/public/i18n/${encodeURIComponent(want)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) });
    if (!r.ok || want !== lang) return;
    Object.assign(dict, (await r.json()) as Record<string, string>);
    safe(() => localStorage.setItem(DICT_KEY(want), JSON.stringify(dict)), undefined);
    translateTree(document.body);
  } catch { /* stays in English until the next screen */ }
}

function doText(node: Text) {
  const now = node.nodeValue ?? "";
  // The page changed the words since we last wrote them: that is the new English.
  if (written.get(node) !== now) originals.set(node, now);
  const original = originals.get(node) ?? now;
  const key = original.trim();
  if (!eligible(key) || skipped(node.parentElement)) return;
  if (lang === "en") return;
  const tr = dict[key];
  if (tr === undefined) { queue(key); return; }
  const next = original.replace(key, tr);
  if (now !== next) { node.nodeValue = next; written.set(node, next); touched.add(node); }
}

function doAttrs(el: Element) {
  // An input's own placeholder is translated; what is typed in it never is.
  if (el.getAttribute("translate") === "no" || el.classList.contains("notranslate") || skipped(el.parentElement)) return;
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const store = `data-i18n-${a}`;
    const now = el.getAttribute(a) ?? "";
    const last = el.getAttribute(`${store}-w`);
    if (last !== now) el.setAttribute(store, now);
    const original = el.getAttribute(store) ?? now;
    const key = original.trim();
    if (!eligible(key) || lang === "en") continue;
    const tr = dict[key];
    if (tr === undefined) { queue(key); continue; }
    if (now !== tr) { el.setAttribute(a, tr); el.setAttribute(`${store}-w`, tr); touchedEls.add(el); }
  }
}

function translateTree(root: Node) {
  if (lang === "en") return;
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (!(root instanceof Element) && root !== document.body) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = root; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else if (n instanceof Element) doAttrs(n);
  }
}

function restoreEnglish() {
  for (const node of touched) { const o = originals.get(node); if (o !== undefined && node.isConnected) { node.nodeValue = o; written.set(node, o); } }
  touched.clear();
  for (const el of touchedEls) for (const a of ATTRS) { const o = el.getAttribute(`data-i18n-${a}`); if (o !== null) { el.setAttribute(a, o); el.removeAttribute(`data-i18n-${a}-w`); } }
  touchedEls.clear();
}

function watch() {
  if (observer || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver((records) => {
    if (lang === "en") return;
    for (const r of records) {
      if (r.type === "characterData") doText(r.target as Text);
      else if (r.type === "attributes" && r.target instanceof Element) doAttrs(r.target);
      else r.addedNodes.forEach((n) => translateTree(n));
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}

/** Switch the website to this language ("en" = the original English). Kept on this browser. */
export async function setScreenLanguage(code: string, isRtl = false) {
  lang = code || "en"; rtl = isRtl;
  safe(() => localStorage.setItem(KEY, JSON.stringify({ code: lang, rtl })), undefined);
  document.documentElement.lang = lang;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
  listeners.forEach((f) => f());
  if (lang === "en") { restoreEnglish(); return; }
  dict = safe(() => JSON.parse(localStorage.getItem(DICT_KEY(lang)) || "{}") as Record<string, string>, {});
  watch();
  translateTree(document.body);
  try {
    const r = await fetch(`/api/v1/public/i18n/${encodeURIComponent(lang)}`);
    if (r.ok && lang === code) { dict = { ...dict, ...((await r.json()) as Record<string, string>) }; safe(() => localStorage.setItem(DICT_KEY(lang), JSON.stringify(dict)), undefined); translateTree(document.body); }
  } catch { /* the kept copy is used */ }
}

/** On load: the language this browser picked last time. */
export function startScreenLanguage() {
  const saved = safe(() => JSON.parse(localStorage.getItem(KEY) || "null") as { code?: string; rtl?: boolean } | null, null);
  if (saved?.code && saved.code !== "en") void setScreenLanguage(saved.code, !!saved.rtl);
}

export async function screenLanguages(): Promise<ScreenLanguage[]> {
  try { const r = await fetch("/api/v1/public/i18n/languages"); if (r.ok) return (await r.json()) as ScreenLanguage[]; } catch { /* below */ }
  return [{ code: "en", name: "English", rtl: false }];
}
