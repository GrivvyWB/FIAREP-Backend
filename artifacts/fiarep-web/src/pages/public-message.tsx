import { useCallback, useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KeyRound, MessageSquare, Send } from "lucide-react";
import { messageAlert, primeMessageSound } from "@/lib/message-alert";

// The code door. Someone a FIAREP Services coordinator met at a building types
// in the code they were handed and writes to that coordinator. No account, no
// plan, nothing else on the website — and no email anywhere in it.

type View = {
  coordinator: string; unit: string; closed: boolean;
  messages: { id: string; mine: boolean; author: string; body: string; at: string }[];
};

const KEY = "fiarep_message_code";
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const post = <T,>(url: string, body: unknown) => customFetch<T>(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), responseType: "json",
} as never);

export default function PublicMessage({ embedded = false, senderName = "" }: { embedded?: boolean; senderName?: string } = {}) {
  const [code, setCode] = useState(() => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } });
  const [view, setView] = useState<View | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const seen = useRef<string>("");

  const open = useCallback(async (value: string, quiet = false) => {
    const typed = value.trim().toUpperCase();
    if (!typed) return;
    if (!quiet) setBusy(true);
    try {
      const r = await post<View>("/api/v1/public/messages/open", { code: typed });
      // A new reply from the other side while the page is open: chime and a notice.
      const lastIn = [...r.messages].reverse().find((m) => !m.mine);
      if (lastIn && seen.current && lastIn.id !== seen.current) messageAlert(`New message from ${lastIn.author || r.coordinator || "FIAREP"}`, lastIn.body);
      if (lastIn) seen.current = lastIn.id; else if (!seen.current) seen.current = "-";
      setView(r); setError("");
      try { localStorage.setItem(KEY, typed); } catch { /* private window */ }
    } catch (err: any) {
      if (!quiet) { setView(null); setError(err?.data?.error || "That code does not open anything."); }
    } finally { if (!quiet) setBusy(false); }
  }, []);

  useEffect(() => { if (code) void open(code, true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!view || view.closed) return;
    const t = setInterval(() => void open(code, true), 15000);
    return () => clearInterval(t);
  }, [view, code, open]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [view?.messages.length]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      await post("/api/v1/public/messages/send", { code: code.trim().toUpperCase(), name: name.trim() || senderName, body: text });
      setBody("");
      await open(code, true);
    } catch (err: any) {
      setError(err?.data?.error || "Not sent. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className={embedded ? "space-y-3" : "mx-auto max-w-lg space-y-4 p-4 sm:p-8"}>
      {embedded ? (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" />Have a code?</h2>
          <p className="text-xs text-muted-foreground">{view ? `You are writing to ${view.coordinator || view.unit}.` : "Type the code someone gave you and you can write to the person who gave it."}</p>
        </div>
      ) : (
      <div className="text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight"><MessageSquare className="h-6 w-6" />Message</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {view ? `You are writing to ${view.coordinator || view.unit}.` : "Type in the code you were given and you can write to the person who gave it to you."}
        </p>
      </div>
      )}

      {!view && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <Input
            placeholder="ABCD-1234"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") void open(code); }}
            className="text-center text-lg tracking-[0.2em]"
          />
          <Button className="w-full" onClick={() => { primeMessageSound(); void open(code); }} disabled={busy || !code.trim()}>{busy ? "Checking…" : "Open"}</Button>
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
        </div>
      )}

      {view && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {view.messages.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Write the first message.</p>}
            {view.messages.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                  <p className={`mt-1 text-[11px] ${m.mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {m.mine ? "" : `${m.author} · `}{when(m.at)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          {view.closed ? (
            <p className="text-center text-sm text-muted-foreground">This conversation has been closed.</p>
          ) : (
            <>
              {view.messages.length === 0 && !senderName && (
                <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
              )}
              <div className="flex items-end gap-2">
                <Textarea className="min-h-10 flex-1" rows={2} placeholder="Write a message" value={body} onChange={(e) => setBody(e.target.value)} />
                <Button onClick={() => void send()} disabled={busy || !body.trim()}><Send className="h-4 w-4" /></Button>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </>
          )}
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setView(null); setCode(""); try { localStorage.removeItem(KEY); } catch { /* private window */ } }}>
            {embedded ? "Done — log off" : "Use a different code"}
          </button>
        </div>
      )}
    </div>
  );
}
