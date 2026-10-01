import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Search, Trash2 } from "lucide-react";

// Upper management's Deleted items box: everything anyone deleted, with who
// deleted it and what it was. Pick a member (or type a name) to see what they
// deleted or what of theirs was deleted. "Delete permanently" purges it.
type Item = { id: string; entity: string; development: string | null; label: string; deletedAt: string; deletedByName: string; deletedByPosition: string; overrideCode: string; owners: string[]; state: Record<string, any> };
type Member = { id: string; name: string; position: string };

export default function DeletedItems() {
  const { staff } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [q, setQ] = useState("");
  const [member, setMember] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const r = await customFetch<{ items: Item[]; members: Member[] }>("/api/v1/deleted-items");
      setItems(r.items); setMembers(r.members);
    } catch (e: any) { toast({ variant: "destructive", title: "Could not load deleted items", description: e?.message }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const needle = (member || q).trim().toLowerCase();
  const shown = useMemo(() => !needle ? [] : items.filter((it) => [it.deletedByName, ...it.owners, it.label].some((v) => String(v || "").toLowerCase().includes(needle))), [items, needle]);

  async function purge(it: Item) {
    if (!window.confirm(`Permanently delete this?\n\n${it.label}\n\nThis cannot be undone.`)) return;
    try {
      await customFetch<void>(`/api/v1/deleted-items/${encodeURIComponent(it.id)}`, { method: "DELETE" });
      setItems((cur) => cur.filter((x) => x.id !== it.id));
      toast({ title: "Permanently deleted" });
    } catch (e: any) { toast({ variant: "destructive", title: "Could not delete", description: e?.message }); }
  }

  async function purgeMany(ids: string[], what: string) {
    if (!ids.length) return;
    if (!window.confirm(`Permanently delete ${ids.length} item${ids.length === 1 ? "" : "s"} (${what})?\n\nThis cannot be undone.`)) return;
    try {
      const r = await customFetch<{ purged: number }>("/api/v1/deleted-items/purge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      setItems((cur) => cur.filter((x) => !ids.includes(x.id)));
      setPicked({});
      toast({ title: `Permanently deleted ${r.purged}` });
    } catch (e: any) { toast({ variant: "destructive", title: "Could not delete", description: e?.message }); }
  }
  const pickedIds = shown.filter((it) => picked[it.id]).map((it) => it.id);

  const fmt = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
  const summary = (st: Record<string, any>) => Object.entries(st)
    .filter(([k, v]) => ["string", "number"].includes(typeof v) && String(v).trim() && !/^(deleted|_)/.test(k) && !/id$/i.test(k) && String(v).length < 200)
    .slice(0, 14);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deleted items</h1>
        <p className="text-sm text-muted-foreground">Everything deleted on the platform, with who deleted it. Pick a member or type a name to see what they deleted, or what of theirs was deleted.</p>
      </div>
      <div className="bg-card rounded-[14px] border border-border shadow-sm p-4 flex flex-col gap-3 sm:flex-row">
        <select value={member} onChange={(e) => { setMember(e.target.value); setQ(""); }} className="h-10 rounded-md border border-border bg-background px-3 text-sm sm:w-72">
          <option value="">Choose a member…</option>
          {members.map((m) => <option key={m.id} value={m.name}>{m.name}{m.position ? ` — ${m.position}` : ""}</option>)}
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setMember(""); }} placeholder="…or type a member's name, a complaint number, an address" className="pl-9" />
        </div>
      </div>
      <div className="bg-card rounded-[14px] border border-border shadow-sm">
        {!!needle && !!shown.length && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">{shown.length} deleted item{shown.length === 1 ? "" : "s"} for <span className="font-medium text-foreground">{member || q}</span>{pickedIds.length ? ` · ${pickedIds.length} selected` : ""}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!pickedIds.length} onClick={() => void purgeMany(pickedIds, "selected")}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete selected</Button>
              <Button size="sm" variant="destructive" onClick={() => void purgeMany(shown.map((it) => it.id), `all for ${member || q}`)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete all for {member || q}</Button>
            </div>
          </div>
        )}
        {loading ? <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>
          : !needle ? <p className="p-8 text-center text-sm text-muted-foreground">{items.length} deleted item{items.length === 1 ? "" : "s"} on file. Choose a member or type a name to see them.</p>
          : !shown.length ? <p className="p-8 text-center text-sm text-muted-foreground">Nothing deleted matches "{member || q}".</p>
          : <div className="divide-y divide-border">
            {shown.map((it) => (
              <div key={it.id} className="p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1.5 h-4 w-4 accent-[#185FA5]" checked={!!picked[it.id]} onChange={(e) => setPicked((p) => ({ ...p, [it.id]: e.target.checked }))} aria-label="Select" />
                    <div>
                    <p className="font-semibold">{it.label}</p>
                    <p className="text-sm text-muted-foreground">
                      Deleted by <span className="font-medium text-foreground">{it.deletedByName || "unknown"}</span>{it.deletedByPosition ? ` (${it.deletedByPosition})` : ""} · {fmt(it.deletedAt)}
                      {it.overrideCode ? <> · override code <span className="font-mono font-semibold">{it.overrideCode}</span></> : null}
                    </p>
                    {!!it.owners.length && <p className="text-xs text-muted-foreground">Was with: {it.owners.join(", ")}{it.development ? ` · ${it.development}` : ""}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))}>{open[it.id] ? "Hide details" : "Show details"}</Button>
                    <Button size="sm" variant="destructive" onClick={() => void purge(it)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete permanently</Button>
                  </div>
                </div>
                {open[it.id] && (
                  <dl className="grid gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
                    {summary(it.state).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 text-muted-foreground">{k}</dt><dd className="break-words">{String(v)}</dd></div>)}
                  </dl>
                )}
              </div>
            ))}
          </div>}
      </div>
    </div>
  );
}
