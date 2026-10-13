import { useCallback, useEffect, useMemo, useState } from "react";
import { customFetch, useListEntityRecords, getListEntityRecordsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Camera, Check, Loader2, Send, Trash2, Zap } from "lucide-react";

// Quick quote. FIAREP walks a building, sees a fixture that has to go, prices
// it off the repair book and either sends it to the owner or approves it on
// the spot. Built for a phone held in one hand on site.
//
// The page sends the item and how many; the server prices it from the book and
// the owner's overrides, so a price is never typed in here.

type CatalogLine = { key: string; label: string; price: number; unit: string; group: string };
type Draft = { key: string; label: string; unit: string; price: number; qty: string; note: string; photo: string; photoName: string };
type Client = { id: string; name: string };
type QuickLine = { id: string; label: string; unit: string; qty: number; unitPrice: number; amount: number; note?: string };
type QuickQuote = {
  lines: QuickLine[]; total: number; status: "approved" | "pending" | "declined";
  approvedBySelf: boolean; clientCompany: string; building: string; sentBy: string; sentAt: string; decidedBy: string; decidedAt: string;
};

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const get = <T,>(url: string) => customFetch<T>(url, { responseType: "json" } as never);

export default function QuickQuote() {
  const { staff } = useAuth();
  const { toast } = useToast();
  const mine = (staff?.tenantId || "default") === "default";

  const projectsQuery = useListEntityRecords("projects", undefined, {
    query: { queryKey: getListEntityRecordsQueryKey("projects"), refetchOnMount: "always" },
  } as never) as { data?: Array<{ id: string; state: Record<string, any> }>; isLoading: boolean };
  const projects = projectsQuery.data ?? [];

  const [projectId, setProjectId] = useState("");
  const [catalog, setCatalog] = useState<CatalogLine[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "self" | "client">("");

  useEffect(() => {
    if (!mine) return;
    void (async () => {
      try { const p = await get<{ catalog: CatalogLine[] }>("/api/v1/pricing"); setCatalog(p.catalog || []); }
      catch { toast({ variant: "destructive", title: "Could not load the price book" }); }
      try { setClients(await get<Client[]>("/api/v1/fiarep/clients")); } catch { /* sending needs it; approving does not */ }
    })();
  }, [mine, toast]);

  const project = projects.find((p) => p.id === projectId) || null;
  const sent: QuickQuote | null = project?.state?.quickQuote ?? null;
  const total = drafts.reduce((n, d) => n + d.price * (Number(d.qty) || 0), 0);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as CatalogLine[];
    return catalog.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)).slice(0, 10);
  }, [catalog, search]);

  const set = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  async function attach(i: number, file: File | undefined) {
    if (!file || !project) return;
    try {
      const uploaded = await customFetch<{ uploadUrl: string; file: { objectPath: string } }>("/api/v1/files/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({ kind: "room-photo", name: file.name || "fixture.jpg", size: file.size, contentType: file.type || "image/jpeg", entity: "projects", recordId: project.id }),
      } as never);
      const put = await fetch(uploaded.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
      if (!put.ok) throw new Error("upload failed");
      set(i, { photo: uploaded.file.objectPath, photoName: file.name });
    } catch {
      toast({ variant: "destructive", title: "Photo did not upload", description: "The line still goes; add the photo again later." });
    }
  }

  const send = useCallback(async (mode: "self" | "client") => {
    if (!project) { toast({ variant: "destructive", title: "Pick the project first" }); return; }
    if (drafts.length === 0) { toast({ variant: "destructive", title: "Add at least one item" }); return; }
    for (const d of drafts) {
      const n = Number(d.qty);
      if (!Number.isFinite(n) || n <= 0) { toast({ variant: "destructive", title: "How many?", description: `Enter a quantity for ${d.label}.` }); return; }
    }
    if (mode === "client" && !clientId) { toast({ variant: "destructive", title: "Pick the company that approves it" }); return; }
    setBusy(mode);
    try {
      await customFetch(`/api/v1/fiarep/projects/${encodeURIComponent(project.id)}/quick-quote`, {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({
          mode, clientTenantId: mode === "client" ? clientId : "", note: note.trim(),
          building: String(project.state?.name || ""),
          lines: drafts.map((d) => ({ key: d.key, qty: Number(d.qty), note: d.note.trim(), photo: d.photo })),
        }),
      } as never);
      setDrafts([]); setNote("");
      await projectsQuery_refetch();
      toast({ title: mode === "self" ? "Approved — go ahead" : "Sent to the client", description: mode === "self" ? "Recorded against the project in your name." : "Their management have been told." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Not sent", description: err?.data?.error || "Try again." });
    } finally { setBusy(""); }
  }, [project, drafts, clientId, note, toast]);

  // The list query owns the record; ask it again so the sent quote shows.
  async function projectsQuery_refetch() {
    try { await (projectsQuery as any).refetch?.(); } catch { /* the toast already said it went */ }
  }

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

      <div className="space-y-2 rounded-lg border bg-card p-4">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="qq-project">Project</label>
        <select
          id="qq-project"
          className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={projectId}
          onChange={(e) => { setProjectId(e.target.value); setDrafts([]); }}
        >
          <option value="">{projectsQuery.isLoading ? "Loading…" : `Pick the project… (${projects.length})`}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{String(p.state?.name || p.id.slice(0, 8))}{p.state?.client ? ` · ${p.state.client}` : ""}</option>
          ))}
        </select>
      </div>

      {sent && (
        <div className="space-y-1 rounded-lg border bg-card p-4">
          <p className="text-sm font-semibold">
            Last quote on this project — {money(sent.total)} ·{" "}
            <span className={sent.status === "approved" ? "text-emerald-700" : sent.status === "declined" ? "text-rose-700" : "text-amber-700"}>
              {sent.status === "approved" ? (sent.approvedBySelf ? "approved by FIAREP" : "approved") : sent.status === "declined" ? "declined" : `waiting for ${sent.clientCompany || "the client"}`}
            </span>
          </p>
          {sent.lines.map((l) => <p key={l.id} className="text-xs text-muted-foreground">{l.qty} × {l.label} — {money(l.amount)}</p>)}
          <p className="text-xs text-muted-foreground">{sent.sentBy}{sent.sentAt ? ` · ${when(sent.sentAt)}` : ""}{sent.decidedBy ? ` · ${sent.decidedBy}` : ""}</p>
        </div>
      )}

      {project && (
        <>
          <div className="space-y-2 rounded-lg border bg-card p-4">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="qq-search">Add what it needs</label>
            <Input id="qq-search" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Window, sink, leak, fixture…" autoCorrect="off" />
            {matches.map((m) => (
              <button
                key={m.key}
                type="button"
                className="block w-full border-b py-2 text-left last:border-0"
                onClick={() => { setDrafts((d) => [...d, { key: m.key, label: m.label, unit: m.unit, price: m.price, qty: "1", note: "", photo: "", photoName: "" }]); setSearch(""); }}
              >
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{money(m.price)} {m.unit} · {m.group}</span>
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
              <Button className="h-12 w-full" disabled={busy !== ""} onClick={() => void send("client")}>
                <Send className="mr-2 h-4 w-4" />{busy === "client" ? "Sending…" : `Send ${money(total)} to the owner`}
              </Button>
              <Button variant="outline" className="h-12 w-full" disabled={busy !== ""} onClick={() => void send("self")}>
                <Check className="mr-2 h-4 w-4" />{busy === "self" ? "Saving…" : `Approve ${money(total)} myself`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Approving it yourself records it against the project in your name and nobody is asked. Sending it tells their management and waits.
              </p>
            </div>
          )}
        </>
      )}
      {projectsQuery.isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
    </div>
  );
}
