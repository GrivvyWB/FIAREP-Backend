import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { CityRecordsCard, type CityRecords } from "@/components/city-records-card";
import { getLookupNycPropertyQueryKey, useLookupNycProperty, type NycPropertyLookup } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, FileSignature, Loader2, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { violationKind, KIND_LABEL, type ViolationKind } from "@/lib/compliance-forms";

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "");
const isOpen = (status: string) => /open|active/i.test(status);

/** HPD / DOB lookup for any staff member: type a building address, see the
 * city's record — HPD violations, HPD complaints, DOB violations. Read-only. */
export default function PropertyLookup() {
  const { organizationModules } = useAuth();
  const formsOn = organizationModules["company-forms"] === true;
  const [address, setAddress] = useState("");
  const [unit, setUnit] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"hpd" | "complaints" | "dob">("hpd");
  // Which affidavit you are after: Lead, Vermin, Mold — or Dismissal for every other violation.
  const [kind, setKind] = useState<ViolationKind | "all">("all");
  const { data, isLoading, isError, error } = useLookupNycProperty(
    { address: query, limit: 100 },
    { query: { enabled: !!query, retry: false, queryKey: getLookupNycPropertyQueryKey({ address: query, limit: 100 }) } },
  );
  const d = data as NycPropertyLookup | undefined;
  // Outside New York City: the city's own record, when that place is on in Platform Control → City Records.
  const [city, setCity] = useState<CityRecords | null>(null);
  const [cityNote, setCityNote] = useState("");
  useEffect(() => {
    setCity(null); setCityNote("");
    if (!query || !isError) return;
    void customFetch<CityRecords>(`/api/v1/property/city-records?address=${encodeURIComponent(query)}`, { responseType: "json" } as never)
      .then(setCity).catch((e: any) => setCityNote(e?.data?.error || ""));
  }, [query, isError]);
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

      {isError && !city && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{cityNote || (error as any)?.message || "That address could not be matched to an NYC property."}</p>}
      {city && <CityRecordsCard data={city} />}
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
            {tab === "hpd" && d.hpdViolations.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 text-sm">
                <span className="text-xs font-semibold text-muted-foreground">Show:</span>
                {(["all", "lead", "vermin", "mold", "other"] as const).map((k) => {
                  const n = k === "all" ? d.hpdViolations.length : d.hpdViolations.filter((v) => violationKind(v.description) === k).length;
                  return <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs font-medium ${kind === k ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>{k === "all" ? "All" : KIND_LABEL[k]} <span className="text-muted-foreground">{n}</span></button>;
                })}
                {/* Fill every open violation of one kind onto a single affidavit.
                    Grouped by kind on purpose: company-forms picks the form from
                    the first violation, so vermin and mold cannot share one
                    document (AF-6 vs AF-7 / AF-8). Lead certifies on paper and
                    "other" goes with the dismissal request, so neither is here. */}
                {formsOn && (() => {
                  const shown = d.hpdViolations.filter((v) => kind === "all" || violationKind(v.description) === kind);
                  const groups = (["vermin", "mold"] as const)
                    .map((k) => ({ k, ids: shown.filter((v) => v.id !== "unknown" && isOpen(v.status) && violationKind(v.description) === k).map((v) => v.id) }))
                    .filter((g) => g.ids.length > 1);
                  if (groups.length === 0) return null;
                  return (
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      {groups.map((g) => (
                        <a
                          key={g.k}
                          href={`/company-forms?hpd=${g.ids.map((x) => encodeURIComponent(x)).join(",")}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
                        >
                          <FileSignature className="h-3.5 w-3.5" />
                          Fill all {g.ids.length} {KIND_LABEL[g.k].toLowerCase()}
                        </a>
                      ))}
                    </span>
                  );
                })()}
              </div>
            )}
            {tab === "hpd" && (d.hpdViolations.length === 0 ? <p className="text-sm text-muted-foreground">No HPD violations found for this property.</p> : sortUnitFirst(d.hpdViolations).filter((v) => kind === "all" || violationKind(v.description) === kind).map((v) => (
              <div key={v.id} className={`rounded-lg border bg-card p-3 text-sm ${unitMatch(v.apartment) ? "border-amber-400" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isOpen(v.status) ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{v.status}</span>
                  {v.class && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">Class {v.class}</span>}
                  {v.apartment && <span className="text-xs text-muted-foreground">Apt {v.apartment}</span>}
                  {v.story && <span className="text-xs text-muted-foreground">Story {v.story}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{fmt(v.inspectionDate)}</span>
                </div>
                <p className="mt-1">{v.description}</p>
                {formsOn && v.id !== "unknown" && isOpen(v.status) && (() => {
                  const k = violationKind(v.description);
                  // Every kind opens a form filled from the violation. Vermin and
                  // mold swear an affidavit to HPD; lead opens the remediation
                  // tracking form (the Disclosure comes with it); anything else
                  // opens the correction timeline that backs the dismissal
                  // request. The note stays, because the form is not the filing.
                  const label = k === "lead" ? "Fill lead tracking" : k === "other" ? "Fill timeline" : "Fill affidavit";
                  const note = k === "lead"
                    ? "HPD certification itself is on paper (Orders 616 / 617 / 624)."
                    : k === "other" ? "Goes with the dismissal request (DR-1) once corrected." : "";
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{KIND_LABEL[k]}</span>
                      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"><FileSignature className="h-3.5 w-3.5" />Violation corrected?</span>
                      <a href={`/company-forms?hpd=${encodeURIComponent(v.id)}`} className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-800 hover:bg-slate-100">{label}</a>
                      {note && <span className="text-xs text-muted-foreground">{note}</span>}
                    </div>
                  );
                })()}
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
