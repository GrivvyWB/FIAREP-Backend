import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEntityRecordsQueryKey,
  useCreateEntityRecord,
  useListEntityRecords,
  usePerformEntityAction,
  useUpdateEntityRecord,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";

type Scope = { id: string; version: number; createdBy?: string | null; development?: string | null; state?: Record<string, unknown> };

export default function ScopeWriting() {
  const { staff } = useAuth();
  const client = useQueryClient();
  const { toast } = useToast();
  const query = useListEntityRecords("procurement", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("procurement"),
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  const create = useCreateEntityRecord();
  const update = useUpdateEntityRecord();
  const submit = usePerformEntityAction();
  const [editing, setEditing] = useState<Scope | null>(null);
  const [draft, setDraft] = useState({ title: "", development: "", address: "", scope: "" });
  const ownScopes = ((query.data || []) as Scope[]).filter((record) =>
    !record.createdBy || record.createdBy === staff?.id,
  );

  const open = (record?: Scope) => {
    const state = record?.state || {};
    setEditing(record || null);
    setDraft({
      title: String(state.title || ""),
      development: String(record?.development || ""),
      address: String(state.address || ""),
      scope: String(state.scope || state.description || ""),
    });
  };
  const save = async (shouldSubmit = false) => {
    try {
      let record = editing;
      const state = { title: draft.title, address: draft.address, scope: draft.scope };
      if (record) {
        await update.mutateAsync({
          entity: "procurement", id: record.id,
          data: { id: record.id, version: record.version, development: draft.development, state },
        });
      } else {
        const id = crypto.randomUUID();
        await create.mutateAsync({
          entity: "procurement",
          data: { id, version: 1, development: draft.development, state: { ...state, status: "draft" } },
        });
        record = { id, version: 1, development: draft.development, state: { ...state, status: "draft" } };
      }
      if (shouldSubmit && record) {
        await submit.mutateAsync({ entity: "procurement", id: record.id, action: "submit" });
      }
      await invalidateOperationalQueries(client, "procurement", record?.id, ["procurement-bids"]);
      setEditing(null);
      setDraft({ title: "", development: "", address: "", scope: "" });
      toast({ title: shouldSubmit ? "Scope submitted" : "Draft saved" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to save scope", description: error?.message || "Please try again." });
    }
  };
  const submitExisting = async (record: Scope) => {
    try {
      await submit.mutateAsync({
        entity: "procurement",
        id: record.id,
        action: "submit",
      });
      await invalidateOperationalQueries(client, "procurement", record.id, ["procurement-bids"]);
      toast({ title: "Scope submitted" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unable to submit scope", description: error?.message || "Please try again." });
    }
  };
  const busy = create.isPending || update.isPending || submit.isPending;

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Scope Writing</h1><p className="text-muted-foreground">Write and submit procurement scopes for your assigned records.</p></div>
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <h2 className="font-semibold">{editing ? "Edit scope draft" : "New scope draft"}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <Input placeholder="Development" value={draft.development} onChange={(e) => setDraft({ ...draft, development: e.target.value })} />
        <Input placeholder="Address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
      </div>
      <Textarea className="min-h-48" placeholder="Full text scope" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
      <div className="flex justify-end gap-2">
        {editing && <Button variant="ghost" onClick={() => { setEditing(null); setDraft({ title: "", development: "", address: "", scope: "" }); }}>Cancel</Button>}
        <Button variant="outline" onClick={() => save(false)} disabled={busy || !draft.title.trim() || !draft.development.trim()}>Save draft</Button>
        <Button onClick={() => save(true)} disabled={busy || !draft.title.trim() || !draft.development.trim() || !draft.scope.trim()}>Submit scope</Button>
      </div>
    </div>
    <div className="grid gap-3">
      {ownScopes.length === 0 ? <p className="text-sm text-muted-foreground">No scope drafts yet.</p> : ownScopes.map((record) => {
        const state = record.state || {};
        const status = String(state.status || "draft");
        const editable = ["draft", "returned"].includes(status);
        return <div key={record.id} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
          <div className="min-w-0 flex-1"><h3 className="font-semibold">{String(state.title || "Untitled scope")}</h3><p className="text-sm text-muted-foreground">{record.development || "No development"} · {String(state.address || "No address")}</p><p className="mt-2 text-sm whitespace-pre-wrap line-clamp-3">{String(state.scope || "")}</p></div>
          <div className="flex shrink-0 flex-col items-end gap-2"><span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold capitalize">{status}</span>{editable && <Button size="sm" variant="outline" onClick={() => open(record)}>Edit</Button>}{editable && <Button size="sm" onClick={() => submitExisting(record)} disabled={busy}>Submit</Button>}</div>
        </div>;
      })}
    </div>
  </div>;
}