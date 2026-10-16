// Audit Log: who did what, and when — everything recorded for the organization,
// on the site and in the app. Administrators only (the server checks too).
import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ChevronDown, Download, ExternalLink, Loader2, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Entry = { id: string; at: string; actorRole: string; actorName: string; action: string; detail: string; reportId?: string | null };

const CATEGORIES: { label: string; match: (a: string) => boolean }[] = [
  { label: "All activity", match: () => true },
  { label: "Hiring / Staff accounts", match: (a) => /staff account|staff code|bulk employees|^staff\.|^hr-/i.test(a) },
  { label: "Reports", match: (a) => /^report (created|submitted|resolved|status|deleted|sent)|^resident-report/i.test(a) },
  { label: "Report assignments", match: (a) => /report assigned|assigned to project|job sent to management|assignment/i.test(a) },
  { label: "Change orders", match: (a) => /change (order|work order)|^change-orders\./i.test(a) },
  { label: "Inspections", match: (a) => /inspection|repair complete/i.test(a) },
  { label: "Elevator", match: (a) => /elevator/i.test(a) },
  { label: "Projects", match: (a) => /project note|^projects\./i.test(a) },
];

// Actions are recorded as keys like "resident-reports.created": show them as words.
function actionLabel(a: string): string {
  if (!/^[a-z0-9-]+(\.[a-z0-9_-]+)+$/.test(a)) return a;
  const t = a.replace(/[._-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const when = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const esc = (v: string) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const isFilePath = (v: unknown): v is string => typeof v === "string" && v.startsWith("/objects/");
const isImage = (p: string) => /\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/i.test(p) || /photo|image/i.test(p);
const words = (k: string) => { const t = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._-]+/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

// A record's fields as label / value rows; files inside it are collected separately.
function flatten(value: unknown, prefix: string, rows: Array<[string, string]>, files: string[], depth = 0) {
  if (isFilePath(value)) { files.push(value); return; }
  if (value == null || value === "") return;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v == null)) {
      const plain = value.filter((v) => !isFilePath(v)); value.filter(isFilePath).forEach((f) => files.push(f));
      if (plain.length) rows.push([prefix, plain.join(", ")]);
      return;
    }
    value.forEach((v, i) => flatten(v, `${prefix} ${i + 1}`, rows, files, depth + 1));
    return;
  }
  if (typeof value === "object") {
    if (depth > 3) { rows.push([prefix, JSON.stringify(value)]); return; }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix} · ${words(k)}` : words(k), rows, files, depth + 1);
    return;
  }
  rows.push([prefix, String(value)]);
}

type Opened = { loading: boolean; rows: Array<[string, string]>; files: Array<{ path: string; url: string }>; note: string };

// What an entry points at: a file, or a record ("resident-reports.created" → the resident-reports record).
function targetOf(e: Entry): { kind: "file" | "record" | "none"; entity?: string; ref?: string } {
  const ref = (e.reportId || "").trim();
  if (!ref) return { kind: "none" };
  if (isFilePath(ref)) return { kind: "file", ref };
  const entity = (e.action || "").split(".")[0];
  if (/^[a-z0-9-]+$/.test(entity) && !/[:/]/.test(ref) && e.action.includes(".")) return { kind: "record", entity, ref };
  return { kind: "none", ref };
}

async function fileUrl(path: string): Promise<string> {
  const r = await customFetch<{ downloadUrl: string }>("/api/v1/files/download-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectPath: path }), responseType: "json" } as never);
  return r.downloadUrl;
}

export default function AuditLog() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, Opened>>({});

  // Open an entry: load the file it points at, or the record with all its fields and photos.
  const open = async (e: Entry) => {
    if (openId === e.id) { setOpenId(null); return; }
    setOpenId(e.id);
    if (opened[e.id]) return;
    const set = (o: Opened) => setOpened((x) => ({ ...x, [e.id]: o }));
    const t = targetOf(e);
    set({ loading: t.kind !== "none", rows: [], files: [], note: "" });
    if (t.kind === "file") {
      try { set({ loading: false, rows: [], files: [{ path: t.ref!, url: await fileUrl(t.ref!) }], note: "" }); }
      catch { set({ loading: false, rows: [], files: [], note: "This file is no longer available." }); }
      return;
    }
    if (t.kind === "record") {
      try {
        const rec = await customFetch<{ state?: Record<string, unknown>; createdAt?: string; updatedAt?: string }>(`/api/v1/${t.entity}/${encodeURIComponent(t.ref!)}`, { responseType: "json" } as never);
        const rows: Array<[string, string]> = []; const paths: string[] = [];
        flatten(rec?.state ?? {}, "", rows, paths);
        const unique = Array.from(new Set(paths)).slice(0, 24);
        const files = (await Promise.all(unique.map(async (p) => { try { return { path: p, url: await fileUrl(p) }; } catch { return null; } }))).filter((f): f is { path: string; url: string } => !!f);
        set({ loading: false, rows, files, note: rows.length || files.length ? "" : "This record has no details." });
      } catch { set({ loading: false, rows: [], files: [], note: "This record was deleted or is not available to open." }); }
    }
  };

  const [deleting, setDeleting] = useState("");
  const deleteEntry = async (e: Entry) => {
    if (!window.confirm("Delete this audit entry? This cannot be undone.")) return;
    setDeleting(e.id);
    try { await customFetch(`/api/v1/audit-log/${encodeURIComponent(e.id)}`, { method: "DELETE", responseType: "json" } as never); setRows((r) => (r || []).filter((x) => x.id !== e.id)); setOpenId(null); }
    catch (err) { setError((err as Error)?.message || "Could not delete."); }
    finally { setDeleting(""); }
  };
  const deleteAll = async () => {
    if (!window.confirm(`Delete all ${(rows || []).length} audit entries? This cannot be undone.`)) return;
    setDeleting("all");
    try { await customFetch("/api/v1/audit-log", { method: "DELETE", responseType: "json" } as never); setRows([]); setOpenId(null); }
    catch (err) { setError((err as Error)?.message || "Could not delete."); }
    finally { setDeleting(""); }
  };

  const printEntry = (e: Entry) => {
    const o = opened[e.id];
    const w = window.open("", "_blank");
    if (!w) return;
    const rows = [["Time", when(e.at)], ["What", actionLabel(e.action)], ["Detail", e.detail], ["Who", `${e.actorName || ""}${e.actorRole ? ` · ${e.actorRole}` : ""}`], ...(e.reportId ? [["Reference", e.reportId]] : [])] as Array<[string, string]>;
    const table = (r: Array<[string, string]>) => `<table>${r.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
    const imgs = (o?.files || []).filter((f) => isImage(f.path)).map((f) => `<img src="${esc(f.url)}" />`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Audit Log entry</title><style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:32px;color:#0f172a}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}p{color:#64748b;margin:0 0 16px;font-size:12px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top}th{width:28%;background:#f8fafc;font-weight:600}img{max-width:48%;margin:4px;border:1px solid #e2e8f0;border-radius:6px}</style></head><body><h1>FIAREP · Audit Log entry</h1><p>Printed ${esc(new Date().toLocaleString())}</p>${table(rows)}${o && o.rows.length ? `<h2>Record</h2>${table(o.rows)}` : ""}${imgs ? `<h2>Photos</h2>${imgs}` : ""}<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
    w.document.close();
  };

  const downloadEntry = async (e: Entry) => {
    const o = opened[e.id];
    const t = targetOf(e);
    if (t.kind === "file" && o?.files[0]) {
      const name = t.ref!.split("/").pop() || "file";
      try {
        const blob = await (await fetch(o.files[0].url)).blob();
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch { window.open(o.files[0].url, "_blank", "noopener"); }
      return;
    }
    const rows: Array<[string, string]> = [["Time", e.at], ["What", actionLabel(e.action)], ["Detail", e.detail], ["Who", e.actorName], ["Role", e.actorRole], ["Reference", e.reportId || ""], ...(o?.rows || []), ...(o?.files || []).map((f, i) => [`File ${i + 1}`, f.path] as [string, string])];
    const csv = [["Field", "Value"].map(cell).join(","), ...rows.map(([k, v]) => [k, v].map(cell).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `audit-entry-${e.at.slice(0, 10)}-${e.id.slice(0, 8)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  useEffect(() => {
    customFetch<Entry[]>("/api/v1/audit-log", { responseType: "json" } as never)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => { setRows([]); setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not load the audit log."); });
  }, []);

  const shown = useMemo(() => (rows || []).filter((e) => CATEGORIES[cat].match(e.action || "")), [rows, cat]);

  const exportCsv = () => {
    const csv = [["Time", "Role", "Name", "Action", "Detail"].map(cell).join(","), ...shown.map((e) => [e.at, e.actorRole, e.actorName, actionLabel(e.action), e.detail].map(cell).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "audit-log.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select value={cat} onChange={(e) => setCat(Number(e.target.value))} className="h-9 min-w-56 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold">
          {CATEGORIES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-9" disabled={shown.length === 0} onClick={exportCsv}><Download className="mr-1 h-4 w-4" />Export CSV</Button>
        <Button size="sm" variant="outline" className="h-9 border-rose-200 text-rose-700 hover:bg-rose-50" disabled={!rows || rows.length === 0 || deleting === "all"} onClick={() => void deleteAll()}><Trash2 className="mr-1 h-4 w-4" />{deleting === "all" ? "Deleting…" : "Delete all"}</Button>
        {rows && <span className="text-sm text-muted-foreground">{shown.length} entr{shown.length === 1 ? "y" : "ies"}</span>}
      </div>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {rows === null && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {rows && !error && shown.length === 0 && <p className="py-6 text-sm text-muted-foreground">No activity in this category.</p>}
      {shown.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {shown.map((e) => {
            const isOpen = openId === e.id; const o = opened[e.id];
            return (
            <li key={e.id}>
              <button type="button" onClick={() => void open(e)} aria-expanded={isOpen} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block text-xs text-slate-400">{when(e.at)}</span>
                  <span className="block font-semibold text-[#185FA5]">{actionLabel(e.action)}</span>
                  {e.detail ? <span className="block text-sm text-slate-700">{e.detail}</span> : null}
                  <span className="block text-xs text-slate-500">{e.actorName ? `${e.actorName} · ` : ""}{e.actorRole || "unknown"}</span>
                </span>
                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-8 bg-white" disabled={o?.loading} onClick={() => printEntry(e)}><Printer className="mr-1 h-4 w-4" />Print</Button>
                    <Button size="sm" variant="outline" className="h-8 bg-white" disabled={o?.loading} onClick={() => void downloadEntry(e)}><Download className="mr-1 h-4 w-4" />Download</Button>
                    <Button size="sm" variant="outline" className="h-8 border-rose-200 bg-white text-rose-700 hover:bg-rose-50" disabled={deleting === e.id} onClick={() => void deleteEntry(e)}><Trash2 className="mr-1 h-4 w-4" />{deleting === e.id ? "Deleting…" : "Delete"}</Button>
                  </div>
                  {o?.loading && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Opening…</div>}
                  {o?.note && <p className="text-sm text-slate-500">{o.note}</p>}
                  {o && !o.loading && o.files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {o.files.map((f) => isImage(f.path)
                        ? <a key={f.path} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt="" className="h-40 max-w-xs rounded-md border border-slate-200 bg-white object-contain" /></a>
                        : <a key={f.path} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#185FA5] underline"><ExternalLink className="h-4 w-4" />Open {f.path.split("/").pop()}</a>)}
                    </div>
                  )}
                  {o && !o.loading && o.rows.length > 0 && (
                    <table className="w-full text-sm"><tbody>
                      {o.rows.map(([k, v], i) => <tr key={i} className="border-t border-slate-200 align-top"><th className="w-1/3 py-1.5 pr-3 text-left font-medium text-slate-600">{k}</th><td className="py-1.5 text-slate-900 break-words">{v}</td></tr>)}
                    </tbody></table>
                  )}
                  {e.reportId && targetOf(e).kind === "none" && <p className="text-xs text-slate-500">Reference: {e.reportId}</p>}
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
