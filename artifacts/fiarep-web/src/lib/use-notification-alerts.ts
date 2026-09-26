import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { notificationTitle } from "@/lib/notification-text";

type Item = { id: string; message: string; detail?: string | null; read: boolean };

// A short two-note chime made in the browser (no sound file needed).
function chime() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [880, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    window.setTimeout(() => { void ctx.close().catch(() => undefined); }, 1200);
  } catch { /* sound is best-effort */ }
}

/** Ask once for desktop alerts; call from a click so the browser allows it. */
export function requestDesktopAlerts() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch { /* unsupported */ }
}

/**
 * Makes the bell "go off" when a new unread notification arrives:
 * chime, pop-up, bell shake, and a desktop alert when the tab is in the
 * background. Returns true while the bell should ring.
 */
export function useNotificationAlerts(items: Item[] | undefined): boolean {
  const seen = useRef<Set<string> | null>(null);
  const [ringing, setRinging] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!items) return;
    if (!seen.current) {
      // First load: remember what's already there, don't alert for it.
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.filter((n) => !seen.current!.has(n.id) && !n.read);
    items.forEach((n) => seen.current!.add(n.id));
    if (!fresh.length) return;
    chime();
    setRinging(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRinging(false), 4000);
    const first = fresh[0]!;
    const title = fresh.length > 1 ? `${fresh.length} new notifications` : notificationTitle(first.message);
    const body = fresh.length > 1 ? fresh.map((n) => notificationTitle(n.message)).slice(0, 3).join(" · ") : (first.detail || "");
    toast({ title, description: body || undefined });
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification(`FIAREP: ${title}`, { body: body || undefined, tag: first.id });
      }
    } catch { /* unsupported */ }
  }, [items]);
  return ringing;
}
