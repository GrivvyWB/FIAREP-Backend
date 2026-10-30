// The client's signing page: read the agreement, tap "I agree", sign, done. Opened from the emailed link.
import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { SquareAutopay } from "@/components/square-autopay";

type View = { number: string; company: string; contact: string; status: "sent" | "signed"; signedAt: string | null; signedName: string | null; html: string };

export default function SignContract() {
  const [, params] = useRoute("/sign/:id");
  const id = params?.id ?? "";
  const t = new URLSearchParams(window.location.search).get("t") ?? "";
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [agree, setAgree] = useState(false);
  const [name, setName] = useState("");
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const pad = useRef<SignaturePadHandle | null>(null);

  const load = async () => {
    const r = await fetch(`/api/v1/public/contracts/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error || "This signing link isn't valid."); return; }
    setView(j as View); if (!name) setName((j as View).contact || "");
  };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sign() {
    const image = pad.current?.toPng();
    if (!image) { setError("Sign in the box first."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/v1/public/contracts/${encodeURIComponent(id)}/sign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t, name, image, agree }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || "Couldn't sign. Try again."); return; }
      await load();
    } finally { setBusy(false); }
  }

  if (!view) return <div className="mx-auto max-w-3xl p-6 text-sm text-slate-600">{error || <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Opening the agreement…</span>}</div>;
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">FIAREP Agreement {view.number}</h1>
          <p className="text-sm text-slate-600">{view.company}</p>
        </div>
        <iframe title="Agreement" srcDoc={view.html} className="h-[60vh] w-full rounded-lg border border-slate-200 bg-white" />
        {view.status === "signed" ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div><b>Signed by {view.signedName}</b>{view.signedAt ? ` on ${new Date(view.signedAt).toLocaleString()}` : ""}. A signed copy was emailed to you.</div>
          </div>
        ) : null}
        {view.status === "signed" ? <SquareAutopay id={id} token={t} /> : (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              I have read and agree to this agreement.
            </label>
            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">Your full name</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-white" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600"><span>Sign here</span><button type="button" className="text-[#185FA5]" onClick={() => pad.current?.clear()}>Clear</button></div>
              <SignaturePad ref={pad} onChange={setDrawn} />
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <Button className="h-11 w-full bg-[#185FA5] text-white hover:bg-[#14508c]" disabled={!agree || !drawn || name.trim().length < 2 || busy} onClick={() => void sign()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Agree and sign
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
