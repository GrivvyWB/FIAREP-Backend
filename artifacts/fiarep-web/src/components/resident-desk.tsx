import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

// The resident line: a resident with no code talks to the Command Center —
// report a repair, check a complaint, set up the visit. This browser keeps the
// conversation so they can come back to it.
type Msg = { id: string; from: "you" | "office"; text: string; at: string };
type View = { messages: Msg[]; complaintNo: string | null; company: string | null; address?: string | null; appointment: { label: string } | null };
const KEY = "fiarep_resident_desk";

export function ResidentDesk({ companyCode, onBuilding }: { companyCode?: string; onBuilding?: (address: string) => void }) {
  const [desk, setDesk] = useState<{ id: string; token: string } | null>(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v?.id && v?.token ? v : null; } catch { return null; } });
  const [view, setView] = useState<View | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const keep = (d: { id: string; token: string }) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode: this visit only */ } setDesk(d); };
  const start = async () => {
    const r = await customFetch<View & { id: string; token: string }>("/api/v1/public/resident-desk", { method: "POST", responseType: "json", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyCode: companyCode || "" }) } as never);
    keep({ id: r.id, token: r.token }); setView(r);
  };
  const load = async (d: { id: string; token: string }) => {
    try { setView(await customFetch<View>(`/api/v1/public/resident-desk/${d.id}`, { responseType: "json", headers: { "x-desk-token": d.token } } as never)); }
    catch { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setDesk(null); void start(); }
  };
  useEffect(() => { if (desk) void load(desk); else void start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!desk) return; const t = setInterval(() => void load(desk), 15_000); return () => clearInterval(t); }, [desk?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [view?.messages.length]);
  useEffect(() => { if (view?.address) onBuilding?.(view.address); }, [view?.address]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send() {
    const t = text.trim(); if (!t || !desk) return;
    setSending(true); setError("");
    setView((v) => v && { ...v, messages: [...v.messages, { id: "pending", from: "you", text: t, at: new Date().toISOString() }] });
    setText("");
    try { setView(await customFetch<View>(`/api/v1/public/resident-desk/${desk.id}/messages`, { method: "POST", responseType: "json", headers: { "Content-Type": "application/json", "x-desk-token": desk.token }, body: JSON.stringify({ text: t }) } as never)); }
    catch (e: any) { setError(e?.data?.error || "Could not send. Try again."); setText(t); }
    finally { setSending(false); }
  }
  const newConversation = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setDesk(null); setView(null); void start(); };
  return (
    <div className="space-y-3">
      {view?.complaintNo && <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Your complaint number: <b>{view.complaintNo}</b>{view.company ? ` · ${view.company}` : ""}</div>}
      {view?.appointment && <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">Visit booked: <b>{view.appointment.label}</b></div>}
      <div className="h-[26rem] space-y-2 overflow-y-auto rounded-md border border-border/50 bg-muted/20 p-3">
        {!view && <p className="text-sm text-muted-foreground">Connecting…</p>}
        {view?.messages.map((m) => (
          <div key={m.id} className={`flex ${m.from === "you" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === "you" ? "bg-[#185FA5] text-white" : "bg-white border border-border text-foreground"}`}>
              {m.text}
              <div className={`mt-1 text-[10px] ${m.from === "you" ? "text-white/70" : "text-muted-foreground"}`}>{new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            </div>
          </div>
        ))}
        {sending && <p className="text-xs text-muted-foreground">Writing…</p>}
        <div ref={end} />
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} placeholder="Write a message" className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" disabled={sending || !view} aria-label="Message" />
        <Button type="button" onClick={() => void send()} disabled={sending || !text.trim() || !view}>Send</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <button type="button" onClick={newConversation} className="text-xs text-muted-foreground underline">Start a new conversation</button>
    </div>
  );
}
