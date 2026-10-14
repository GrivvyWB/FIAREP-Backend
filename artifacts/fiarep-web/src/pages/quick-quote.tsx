import { useCallback, useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { quoteReceiptHtml, type Receipt } from "@/lib/quote-receipt";
import { Camera, Check, Loader2, Printer, Send, Trash2, Zap } from "lucide-react";

// Quick quote. FIAREP walks a building, sees a fixture that has to go, prices
// it off the repair book and either sends it to the owner or approves it on
// the spot. Built for a phone held in one hand on site.
//
// The page sends the item and how many; the server prices it from the book and
// the owner's overrides, so a price is never typed in here.

type CatalogLine = { key: string; label: string; price: number; unit: string; group: string; source?: string };
type Draft = { key: string; label: string; unit: string; price: number; qty: string; note: string; photo: string; photoName: string };
type Client = { id: string; name: string };
type Building = { id: string; address: string; city: string | null; state: string | null; organizationId: string; company: string | null };
type QuickLine = { id: string; label: string; unit: string; qty: number; unitPrice: number; amount: number; note: string };
type QuickQuote = {
  lines: QuickLine[]; total: number; status: "admin_review" | "approved" | "pending" | "declined";
  approvedBySelf: boolean; clientCompany: string; clientTenantId?: string; building: string; note: string;
  sentBy: string; sentAt: string; decidedBy: string; decidedAt: string;
};

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
/** Where a quote stands, in words. */
const standing = (q: QuickQuote) => q.status === "approved"
  ? (q.approvedBySelf ? "approved by FIAREP" : "approved")
  : q.status === "declined" ? "declined"
  : q.status === "admin_review" ? "waiting for the administrator"
  : `waiting for ${q.clientCompany || "the owner"}`;

const get = <T,>(url: string) => customFetch<T>(url, { responseType: "json" } as never);

export default function QuickQuote() {
  const { staff, organizationModules } = useAuth();
  // The same switch the app reads, so Past quotes is on or off in both places.
  const pastEnabled = organizationModules?.["apptab.cpm.past-quotes"] !== false;
  const { toast } = useToast();
  const mine = (staff?.tenantId || "default") === "default";
  // Only FIAREP's administrator approves a quote or sends it to the owner;
  // everyone else sends theirs to the administrator. The server enforces it.
  const isAdmin = staff?.role === "administrator";

  // The walk is priced against a BUILDING, not a project: a project made on a
  // phone may not have reached the server, and waiting for one is why this
  // page was empty. The server hangs the quote on a project behind the scenes
  // so the photographs have somewhere to live.
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState("");
  const [typedAddress, setTypedAddress] = useState("");
  const [projectId, setProjectId] = useState("");
  const [starting, setStarting] = useState(false);
  const [lastQuote, setLastQuote] = useState<QuickQuote | null>(null);
  const [past, setPast] = useState<Array<{ projectId: string; quote: QuickQuote }>>([]);
  const [showPast, setShowPast] = useState(false);
  const [catalog, setCatalog] = useState<CatalogLine[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "self" | "client" | "admin" | "approve" | "send" | "decline">("");

  useEffect(() => {
    if (!mine) return;
    void (async () => {
      try {
        const p = await get<{ catalog: CatalogLine[] }>("/api/v1/pricing");
        // The materials book rides separately: it is FIAREP's cost basis and is
        // never on the public pricing payload.
        let mats: CatalogLine[] = [];
        try { mats = (await get<{ materials: CatalogLine[] }>("/api/v1/fiarep/materials")).materials || []; } catch { /* repairs still price */ }
        setCatalog([...(p.catalog || []), ...mats]);
      }
      catch { toast({ variant: "destructive", title: "Could not load the price book" }); }
      try { setClients(await get<Client[]>("/api/v1/fiarep/clients")); } catch { /* sending needs it; approving does not */ }
      try { setBuildings(await get<Building[]>("/api/v1/fiarep/buildings")); } catch { /* an address can still be typed */ }
      try { setPast(await get<Array<{ projectId: string; quote: QuickQuote }>>("/api/v1/fiarep/quotes")); } catch { /* history is a convenience */ }
    })();
  }, [mine, toast]);

  const building = buildings.find((b) => b.id === buildingId) || null;
  const place = building
    ? [building.address, [building.city, building.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")
    : typedAddress.trim();
  const ready = Boolean(projectId);
  const sent = lastQuote;
  const total = drafts.reduce((n, d) => n + d.price * (Number(d.qty) || 0), 0);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as CatalogLine[];
    return catalog.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)).slice(0, 12);
  }, [catalog, search]);

  /** Open a project for this building so photographs have somewhere to live. */
  const startOn = useCallback(async (address: string, company: string, org: string) => {
    if (!address.trim()) return;
    setStarting(true);
    try {
      const r = await customFetch<{ projectId: string; quote?: QuickQuote | null }>("/api/v1/fiarep/quick-quote/start", {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({ address: address.trim(), company }),
      } as never);
      setProjectId(r.projectId);
      // A building already priced shows its quote again rather than looking blank.
      setLastQuote(r.quote || null);
      if (org) setClientId(org);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not open the building", description: err?.data?.error || "Try again." });
    } finally { setStarting(false); }
  }, [toast]);

  const set = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  async function attach(i: number, file: File | undefined) {
    if (!file || !projectId) return;
    try {
      const uploaded = await customFetch<{ uploadUrl: string; file: { objectPath: string } }>("/api/v1/files/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({ kind: "room-photo", name: file.name || "fixture.jpg", size: file.size, contentType: file.type || "image/jpeg", entity: "projects", recordId: projectId }),
      } as never);
      const put = await fetch(uploaded.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
      if (!put.ok) throw new Error("upload failed");
      set(i, { photo: uploaded.file.objectPath, photoName: file.name });
    } catch {
      toast({ variant: "destructive", title: "Photo did not upload", description: "The line still goes; add the photo again later." });
    }
  }

  /** The owner's piece of paper, whoever approved it — and before it is sent. */
  function receipt(which: "sent" | "draft" = "sent") {
    const q: Receipt | null = which === "sent"
      ? (sent ? ({ ...sent, building: sent.building || place } as Receipt) : null)
      : drafts.length
        ? ({
            lines: drafts.map((d, i) => ({
              id: String(i), label: d.label, unit: d.unit,
              qty: Number(d.qty) || 0, unitPrice: d.price,
              amount: d.price * (Number(d.qty) || 0), note: d.note.trim(),
            })),
            total,
            status: "draft",
            approvedBySelf: false,
            clientCompany: clients.find((c) => c.id === clientId)?.name || building?.company || "",
            building: place,
            note: note.trim(),
            sentBy: "", sentAt: "", decidedBy: "", decidedAt: "",
          } as Receipt)
        : null;
    if (!q) return;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) { toast({ variant: "destructive", title: "Allow pop-ups to print the receipt" }); return; }
    w.document.write(quoteReceiptHtml(q));
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 300);
  }

  const remove = useCallback(async () => {
    if (!projectId) return;
    if (!window.confirm("Delete this quote? It goes for good, and if this building was only opened for the quote it goes too.")) return;
    setBusy("self");
    try {
      await customFetch(`/api/v1/fiarep/projects/${encodeURIComponent(projectId)}/quick-quote`, { method: "DELETE", responseType: "json" } as never);
      setLastQuote(null); setDrafts([]); setProjectId(""); setBuildingId(""); setTypedAddress("");
      toast({ title: "Deleted" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not delete it", description: err?.data?.error || "Try again." });
    } finally { setBusy(""); }
  }, [projectId, toast]);

  const send = useCallback(async (mode: "self" | "client" | "admin") => {
    if (!projectId) { toast({ variant: "destructive", title: "Pick the building first" }); return; }
    if (drafts.length === 0) { toast({ variant: "destructive", title: "Add at least one item" }); return; }
    for (const d of drafts) {
      const n = Number(d.qty);
      if (!Number.isFinite(n) || n <= 0) { toast({ variant: "destructive", title: "How many?", description: `Enter a quantity for ${d.label}.` }); return; }
    }
    if (mode === "client" && !clientId) { toast({ variant: "destructive", title: "Pick the company that approves it" }); return; }
    setBusy(mode);
    try {
      const saved = await customFetch<QuickQuote>(`/api/v1/fiarep/projects/${encodeURIComponent(projectId)}/quick-quote`, {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({
          mode, clientTenantId: mode === "self" ? "" : clientId, note: note.trim(),
          building: place,
          lines: drafts.map((d) => ({ key: d.key, qty: Number(d.qty), note: d.note.trim(), photo: d.photo })),
        }),
      } as never);
      setDrafts([]); setNote("");
      setLastQuote(saved);
      toast({
        title: mode === "self" ? "Approved — go ahead" : mode === "admin" ? "Sent to the administrator" : "Sent to the client",
        description: mode === "self" ? "Recorded against the project in your name." : mode === "admin" ? "You will hear when it is approved, sent on or turned back." : "Their management have been told.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Not sent", description: err?.data?.error || "Try again." });
    } finally { setBusy(""); }
  }, [projectId, place, drafts, clientId, note, toast]);

  /** The administrator acts on a technician's quote. */
  const review = useCallback(async (decision: "approve" | "send" | "decline") => {
    if (!projectId) return;
    if (decision === "send" && !clientId) { toast({ variant: "destructive", title: "Pick the company that approves it" }); return; }
    setBusy(decision);
    try {
      const saved = await customFetch<QuickQuote>(`/api/v1/fiarep/projects/${encodeURIComponent(projectId)}/quick-quote/review`, {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({ decision, clientTenantId: decision === "send" ? clientId : "" }),
      } as never);
      setLastQuote(saved);
      try { setPast(await get<Array<{ projectId: string; quote: QuickQuote }>>("/api/v1/fiarep/quotes")); } catch { /* history is a convenience */ }
      toast({ title: decision === "approve" ? "Approved" : decision === "send" ? "Sent to the owner" : "Turned back" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Not done", description: err?.data?.error || "Try again." });
    } finally { setBusy(""); }
  }, [projectId, clientId, toast]);

  if (!mine) {
    return <div className="mx-auto max-w-lg p-10 text-center text-sm text-muted-foreground">Quick quotes are FIAREP's own.</div>;
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Zap className="h-6 w-6" />Quick quote</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What this building needs replacing or fixing, priced off FIAREP's book. Send it to the owner to approve, or approve it yourself when it is small enough to just do.
        </p>
      </div>

      {past.length > 0 && pastEnabled && (
        <div className="rounded-lg border bg-card p-4">
          <Button variant="outline" className="w-full" onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Hide past quotes" : `Past quotes (${past.length})`}
          </Button>
          {showPast && (
            <div className="mt-2 divide-y rounded-md border">
              {past.map((row) => (
                <button
                  key={row.projectId}
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-muted"
                  onClick={() => {
                    setProjectId(row.projectId);
                    setBuildingId(""); setTypedAddress(row.quote.building || "");
                    setLastQuote(row.quote);
                    if (row.quote.clientTenantId) setClientId(row.quote.clientTenantId);
                    setDrafts([]);
                    setShowPast(false);
                  }}
                >
                  <span className="block text-sm font-medium">{row.quote.building || "Quote"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {money(row.quote.total)} · {standing(row.quote)}
                    {row.quote.sentAt ? ` · ${new Date(row.quote.sentAt).toLocaleString()}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 rounded-lg border bg-card p-4">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="qq-building">Building</label>
        <select
          id="qq-building"
          className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={buildingId}
          onChange={(e) => {
            const id = e.target.value;
            setBuildingId(id); setDrafts([]); setProjectId(""); setLastQuote(null);
            const b = buildings.find((x) => x.id === id);
            if (b) void startOn([b.address, [b.city, b.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "), b.company || "", b.organizationId);
          }}
        >
          <option value="">{buildings.length ? `Pick a registered building… (${buildings.length})` : "No registered buildings"}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.address}{b.city || b.state ? ` · ${[b.city, b.state].filter(Boolean).join(", ")}` : ""}{b.company ? ` · ${b.company}` : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Not registered? Type the address instead.</p>
        <div className="flex gap-2">
          <Input
            className="h-11"
            value={typedAddress}
            onChange={(e) => { setTypedAddress(e.target.value); setBuildingId(""); setProjectId(""); }}
            placeholder="1555 Grand Concourse"
            aria-label="Building address"
          />
          <Button variant="outline" className="h-11 shrink-0" disabled={starting || typedAddress.trim().length < 3} onClick={() => void startOn(typedAddress, "", "")}>
            {starting ? "Opening…" : "Use this"}
          </Button>
        </div>
        {ready && <p className="text-xs text-emerald-700">Pricing {place}.</p>}
      </div>

      {sent && (
        <div className="space-y-1 rounded-lg border bg-card p-4">
          <p className="text-sm font-semibold">
            Sent — {money(sent.total)} ·{" "}
            <span className={sent.status === "approved" ? "text-emerald-700" : sent.status === "declined" ? "text-rose-700" : "text-amber-700"}>
              {standing(sent)}
            </span>
          </p>
          {sent.lines.map((l) => <p key={l.id} className="text-xs text-muted-foreground">{l.qty} × {l.label} — {money(l.amount)}</p>)}
          <p className="text-xs text-muted-foreground">{sent.sentBy}{sent.sentAt ? ` · ${when(sent.sentAt)}` : ""}{sent.decidedBy ? ` · ${sent.decidedBy}` : ""}</p>
          {isAdmin && sent.status === "admin_review" && (
            <div className="space-y-2 pt-2">
              <Button className="h-11 w-full" disabled={busy !== ""} onClick={() => void review("approve")}>
                <Check className="mr-2 h-4 w-4" />{busy === "approve" ? "Approving…" : `Approve ${money(sent.total)}`}
              </Button>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="qq-review-client">Company that approves it</label>
              <select id="qq-review-client" className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Pick a company…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button variant="outline" className="h-11 w-full" disabled={busy !== ""} onClick={() => void review("send")}>
                <Send className="mr-2 h-4 w-4" />{busy === "send" ? "Sending…" : "Send to the owner"}
              </Button>
              <Button variant="ghost" className="w-full text-destructive hover:text-destructive" disabled={busy !== ""} onClick={() => void review("decline")}>
                {busy === "decline" ? "Turning it back…" : "Turn it back"}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => receipt("sent")}>
              <Printer className="mr-1 h-4 w-4" />Receipt
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy !== ""} onClick={() => void remove()}>
              <Trash2 className="mr-1 h-4 w-4" />Delete this quote
            </Button>
          </div>
        </div>
      )}

      {ready && (
        <>
          <div className="space-y-2 rounded-lg border bg-card p-4">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="qq-search">Add what it needs</label>
            <Input id="qq-search" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Flapper, GFCI, hinge, filter, wax ring…" autoCorrect="off" />
            {matches.map((m) => (
              <button
                key={m.key}
                type="button"
                className="block w-full border-b py-2 text-left last:border-0"
                onClick={() => { setDrafts((d) => [...d, { key: m.key, label: m.label, unit: m.unit, price: m.price, qty: "1", note: "", photo: "", photoName: "" }]); setSearch(""); }}
              >
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{money(m.price)} {m.unit} · {m.group}{m.source ? ` · ${m.source}` : ""}</span>
              </button>
            ))}
          </div>

          {drafts.map((d, i) => (
            <div key={`${d.key}-${i}`} className="space-y-2 rounded-lg border bg-card p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{d.label}</p>
                  <p className="text-xs text-muted-foreground">{money(d.price)} {d.unit}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" aria-label={`Remove ${d.label}`} onClick={() => setDrafts((x) => x.filter((_, n) => n !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground" htmlFor={`qq-qty-${i}`}>How many</label>
                <Input id={`qq-qty-${i}`} className="h-11 w-24" inputMode="decimal" value={d.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/[^0-9.]/g, "") })} />
                <span className="ml-auto text-sm font-semibold">{money(d.price * (Number(d.qty) || 0))}</span>
              </div>
              <Input className="h-11" value={d.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="Where it is / what is wrong (optional)" />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[#185FA5]">
                <Camera className="h-4 w-4" />
                {d.photo ? `Photo added${d.photoName ? ` · ${d.photoName}` : ""}` : "Take or choose a photo"}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void attach(i, e.target.files?.[0])} />
              </label>
            </div>
          ))}

          {drafts.length > 0 && (
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between text-base font-bold">
                <span>Total</span><span>{money(total)}</span>
              </div>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the owner should know (optional)" />
              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="qq-client">Company that approves it</label>
                <select id="qq-client" className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Pick a company…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {isAdmin ? (
                <>
                  <Button className="h-12 w-full" disabled={busy !== ""} onClick={() => void send("client")}>
                    <Send className="mr-2 h-4 w-4" />{busy === "client" ? "Sending…" : `Send ${money(total)} to the owner`}
                  </Button>
                  <Button variant="outline" className="h-12 w-full" disabled={busy !== ""} onClick={() => void send("self")}>
                    <Check className="mr-2 h-4 w-4" />{busy === "self" ? "Saving…" : `Approve ${money(total)} myself`}
                  </Button>
                </>
              ) : (
                <Button className="h-12 w-full" disabled={busy !== ""} onClick={() => void send("admin")}>
                  <Send className="mr-2 h-4 w-4" />{busy === "admin" ? "Sending…" : `Send ${money(total)} to the administrator`}
                </Button>
              )}
              <Button variant="outline" className="h-12 w-full" disabled={busy !== ""} onClick={() => receipt("draft")}>
                <Printer className="mr-2 h-4 w-4" />Receipt
              </Button>
              <p className="text-xs text-muted-foreground">
                {isAdmin
                  ? "Approving it yourself records it against the project in your name and nobody is asked. Sending it tells their management and waits."
                  : "The administrator approves it, or sends it to the owner. Nothing is bought until then."}
              </p>
            </div>
          )}
        </>
      )}
      {starting && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
    </div>
  );
}
