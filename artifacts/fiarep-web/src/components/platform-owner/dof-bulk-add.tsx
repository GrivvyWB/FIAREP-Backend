import { useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Loader2, Search } from "lucide-react";

/**
 * Pull a client's whole portfolio off the DOF assessment roll by owner name and
 * add every building at once. Each building goes in ON the plan (so it shows in
 * Building Baseline); switch off the ones you do not want.
 */
type DofBuilding = { bbl: string; displayAddress: string; owner: string; units: number; buildings: number; buildingClass: string; added: boolean; otherClient: boolean };
type DofResult = { year: string; buildings: DofBuilding[] };
type BulkResult = { added: number; on: number; off: number; skipped: number; stoppedAtPropertyLimit: boolean; propertyLimit: number | null; licensedUnits: number | null };
const errText = (e: any, fallback: string) => e?.data?.error || e?.message || fallback;

export function DofBulkAdd({ organizationId, defaultOwner, onAdded }: { organizationId: string; defaultOwner: string; onAdded: () => void | Promise<void> }) {
  const [owner, setOwner] = useState(defaultOwner);
  const [busy, setBusy] = useState<"" | "find" | "add">("");
  const [result, setResult] = useState<DofResult | null>(null);
  const [ownersOff, setOwnersOff] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const owners = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of result?.buildings ?? []) m.set(b.owner, (m.get(b.owner) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [result]);
  const toAdd = useMemo(() => (result?.buildings ?? []).filter((b) => !b.added && !b.otherClient && !ownersOff.has(b.owner)), [result, ownersOff]);
  const alreadyAdded = (result?.buildings ?? []).filter((b) => b.added).length;
  const atOtherClient = (result?.buildings ?? []).filter((b) => b.otherClient).length;
  const unitsToAdd = toAdd.reduce((n, b) => n + b.units, 0);

  async function find() {
    if (owner.trim().length < 3) return;
    setBusy("find"); setError(""); setMessage(""); setResult(null); setOwnersOff(new Set());
    try {
      setResult(await customFetch<DofResult>(`/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/dof-owner?owner=${encodeURIComponent(owner.trim())}`, { responseType: "json" } as never));
    } catch (e) { setError(errText(e, "Could not reach the DOF roll.")); } finally { setBusy(""); }
  }

  async function addAll() {
    if (toAdd.length === 0) return;
    setBusy("add"); setError(""); setMessage("");
    try {
      const r = await customFetch<BulkResult>(`/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/properties/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({ buildings: toAdd.map((b) => ({ displayAddress: b.displayAddress, bbl: b.bbl, units: b.units })) }),
      } as never);
      const parts = [`Added ${r.added.toLocaleString()} building${r.added === 1 ? "" : "s"} — ${r.on.toLocaleString()} on the plan`];
      if (r.off > 0) parts.push(`${r.off.toLocaleString()} switched off because they go past the ${r.licensedUnits?.toLocaleString()} licensed units — raise the licensed units to switch them on`);
      if (r.skipped > 0) parts.push(`${r.skipped.toLocaleString()} already registered`);
      if (r.stoppedAtPropertyLimit) parts.push(`stopped at the property limit of ${r.propertyLimit}`);
      setMessage(parts.join(" · ") + ".");
      setResult(null);
      await onAdded();
    } catch (e) { setError(errText(e, "Could not add the buildings.")); } finally { setBusy(""); }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <div className="text-sm font-semibold text-slate-900">Add all buildings from DOF</div>
        <p className="mt-0.5 text-xs text-slate-500">Type the owner name as it is on the DOF tax roll. Every building under that owner comes in on the plan; switch off the ones you don't want.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Owner name on the DOF roll" value={owner} onChange={(e) => setOwner(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find(); } }} placeholder="Owner name, e.g. NYC HOUSING AUTHORITY" className="h-9 flex-1 bg-white text-sm" />
        <Button type="button" variant="outline" className="h-9" disabled={busy !== "" || owner.trim().length < 3} onClick={() => void find()}>
          {busy === "find" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
          {busy === "find" ? "Searching DOF…" : "Find on DOF"}
        </Button>
      </div>
      {result && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-600">
            DOF roll {result.year}: <b className="text-slate-900">{result.buildings.length.toLocaleString()} building{result.buildings.length === 1 ? "" : "s"}</b>
            {alreadyAdded > 0 ? ` · ${alreadyAdded.toLocaleString()} already on this client` : ""}
            {atOtherClient > 0 ? ` · ${atOtherClient.toLocaleString()} registered to another client` : ""}
          </p>
          {owners.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-slate-50 p-2">
              {owners.map(([name, n]) => (
                <label key={name} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                  <span className="truncate">{name} <span className="text-slate-400">· {n.toLocaleString()}</span></span>
                  <Switch checked={!ownersOff.has(name)} onCheckedChange={(on) => setOwnersOff((s) => { const next = new Set(s); if (on) next.delete(name); else next.add(name); return next; })} aria-label={`Include ${name}`} />
                </label>
              ))}
            </div>
          )}
          <Button type="button" className="h-9 bg-slate-900 text-white hover:bg-slate-800" disabled={busy !== "" || toAdd.length === 0} onClick={() => void addAll()}>
            {busy === "add" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {busy === "add" ? "Adding…" : `Add all ${toAdd.length.toLocaleString()} buildings${unitsToAdd > 0 ? ` · ${unitsToAdd.toLocaleString()} units` : ""}`}
          </Button>
        </div>
      )}
      {message && <p className="text-xs text-emerald-700">{message}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Every building on a client, with an on / off switch and a search box. */
export type SwitchBuilding = { id: string; displayAddress: string; units: number | null; active: boolean };
export function BuildingSwitchList({ organizationId, buildings, onChanged, clientName = "" }: { organizationId: string; buildings: SwitchBuilding[]; onChanged: () => void | Promise<void>; clientName?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? buildings.filter((b) => b.displayAddress.toLowerCase().includes(t)) : buildings).slice().sort((a, b) => a.displayAddress.localeCompare(b.displayAddress));
  }, [buildings, q]);
  const onCount = buildings.filter((b) => b.active).length;
  const [bulk, setBulk] = useState<"" | "on" | "off">("");

  // Switch every building on (or off) the plan in one press.
  async function switchAll(active: boolean) {
    const targets = buildings.filter((b) => b.active !== active);
    if (targets.length === 0) return;
    setBulk(active ? "on" : "off"); setError("");
    let failed = 0; let firstError = "";
    for (const b of targets) {
      try { await customFetch(`/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/properties/${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }), responseType: "json" } as never); }
      catch (e) { failed += 1; if (!firstError) firstError = errText(e, "Could not switch it."); }
    }
    await onChanged();
    if (failed) setError(`${failed.toLocaleString()} of ${targets.length.toLocaleString()} could not be switched ${active ? "on" : "off"}: ${firstError}`);
    setBulk("");
  }

  async function flip(b: SwitchBuilding) {
    setBusyId(b.id); setError("");
    try {
      await customFetch(`/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/properties/${encodeURIComponent(b.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !b.active }), responseType: "json" } as never);
      await onChanged();
    } catch (e) { setError(errText(e, "Could not switch it.")); } finally { setBusyId(""); }
  }

  if (buildings.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-sm font-semibold text-slate-900">All buildings{clientName ? ` — ${clientName}` : ""}</span>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {buildings.length.toLocaleString()} · {onCount.toLocaleString()} on
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-8 bg-slate-900 text-white hover:bg-slate-800" disabled={bulk !== "" || onCount === buildings.length} onClick={() => void switchAll(true)}>{bulk === "on" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{bulk === "on" ? "Switching on…" : `Switch all on (${(buildings.length - onCount).toLocaleString()})`}</Button>
        <Button type="button" size="sm" variant="outline" className="h-8" disabled={bulk !== "" || onCount === 0} onClick={() => void switchAll(false)}>{bulk === "off" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{bulk === "off" ? "Switching off…" : "Switch all off"}</Button>
      </div>
      <Input aria-label="Search buildings" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search an address" className="h-8 bg-white text-sm" />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
        {shown.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className={b.active ? "text-slate-800" : "text-slate-400"}>
              {b.displayAddress}
              {clientName && <span className="block text-xs font-normal text-slate-500">{clientName}</span>}
              {b.units ? <span className="ml-2 text-xs text-slate-500">{b.units.toLocaleString()} units</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
              {b.active ? "On" : "Off"}
              <Switch checked={b.active} disabled={busyId === b.id} onCheckedChange={() => void flip(b)} aria-label={`${b.active ? "Switch off" : "Switch on"} ${b.displayAddress}`} />
            </span>
          </div>
        ))}
        {shown.length === 0 && <p className="py-2 text-xs text-slate-500">No building matches.</p>}
      </div>
      </>}
    </div>
  );
}
