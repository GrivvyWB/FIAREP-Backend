// How high or deep a voice is, measured on the phone from a WAV recording (16-bit PCM):
// the median pitch (Hz) of the voiced parts, by autocorrelation. Nothing leaves the phone.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decode(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 3 < clean.length + 3; i += 4) {
    const a = B64.indexOf(clean[i] ?? 'A'), b = B64.indexOf(clean[i + 1] ?? 'A'), c = B64.indexOf(clean[i + 2] ?? 'A'), d = B64.indexOf(clean[i + 3] ?? 'A');
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Median pitch in Hz, or null when the file isn't a 16-bit PCM WAV or no voice was found. */
export function voicePitch(wavBase64: string): number | null {
  const bytes = decode(wavBase64);
  const dv = new DataView(bytes.buffer);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let rate = 0, channels = 1, bits = 16, dataAt = -1, dataLen = 0;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = tag(p), len = dv.getUint32(p + 4, true);
    if (id === 'fmt ') { channels = dv.getUint16(p + 10, true); rate = dv.getUint32(p + 12, true); bits = dv.getUint16(p + 22, true); }
    if (id === 'data') { dataAt = p + 8; dataLen = Math.min(len, bytes.length - dataAt); break; }
    p += 8 + len + (len % 2);
  }
  if (dataAt < 0 || bits !== 16 || !rate) return null;
  const n = Math.floor(dataLen / (2 * channels));
  const step = Math.max(1, Math.round(rate / 8000)); // work at about 8 kHz
  const sr = rate / step;
  const x: number[] = [];
  for (let i = 0; i < n; i += step) x.push(dv.getInt16(dataAt + i * 2 * channels, true) / 32768);
  const frame = Math.round(sr * 0.04), hop = Math.round(sr * 0.02);
  const minLag = Math.floor(sr / 350), maxLag = Math.ceil(sr / 70);
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  const found: number[] = [];
  for (let s = 0; s + frame + maxLag < x.length; s += hop) {
    let energy = 0; for (let i = 0; i < frame; i++) energy += x[s + i]! * x[s + i]!;
    if (Math.sqrt(energy / frame) < peak * 0.08) continue; // quiet: not voice
    const rs: number[] = [];
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0, e1 = 0, e2 = 0;
      for (let i = 0; i < frame; i++) { const a = x[s + i]!, b = x[s + i + lag]!; num += a * b; e1 += a * a; e2 += b * b; }
      const r = num / Math.sqrt(e1 * e2 || 1);
      rs.push(r); if (r > best) best = r;
    }
    // The first strong peak, not a double-length one (which would read an octave too low).
    let bestLag = 0;
    for (let i = 1; i < rs.length - 1; i++) if (rs[i]! >= best * 0.9 && rs[i]! >= rs[i - 1]! && rs[i]! >= rs[i + 1]!) { bestLag = minLag + i; break; }
    if (best > 0.55 && bestLag) found.push(sr / bestLag);
  }
  if (found.length < 10) return null;
  found.sort((a, b) => a - b);
  return Math.round(found[Math.floor(found.length / 2)]!);
}
