// After signing: put a card on file with Square for the monthly payment. Square's own card form —
// the card number goes straight to Square, never through FIAREP.
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Info = { available: boolean; appId?: string; locationId?: string; sdk?: string; monthly?: number; enrolled?: { card: string; monthly: number; nextChargeOn: string; on: boolean } | null };
type SquareCard = { attach: (sel: string) => Promise<void>; tokenize: () => Promise<{ status: string; token?: string; errors?: Array<{ message: string }> }>; destroy?: () => Promise<void> };
declare global { interface Window { Square?: { payments: (appId: string, locationId: string) => { card: () => Promise<SquareCard> } } } }

const loadScript = (src: string) => new Promise<void>((ok, fail) => {
  if (window.Square) { ok(); return; }
  const el = document.createElement("script"); el.src = src; el.onload = () => ok(); el.onerror = () => fail(new Error("Square didn't load")); document.head.appendChild(el);
});

export function SquareAutopay({ id, token }: { id: string; token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<{ card: string; monthly: number; nextChargeOn: string } | null>(null);
  const card = useRef<SquareCard | null>(null);

  useEffect(() => {
    void fetch(`/api/v1/public/contracts/${encodeURIComponent(id)}/autopay?t=${encodeURIComponent(token)}`).then((r) => r.json()).then((j: Info) => setInfo(j)).catch(() => setInfo({ available: false }));
  }, [id, token]);
  useEffect(() => {
    if (!info?.available || info.enrolled || !info.sdk || !info.appId || !info.locationId) return;
    let gone = false;
    void (async () => {
      try {
        await loadScript(info.sdk!);
        const c = await window.Square!.payments(info.appId!, info.locationId!).card();
        if (gone) return;
        await c.attach("#square-card"); card.current = c; setReady(true);
      } catch (e) { setMsg(e instanceof Error ? e.message : "The card form didn't load."); }
    })();
    return () => { gone = true; void card.current?.destroy?.(); };
  }, [info]);

  async function enroll() {
    if (!card.current) return;
    setBusy(true); setMsg("");
    try {
      const t = await card.current.tokenize();
      if (t.status !== "OK" || !t.token) { setMsg(t.errors?.[0]?.message || "Check the card details."); return; }
      const r = await fetch(`/api/v1/public/contracts/${encodeURIComponent(id)}/autopay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, sourceId: t.token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error || "The card wasn't saved."); return; }
      setDone({ card: j.card, monthly: j.monthly, nextChargeOn: j.nextChargeOn });
      if (j.error) setMsg(j.error);
    } finally { setBusy(false); }
  }

  if (!info?.available) return null;
  const enrolled = done ?? info.enrolled;
  const usd = (n?: number) => `$${(n ?? 0).toLocaleString("en-US")}`;
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <div className="text-sm font-semibold text-slate-900">Monthly autopay</div>
        <p className="text-xs text-slate-500">{usd(info.monthly)} is charged to this card today and on the same day every month. Square sends a receipt each time.</p>
      </div>
      {enrolled ? (
        <div className="flex items-start gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div>Autopay is on: {enrolled.card}, {usd(enrolled.monthly)} a month. Next payment {enrolled.nextChargeOn}.</div></div>
      ) : (
        <>
          <div id="square-card" className="min-h-[90px]" />
          <Button className="h-11 w-full bg-[#185FA5] text-white hover:bg-[#14508c]" disabled={!ready || busy} onClick={() => void enroll()}>
            {busy || !ready ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Set up autopay · {usd(info.monthly)} a month
          </Button>
        </>
      )}
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </div>
  );
}
