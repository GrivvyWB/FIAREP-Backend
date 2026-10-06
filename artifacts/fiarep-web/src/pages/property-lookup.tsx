import { useState } from "react";
import { getLookupNycPropertyQueryKey, useLookupNycProperty, type NycPropertyLookup } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Loader2, Search } from "lucide-react";

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "");
const isOpen = (status: string) => /open|active/i.test(status);

/** HPD / DOB lookup for any staff member: type a building address, see the
 * city's record — HPD violations, HPD complaints, DOB violations. Read-only. */
export default function PropertyLookup() {
  const [address, setAddress] = useState("");
  const [unit, setUnit] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"hpd" | "complaints" | "dob">("hpd");
  const { data, isLoading, isError, error } = useLookupNycProperty(
    { address: query, limit: 100 },
    { query: { enabled: !!query, retry: false, queryKey: getLookupNycPropertyQueryKey({ address: query, limit: 100 }) } },
  );
  const d = data as NycPropertyLookup | undefined;
  const unitMatch = (apt?: string | null) => !!unit.trim() && String(apt || "").replace(/\s/g, "").toUpperCase() === unit.replace(/\s/g, "").toUpperCase();
  const sortUnitFirst = <T extends { apartment?: string | null }>(rows: T[]) => [...rows].sort((a, b) => Number(unitMatch(b.apartment)) - Number(unitMatch(a.apartment)));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6" />HPD / DOB lookup</h1>
        <p className="text-sm text-muted-foreground">The City's record for a building: HPD violations and complaints, DOB violations. Look only — nothing is logged here.</p>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(address.trim()); }}>
        <Input className="flex-1 min-w-[240px]" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Building address, e.g. 262 Ralph Ave, Brooklyn" />
        <Input className="w-28" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Apt (optional)" />
        <Button type="submit" disabled={!address.trim() || isLoading}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}Look up</Button>
      </form>

      {isError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{(error as any)?.message || "That address could not be matched to an NYC property."}</p>}
      {d && (
        <>
          <div className="rounded-lg border bg-card p-4">
            <p className="font-semibold">{d.property.formattedAddress}</p>
            <p className="text-sm text-muted-foreground">{[d.property.borough, d.property.zip, d.property.bin ? `BIN ${d.property.bin}` : "", d.property.bbl ? `BBL ${d.property.bbl}` : ""].filter(Boolean).join(" · ")}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <button type="button" onClick={() => setTab("hpd")} className={`rounded-md border p-2 ${tab === "hpd" ? "border-primary bg-primary/10" : ""}`}><p className="text-xs text-muted-foreground">HPD violations</p><p className="text-xl font-bold">{d.summary.openHpdViolations}<span className="text-sm font-normal text-muted-foreground"> open / {d.summary.hpdViolations}</span></p></button>
              <button type="button" onClick={() => setTab("complaints")} className={`rounded-md border p-2 ${tab === "complaints" ? "border-primary bg-primary/10" : ""}`}><p className="text-xs text-muted-foreground">HPD complaints</p><p className="text-xl font-bold">{d.summary.hpdComplaints}</p></button>
              <button type="button" onClick={() => setTab("dob")} className={`rounded-md border p-2 ${tab === "dob" ? "border-primary bg-primary/10" : ""}`}><p className="text-xs text-muted-foreground">DOB violations</p><p className="text-xl font-bold">{d.summary.openDobViolations}<span className="text-sm font-normal text-muted-foreground"> open / {d.summary.dobViolations}</span></p></button>
            </div>
            {d.warnings?.length > 0 && <p className="mt-2 text-xs text-amber-700">{d.warnings.join(" · ")}</p>}
            <p className="mt-2 text-xs text-muted-foreground">Retrieved {new Date(d.retrievedAt).toLocaleString()}</p>
          </div>

          <div className="space-y-2">
            {tab === "hpd" && (d.hpdViolations.length === 0 ? <p className="text-sm text-muted-foreground">No HPD violations found for this property.</p> : sortUnitFirst(d.hpdViolations).map((v) => (
              <div key={v.id} className={`rounded-lg border bg-card p-3 text-sm ${unitMatch(v.apartment) ? "border-amber-400" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isOpen(v.status) ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{v.status}</span>
                  {v.class && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">Class {v.class}</span>}
                  {v.apartment && <span className="text-xs text-muted-foreground">Apt {v.apartment}</span>}
                  {v.story && <span className="text-xs text-muted-foreground">Story {v.story}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{fmt(v.inspectionDate)}</span>
                </div>
                <p className="mt-1">{v.description}</p>
                {v.orderNumber && <p className="text-xs text-muted-foreground">Order #{v.orderNumber}</p>}
              </div>
            )))}
            {tab === "complaints" && (d.hpdComplaints.length === 0 ? <p className="text-sm text-muted-foreground">No HPD complaints found for this property.</p> : sortUnitFirst(d.hpdComplaints).map((c) => (
              <div key={c.id} className={`rounded-lg border bg-card p-3 text-sm ${unitMatch(c.apartment) ? "border-amber-400" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isOpen(c.status) ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{c.status}</span>
                  {c.majorCategory && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{c.majorCategory}</span>}
                  {c.apartment && <span className="text-xs text-muted-foreground">Apt {c.apartment}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{fmt(c.receivedDate)}</span>
                </div>
                <p className="mt-1">{c.description}</p>
              </div>
            )))}
            {tab === "dob" && (d.dobViolations.length === 0 ? <p className="text-sm text-muted-foreground">No DOB violations found for this property.</p> : d.dobViolations.map((v) => (
              <div key={v.id} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isOpen(v.status) ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{v.status}</span>
                  {v.type && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{v.type}</span>}
                  {v.category && <span className="text-xs text-muted-foreground">{v.category}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{fmt(v.issueDate)}</span>
                </div>
                <p className="mt-1">{v.description}</p>
                {v.number && <p className="text-xs text-muted-foreground">#{v.number}</p>}
              </div>
            )))}
          </div>
        </>
      )}
    </div>
  );
}
