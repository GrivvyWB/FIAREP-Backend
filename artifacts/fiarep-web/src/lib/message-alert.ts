// A new message: a short chime and, when the browser allows it, a desktop notice.
let ctx: AudioContext | null = null;

/** Browsers only let a page make sound after the person has clicked something once. */
export function primeMessageSound(): void {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx && AC) ctx = new AC();
    if (ctx && ctx.state === "suspended") void ctx.resume();
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  } catch { /* no sound on this browser */ }
}

export function chime(): void {
  try {
    if (!ctx) primeMessageSound();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.25);
      o.connect(g); g.connect(ctx.destination); o.start(now + i * 0.18); o.stop(now + i * 0.18 + 0.3);
    }
  } catch { /* no sound */ }
}

export function messageAlert(title: string, body: string): void {
  chime();
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag: "fiarep-message" });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch { /* notices not allowed */ }
}
