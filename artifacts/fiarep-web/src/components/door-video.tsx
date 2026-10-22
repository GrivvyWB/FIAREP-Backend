import { useEffect, useState } from "react";

/**
 * A door video from the phone (.mov / .mp4). Storage hands it back without its type,
 * so the browser would refuse to play it: it is fetched and played with the right type.
 */
export function DoorVideo({ url, contentType, className }: { url: string; contentType?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true; let made: string | null = null;
    setSrc(null); setFailed(false);
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(new Blob([b], { type: contentType || (url.includes(".mp4") ? "video/mp4" : "video/quicktime") }));
        setSrc(made);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url, contentType]);
  if (failed) return <a href={url} target="_blank" rel="noopener" className="text-sm font-medium text-[#185FA5] underline">Open the video</a>;
  if (!src) return <div className={`grid place-items-center rounded-lg bg-black text-xs text-white/70 ${className || "h-48 w-full max-w-xl"}`}>Loading video…</div>;
  return <video className={`rounded-lg bg-black ${className || "max-h-80 w-full max-w-xl"}`} src={src} controls playsInline preload="metadata" />;
}
