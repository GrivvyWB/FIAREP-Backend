import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  NYCHA_DEVELOPMENT_NAMES,
  customFetch,
  getListEntityRecordsQueryKey,
  useCreateEntityRecord,
  useListEntityRecords,
  useUpdateEntityRecord,
  type EntityRecord,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { isCommunityCoordinatorSupervisor } from "@/lib/access-policy";
import { AlertTriangle, Building2, Edit2, Phone, Plus, Search, Trash2, UserRound, Users } from "lucide-react";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

/** The programs a Community Coordinator works under (HPD-style divisions). */
const PROGRAMS = [
  "General outreach",
  "Tenant & Owner Resources (rent subsidies, Section 8)",
  "Enforcement & Neighborhood Services (violations, owner accountability)",
  "Emergency Housing & Relocation (vacate orders, fire, displacement)",
];
const CRITICAL_TAGS = [
  "No heat / hot water", "Mold", "Lead paint", "Pests", "Vacate order", "Fire damage",
  "Elderly / disabled resident", "Children in unit", "Owner unresponsive", "Other",
];
const BOROUGHS = ["Manhattan", "Brooklyn", "Bronx", "Queens", "Staten Island"];

type Rec = EntityRecord & { state: Record<string, any> };
const s = (v: unknown) => String(v ?? "").trim();
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (v: string) => (v ? new Date(v).toLocaleDateString() : "");

async function removeRecord(entity: string, id: string, version: number) {
  await customFetch<void>(`/api/v1/${entity}/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }),
  } as never);
}

export default function CommunityCoordinators() {
  const { staff } = useAuth();
  const supervisor = isCommunityCoordinatorSupervisor(staff);
  const [tab, setTab] = useState<"residents" | "buildings">("residents");
  const [search, setSearch] = useState("");
  const [who, setWho] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const q = { query: { staleTime: 15_000, refetchOnMount: "always" as const, refetchInterval: 30_000 } };
  const residentsQuery = useListEntityRecords("community-residents", undefined, { ...q, query: { ...q.query, queryKey: getListEntityRecordsQueryKey("community-residents") } });
  const buildingsQuery = useListEntityRecords("community-buildings", undefined, { ...q, query: { ...q.query, queryKey: getListEntityRecordsQueryKey("community-buildings") } });
  const residents = (residentsQuery.data ?? []) as Rec[];
  const buildings = (buildingsQuery.data ?? []) as Rec[];

  const coordinators = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of [...residents, ...buildings]) {
      const id = s(r.state.loggedById); const name = s(r.state.loggedByName);
      if (id && name) map.set(id, name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [residents, buildings]);

  const matches = (r: Rec) => {
    if (who && s(r.state.loggedById) !== who) return false;
    if (criticalOnly && r.state.critical !== true) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return Object.values(r.state).some((v) => typeof v === "string" && v.toLowerCase().includes(needle)) ||
      s(r.development).toLowerCase().includes(needle);
  };
  const residentRows = residents.filter(matches).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  const buildingRows = buildings.filter(matches).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  const residentsAt = (address: string) => residents.filter((r) => s(r.state.address).toLowerCase() === address.toLowerCase()).length;

  const [editResident, setEditResident] = useState<Rec | null | "new">(null);
  const [editBuilding, setEditBuilding] = useState<Rec | null | "new">(null);
  const [deleting, setDeleting] = useState<{ entity: string; rec: Rec; label: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("community-residents") }),
    queryClient.invalidateQueries({ queryKey: getListEntityRecordsQueryKey("community-buildings") }),
  ]);
  async function confirmDelete() {
    if (!deleting) return;
    try {
      await removeRecord(deleting.entity, deleting.rec.id, deleting.rec.version);
      toast({ title: "Deleted" });
      await refresh();
    } catch (error) {
      toast({ variant: "destructive", title: "Could not delete", description: error instanceof Error ? error.message : "Try again." });
    } finally { setDeleting(null); }
  }
  const canEdit = (r: Rec) => supervisor || s(r.state.loggedById) === staff?.id;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" />Community Coordinators</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Field outreach: residents, building owners and building details. {supervisor
              ? "You see everything your coordinators log."
              : "Only you and your Community Coordinator Supervisor can see what you log here."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditResident("new")}><Plus className="mr-1 h-4 w-4" />Log resident</Button>
          <Button variant="outline" onClick={() => setEditBuilding("new")}><Building2 className="mr-1 h-4 w-4" />Add building / owner</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Residents on file" value={residents.length} />
        <Stat label="Buildings on file" value={buildings.length} />
        <Stat label="Critical" value={residents.filter((r) => r.state.critical === true).length} tone="warn" />
        <Stat label="Apartment units covered" value={buildings.reduce((sum, b) => sum + (Number(b.state.units) || 0), 0)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          {(["residents", "buildings"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              {t === "residents" ? `Residents (${residentRows.length})` : `Buildings & owners (${buildingRows.length})`}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, address, phone, notes…" />
        </div>
        {supervisor && coordinators.length > 0 && (
          <select className={`${selectClass} w-auto`} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">All coordinators</option>
            {coordinators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {tab === "residents" && (
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={criticalOnly} onCheckedChange={(v) => setCriticalOnly(v === true)} />Critical only</label>
        )}
      </div>

      {tab === "residents" ? (
        residentsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
        residentRows.length === 0 ? <Empty text="No residents logged yet. Use “Log resident” after a visit." /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {residentRows.map((r) => {
              const st = r.state;
              return (
                <div key={r.id} className={`rounded-lg border bg-card p-4 ${st.critical ? "border-amber-400" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold flex items-center gap-2"><UserRound className="h-4 w-4" />{s(st.name) || "Unnamed resident"}
                        {st.critical && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Critical</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{[s(st.address), st.apartment ? `Apt ${s(st.apartment)}` : "", s(r.development), s(st.borough)].filter(Boolean).join(" · ")}</p>
                    </div>
                    {canEdit(r) && (
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setEditResident(r)}><Edit2 className="h-4 w-4" /></Button>
                        {supervisor && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting({ entity: "community-residents", rec: r, label: `${s(st.name)} · ${s(st.address)}` })}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 grid gap-1 text-sm">
                    {s(st.phone) && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /><a className="underline" href={`tel:${s(st.phone)}`}>{s(st.phone)}</a>{s(st.email) && <span className="text-muted-foreground">· {s(st.email)}</span>}</p>}
                    {s(st.program) && <p className="text-muted-foreground">{s(st.program)}</p>}
                    {Array.isArray(st.criticalTags) && st.criticalTags.length > 0 && <p className="flex flex-wrap gap-1">{st.criticalTags.map((t: string) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>)}</p>}
                    {s(st.notes) && <p className="whitespace-pre-wrap">{s(st.notes)}</p>}
                    <p className="text-xs text-muted-foreground">Visited {fmt(s(st.visitedOn))}{supervisor && s(st.loggedByName) ? ` · Logged by ${s(st.loggedByName)}` : ""}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        buildingsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
        buildingRows.length === 0 ? <Empty text="No buildings on file yet. Add a building with its owner and how many apartments it has." /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {buildingRows.map((b) => {
              const st = b.state;
              return (
                <div key={b.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" />{s(st.address) || "Address missing"}</p>
                      <p className="text-sm text-muted-foreground">{[s(b.development), s(st.borough), st.units ? `${st.units} apartment units` : "", st.floors ? `${st.floors} floors` : ""].filter(Boolean).join(" · ")}</p>
                    </div>
                    {canEdit(b) && (
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setEditBuilding(b)}><Edit2 className="h-4 w-4" /></Button>
                        {supervisor && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting({ entity: "community-buildings", rec: b, label: s(st.address) })}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 grid gap-1 text-sm">
                    <p><span className="text-muted-foreground">Owner:</span> {s(st.ownerName) || "—"}{s(st.ownerPhone) && <> · <a className="underline" href={`tel:${s(st.ownerPhone)}`}>{s(st.ownerPhone)}</a></>}{s(st.ownerEmail) && <span className="text-muted-foreground"> · {s(st.ownerEmail)}</span>}</p>
                    {s(st.ownerAddress) && <p><span className="text-muted-foreground">Owner address:</span> {s(st.ownerAddress)}</p>}
                    {s(st.managementCompany) && <p><span className="text-muted-foreground">Managed by:</span> {s(st.managementCompany)}{s(st.managementPhone) ? ` · ${s(st.managementPhone)}` : ""}</p>}
                    <p className="text-muted-foreground">{residentsAt(s(st.address))} resident{residentsAt(s(st.address)) === 1 ? "" : "s"} on file here</p>
                    {s(st.notes) && <p className="whitespace-pre-wrap">{s(st.notes)}</p>}
                    <p className="text-xs text-muted-foreground">Visited {fmt(s(st.visitedOn))}{supervisor && s(st.loggedByName) ? ` · Logged by ${s(st.loggedByName)}` : ""}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {editResident && <ResidentDialog record={editResident === "new" ? null : editResident} buildings={buildings} onClose={async (saved) => { setEditResident(null); if (saved) await refresh(); }} />}
      {editBuilding && <BuildingDialog record={editBuilding === "new" ? null : editBuilding} onClose={async (saved) => { setEditBuilding(null); if (saved) await refresh(); }} />}

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>{deleting?.label} will be removed for your whole unit.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border bg-card p-3 ${tone === "warn" && value > 0 ? "border-amber-400" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function useDevelopments() {
  const { staff } = useAuth();
  return useMemo(() => {
    const own = (staff?.developments || []).filter(Boolean);
    return own.length ? own : [...NYCHA_DEVELOPMENT_NAMES];
  }, [staff?.developments]);
}

function ResidentDialog({ record, buildings, onClose }: { record: Rec | null; buildings: Rec[]; onClose: (saved: boolean) => void }) {
  const { toast } = useToast();
  const create = useCreateEntityRecord();
  const update = useUpdateEntityRecord();
  const developments = useDevelopments();
  const st = record?.state || {};
  const [form, setForm] = useState({
    name: s(st.name), phone: s(st.phone), email: s(st.email), development: s(record?.development || st.development),
    borough: s(st.borough), address: s(st.address), apartment: s(st.apartment), program: s(st.program) || PROGRAMS[0]!,
    critical: st.critical === true, criticalTags: (Array.isArray(st.criticalTags) ? st.criticalTags : []) as string[],
    notes: s(st.notes), visitedOn: s(st.visitedOn) || today(),
  });
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const knownAddresses = [...new Set(buildings.map((b) => s(b.state.address)).filter(Boolean))].sort();
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim() || !form.address.trim()) {
      toast({ variant: "destructive", title: "Name and building address are required" });
      return;
    }
    setBusy(true);
    const state = { ...form, name: form.name.trim(), address: form.address.trim(), criticalTags: form.critical ? form.criticalTags : [] };
    try {
      if (record) {
        await update.mutateAsync({ entity: "community-residents", id: record.id, data: { id: record.id, version: record.version, development: form.development || undefined, state } as never });
        toast({ title: "Resident updated" });
      } else {
        await create.mutateAsync({ entity: "community-residents", data: { id: crypto.randomUUID(), version: 1, development: form.development || undefined, state } as never });
        toast({ title: "Resident logged" });
      }
      onClose(true);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not save", description: error instanceof Error ? error.message : "Try again." });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(false); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{record ? "Edit resident" : "Log a resident"}</DialogTitle>
          <DialogDescription>What the tenant told you at the door. Mark it critical if it needs attention now.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Resident name *"><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Phone"><Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(718) 555-0100" /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Visit date"><Input type="date" value={form.visitedOn} onChange={(e) => set("visitedOn", e.target.value)} /></Field>
          <Field label="Development (if NYCHA)">
            <select className={selectClass} value={form.development} onChange={(e) => set("development", e.target.value)}>
              <option value="">Not a NYCHA development</option>
              {developments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Borough">
            <select className={selectClass} value={form.borough} onChange={(e) => set("borough", e.target.value)}>
              <option value="">Select</option>
              {BOROUGHS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Building address *">
            <Input list="community-known-addresses" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="262 Ralph Ave" />
            <datalist id="community-known-addresses">{knownAddresses.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label="Apartment"><Input value={form.apartment} onChange={(e) => set("apartment", e.target.value)} placeholder="4C" /></Field>
          <div className="sm:col-span-2">
            <Field label="Program / reason for the visit">
              <select className={selectClass} value={form.program} onChange={(e) => set("program", e.target.value)}>
                {PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <div className="sm:col-span-2 rounded-md border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={form.critical} onCheckedChange={(v) => set("critical", v === true)} />Critical information — needs attention</label>
            {form.critical && (
              <div className="grid grid-cols-2 gap-1 text-sm">
                {CRITICAL_TAGS.map((t) => (
                  <label key={t} className="flex items-center gap-2"><Checkbox checked={form.criticalTags.includes(t)} onCheckedChange={(v) => set("criticalTags", v === true ? [...form.criticalTags, t] : form.criticalTags.filter((x) => x !== t))} />{t}</label>
                ))}
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes"><Textarea rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="What the resident reported, who was present, what was promised…" /></Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : record ? "Save changes" : "Log resident"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BuildingDialog({ record, onClose }: { record: Rec | null; onClose: (saved: boolean) => void }) {
  const { toast } = useToast();
  const create = useCreateEntityRecord();
  const update = useUpdateEntityRecord();
  const developments = useDevelopments();
  const st = record?.state || {};
  const [form, setForm] = useState({
    address: s(st.address), development: s(record?.development || st.development), borough: s(st.borough),
    units: s(st.units), floors: s(st.floors), ownerName: s(st.ownerName), ownerPhone: s(st.ownerPhone), ownerEmail: s(st.ownerEmail),
    ownerAddress: s(st.ownerAddress), managementCompany: s(st.managementCompany), managementPhone: s(st.managementPhone),
    notes: s(st.notes), visitedOn: s(st.visitedOn) || today(),
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.address.trim()) { toast({ variant: "destructive", title: "Building address is required" }); return; }
    if (form.units && !(Number(form.units) >= 0)) { toast({ variant: "destructive", title: "Apartment units must be a number" }); return; }
    setBusy(true);
    const state = { ...form, address: form.address.trim(), units: form.units ? Number(form.units) : "", floors: form.floors ? Number(form.floors) : "" };
    try {
      if (record) {
        await update.mutateAsync({ entity: "community-buildings", id: record.id, data: { id: record.id, version: record.version, development: form.development || undefined, state } as never });
        toast({ title: "Building updated" });
      } else {
        await create.mutateAsync({ entity: "community-buildings", data: { id: crypto.randomUUID(), version: 1, development: form.development || undefined, state } as never });
        toast({ title: "Building added" });
      }
      onClose(true);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not save", description: error instanceof Error ? error.message : "Try again." });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(false); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{record ? "Edit building" : "Add a building and its owner"}</DialogTitle>
          <DialogDescription>The building, how many apartments are in it, and who owns or manages it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Building address *"><Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="262 Ralph Ave, Brooklyn" /></Field></div>
          <Field label="Development (if NYCHA)">
            <select className={selectClass} value={form.development} onChange={(e) => set("development", e.target.value)}>
              <option value="">Not a NYCHA development</option>
              {developments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Borough">
            <select className={selectClass} value={form.borough} onChange={(e) => set("borough", e.target.value)}>
              <option value="">Select</option>
              {BOROUGHS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Apartment units in building"><Input type="number" min={0} value={form.units} onChange={(e) => set("units", e.target.value)} /></Field>
          <Field label="Floors"><Input type="number" min={0} value={form.floors} onChange={(e) => set("floors", e.target.value)} /></Field>
          <Field label="Owner name"><Input value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field>
          <Field label="Owner phone"><Input type="tel" value={form.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} /></Field>
          <Field label="Owner email"><Input type="email" value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} /></Field>
          <Field label="Owner mailing address"><Input value={form.ownerAddress} onChange={(e) => set("ownerAddress", e.target.value)} /></Field>
          <Field label="Management company"><Input value={form.managementCompany} onChange={(e) => set("managementCompany", e.target.value)} /></Field>
          <Field label="Management phone"><Input type="tel" value={form.managementPhone} onChange={(e) => set("managementPhone", e.target.value)} /></Field>
          <Field label="Visit date"><Input type="date" value={form.visitedOn} onChange={(e) => set("visitedOn", e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Condition of the building, access, super's name…" /></Field></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : record ? "Save changes" : "Add building"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="mb-1 text-sm font-medium">{label}</p>{children}</div>;
}
