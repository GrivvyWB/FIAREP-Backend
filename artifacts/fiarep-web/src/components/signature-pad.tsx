import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type SignaturePadHandle = { clear: () => void; toPng: () => string | null };

/** Sign with a finger or mouse. toPng() is null until something is drawn. */
export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number; onChange?: (drawn: boolean) => void }>(function SignaturePad({ height = 160, onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => { onChange?.(drawn); }, [drawn, onChange]);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio; c.height = height * ratio;
    const g = c.getContext("2d"); if (!g) return;
    g.scale(ratio, ratio); g.lineWidth = 2.4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0b1f45";
  }, [height]);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  useImperativeHandle(ref, () => ({
    clear: () => { const c = canvas.current; const g = c?.getContext("2d"); if (c && g) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.restore(); } setDrawn(false); },
    toPng: () => (drawn && canvas.current ? canvas.current.toDataURL("image/png") : null),
  }), [drawn]);
  return (
    <canvas
      ref={canvas}
      style={{ height, touchAction: "none" }}
      className="block w-full rounded-md border border-slate-300 bg-white"
      aria-label="Sign here"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const g = e.currentTarget.getContext("2d"); const p = at(e); g?.beginPath(); g?.moveTo(p.x, p.y); }}
      onPointerMove={(e) => { if (!drawing.current) return; const g = e.currentTarget.getContext("2d"); const p = at(e); g?.lineTo(p.x, p.y); g?.stroke(); if (!drawn) setDrawn(true); }}
      onPointerUp={() => { drawing.current = false; }}
      onPointerLeave={() => { drawing.current = false; }}
    />
  );
});
