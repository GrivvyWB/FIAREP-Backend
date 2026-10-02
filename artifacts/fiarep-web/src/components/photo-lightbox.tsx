import { X } from "lucide-react";

// Full-screen photo viewer that fits the picture to the window (click or
// Close to dismiss). Used instead of opening the raw image in a new tab,
// which shows it at full camera size and, in Safari, blocks data: URLs.
export function PhotoLightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <img src={src} alt={alt || "Photo"} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-black" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
    </div>
  );
}
