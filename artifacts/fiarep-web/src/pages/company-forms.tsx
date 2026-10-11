import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, Download, FileText, Lock, Plus, Printer, Save, Trash2 } from "lucide-react";
import { COMPLIANCE_FORMS, MILESTONES, entryLabel, prefillFromHpd, affidavitPlan, type HpdPrefill, type FormDef, type Field, type Section } from "@/lib/compliance-forms";

type Entry = { id: string; formId: string; values: Record<string, unknown>; label: string; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string };
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Company Forms — FIAREP's locked folder, filled in on the website. Pick a
 * form, fill it, save it; every entry stays with the organization and can be
 * printed or saved as PDF from the print dialog. Blank PDFs stay available.
 */
export default function CompanyForms() {
  const { toast } = useToast();
  const { organizationName } = useAuth();
  const [locked, setLocked] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [formId, setFormId] = useState("");
  const [editing, setEditing] = useState<{ id: string; values: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);

  const def = useMemo(() => COMPLIANCE_FORMS.find((f) => f.id === formId) || null, [formId]);

  async function reload() {
    try {
      setEntries(await customFetch<Entry[]>("/api/v1/company-forms/records", { responseType: "json" } as never));
      setLocked("");
    } catch (err: any) { setLocked(err?.data?.error || err?.message || "Company forms are not available."); }
  }
  useEffect(() => { void reload(); }, []);

  // Opened from a violation ("Fill affidavit"): /company-forms?hpd=<violation number>.
  // HPD's record of that violation picks the right affidavit (AF-6 / AF-7 / AF-8)
  // and fills it; the company's last entry of the same form supplies the firm
  // names, licenses and phone. With AF-8 the attachments are offered too.
  const [prefillNote, setPrefillNote] = useState("");
  const [hpd, setHpd] = useState<HpdPrefill | null>(null);
  const [alsoFill, setAlsoFill] = useState<FormDef[]>([]);
  const [fillNo, setFillNo] = useState("");
  const [filling, setFilling] = useState(false);
  const AFFIDAVITS = new Set(["af6-vermin", "af7-mold", "af8-mold", "civ194-mold", "mold-assessment", "mold-remediation"]);
  // Typed on the open form: pull that violation from HPD and fill this form with it.
  async function fillFromNumber() {
    if (!def) return;
    const id = fillNo.replace(/\D/g, "");
    if (!id) return;
    setFilling(true);
    try {
      const v = await customFetch<HpdPrefill>(`/api/v1/company-forms/prefill/hpd/${encodeURIComponent(id)}`, { responseType: "json" } as never);
      const plan = affidavitPlan(v);
      setHpd(v); setAlsoFill(plan && plan.primary.id === def.id ? plan.attachments : []);
      setPrefillNote(`Filled from violation #${v.violationId}${v.novId ? ` (NOV ${v.novId})` : ""} · ${v.address}${v.apartment ? ` Apt ${v.apartment}` : ""} · Class ${v.class || "?"}${v.units ? ` · ${v.units} units (${v.unitsSource})` : ""}${plan && plan.primary.id !== def.id ? ` · HPD's record points to ${plan.primary.title}` : ""}`);
      await openFilled(def, v);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not fill from the violation", description: err?.data?.error || err?.message || "Check the number." });
    } finally { setFilling(false); }
  }
  async function openFilled(f: FormDef, v: HpdPrefill) {
    let last: Record<string, unknown> | undefined;
    try { const mine = await customFetch<Entry[]>(`/api/v1/company-forms/records?form=${encodeURIComponent(f.id)}`, { responseType: "json" } as never); last = mine[0]?.values; } catch { /* none yet */ }
    setFormId(f.id); setEditing({ id: "", values: prefillFromHpd(f.id, v, last) });
  }
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const wanted = q.get("form") || ""; const id = q.get("hpd") || "";
    if (!wanted && !id) return;
    (async () => {
      if (!id) { const f = COMPLIANCE_FORMS.find((x) => x.id === wanted); if (f) startNew(f); return; }
      try {
        const v = await customFetch<HpdPrefill>(`/api/v1/company-forms/prefill/hpd/${encodeURIComponent(id)}`, { responseType: "json" } as never);
        const plan = affidavitPlan(v);
        const f = COMPLIANCE_FORMS.find((x) => x.id === wanted) || plan?.primary;
        if (!f) { toast({ variant: "destructive", title: "No affidavit for this violation", description: v.description }); return; }
        setHpd(v); setAlsoFill(plan && plan.primary.id === f.id ? plan.attachments : []);
        setPrefillNote(`Filled from violation #${v.violationId}${v.novId ? ` (NOV ${v.novId})` : ""} · ${v.address}${v.apartment ? ` Apt ${v.apartment}` : ""} · Class ${v.class || "?"}${v.units ? ` · ${v.units} units (${v.unitsSource})` : ""}${plan ? ` · ${plan.why}` : ""}`);
        await openFilled(f, v);
      } catch (err: any) {
        toast({ variant: "destructive", title: "Could not fill from the violation", description: err?.data?.error || err?.message || "Fill it in by hand." });
      }
      window.history.replaceState(null, "", "/company-forms");
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startNew(f: FormDef) {
    const values: Record<string, unknown> = {};
    if (f.id === "violation-timeline") values["milestones"] = MILESTONES.map((m) => ({ milestone: m }));
    setFormId(f.id); setEditing({ id: "", values });
  }

  async function save() {
    if (!def || !editing) return;
    setBusy(true);
    try {
      const r = await customFetch<Entry>("/api/v1/company-forms/records", {
        method: "POST", headers: { "Content-Type": "application/json" }, responseType: "json",
        body: JSON.stringify({ id: editing.id || undefined, formId: def.id, values: editing.values, label: entryLabel(def, editing.values) }),
      } as never);
      setEditing({ id: r.id, values: r.values });
      toast({ title: "Saved", description: `${def.title} — ${r.label}` });
      await reload();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not save", description: err?.data?.error || err?.message || "Try again." });
    } finally { setBusy(false); }
  }

  async function remove(e: Entry) {
    if (!window.confirm(`Delete "${e.label || "this entry"}"?`)) return;
    try {
      await customFetch(`/api/v1/company-forms/records/${encodeURIComponent(e.id)}`, { method: "DELETE", responseType: "json" } as never);
      if (editing?.id === e.id) setEditing(null);
      await reload();
    } catch (err: any) { toast({ variant: "destructive", title: "Could not delete", description: err?.message }); }
  }

  async function blankPdf(f: FormDef) {
    try {
      const blob = await customFetch<Blob>(`/api/v1/company-forms/${encodeURIComponent(f.pdf)}`, { responseType: "blob" } as never);
      const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) { toast({ variant: "destructive", title: "Could not open", description: err?.data?.error || err?.message }); }
  }

  // The real government form with the entry written into its blanks.
  const FILLABLE = new Set(["hpd-af6-vermin-affidavit.pdf", "hpd-mold-certificate-of-correction.pdf", "hpd-affidavit-mold-assessment.pdf", "hpd-affidavit-mold-remediation.pdf"]);
  async function filledPdf() {
    if (!def || !editing) return;
    try {
      const blob = await customFetch<Blob>(`/api/v1/company-forms/fill/${encodeURIComponent(def.pdf)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: editing.values }), responseType: "blob" } as never);
      const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) { toast({ variant: "destructive", title: "Could not fill the PDF", description: err?.data?.error || err?.message }); }
  }

  function print() {
    if (!def || !editing) return;
    const w = window.open("", "_blank", "noopener,width=900,height=1100");
    if (!w) return;
    w.document.write(printHtml(def, editing.values, organizationName || "FIAREP"));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  if (locked) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Lock className="h-6 w-6" />Company Forms</h1>
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{locked}</p>
      </div>
    );
  }

  // ── Editor ──
  if (def && editing) {
    const set = (k: string, v: unknown) => setEditing((e) => (e ? { ...e, values: { ...e.values, [k]: v } } : e));
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <button type="button" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => setEditing(null)}><ArrowLeft className="h-4 w-4" /> All {def.group.toLowerCase()} forms</button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{def.title}</h1>
            <p className="text-sm text-muted-foreground">{def.subtitle}</p>
            {AFFIDAVITS.has(def.id) && (
              <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void fillFromNumber(); }}>
                <label className="text-xs font-semibold text-slate-700">Fill from violation #</label>
                <Input value={fillNo} onChange={(e) => setFillNo(e.target.value)} placeholder="HPD violation number" className="h-8 w-48" inputMode="numeric" />
                <Button type="submit" size="sm" className="h-8" disabled={filling || !fillNo.trim()}>{filling ? "Filling…" : "Fill"}</Button>
                <span className="text-xs text-muted-foreground">or open it from the violation on Violation Alerts / Check HPD / DOB</span>
              </form>
            )}
            {prefillNote && <p className="mt-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{prefillNote} — check every line before you sign.</p>}
            {hpd && alsoFill.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-slate-700">Goes with this one — also fill:</span>
                {alsoFill.map((f) => <Button key={f.id} size="sm" variant="outline" className="h-7" onClick={() => void openFilled(f, hpd)}>{f.title}</Button>)}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {FILLABLE.has(def.pdf) && <Button onClick={() => void filledPdf()}><FileText className="mr-1 h-4 w-4" />Filled PDF form</Button>}
            <Button variant="outline" onClick={print}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>
            <Button onClick={() => void save()} disabled={busy}><Save className="mr-1 h-4 w-4" />{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
        {def.sections.map((s) => <SectionEditor key={s.title} section={s} values={editing.values} set={set} />)}
        <div className="flex justify-end gap-2 pb-8">
          {FILLABLE.has(def.pdf) && <Button onClick={() => void filledPdf()}><FileText className="mr-1 h-4 w-4" />Filled PDF form</Button>}
          <Button variant="outline" onClick={print}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>
          <Button onClick={() => void save()} disabled={busy}><Save className="mr-1 h-4 w-4" />{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    );
  }

  // ── Folder ──
  const groups = [...new Set(COMPLIANCE_FORMS.map((f) => f.group))];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Lock className="h-6 w-6" />Company Forms</h1>
        <p className="text-sm text-muted-foreground">FIAREP's compliance forms, filled in here and kept with the organization. This folder is locked — client staff never see it.</p>
      </div>
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
          <div className="space-y-3">
            {COMPLIANCE_FORMS.filter((f) => f.group === g).map((f) => {
              const mine = entries.filter((e) => e.formId === f.id);
              return (
                <div key={f.id} className="rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{f.title}</p>
                      <p className="text-xs text-muted-foreground">{f.subtitle}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => void blankPdf(f)} title="Blank PDF"><Download className="h-4 w-4" /></Button>
                      <Button size="sm" onClick={() => startNew(f)}><Plus className="mr-1 h-4 w-4" />Fill in</Button>
                    </div>
                  </div>
                  {mine.length > 0 && (
                    <ul className="mt-3 divide-y rounded-md border bg-background text-sm">
                      {mine.map((e) => (
                        <li key={e.id} className="flex items-center gap-2 px-3 py-2">
                          <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => { setFormId(f.id); setEditing({ id: e.id, values: e.values }); }}>
                            <span className="font-medium">{e.label || "Untitled"}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{when(e.updatedAt)}{e.updatedBy ? ` · ${e.updatedBy}` : ""}</span>
                          </button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-600" onClick={() => void remove(e)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function SectionEditor({ section, values, set }: { section: Section; values: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{section.title}</h2>
      {section.note && <p className="mt-1 text-xs text-muted-foreground">{section.note}</p>}
      {section.checks && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {section.checks.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[#185FA5]" checked={values[c.key] === true} onChange={(e) => set(c.key, e.target.checked)} />{c.label}</label>
          ))}
        </div>
      )}
      {section.fields && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {section.fields.map((f) => <FieldEditor key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />)}
        </div>
      )}
      {section.table && <TableEditor table={section.table} rows={(values[section.table.key] as Record<string, unknown>[]) || []} onChange={(rows) => set(section.table!.key, rows)} />}
    </section>
  );
}

function FieldEditor({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const wrap = field.full || field.type === "textarea" ? "sm:col-span-2" : "";
  if (field.type === "checkbox") {
    return <label className={`flex items-center gap-2 text-sm ${wrap}`}><input type="checkbox" className="h-4 w-4 accent-[#185FA5]" checked={value === true} onChange={(e) => onChange(e.target.checked)} />{field.label}</label>;
  }
  return (
    <label className={`block ${wrap}`}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{field.label}</span>
      {field.type === "textarea" ? <Textarea className="min-h-[80px]" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        : field.type === "select" ? (
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {(field.options || []).map((o) => <option key={o} value={o}>{o || "—"}</option>)}
          </select>
        ) : <Input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function TableEditor({ table, rows, onChange }: { table: NonNullable<Section["table"]>; rows: Record<string, unknown>[]; onChange: (rows: Record<string, unknown>[]) => void }) {
  const list = rows.length ? rows : Array.from({ length: table.rows }, () => ({}));
  const setCell = (i: number, k: string, v: string) => onChange(list.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-muted/40">{table.columns.map((c) => <th key={c.key} className="px-2 py-1 text-left text-xs font-semibold text-muted-foreground">{c.label}</th>)}</tr></thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {table.columns.map((c) => (
                <td key={c.key} className="px-1 py-1">
                  <Input className="h-9" type={c.type === "date" ? "date" : c.type === "number" ? "number" : "text"} value={String(r[c.key] ?? "")} onChange={(e) => setCell(i, c.key, e.target.value)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => onChange([...list, {}])}><Plus className="mr-1 h-4 w-4" />Add row</Button>
    </div>
  );
}

function printHtml(def: FormDef, values: Record<string, unknown>, org: string): string {
  const v = (k: string) => esc(values[k]);
  const field = (f: Field) => f.type === "checkbox"
    ? `<div class="chk">${values[f.key] === true ? "☑" : "☐"} ${esc(f.label)}</div>`
    : `<div class="f${f.full || f.type === "textarea" ? " full" : ""}"><div class="l">${esc(f.label)}</div><div class="v">${f.type === "textarea" ? v(f.key).replaceAll("\n", "<br>") : v(f.key)}&nbsp;</div></div>`;
  const sections = def.sections.map((s) => {
    const checks = s.checks ? `<div class="checks">${s.checks.map((c) => `<span>${values[c.key] === true ? "☑" : "☐"} ${esc(c.label)}</span>`).join("")}</div>` : "";
    const fields = s.fields ? `<div class="grid">${s.fields.map(field).join("")}</div>` : "";
    const rows = s.table ? ((values[s.table.key] as Record<string, unknown>[]) || []) : [];
    const table = s.table ? `<table><tr>${s.table.columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>${(rows.length ? rows : Array.from({ length: s.table.rows }, () => ({}))).map((r) => `<tr>${s.table!.columns.map((c) => `<td>${esc(r[c.key])}&nbsp;</td>`).join("")}</tr>`).join("")}</table>` : "";
    return `<section><h2>${esc(s.title)}</h2>${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}${checks}${fields}${table}</section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(def.title)}</title><style>
    body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:28px;font-size:12px}
    header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px}
    h1{font-size:18px;margin:0}.sub{color:#555;font-size:11px}.org{font-weight:700;font-size:13px;text-align:right}
    section{margin-bottom:14px;page-break-inside:avoid}h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #999;padding-bottom:3px;margin:0 0 8px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}.f.full{grid-column:1/-1}.l{font-size:9px;color:#555;text-transform:uppercase}.v{border-bottom:1px solid #999;min-height:16px;padding:2px 0}
    .checks{display:flex;flex-wrap:wrap;gap:4px 16px;margin-bottom:8px}.chk{grid-column:1/-1}.note{font-size:10px;color:#444;font-style:italic;margin:0 0 8px}
    table{width:100%;border-collapse:collapse;margin-top:4px}th,td{border:1px solid #999;padding:4px 6px;text-align:left;font-size:11px}th{background:#eee;font-size:10px}
    footer{margin-top:20px;font-size:9px;color:#777;text-align:center}
  </style></head><body>
  <header><div><h1>${esc(def.title)}</h1><div class="sub">${esc(def.subtitle)}</div></div><div class="org">${esc(org)}<br><span class="sub">${new Date().toLocaleDateString()}</span></div></header>
  ${sections}<footer>Powered by FIAREP · fiarep.com</footer></body></html>`;
}
