// Platform Control: the owner's signature, drawn once, put on FIAREP's side of every contract the Command Center sends.
import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";

type Sig = { saved: boolean; name?: string; image?: string; savedAt?: string };

export function MySignature() {
  const [sig, setSig] = useState<Sig | null>(null);
  const [name, setName] = useState("Tim Winn");
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const pad = useRef<SignaturePadHandle | null>(null);
  useEffect(() => { void customFetch<Sig>("/api/v1/platform/signature", { responseType: "json" } as never).then((s) => { setSig(s); if (s.name) setName(s.name); }).catch(() => setSig({ saved: false })); }, []);
  async function save() {
    const image = pad.current?.toPng(); if (!image) return;
    setBusy(true); setMsg("");
    try {
      setSig(await customFetch<Sig>("/api/v1/platform/signature", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, name }), responseType: "json" } as never));
      pad.current?.clear(); setMsg("Saved. It goes on FIAREP's side of every contract the Command Center sends.");
    } catch (e) { setMsg((e as { data?: { error?: string } })?.data?.error || "Couldn't save it."); } finally { setBusy(false); }
  }
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">My signature</h2>
        <p className="mt-0.5 text-xs text-slate-500">Signed on FIAREP's side of every contract the Command Center creates and sends to a client to sign.</p>
      </div>
      {sig?.saved && sig.image && (
        <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
          <img src={sig.image} alt="Your saved signature" className="h-14" />
          <div className="mt-1 text-xs text-slate-500">{sig.name} · saved {sig.savedAt ? new Date(sig.savedAt).toLocaleDateString() : ""}</div>
        </div>
      )}
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name under the signature" className="h-9 bg-white text-sm" />
      <SignaturePad ref={pad} height={130} onChange={setDrawn} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-9" onClick={() => pad.current?.clear()}>Clear</Button>
        <Button type="button" className="h-9 bg-slate-900 text-white hover:bg-slate-800" disabled={!drawn || busy} onClick={() => void save()}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{sig?.saved ? "Replace signature" : "Save signature"}</Button>
      </div>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </section>
  );
}
