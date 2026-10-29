import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Globe2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type Country = { code: string; name: string; on: boolean };

/** Platform Control → Countries: FIAREP works in a country once it is switched on here. The United
 * States is on; every other country starts off. Off: no address search there and no new buildings. */
export default function OwnerCountries() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Country[]>([]);
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => { void customFetch<Country[]>("/api/v1/platform/countries", { responseType: "json" } as never).then(setRows).catch(() => undefined); }, []);

  async function toggle(c: Country, on: boolean) {
    setBusy(c.code);
    try {
      setRows(await customFetch<Country[]>(`/api/v1/platform/countries/${c.code}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }), responseType: "json" } as never));
      toast({ title: `${c.name} ${on ? "on" : "off"}` });
    } catch { toast({ variant: "destructive", title: "Could not save", description: "Try again." }); }
    finally { setBusy(""); }
  }

  const q = find.trim().toLowerCase();
  const onRows = useMemo(() => rows.filter((r) => r.on), [rows]);
  const shown = useMemo(() => (q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase() === q) : rows), [rows, q]);
  const row = (c: Country) => (
    <div key={c.code} className={`flex items-center gap-3 px-5 py-2.5 ${c.on ? "" : "opacity-70"}`}>
      <span className="w-8 text-xs font-semibold text-slate-400">{c.code}</span>
      <p className="flex-1 text-sm text-slate-900">{c.name}</p>
      {busy === c.code && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      <span className={`w-8 text-right text-[11px] font-bold uppercase ${c.on ? "text-emerald-700" : "text-slate-400"}`}>{c.on ? "On" : "Off"}</span>
      <Switch checked={c.on} disabled={busy === c.code} onCheckedChange={(v) => void toggle(c, v)} aria-label={`${c.on ? "Switch off" : "Switch on"} ${c.name}`} />
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-950"><Globe2 className="h-6 w-6" />Countries</h1>
        <p className="text-sm text-slate-600">FIAREP works in a country once it is switched on here. The United States is on; every other country starts off. While a country is off, its addresses don't come up in the address search and no building there can be added.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <p className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">On now ({onRows.length})</p>
        <div className="divide-y divide-slate-100">{onRows.length ? onRows.map(row) : <p className="px-5 py-3 text-sm text-slate-500">No country is on.</p>}</div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a country, e.g. Canada" aria-label="Find a country" />
        </div>
        <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">{shown.map(row)}</div>
      </div>
    </div>
  );
}
