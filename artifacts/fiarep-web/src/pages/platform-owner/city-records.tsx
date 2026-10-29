import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Loader2, MapPinned, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { CityRecordsCard, type CityRecords } from "@/components/city-records-card";

type Source = { id: string; label: string; covers: string; publisher: string; violations: boolean; on: boolean };

/** Platform Control → City Records: switch on a city or state when FIAREP works there, and its
 * own free records (owner, value, units, violations where published) come up on every address lookup. */
export default function OwnerCityRecords() {
  const { toast } = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState("");
  const [address, setAddress] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<CityRecords | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { void customFetch<Source[]>("/api/v1/platform/city-records", { responseType: "json" } as never).then(setSources).catch(() => undefined); }, []);

  async function toggle(s: Source, on: boolean) {
    setBusy(s.id);
    try {
      setSources(await customFetch<Source[]>(`/api/v1/platform/city-records/${s.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }), responseType: "json" } as never));
      toast({ title: `${s.label} records ${on ? "on" : "off"}` });
    } catch { toast({ variant: "destructive", title: "Could not save", description: "Try again." }); }
    finally { setBusy(""); }
  }

  async function test() {
    setTesting(true); setResult(null); setNote("");
    try {
      const r = await customFetch<CityRecords | { off: string; label: string } | null>("/api/v1/platform/city-records/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }), responseType: "json" } as never);
      if (!r) setNote("FIAREP doesn't read this city's records yet.");
      else if ("off" in r) setNote(`${r.label} records are off. Switch them on above.`);
      else setResult(r);
    } catch (e: any) { setNote(e?.data?.error || e?.message || "Lookup failed."); }
    finally { setTesting(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-950"><MapPinned className="h-6 w-6" />City Records</h1>
        <p className="text-sm text-slate-600">Outside New York City, each city or state publishes its own building records for free. Switch one on when you're working there and its records (owner, value, units, and violations where the city publishes them) come up on every address lookup on the website and in the app, for every client. Everything is off until you switch it on.</p>
      </div>
      <div className="divide-y overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {sources.map((s) => (
          <div key={s.id} className="flex items-center gap-4 px-5 py-4">
            <div className="flex-1">
              <p className="font-semibold text-slate-950">{s.label} <span className="ml-1 text-xs font-normal text-slate-500">{s.covers}</span></p>
              <p className="text-xs text-slate-500">{s.publisher}{s.violations ? " · includes violations" : " · property records (no violations published)"}</p>
            </div>
            {busy === s.id ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
            <span className={`w-10 text-right text-[11px] font-bold uppercase ${s.on ? "text-emerald-700" : "text-slate-400"}`}>{s.on ? "On" : "Off"}</span>
            <Switch checked={s.on} disabled={busy === s.id} onCheckedChange={(v) => void toggle(s, v)} aria-label={`${s.on ? "Switch off" : "Switch on"} ${s.label} records`} />
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Try an address</h2>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (address.trim()) void test(); }}>
          <Input className="min-w-[260px] flex-1" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 256 Washington Blvd, Stamford, CT" />
          <Button type="submit" disabled={testing || !address.trim()}>{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}Look up</Button>
        </form>
        {note && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{note}</p>}
        {result && <CityRecordsCard data={result} />}
      </div>
    </div>
  );
}
