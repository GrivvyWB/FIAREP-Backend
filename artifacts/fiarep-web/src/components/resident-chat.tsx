import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

type Msg = { id: string; from: "you" | "office"; text: string; at: string };
type Chat = { messages: Msg[]; appointment: { start: string; end: string; label: string } | null; open: boolean };

/** Status tokens for complaints filed from this browser (kept so the resident can come back to the conversation). */
const KEY = "fiarep_resident_tokens";
export function rememberResidentToken(complaintNo: string, token: string) {
  try { const all = JSON.parse(localStorage.getItem(KEY) || "{}"); all[complaintNo.toUpperCase()] = token; localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: this visit only */ }
}
function tokenFor(complaintNo: string): string {
  try { const t = JSON.parse(localStorage.getItem(KEY) || "{}")[complaintNo.toUpperCase()]; if (t) return String(t); } catch { /* ignore */ }
  try { if ((sessionStorage.getItem("fiarep_resident_complaint") || "").toUpperCase() === complaintNo.toUpperCase()) return sessionStorage.getItem("fiarep_resident_token") || ""; } catch { /* ignore */ }
  return "";
}

/** Messages with the management office about one complaint. Shown only on the device the complaint was filed from. */
export function ResidentChat({ complaintNo }: { complaintNo: string }) {
  const token = tokenFor(complaintNo);
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const path = `/api/v1/public/resident-reports/${encodeURIComponent(complaintNo)}/messages`;
  const load = async () => { try { setChat(await customFetch<Chat>(path, { responseType: "json", headers: { "x-resident-token": token } } as never)); } catch { setChat(null); } };
  useEffect(() => { if (!token) return; void load(); const t = setInterval(() => void load(), 15_000); return () => clearInterval(t); }, [complaintNo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [chat?.messages.length]);
  if (!token || !chat?.open) return null;
  async function send() {
    const t = text.trim(); if (!t) return;
    setSending(true); setError("");
    try {
      setChat(await customFetch<Chat>(path, { method: "POST", responseType: "json", headers: { "Content-Type": "application/json", "x-resident-token": token }, body: JSON.stringify({ text: t }) } as never));
      setText("");
    } catch (e: any) { setError(e?.data?.error || "Could not send. Try again."); }
    finally { setSending(false); }
  }
  return (
    <div>
      <h4 className="text-sm font-medium text-muted-foreground mb-2">Messages with the management office</h4>
      {chat.appointment && <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">Visit booked: <b>{chat.appointment.label}</b></div>}
      <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-border/50 bg-muted/20 p-3">
        {chat.messages.length === 0 && <p className="text-sm text-muted-foreground">Ask about your complaint or when someone can come.</p>}
        {chat.messages.map((m) => (
          <div key={m.id} className={`flex ${m.from === "you" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === "you" ? "bg-[#185FA5] text-white" : "bg-white border border-border text-foreground"}`}>
              {m.text}
              <div className={`mt-1 text-[10px] ${m.from === "you" ? "text-white/70" : "text-muted-foreground"}`}>{new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="mt-2 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} placeholder="Write a message" className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" disabled={sending} />
        <Button type="button" onClick={() => void send()} disabled={sending || !text.trim()}>{sending ? "Sending…" : "Send"}</Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
