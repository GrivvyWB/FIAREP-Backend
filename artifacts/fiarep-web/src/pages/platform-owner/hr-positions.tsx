import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";

type Position = { title: string; description: string };

/** Platform Control → HR: job titles (with a description) every company's HR can pick. */
export default function OwnerHrPositions() {
  const { toast } = useToast();
  const [list, setList] = useState<Position[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void customFetch<Position[]>("/api/v1/platform/hr-positions", { responseType: "json" } as never).then(setList).catch(() => undefined);
  }, []);
  async function save(next: Position[], done: string) {
    setBusy(true);
    try {
      setList(await customFetch<Position[]>("/api/v1/platform/hr-positions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list: next }), responseType: "json" } as never));
      toast({ title: done });
      return true;
    } catch (e: any) { toast({ variant: "destructive", title: "Not saved", description: e?.data?.error || e?.message }); return false; }
    finally { setBusy(false); }
  }
  async function add() {
    const t = title.trim();
    if (!t) return;
    if (await save([...list, { title: t, description: description.trim() }], `${t} added`)) { setTitle(""); setDescription(""); }
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[#185FA5]">Human resources</p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">HR job titles</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">Job titles you add here show in every company's HR Workspace, in Position on Create HR record, with the description under it.</p>
      </div>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-900">Add a job title</p>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title, e.g. HVAC Technician" className="max-w-md" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Job description" rows={3} className="w-full max-w-2xl rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <Button type="button" disabled={busy || !title.trim()} onClick={() => void add()} className="bg-[#185FA5] text-white hover:bg-[#124d87]"><Plus className="mr-1.5 h-4 w-4" />Add job title</Button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white">
        {list.length === 0 && <p className="p-5 text-sm text-slate-500">No job titles added yet.</p>}
        {list.map((p, i) => (
          <div key={p.title} className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 last:border-b-0">
            <div>
              <p className="text-sm font-semibold text-slate-900">{p.title}</p>
              {p.description && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{p.description}</p>}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { if (window.confirm(`Remove ${p.title}? People who already have it keep it.`)) void save(list.filter((_, j) => j !== i), `${p.title} removed`); }}><Trash2 className="mr-1 h-4 w-4" />Remove</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
