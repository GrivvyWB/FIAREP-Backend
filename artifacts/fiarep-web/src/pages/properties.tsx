import { useCallback, useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Building2, Loader2, Plus, Search, Trash2, X } from "lucide-react";


// ── Types ──
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

// ── Helpers ──
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("fiarep_access_token") || ""}`,
  "Content-Type": "application/json",
});

/**
 * Properties — manage the buildings your organization is responsible for.
 * Adding a property here puts it in your managed list. It does NOT put it
 * "on the plan" — toggle that separately when you're ready.
 */
export default function Properties() {
  const { staff } = useAuth();
  const { toast } = useToast();
  const canEdit = staff?.role === "administrator" || staff?.role === "management";

  // ── Property list ──
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const rows = await customFetch<Property[]>("/api/v1/properties", { responseType: "json" } as never);
      setProperties(rows);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not load properties", description: err?.data?.error || err?.message || "Try again." });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void reload(); }, [reload]);

  // ── Address autocomplete ──
  const [addressInput, setAddressInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Development name (optional)
  const [devName, setDevName] = useState("");

  function onAddressChange(value: string) {
    setAddressInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) { setSuggestions([]); setSuggestOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const rows = await customFetch<Suggestion[]>(
          `/api/v1/properties/address-suggest?q=${encodeURIComponent(value.trim())}`,
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

  function pickSuggestion(s: Suggestion) {
    setAddressInput(s.label);
    setSuggestions([]);
    setSuggestOpen(false);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSuggestOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Add property ──
  const [adding, setAdding] = useState(false);
  async function addProperty() {
    const displayAddress = addressInput.trim();
    if (!displayAddress || displayAddress.length < 4) {
      toast({ variant: "destructive", title: "Enter a building address" }); return;
    }
    setAdding(true);
    try {
      await customFetch<Property>("/api/v1/properties", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ displayAddress, development: devName.trim() || null }),
        responseType: "json",
      } as never);
      setAddressInput("");
      setDevName("");
      toast({ title: "Property added to your list" });
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not add property", description: err?.data?.error || err?.message || "Try again." });
    } finally {
      setAdding(false);
    }
  }

  // ── Toggle on/off plan ──
  async function toggleActive(prop: Property) {
    try {
      await customFetch<Property>(`/api/v1/properties/${encodeURIComponent(prop.id)}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ active: !prop.active }),
        responseType: "json",
      } as never);
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not update property", description: err?.data?.error || err?.message || "Try again." });
    }
  }

  // ── Remove property ──
  const [removing, setRemoving] = useState<string | null>(null);
  async function removeProperty(prop: Property) {
    setRemoving(prop.id);
    try {
      await customFetch(`/api/v1/properties/${encodeURIComponent(prop.id)}`, {
        method: "DELETE",
        headers: authHeaders(),
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

  // ── Filter / search ──
  const [filter, setFilter] = useState("");
  const filtered = properties.filter((p) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return p.displayAddress.toLowerCase().includes(q) || (p.development || "").toLowerCase().includes(q);
  });

  // Group by development
  const grouped = new Map<string, Property[]>();
  for (const p of filtered) {
    const key = p.development || "(No development)";
    const arr = grouped.get(key) || [];
    arr.push(p);
    grouped.set(key, arr);
  }

  const totalUnits = properties.reduce((n, p) => n + (p.active && p.units ? p.units : 0), 0);
  const onPlanCount = properties.filter((p) => p.active).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-6 w-6" /> Properties
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the buildings your organization is responsible for. Adding a property here does not put it on the plan — toggle it on when ready.
        </p>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="rounded-md bg-muted px-3 py-1.5 font-medium">{properties.length} {properties.length === 1 ? "property" : "properties"}</span>
        <span className="rounded-md bg-muted px-3 py-1.5">{onPlanCount} on the plan</span>
        {totalUnits > 0 && <span className="rounded-md bg-muted px-3 py-1.5">{totalUnits.toLocaleString()} units on plan</span>}
      </div>

      {/* Add property (admin/management only) */}
      {canEdit && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Add a property</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Address with autocomplete */}
            <div className="relative flex-1" ref={wrapRef}>
              <Input
                placeholder="Start typing an address..."
                value={addressInput}
                onChange={(e) => onAddressChange(e.target.value)}
                onFocus={() => { if (suggestions.length > 0) setSuggestOpen(true); }}
              />
              {suggestLoading && (
                <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {suggestOpen && suggestions.length > 0 && (
                <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-auto text-sm">
                  {suggestions.map((s, i) => (
                    <li
                      key={i}
                      className="cursor-pointer px-3 py-2 hover:bg-accent"
                      onMouseDown={() => pickSuggestion(s)}
                    >
                      <span className="font-medium">{s.address}</span>
                      {s.borough && <span className="ml-2 text-muted-foreground">{s.borough}</span>}
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
            <Button onClick={addProperty} disabled={adding || !addressInput.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span className="ml-1.5">Add</span>
            </Button>
          </div>
        </div>
      )}

      {/* Filter */}
      {properties.length > 4 && (
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Filter properties..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => setFilter("")}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Property list */}
      {filtered.length === 0 && (
        <p className="text-center text-muted-foreground py-8">
          {properties.length === 0 ? "No properties yet. Add one above." : "No properties match your filter."}
        </p>
      )}

      {Array.from(grouped.entries()).map(([dev, props]) => (
        <div key={dev} className="space-y-2">
          {grouped.size > 1 && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4">{dev}</h3>
          )}
          {props.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.displayAddress}</p>
                <p className="text-xs text-muted-foreground">
                  {p.units ? `${p.units} units` : "Units unknown"}
                  {p.development && grouped.size <= 1 ? ` · ${p.development}` : ""}
                  {p.active
                    ? <span className="ml-2 inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-green-700 dark:text-green-400 text-[11px] font-medium">On the plan</span>
                    : <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-[11px] font-medium">Not on plan</span>
                  }
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                    <Switch
                      checked={p.active}
                      onCheckedChange={() => toggleActive(p)}
                    />
                    <span className="hidden sm:inline">{p.active ? "On plan" : "Off plan"}</span>
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeProperty(p)}
                    disabled={removing === p.id}
                  >
                    {removing === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
