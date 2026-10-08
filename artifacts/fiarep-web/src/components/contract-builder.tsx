import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FileText, Mail, Printer } from "lucide-react";
import { BRAND, KIND_LABEL, agencyDefaultFee, buildContractHtml, contractNumber, grandTotal, monthlyFee, scopeTotal, type Building, type ContractInput, type ContractKind, type ScopeLine } from "@/lib/contract";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

/** Builds the service agreement from the client's details plus whatever is
 * filled in on the price book above (scope + engineering). Print → PDF, or
 * email it to the client from the FIAREP mailbox. */
type Expediter = NonNullable<ContractInput["expediter"]>;
export function ContractBuilder({ scope, engineering, expediter, onClearScope }: { scope: ScopeLine[]; engineering: { label: string; amount: number } | null; expediter?: Expediter | null; onClearScope: () => void }) {
  const { toast } = useToast();
  const [number, setNumber] = useState(contractNumber);
  // Prefilled when opened from Job requests → Build contract (?company=…&building=…&units=…).
  const q = useMemo(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search), []);
  // From a job request the default is the work contract — just the violations and repairs, no plan.
  const [kind, setKind] = useState<ContractKind>(q.get("request") ? "work" : "fiarep");
  const [client, setClient] = useState({ company: q.get("company") || "", contact: q.get("contact") || "", title: "", address: "", email: q.get("email") || "", phone: q.get("phone") || "" });
  const [buildings, setBuildings] = useState<Building[]>([{ name: q.get("building") || "", address: q.get("building") || "", units: num(q.get("units") || "") }]);
  const [flatFee, setFlatFee] = useState(0);
  const [feeEdited, setFeeEdited] = useState(false);
  const [pilot, setPilot] = useState(true);
  const [startDate, setStartDate] = useState(today);
  const [termMonths, setTermMonths] = useState(12);
  const [fiarepSigner, setFiarepSigner] = useState("Tim Winn, Managing Member");
  const [fiarepEntity, setFiarepEntity] = useState("Grivvy Com LLC d/b/a FIAREP");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");

  const units = buildings.reduce((n, b) => n + (b.units || 0), 0);
  // Agency fee follows units × tier rate until the owner types their own number.
  const suggested = agencyDefaultFee(kind, units);
  useEffect(() => { if (!feeEdited) setFlatFee(suggested); }, [suggested, feeEdited]);
  const input: ContractInput = useMemo(() => ({
    kind, number, date: today(), fiarepSigner, fiarepEntity, client, buildings: buildings.filter((b) => b.name || b.address || b.units), units, flatFee, pilot, startDate, termMonths, scope, engineering, expediter: expediter || null, notes,
  }), [kind, number, fiarepSigner, fiarepEntity, client, buildings, units, flatFee, pilot, startDate, termMonths, scope, engineering, expediter, notes]);
  const fee = monthlyFee(input);
  const isAgency = kind.startsWith("agency");
  const ready = client.company.trim() && client.contact.trim() && units > 0 && (!isAgency || flatFee > 0);

  function setB(i: number, patch: Partial<Building>) { setBuildings((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function openPrint() {
    const w = window.open("", "_blank");
    if (!w) { toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups for this site to open the contract." }); return; }
    w.document.write(buildContractHtml(input)); w.document.close();
    w.focus(); setTimeout(() => w.print(), 400);
  }
  function preview() {
    const w = window.open("", "_blank");
    if (!w) { toast({ variant: "destructive", title: "Pop-up blocked" }); return; }
    w.document.write(buildContractHtml(input)); w.document.close();
  }
  async function email() {
    if (!client.email.trim()) { toast({ variant: "destructive", title: "Add the client's email first" }); return; }
    setBusy("email");
    try {
      const out = await customFetch<{ ok: boolean; emailed: boolean }>("/api/v1/platform/contracts/email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: client.email.trim(), subject: `${BRAND.name} Service Agreement ${number} — ${client.company.trim()}`, html: buildContractHtml(input), number, company: client.company.trim(), kind, monthly: fee.monthly, scopeTotal: grandTotal(input), requestId: q.get("request") || "" }),
        responseType: "json",
      } as never);
      if (out.emailed) toast({ title: `Sent to ${client.email.trim()}`, description: `Agreement ${number}. A copy is in the FIAREP Outlook sent folder.` });
      else toast({ variant: "destructive", title: "Email did not send", description: "Outlook is not connected or rejected the message. Print to PDF and attach it instead." });
    } catch (err: any) { toast({ variant: "destructive", title: "Could not send", description: err?.data?.error || err?.message }); }
    finally { setBusy(""); }
  }

  const field = "rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-amber-500 focus:outline-none";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Contract</h2>
          <p className="text-xs text-slate-500">{BRAND.name} — {BRAND.long}. The scope filled in above goes into Section 4. Print to PDF or email it to the client.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-right text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-400">{kind === "work" ? "Work total" : "Monthly"}</p>
          <p className="text-xl font-bold text-slate-950">{money(kind === "work" ? grandTotal(input) : fee.monthly)}</p>
          <p className="text-xs text-slate-500">{fee.setup ? `+ ${money(fee.setup)} setup · ` : ""}{expediter ? `expediting ${money(expediter.total)} · ` : ""}repairs {money(scopeTotal(input))}{expediter ? ` · to approve ${money(grandTotal(input))}` : ""}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="text-sm text-slate-700 lg:col-span-2">Contract type
          <select value={kind} onChange={(e) => setKind(e.target.value as ContractKind)} className={`mt-1 block w-full ${field}`}>
            {(Object.keys(KIND_LABEL) as ContractKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {isAgency && (
          <label className="text-sm text-slate-700">Flat monthly fee $
            <Input type="number" inputMode="numeric" min={0} step={500} value={flatFee || ""} placeholder="0" onChange={(e) => { setFeeEdited(true); setFlatFee(num(e.target.value)); }} className="mt-1" />
            <span className="text-xs text-slate-500">Default {money(suggested)} — {kind === "agency-small" ? "$15 per unit, minimum $5,000" : "$10 per unit, minimum $25,000"}.{feeEdited && <button type="button" className="ml-1 underline" onClick={() => { setFeeEdited(false); setFlatFee(suggested); }}>Use default</button>}</span>
          </label>
        )}
        {kind === "fiarep" && (
          <label className="flex items-center gap-2 text-sm text-slate-700 lg:col-span-2"><input type="checkbox" checked={pilot} onChange={(e) => setPilot(e.target.checked)} /> Include the 60-day pilot at half price</label>
        )}
        <label className="text-sm text-slate-700">Client company<Input value={client.company} onChange={(e) => setClient({ ...client, company: e.target.value })} className="mt-1" /></label>
        <label className="text-sm text-slate-700">Address<Input value={client.address} onChange={(e) => setClient({ ...client, address: e.target.value })} className="mt-1" /></label>
        <label className="text-sm text-slate-700">Signer name<Input value={client.contact} onChange={(e) => setClient({ ...client, contact: e.target.value })} className="mt-1" /></label>
        <label className="text-sm text-slate-700">Signer title<Input value={client.title} onChange={(e) => setClient({ ...client, title: e.target.value })} className="mt-1" /></label>
        <label className="text-sm text-slate-700">Email<Input type="email" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} className="mt-1" /></label>
        <label className="text-sm text-slate-700">Phone<Input value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} className="mt-1" /></label>
      </div>

      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-900">Developments / buildings <span className="font-normal text-slate-500">· {units.toLocaleString()} units</span></p>
        <div className="mt-1 grid gap-1.5">
          {buildings.map((b, i) => (
            <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_2fr_90px_auto]">
              <Input placeholder="Development" value={b.name} onChange={(e) => setB(i, { name: e.target.value })} />
              <Input placeholder="Address" value={b.address} onChange={(e) => setB(i, { address: e.target.value })} />
              <Input type="number" inputMode="numeric" min={0} placeholder="Units" value={b.units || ""} onChange={(e) => setB(i, { units: num(e.target.value) })} />
              <Button type="button" variant="ghost" size="sm" className="text-slate-400" onClick={() => setBuildings((rows) => rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}>×</Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setBuildings((rows) => [...rows, { name: "", address: "", units: 0 }])}>Add development</Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm text-slate-700">Start date<Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" /></label>
        <label className="text-sm text-slate-700">Term (months)<Input type="number" inputMode="numeric" min={1} value={termMonths} onChange={(e) => setTermMonths(Math.max(1, num(e.target.value)))} className="mt-1" /></label>
        <label className="text-sm text-slate-700">Agreement no.<Input value={number} onChange={(e) => setNumber(e.target.value)} className="mt-1" /></label>
        <label className="text-sm text-slate-700">FIAREP signer<Input value={fiarepSigner} onChange={(e) => setFiarepSigner(e.target.value)} className="mt-1" /></label>
        <label className="text-sm text-slate-700 sm:col-span-2">FIAREP legal name<Input value={fiarepEntity} onChange={(e) => setFiarepEntity(e.target.value)} className="mt-1" /></label>
        <label className="text-sm text-slate-700 sm:col-span-2">Additional terms<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`mt-1 block w-full ${field}`} /></label>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        {expediter && (
          <p className="mb-2 flex justify-between gap-3 border-b border-slate-200 pb-2 text-slate-700"><span><b>Section 4 — violation work</b> · {expediter.address}: {expediter.hpdOpen} HPD open in {expediter.apartments} apartment{expediter.apartments === 1 ? "" : "s"} × $400{expediter.dob ? ` + ${expediter.dob} DOB` : ""}</span><span className="font-semibold">{money(expediter.total)}</span></p>
        )}
        <p className="font-semibold text-slate-900">Section {expediter ? "4a" : "4"} — repairs going into this contract</p>
        {scope.length === 0 && !engineering ? <p className="text-slate-500">Nothing yet — fill in counts in the price book above.</p> : (
          <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
            {scope.map((l) => <li key={l.label} className="flex justify-between gap-3 text-slate-700"><span>{l.qty} × {l.label}</span><span className="font-semibold">{money(l.qty * l.price)}</span></li>)}
            {engineering && <li className="flex justify-between gap-3 text-slate-700"><span>Architect / engineer — {engineering.label}</span><span className="font-semibold">{money(engineering.amount)}</span></li>}
          </ul>
        )}
        {(scope.length > 0 || engineering) && <button type="button" className="mt-1 text-xs text-slate-500 underline" onClick={onClearScope}>Clear scope</button>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={preview} disabled={!ready}><FileText className="mr-1 h-4 w-4" />Preview</Button>
        <Button type="button" onClick={openPrint} disabled={!ready}><Printer className="mr-1 h-4 w-4" />Print / save as PDF</Button>
        <Button type="button" className="bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={() => void email()} disabled={!ready || busy === "email"}><Mail className="mr-1 h-4 w-4" />{busy === "email" ? "Sending…" : "Email to client"}</Button>
        {!ready && <p className="self-center text-xs text-slate-500">Needs company, signer name, at least one development with units{isAgency ? ", and the flat fee" : ""}.</p>}
      </div>
    </section>
  );
}
