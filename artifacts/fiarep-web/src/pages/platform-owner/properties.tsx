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
 *
 * Portfolio: NYCHA and L+M get their whole catalog of development names from a
 * built-in list (Organizations -> the NYCHA / L+M buttons). A private landlord
 * has no built-in list, so theirs comes from HPD's registration file: pulling
 * from one building already registered finds every other building registered
 * to the same corporations and people. All the names come into the system; the
 * owner keeps as many as the client pays for and the rest stay blocked.
 *
 * Registering goes through /v1/platform/organizations/:id/properties, the same
 * route the Organizations dialog uses, so the property limit, the licensed-unit
 * check and the configuredDevelopments bookkeeping all stay in one place.
 */

type Property = {
  id: string;
  displayAddress: string;
  development: string | null;
  units: number | null;
  bbl: string | null;
  active: boolean;
};
type Suggestion = { address: string; borough: string; label: string };
type PortfolioRow = {
  registrationId: string; buildingId: string; address: string; borough: string; zip: string;
  bbl: string; bin: string; units?: number; hpdA: number; hpdB: number; hpdC: number;
  via: string[]; aep: { status: string } | null;
};
type Portfolio = { names: string[]; rows: PortfolioRow[]; totalUnits?: number; lots?: number };

const json = { "Content-Type": "application/json" };
const errText = (e: any, fallback: string) => e?.data?.error || e?.message || fallback;

function Metric({ label, value, tone }: { label: string; value: string; tone?: "blocked" }) {
  return (
    <div className="flex-1 border-r border-slate-200 px-5 py-4 last:border-r-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone === "blocked" ? "text-rose-700" : "text-slate-950"}`}>{value}</p>
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

  const organization = organizations.find((o) => o.id === organizationId) ?? null;
  const licensedUnits = (organization as unknown as { licensedUnits?: number | null } | null)?.licensedUnits ?? null;
  const unrestricted = organization?.unrestricted === true;

  const base = organizationId
    ? `/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/properties`
    : "";

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const rows = await customFetch<Property[]>(
        `/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/properties`,
        { responseType: "json" } as never,
      );
      setProperties([...rows].sort((a, b) => a.displayAddress.localeCompare(b.displayAddress)));
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not load properties", description: errText(err, "Try again.") });
    } finally {
      setLoading(false);
    }
  }, [organizationId, toast]);

  useEffect(() => { void reload(); }, [reload]);

  // ── Portfolio: every building registered to the same names ──
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioNote, setPortfolioNote] = useState("");
  const [seedBbl, setSeedBbl] = useState("");

  const seeds = useMemo(() => properties.filter((p) => p.bbl), [properties]);
  useEffect(() => { setPortfolio(null); setPortfolioNote(""); }, [organizationId]);
  useEffect(() => { if (!seedBbl && seeds[0]?.bbl) setSeedBbl(seeds[0].bbl); }, [seeds, seedBbl]);

  async function pullPortfolio() {
    if (!seedBbl) return;
    setPortfolioLoading(true);
    setPortfolio(null);
    setPortfolioNote("");
    try {
      const info = await customFetch<{ registrationId: string | null }>(
        `/api/v1/platform/aep/contacts-by-bbl/${encodeURIComponent(seedBbl)}`,
        { responseType: "json" } as never,
      );
      if (!info.registrationId) {
        setPortfolioNote("That building has no HPD registration on file, so there are no names to search.");
        return;
      }
      const result = await customFetch<Portfolio>(
        `/api/v1/platform/aep/portfolio/${encodeURIComponent(info.registrationId)}`,
        { responseType: "json" } as never,
      );
      setPortfolio(result);
      if (result.rows.length === 0) setPortfolioNote("No other registrations name these people or corporations.");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not pull the portfolio", description: errText(err, "NYC Open Data may be unavailable.") });
    } finally {
      setPortfolioLoading(false);
    }
  }

  const addedBbls = useMemo(() => new Set(properties.map((p) => p.bbl).filter(Boolean) as string[]), [properties]);
  const portfolioOpen = useMemo(
    () => (portfolio?.rows ?? []).filter((r) => !addedBbls.has(r.bbl)),
    [portfolio, addedBbls],
  );

  /** Register a building. Added OFF the plan — switching it on is the moment
   *  it counts against the client's licensed units. */
  async function register(body: Record<string, unknown>) {
    return customFetch<Property>(base, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ active: false, ...body }),
      responseType: "json",
    } as never);
  }

  const [addingBbl, setAddingBbl] = useState("");
  async function addFromPortfolio(row: PortfolioRow) {
    setAddingBbl(row.bbl);
    try {
      await register({
        displayAddress: `${row.address}, ${row.borough} ${row.zip}`.trim(),
        development: row.address,
        ...(row.units && row.units > 0 ? { units: row.units } : {}),
      });
      toast({ title: `Added ${row.address}`, description: "Off the plan — switch it on when the client is paying for it." });
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not add building", description: errText(err, "Try again.") });
    } finally {
      setAddingBbl("");
    }
  }

  // ── Address autocomplete (add one by hand) ──
  const [addressInput, setAddressInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [devName, setDevName] = useState("");
  const [unitsInput, setUnitsInput] = useState("");
  const [needsUnits, setNeedsUnits] = useState(false);
  const [addError, setAddError] = useState("");

  function onAddressChange(value: string) {
    setAddressInput(value);
    setNeedsUnits(false);
    setAddError("");
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

  const [adding, setAdding] = useState(false);
  async function addProperty() {
    const displayAddress = addressInput.trim();
    if (!displayAddress || displayAddress.length < 4) {
      toast({ variant: "destructive", title: "Enter a building address" }); return;
    }
    setAdding(true);
    setAddError("");
    try {
      const typed = Number(unitsInput);
      await register({
        displayAddress,
        development: devName.trim() || null,
        ...(Number.isFinite(typed) && typed > 0 ? { units: typed } : {}),
      });
      setAddressInput(""); setDevName(""); setUnitsInput(""); setNeedsUnits(false);
      toast({ title: `Added to ${organization?.name ?? "the organization"}` });
      await reload();
    } catch (err: any) {
      // The City has no unit count for this address: the route asks for one.
      if (err?.data?.needsUnits) { setNeedsUnits(true); setAddError(errText(err, "Type the number of dwelling units.")); }
      else setAddError(errText(err, "Could not add the building."));
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(prop: Property) {
    try {
      await customFetch<Property>(`${base}/${encodeURIComponent(prop.id)}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ active: !prop.active }),
        responseType: "json",
      } as never);
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: prop.active ? "Could not take it off the plan" : "Could not put it on the plan", description: errText(err, "Try again.") });
    }
  }

  const [removing, setRemoving] = useState<string | null>(null);
  async function removeProperty(prop: Property) {
    setRemoving(prop.id);
    try {
      await customFetch(`${base}/${encodeURIComponent(prop.id)}`, {
        method: "DELETE",
        headers: json,
        responseType: "json",
      } as never);
      toast({ title: `Removed ${prop.displayAddress}` });
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not remove property", description: errText(err, "Try again.") });
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
  const licensed = unrestricted ? "Unlimited" : licensedUnits ? licensedUnits.toLocaleString() : "—";

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
        <Select value={organizationId} onValueChange={(v) => { setOrganizationId(v); setFilter(""); setSeedBbl(""); }}>
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
        <Metric label="Registered" value={String(properties.length)} />
        <Metric label="On the plan" value={String(onPlanCount)} />
        <Metric label="Units on plan" value={unitsOnPlan.toLocaleString()} />
        <Metric label="Licensed units" value={licensed} />
        {portfolio && <Metric label="In portfolio" value={String(portfolio.rows.length + properties.length)} />}
        {portfolio && <Metric label="Blocked" value={String(portfolioOpen.length)} tone="blocked" />}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {/* ── Portfolio pull ── */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">This client's portfolio</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                NYCHA and L+M get their whole list of names from a built-in catalog on the Organizations tab.
                A private landlord has no built-in list, so theirs comes from HPD's registration file: pull from
                one building already registered and every other building under the same corporations and people
                comes over. Keep as many as the client pays for — the rest stay blocked.
              </p>
            </div>
            {seeds.length === 0 ? (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Register one of this client's buildings below first. Its HPD registration is what finds the rest.
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={seedBbl}
                  onChange={(e) => setSeedBbl(e.target.value)}
                  className="h-10 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                  aria-label="Pull from"
                >
                  {seeds.map((p) => (
                    <option key={p.id} value={p.bbl!}>Pull from {p.displayAddress}</option>
                  ))}
                </select>
                <Button
                  onClick={pullPortfolio}
                  disabled={portfolioLoading || !seedBbl}
                  className="h-10 bg-slate-900 px-5 text-white hover:bg-slate-800"
                >
                  {portfolioLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="ml-1.5">{portfolioLoading ? "Searching HPD" : "Pull portfolio"}</span>
                </Button>
              </div>
            )}

            {portfolioNote && <p className="text-xs text-slate-500">{portfolioNote}</p>}

            {portfolio && portfolio.rows.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-500">
                  {portfolio.rows.length} other building{portfolio.rows.length === 1 ? "" : "s"}
                  {portfolio.totalUnits ? <> · <b className="text-slate-900">{portfolio.totalUnits.toLocaleString()} residential units</b> (PLUTO, counted once per lot{portfolio.lots && portfolio.lots !== portfolio.rows.length ? `, ${portfolio.lots} lots` : ""})</> : null}
                  {" "}registered to {portfolio.names.join(", ")}.
                </p>
                <select
                  value=""
                  disabled={!!addingBbl}
                  onChange={(e) => { const r = portfolioOpen[Number(e.target.value)]; if (r) void addFromPortfolio(r); }}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:opacity-60"
                  aria-label="Add a building from the portfolio"
                >
                  <option value="">
                    {addingBbl ? "Adding…" : `Choose a building to add… (${portfolioOpen.length} not yet added)`}
                  </option>
                  {portfolioOpen.map((r, i) => (
                    <option key={r.bbl + r.registrationId} value={i}>
                      {r.address}, {r.borough} {r.zip}
                      {r.units ? ` · ${r.units} units` : ""}
                      {` · ${r.hpdA + r.hpdB + r.hpdC} open HPD (${r.hpdB} B · ${r.hpdC} C)`}
                      {r.aep?.status === "AEP Active" ? " · IN AEP" : ""}
                      {r.via[0] ? ` · ${r.via[0]}` : ""}
                    </option>
                  ))}
                </select>
                {portfolioOpen.length === 0 && (
                  <p className="text-xs text-emerald-700">Every building in this portfolio is registered to this client.</p>
                )}
              </div>
            )}
          </section>

          {/* ── Add one by hand ── */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Add a building by address</h2>
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
              {needsUnits && (
                <Input
                  className="sm:w-28"
                  type="number"
                  placeholder="Units"
                  value={unitsInput}
                  onChange={(e) => setUnitsInput(e.target.value)}
                  aria-label="Dwelling units"
                />
              )}
              <Button
                onClick={addProperty}
                disabled={adding || !addressInput.trim() || !organizationId}
                className="h-10 bg-[#185FA5] px-5 text-white hover:bg-[#124d87]"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-1.5">Add</span>
              </Button>
            </div>
            {addError
              ? <p className="text-xs text-rose-700">{addError}</p>
              : <p className="text-xs text-slate-500">
                  Units come from the City record. A building is added off the plan — switch it on when the client is paying for it.
                </p>}
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
                ? `No buildings registered for ${organization?.name ?? "this organization"} yet.`
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
                      {p.units ? `${p.units} units` : "same lot as another building"}
                      {p.bbl ? ` · BBL ${p.bbl}` : ""}
                      {p.active
                        ? <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">On the plan</span>
                        : <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Blocked</span>}
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
