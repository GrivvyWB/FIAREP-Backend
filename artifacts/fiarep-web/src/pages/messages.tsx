import { useCallback, useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { communityUnit, isCommunityCoordinator, isFiarepAdministrator } from "@/lib/access-policy";
import { Copy, KeyRound, MessageSquare, Search, Send, X } from "lucide-react";
import PublicMessage from "@/pages/public-message";

// Text messaging with FIAREP Services.
//
// A coordinator sees the people they handed a code to, and every plan client
// writing to FIAREP Services. FIAREP's administrators (Timothy Winn, Emily
// Winn) see the clients writing to the administrator and the codes they
// handed out themselves. A plan client has two conversations: one with
// FIAREP Services, one with the administrator. Nobody reads a conversation
// they are not part of - not a supervisor, not the administrators.

type ThreadRow = {
  id: string; kind: "code" | "client"; who: string; address: string; apartment: string;
  last: string; lastAt: string; unread: number; closed: boolean;
};
type Message = { id: string; from?: "fiarep" | "contact"; mine?: boolean; authorName: string; body: string; at: string };

const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const get = <T,>(url: string) => customFetch<T>(url, { responseType: "json" } as never);
const post = <T,>(url: string, body: unknown) => customFetch<T>(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), responseType: "json",
} as never);

export default function Messages() {
  const { staff, organizationModules } = useAuth();
  const { toast } = useToast();
  const admin = isFiarepAdministrator(staff);
  const mine = (isCommunityCoordinator(staff) && (staff?.tenantId || "default") === "default") || admin;
  const unit = communityUnit("default");
  const clientSide = !mine && (staff?.role === "administrator" || staff?.role === "management") &&
    (staff?.tenantId || "default") !== "default" && organizationModules["fiarepMessaging"] !== false;
  const memberSide = !mine && !clientSide && !!staff && !["resident", "vendor"].includes(String(staff.role)) &&
    ((staff.tenantId || "default") === "default" || organizationModules["fiarepMessaging"] !== false);

  // Every page has the code box: a code someone handed you opens a conversation with whoever made it.
  const codeBox = (width: string) => <div className={`mx-auto ${width} px-4 pb-6 sm:px-6`}><div className="rounded-lg border bg-card p-4"><PublicMessage embedded senderName={staff?.name || ""} /></div></div>;
  if (mine) return <><CoordinatorMessages unit={unit} admin={admin} toast={toast} />{codeBox("max-w-3xl")}</>;
  if (clientSide) return <><ClientMessages unit={unit} toast={toast} />{codeBox("max-w-2xl")}</>;
  // Every other member (CPM, inspector, technician, worker…): their own conversation with FIAREP.
  if (memberSide) return <><ClientMessages unit={unit} toast={toast} base="/api/v1/member/messages" />{codeBox("max-w-2xl")}</>;
  return codeBox("max-w-2xl");
}

/** FIAREP's side: hand out a code, read and answer. */
function CoordinatorMessages({ unit, admin, toast }: { unit: string; admin: boolean; toast: ReturnType<typeof useToast>["toast"] }) {
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [openId, setOpenId] = useState("");
  const [issued, setIssued] = useState<{ code: string; who: string } | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [apartment, setApartment] = useState("");
  const [issuing, setIssuing] = useState(false);
  // Someone who signed up in the app: type the name, click it, the conversation lands on their phone.
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Array<{ id: string; name: string; apartment: string; building: string }>>([]);
  const [starting, setStarting] = useState("");
  async function find(text: string) {
    setQ(text);
    if (text.trim().length < 2) { setPeople([]); return; }
    try { setPeople(await get(`/api/v1/fiarep/messages/people?q=${encodeURIComponent(text.trim())}`)); } catch { setPeople([]); }
  }
  async function start(id: string) {
    setStarting(id);
    try { const r = await post<{ threadId: string }>(`/api/v1/fiarep/messages/people/${encodeURIComponent(id)}/start`, {}); setQ(""); setPeople([]); await load(); setOpenId(r.threadId); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not start it", description: err?.data?.error || "Try again." }); }
    finally { setStarting(""); }
  }

  const load = useCallback(async () => {
    try { setRows(await get<ThreadRow[]>("/api/v1/fiarep/messages")); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not load messages", description: err?.data?.error || "Try again." }); }
  }, [toast]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [load]);

  async function issue() {
    if (!name.trim()) { toast({ variant: "destructive", title: "Who is the code for?" }); return; }
    setIssuing(true);
    try {
      const r = await post<{ code: string; threadId: string }>("/api/v1/fiarep/messages/codes", {
        contactName: name.trim(), address: address.trim(), apartment: apartment.trim(),
      });
      setIssued({ code: r.code, who: name.trim() });
      setName(""); setAddress(""); setApartment("");
      await load();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not make a code", description: err?.data?.error || "Try again." });
    } finally { setIssuing(false); }
  }

  async function close(id: string) {
    try { await post(`/api/v1/fiarep/messages/${encodeURIComponent(id)}/close`, {}); await load(); if (openId === id) setOpenId(""); }
    catch (err: any) { toast({ variant: "destructive", title: "Could not close it", description: err?.data?.error || "Try again." }); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><MessageSquare className="h-6 w-6" />Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Give someone a code at the door and they can write to you — in the app or on the website — and to nobody else.
          You are the only person at FIAREP who reads it.{admin ? " Client companies on the plan can also write to the administrator here." : ""}
        </p>
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4" />Find a person</h2>
        <Input placeholder="Type their name" value={q} onChange={(e) => void find(e.target.value)} />
        {q.trim().length >= 2 && people.length === 0 && <p className="text-xs text-muted-foreground">Nobody signed up under that name yet.</p>}
        {people.length > 0 && (
          <div className="divide-y rounded-md border">
            {people.map((p) => (
              <button key={p.id} type="button" disabled={!!starting} onClick={() => void start(p.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50">
                <span className="min-w-0"><span className="block text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{[p.building, p.apartment ? `Apt ${p.apartment}` : ""].filter(Boolean).join(" · ") || "Signed up in the app"}</span></span>
                <span className="shrink-0 text-xs font-semibold text-[#185FA5]">{starting === p.id ? "Opening…" : "Message"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" />Hand out a code</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input className="flex-1" placeholder="Who is it for" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="flex-1" placeholder="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />
          <Input className="sm:w-24" placeholder="Apt" value={apartment} onChange={(e) => setApartment(e.target.value)} />
          <Button onClick={() => void issue()} disabled={issuing || !name.trim()}>{issuing ? "Making…" : "Make a code"}</Button>
        </div>
        {issued && (
          <div className="rounded-md bg-muted p-4 text-center">
            <p className="text-sm font-medium">Code for {issued.who}</p>
            <p className="my-2 text-3xl font-bold tracking-[0.3em]">{issued.code}</p>
            <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(issued.code); toast({ title: "Code copied" }); }}>
              <Copy className="mr-2 h-4 w-4" />Copy
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              They open the app or go to the website, press Message and type this in. It is shown once — write it down for them.
            </p>
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => setIssued(null)}><X className="mr-1 h-3.5 w-3.5" />Done</Button>
          </div>
        )}
      </div>

      {rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nobody has written yet.</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card">
            <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpenId(openId === r.id ? "" : r.id)}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {r.who || "Unnamed"}
                  {r.kind === "client" && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">Client company</span>}
                  {r.closed && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Blocked</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[r.address, r.apartment ? `Apt ${r.apartment}` : ""].filter(Boolean).join(" · ")}
                  {r.last ? `${r.address ? " · " : ""}${r.last}` : ""}
                </p>
              </div>
              {r.unread > 0 && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{r.unread} new</span>}
              <span className="shrink-0 text-xs text-muted-foreground">{when(r.lastAt)}</span>
            </button>
            {openId === r.id && (
              <Thread
                id={r.id}
                readUrl={`/api/v1/fiarep/messages/${encodeURIComponent(r.id)}`}
                sendUrl={`/api/v1/fiarep/messages/${encodeURIComponent(r.id)}`}
                side="fiarep"
                closed={r.closed}
                onSent={load}
                toast={toast}
                footer={r.kind === "code" && !r.closed ? (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { if (window.confirm(`Block ${r.who || "this person"}? Their code stops working and they can no longer message you.`)) void close(r.id); }}>Block this person</Button>
                ) : null}
              />
            )}
          </div>
        ))}
      </div>
      {!admin && <p className="text-xs text-muted-foreground">A client company on the plan writes to the whole {unit} unit — any coordinator can answer.</p>}
    </div>
  );
}

/** A plan client's side, no code needed: one conversation with FIAREP
 *  Services and a separate one with FIAREP's administrator. Never a
 *  technician or a worker. */
function ClientMessages({ unit, toast, base = "/api/v1/client/messages" }: { unit: string; toast: ReturnType<typeof useToast>["toast"]; base?: string }) {
  const [to, setTo] = useState<"services" | "admin">("services");
  const url = to === "admin" ? `${base}?to=admin` : base;
  const name = to === "admin" ? "FIAREP's administrator" : unit;
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><MessageSquare className="h-6 w-6" />Message FIAREP</h1>
        <p className="mt-1 text-sm text-muted-foreground">Write to {name} and they answer here. Only the two of you see it.</p>
      </div>
      <div className="flex gap-2">
        <Button variant={to === "services" ? "default" : "outline"} onClick={() => setTo("services")}>{unit}</Button>
        <Button variant={to === "admin" ? "default" : "outline"} onClick={() => setTo("admin")}>Administrator</Button>
      </div>
      <div className="rounded-lg border bg-card">
        <Thread key={`${base}-${to}`} id={`client-${to}`} readUrl={url} sendUrl={url} side="contact" closed={false} toast={toast} />
      </div>
    </div>
  );
}

/** The conversation itself. Same bubbles whichever side you are on. */
function Thread({ id, readUrl, sendUrl, side, closed, onSent, footer, toast }: {
  id: string; readUrl: string; sendUrl: string; side: "fiarep" | "contact"; closed: boolean;
  onSent?: () => Promise<void> | void; footer?: React.ReactNode; toast: ReturnType<typeof useToast>["toast"];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await get<{ messages: Message[] }>(readUrl);
      setMessages(r.messages || []);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not open the conversation", description: err?.data?.error || "Try again." });
    }
  }, [readUrl, toast]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15000); return () => clearInterval(t); }, [load, id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      await post(sendUrl, { body: text });
      setBody("");
      await load();
      await onSent?.();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Not sent", description: err?.data?.error || "Try again." });
    } finally { setSending(false); }
  }

  const isMine = (m: Message) => (m.mine !== undefined ? m.mine : m.from === side);

  return (
    <div className="space-y-3 border-t p-4">
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {messages.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${isMine(m) ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${isMine(m) ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              <p className="whitespace-pre-wrap text-sm">{m.body}</p>
              <p className={`mt-1 text-[11px] ${isMine(m) ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {isMine(m) ? "" : `${m.authorName} · `}{when(m.at)}
              </p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {closed ? (
        <p className="text-xs text-muted-foreground">This conversation is blocked.</p>
      ) : (
        <div className="flex items-end gap-2">
          <Textarea className="min-h-10 flex-1" rows={2} placeholder="Write a message" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button onClick={() => void send()} disabled={sending || !body.trim()}><Send className="h-4 w-4" /></Button>
        </div>
      )}
      {footer}
    </div>
  );
}
