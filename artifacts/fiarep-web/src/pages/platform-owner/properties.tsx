import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { customFetch, useListOrganizations } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Building2, Loader2, Plus, Search, Trash2, X } from "lucide-react";

/**
 * Platform Control -> Properties. FIAREP registers the buildings each client
 * is responsible for and switches each one on or off the plan. Clients never
 * manage their own properties: "on the plan" drives licensed-unit billing,
 * resident complaint routing and public resident access, so it stays here.
 */

type Property = {
  id: string;
  displayAddress: string;
  development: string | null;
  units: number | null;
  bbl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
type Suggestion = { address: string; borough: string; label: string };
type Payload = {
  properties: Property[];
  organizationName: string;
  licensedUnits: number | null;
  unrestricted: boolean;
};

const json = { "Content-Type": "application/json" };

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 border-r border-slate-200 px-5 py-4 last:border-r-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
    </div>
  );
}

export default function OwnerProperties() {
  const { toast } = useToast();
  const { data: organizations = [], isLoading: orgsLoading } = useListOrganizations();

  const [organizationId, setOrganizationId] = useState("");
  useEffect(() => {
    if (!organizationId && organizations[0]) setOrganizationId(organizations[0].id);
  }, [organizationId, organizations]);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const payload = await customFetch<Payload>(
        `/api/v1/platform/properties?organizationId=${encodeURIComponent(organizationId)}`,
        { responseType: "json" } as never,
      );
      setData(payload);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not load properties", description: err?.data?.error || err?.message || "Try again." });
    } finally {
      setLoading(false);
    }
  }, [organizationId, toast]);

  useEffect(() => { void reload(); }, [reload]);

  const properties = useMemo(() => data?.properties ?? [], [data]);

  // ── Address autocomplete ──
  const [addressInput, setAddressInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [devName, setDevName] = useState("");

  function onAddressChange(value: string) {
    setAddressInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) { setSuggestions([]); setSuggestOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const rows = await customFetch<Suggestion[]>(
          `/api/v1/platform/properties/address-suggest?q=${encodeURIComponent(value.trim())}`,
          { responseType: "json" } as never,
        );
        setSuggestions(rows);
        setSuggestOpen(rows.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestLoading(false);
      }
    }, 300);
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSuggestOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Add ──
  const [adding, setAdding] = useState(false);
  async function addProperty() {
    const displayAddress = addressInput.trim();
    if (!displayAddress || displayAddress.length < 4) {
      toast({ variant: "destructive", title: "Enter a building address" }); return;
    }
    setAdding(true);
    try {
      await customFetch<Property>("/api/v1/platform/properties", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ organizationId, displayAddress, development: devName.trim() || null }),
        responseType: "json",
      } as never);
      setAddressInput("");
      setDevName("");
      toast({ title: `Added to ${data?.organizationName ?? "the organization"}` });
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not add property", description: err?.data?.error || err?.message || "Try again." });
    } finally {
      setAdding(false);
    }
  }

  // ── On / off the plan ──
  async function toggleActive(prop: Property) {
    try {
      await customFetch<Property>(`/api/v1/platform/properties/${encodeURIComponent(prop.id)}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ active: !prop.active }),
        responseType: "json",
      } as never);
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not update property", description: err?.data?.error || err?.message || "Try again." });
    }
  }

  // ── Remove ──
  const [removing, setRemoving] = useState<string | null>(null);
  async function removeProperty(prop: Property) {
    setRemoving(prop.id);
    try {
      await customFetch(`/api/v1/platform/properties/${encodeURIComponent(prop.id)}`, {
        method: "DELETE",
        headers: json,
        responseType: "json",
      } as never);
      toast({ title: `Removed ${prop.displayAddress}` });
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not remove property", description: err?.data?.error || err?.message || "Try again." });
    } finally {
      setRemoving(null);
    }
  }

  // ── Filter / group ──
  const [filter, setFilter] = useState("");
  const filtered = properties.filter((p) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return p.displayAddress.toLowerCase().includes(q) || (p.development || "").toLowerCase().includes(q);
  });
  const grouped = new Map<string, Property[]>();
  for (const p of filtered) {
    const key = p.development || "(No development)";
    const arr = grouped.get(key) || [];
    arr.push(p);
    grouped.set(key, arr);
  }

  const unitsOnPlan = properties.reduce((n, p) => n + (p.active && p.units ? p.units : 0), 0);
  const onPlanCount = properties.filter((p) => p.active).length;
  const licensed = data?.unrestricted ? "Unlimited" : data?.licensedUnits ? data.licensedUnits.toLocaleString() : "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#185FA5]">Company configuration</p>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-950">
            <Building2 className="h-7 w-7" /> Properties
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Register the buildings this client is responsible for and switch each one on or off the plan.
            On the plan counts against their licensed units and opens the building to resident complaints.
            Clients cannot change this themselves.
          </p>
        </div>
        <Select value={organizationId} onValueChange={(v) => { setOrganizationId(v); setFilter(""); }}>
          <SelectTrigger className="h-11 w-full bg-white sm:w-[320px]" aria-label="Organization">
            <SelectValue placeholder={orgsLoading ? "Loading..." : "Pick an organization"} />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.id === "default" ? "FIAREP" : item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap rounded-xl border border-slate-200 bg-white shadow-sm">
        <Metric label="Properties" value={String(properties.length)} />
        <Metric label="On the plan" value={String(onPlanCount)} />
        <Metric label="Units on plan" value={unitsOnPlan.toLocaleString()} />
        <Metric label="Licensed units" value={licensed} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Add a building</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1" ref={wrapRef}>
                <Input
                  placeholder="Start typing an address..."
                  value={addressInput}
                  onChange={(e) => onAddressChange(e.target.value)}
                  onFocus={() => { if (suggestions.length > 0) setSuggestOpen(true); }}
                />
                {suggestLoading && (
                  <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />
                )}
                {suggestOpen && suggestions.length > 0 && (
                  <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white text-sm shadow-md">
                    {suggestions.map((s, i) => (
                      <li
                        key={i}
                        className="cursor-pointer px-3 py-2 hover:bg-slate-50"
                        onMouseDown={() => { setAddressInput(s.label); setSuggestions([]); setSuggestOpen(false); }}
                      >
                        <span className="font-medium text-slate-900">{s.address}</span>
                        {s.borough && <span className="ml-2 text-slate-500">{s.borough}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Input
                className="sm:w-44"
                placeholder="Development (optional)"
                value={devName}
                onChange={(e) => setDevName(e.target.value)}
              />
              <Button
                onClick={addProperty}
                disabled={adding || !addressInput.trim() || !organizationId}
                className="h-10 bg-[#185FA5] px-5 text-white hover:bg-[#124d87]"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-1.5">Add</span>
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Units come from the City record. A building is added off the plan — switch it on when the client is ready.
            </p>
          </section>

          {properties.length > 4 && (
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="bg-white pl-9"
                placeholder="Filter buildings..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {filter && (
                <button className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-900" onClick={() => setFilter("")}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {filtered.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
              {properties.length === 0
                ? `No buildings registered for ${data?.organizationName ?? "this organization"} yet.`
                : "No buildings match your filter."}
            </p>
          )}

          {Array.from(grouped.entries()).map(([dev, props]) => (
            <div key={dev} className="space-y-2">
              {grouped.size > 1 && (
                <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">{dev}</h3>
              )}
              {props.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{p.displayAddress}</p>
                    <p className="text-xs text-slate-500">
                      {p.units ? `${p.units} units` : "Units unknown"}
                      {p.bbl ? ` · BBL ${p.bbl}` : ""}
                      {p.development && grouped.size <= 1 ? ` · ${p.development}` : ""}
                      {p.active
                        ? <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">On the plan</span>
                        : <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Not on plan</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-600">
                      <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} />
                      <span className="hidden sm:inline">{p.active ? "On plan" : "Off plan"}</span>
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-rose-600"
                      onClick={() => removeProperty(p)}
                      disabled={removing === p.id}
                    >
                      {removing === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
