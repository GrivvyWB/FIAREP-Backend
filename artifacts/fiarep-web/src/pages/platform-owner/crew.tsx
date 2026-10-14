import React, { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChevronDown } from "lucide-react";

const CREW_KINDS = [
  { kind: "technician", label: "Technician", blurb: "FIAREP CPM / Inspector — all field tools" },
  { kind: "community-coordinator", label: "FIAREP Services", blurb: "Resident visits and building checks, on FIAREP's own team" },
] as const;
const kindOfRole = (role: string) => (role === "community_coordinator" ? "FIAREP Services" : "Technician");

type Member = { id: string; name: string; position: string; role: string; code: string; status: string; hourlyRate: number | null; hours: number; shifts: number; pay: number | null; clockedInSince: string | null; lastPunch: { direction: string; at: string } | null; messaging?: boolean };
type Crew = { clockEnabled: boolean; from: string; to: string; members: Member[]; totalHours: number; totalPay: number; administrators?: Array<{ id: string; name: string; messaging: boolean }> };
type Punch = { id: string; direction: string; at: string; source: string; address?: string | null; latitude?: number | null; longitude?: number | null; company?: string; development?: string };
type Job = { id: string; tenantId: string; company: string; complaintNo: string; development: string; address: string; unit: string; category: string; description: string; status: string; createdAt: string | null; sentAt: string | null; clientStatus: string; fiarep: { recordId: string; status: string; assignedStaffId: string; assignedTo: string; startedAt: string | null; completedAt: string | null; completionNote: string; photos: string[]; approvedAt: string | null; approvedBy: string; sentBackNote: string; sentBackAt: string | null; clientApprovedAt: string | null; clientApprovedBy: string; updates: { status?: string; note?: string; by?: string; at?: string }[] } | null };
type Stop = { id: string; address: string | null; latitude: number; longitude: number; arrivedAt: string; leftAt: string | null; minutes: number; company?: string; development?: string };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const iso = (d: Date) => d.toISOString().slice(0, 10);
function thisWeek(): { from: string; to: string } { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const e = new Date(d); e.setDate(e.getDate() + 6); return { from: iso(d), to: iso(e) }; }

/** Platform Control → FIAREP crew: FIAREP's own technicians. Switch the time
 * clock on, add a person with an hourly rate, hand them the code — they log in
 * to the FIAREP app as a worker and clock in / out on the Attendance screen.
 * Hours and pay for any period come from the punches. FIAREP only. */

/** A section that folds up. Click the header to open / close; it remembers per section. */
function Fold({ id, title, summary, badge, defaultOpen = false, tone = "white", children }: { id: string; title: string; summary?: string; badge?: string; defaultOpen?: boolean; tone?: "white" | "grey"; children: React.ReactNode }) {
  const key = `fiarep.crew.fold.${id}`;
  const [open, setOpen] = useState<boolean>(() => { try { const v = localStorage.getItem(key); return v == null ? defaultOpen : v === "1"; } catch { return defaultOpen; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* private mode */ } return !o; });
  return (
    <section className={`rounded-xl border border-slate-200 shadow-sm ${tone === "grey" ? "bg-slate-50" : "bg-white"}`}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">{title}{badge ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{badge}</span> : null}</span>
          {summary && !open ? <span className="mt-0.5 block truncate text-xs text-slate-500">{summary}</span> : null}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="border-t border-slate-100">{children}</div> : null}
    </section>
  );
}

export default function OwnerCrew() {
  const [crew, setCrew] = useState<Crew | null>(null);
  const [range, setRange] = useState(thisWeek);
  const [error, setError] = useState("");
  const [add, setAdd] = useState({ name: "", kind: "technician", hourlyRate: "" });
  const [adding, setAdding] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string>("");
  const [punches, setPunches] = useState<Punch[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [copied, setCopied] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [sending, setSending] = useState("");
  const [openJob, setOpenJob] = useState("");
  const [backNote, setBackNote] = useState<Record<string, string>>({});
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  async function load(r = range) {
    try { setCrew(await customFetch<Crew>(`/api/v1/platform/crew?from=${r.from}&to=${r.to}`, { responseType: "json" } as never)); setJobs(await customFetch<Job[]>("/api/v1/platform/crew/jobs", { responseType: "json" } as never)); setError(""); }
    catch (e) { setError((e as Error)?.message || "Could not load the crew."); }
  }
  useEffect(() => { void load(range); const t = setInterval(() => void load(range), 60_000); return () => clearInterval(t); }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const req = async (url: string, method: string, body?: unknown) => customFetch(url, { method, headers: { "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body), responseType: "json" } as never);
  const setClock = async (enabled: boolean) => { try { await req("/api/v1/platform/crew/clock", "PUT", { enabled }); await load(); } catch (e) { setError((e as Error)?.message || "Could not change the clock."); } };
  const addMember = async () => {
    if (!add.name.trim() || !Number(add.hourlyRate)) return;
    setAdding(true); setError("");
    try { await req("/api/v1/platform/crew", "POST", { name: add.name.trim(), kind: add.kind, hourlyRate: Number(add.hourlyRate) }); setAdd({ name: "", kind: "technician", hourlyRate: "" }); await load(); }
    catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not add."); }
    finally { setAdding(false); }
  };
  const saveRate = async (m: Member) => { const v = Number(edits[m.id]); if (!v || v === m.hourlyRate) { setEdits((x) => { const n = { ...x }; delete n[m.id]; return n; }); return; } try { await req(`/api/v1/platform/crew/${m.id}`, "PATCH", { hourlyRate: v }); setEdits((x) => { const n = { ...x }; delete n[m.id]; return n; }); await load(); } catch (e) { setError((e as Error)?.message || "Could not save."); } };
  const setStatus = async (m: Member, status: "approved" | "revoked") => { try { await req(`/api/v1/platform/crew/${m.id}`, "PATCH", { status }); await load(); } catch (e) { setError((e as Error)?.message || "Could not update."); } };
  // Who uses messaging: the administrator's switch per FIAREP Services member.
  const setMessaging = async (m: { id: string }, enabled: boolean) => { try { await req(`/api/v1/platform/crew/${m.id}/messaging`, "PUT", { enabled }); await load(); } catch (e) { setError((e as Error)?.message || "Could not change messaging."); } };
  const resetCode = async (m: Member) => { try { await req(`/api/v1/platform/crew/${m.id}/reset-code`, "POST"); await load(); } catch (e) { setError((e as Error)?.message || "Could not reset the code."); } };
  const showPunches = async (m: Member) => { if (open === m.id) { setOpen(""); return; } setOpen(m.id); try { const [p, st] = await Promise.all([customFetch<Punch[]>(`/api/v1/platform/crew/${m.id}/punches?from=${range.from}&to=${range.to}`, { responseType: "json" } as never), customFetch<Stop[]>(`/api/v1/platform/crew/${m.id}/locations?from=${range.from}&to=${range.to}`, { responseType: "json" } as never)]); setPunches(p); setStops(st); } catch { setPunches([]); setStops([]); } };
  const copy = async (m: Member) => { try { await navigator.clipboard.writeText(`${m.name} · code ${m.code}`); setCopied(m.id); setTimeout(() => setCopied(""), 1500); } catch { /* clipboard blocked */ } };

  const sendJob = async (j: Job) => {
    const staffId = pick[j.id] || j.fiarep?.assignedStaffId || "";
    if (!staffId) return;
    setSending(j.id); setError("");
    try { await req(`/api/v1/platform/crew/jobs/${encodeURIComponent(j.tenantId)}/${encodeURIComponent(j.id)}/send`, "POST", { staffId }); await load(); }
    catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not send the job."); }
    finally { setSending(""); }
  };

  const approveJob = async (j: Job) => {
    setSending(j.id); setError("");
    try { await req(`/api/v1/platform/crew/jobs/${encodeURIComponent(j.tenantId)}/${encodeURIComponent(j.id)}/approve`, "POST"); await load(); }
    catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not approve."); }
    finally { setSending(""); }
  };
  const sendBack = async (j: Job) => {
    const note = (backNote[j.id] || "").trim();
    if (note.length < 3) return;
    setSending(j.id); setError("");
    try { await req(`/api/v1/platform/crew/jobs/${encodeURIComponent(j.tenantId)}/${encodeURIComponent(j.id)}/send-back`, "POST", { note }); setBackNote((x) => ({ ...x, [j.id]: "" })); await load(); }
    catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not send back."); }
    finally { setSending(""); }
  };
  const photoUrl = async (objectPath: string) => {
    if (photoUrls[objectPath]) return;
    try { const r = await customFetch<{ downloadUrl: string }>("/api/v1/platform/crew/photo-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectPath }), responseType: "json" } as never); setPhotoUrls((x) => ({ ...x, [objectPath]: r.downloadUrl })); } catch { /* no link */ }
  };
  const toggleJob = (j: Job) => { const next = openJob === j.id ? "" : j.id; setOpenJob(next); if (next && j.fiarep) j.fiarep.photos.forEach((p) => void photoUrl(p)); };
  const finished = (j: Job) => !!j.fiarep && ["done", "approved", "resolved", "cleared"].includes(j.fiarep.status);
  const openJobs = jobs.filter((j) => !finished(j));
  const doneJobs = jobs.filter(finished);
  const stamp = (v: unknown) => (typeof v === "string" && v ? when(v) : "—");

  // What the technician did on a job: times, note, photos, send-backs, approvals.
  // A plain function, not a component: a component defined inside would remount on every keystroke and lose the note box focus.
  const renderWork = (j: Job) => j.fiarep ? (
    <div className="grid gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 text-sm md:grid-cols-[1fr_auto]">
      <div className="space-y-1 text-slate-700">
        <p><span className="text-slate-500">Technician:</span> {j.fiarep.assignedTo || "—"}</p>
        <p><span className="text-slate-500">Started:</span> {stamp(j.fiarep.startedAt)} · <span className="text-slate-500">Done:</span> {stamp(j.fiarep.completedAt)}</p>
        {j.fiarep.completionNote ? <p><span className="text-slate-500">Note:</span> {j.fiarep.completionNote}</p> : null}
        {j.fiarep.sentBackNote ? <p className="text-amber-700">Sent back {stamp(j.fiarep.sentBackAt)}: {j.fiarep.sentBackNote}</p> : null}
        {j.fiarep.approvedAt ? <p className="text-emerald-700">Approved by {j.fiarep.approvedBy} · {stamp(j.fiarep.approvedAt)}</p> : null}
        {j.fiarep.clientApprovedAt ? <p className="text-emerald-700">{j.company} approved · {j.fiarep.clientApprovedBy} · {stamp(j.fiarep.clientApprovedAt)}</p> : <p className="text-slate-500">{j.company}: {j.clientStatus.replaceAll("_", " ")}</p>}
        {j.fiarep.updates.length > 0 ? <ul className="mt-1 space-y-0.5 text-xs text-slate-500">{j.fiarep.updates.map((u, i) => <li key={i}>{u.at ? when(u.at) : ""} · {u.by || ""} · {u.note || u.status || ""}</li>)}</ul> : null}
        {j.fiarep.photos.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{j.fiarep.photos.map((p) => photoUrls[p] ? <a key={p} href={photoUrls[p]} target="_blank" rel="noreferrer"><img src={photoUrls[p]} alt="Job photo" className="h-24 w-24 rounded-md border border-slate-200 object-cover" /></a> : <span key={p} className="flex h-24 w-24 items-center justify-center rounded-md border border-slate-200 bg-white text-xs text-slate-400">photo…</span>)}</div> : <p className="text-xs text-slate-400">No photo yet.</p>}
      </div>
      {j.fiarep.status === "done" && (
        <div className="w-full space-y-2 md:w-72">
          <Button size="sm" className="w-full bg-emerald-600 text-white hover:bg-emerald-500" disabled={sending === j.id} onClick={() => void approveJob(j)}>{sending === j.id ? "…" : "Approve work"}</Button>
          <textarea value={backNote[j.id] || ""} onChange={(e) => setBackNote((x) => ({ ...x, [j.id]: e.target.value }))} placeholder="What needs fixing? (goes to the technician)" className="h-16 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <Button size="sm" variant="outline" className="w-full" disabled={sending === j.id || (backNote[j.id] || "").trim().length < 3} onClick={() => void sendBack(j)}>Send back</Button>
        </div>
      )}
    </div>
  ) : null;

  const active = crew?.members.filter((m) => m.status === "approved") ?? [];
  const removed = crew?.members.filter((m) => m.status !== "approved") ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">FIAREP crew</h1>
          <p className="text-sm text-slate-500">FIAREP's own technicians — issued as CPM / Inspector accounts so they have every field tool in the app (projects, HUD inspections, violations, measurement, scopes, change orders). Add a person, hand them their code; they clock in and out on the Attendance screen. Hours here are what the plan's labor pool is measured against.</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-slate-900">Time clock for FIAREP employees</p>
            <p className="text-xs text-slate-500">{crew?.clockEnabled ? "On — the Clock in / out button shows in the app." : "Off — the app shows attendance but no button."}</p>
          </div>
          <Switch checked={!!crew?.clockEnabled} onCheckedChange={(v: boolean) => void setClock(v)} />
        </div>
      </div>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <Fold id="jobs" title="Jobs from client companies" badge={`${openJobs.length} open`} defaultOpen summary="Send a resident complaint to one of your technicians.">
        <div className="border-b border-slate-100 px-4 py-2">
          <p className="text-xs text-slate-500">Every open resident complaint on the platform. Pick a technician and send — it lands in his My Jobs and Inbox with a push; the company sees "FIAREP · name" and every step he takes.</p>
        </div>
        {openJobs.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No open complaints right now.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Company</th><th className="px-4 py-2">Complaint</th><th className="px-4 py-2">Where</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Technician</th><th className="px-4 py-2"></th></tr></thead>
            <tbody>{openJobs.map((j) => {
              const chosen = pick[j.id] ?? j.fiarep?.assignedStaffId ?? "";
              return <React.Fragment key={j.id}><tr className="border-t border-slate-100 align-top">
                <td className="px-4 py-2 font-medium text-slate-900">{j.company}</td>
                <td className="px-4 py-2"><div className="font-medium text-slate-900">{j.complaintNo || "—"}{j.category ? <span className="font-normal text-slate-500"> · {j.category}</span> : null}</div><div className="max-w-md text-slate-600">{j.description}</div><div className="text-xs text-slate-400">{when(j.createdAt)}</div></td>
                <td className="px-4 py-2 text-slate-700">{j.address}{j.unit ? ` · Apt ${j.unit}` : ""}{j.development ? <div className="text-xs text-slate-500">{j.development}</div> : null}</td>
                <td className="px-4 py-2">{j.fiarep ? <span className="text-emerald-700">FIAREP · {j.fiarep.status.replaceAll("_", " ")}</span> : <span className="text-slate-600">{j.status.replaceAll("_", " ")}</span>}{j.sentAt ? <div className="text-xs text-slate-400">sent {when(j.sentAt)}</div> : null}</td>
                <td className="px-4 py-2"><select value={chosen} onChange={(e) => setPick((x) => ({ ...x, [j.id]: e.target.value }))} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"><option value="">Choose…</option>{active.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>
                <td className="px-4 py-2"><Button size="sm" disabled={!chosen || sending === j.id || (!!j.fiarep && chosen === j.fiarep.assignedStaffId)} onClick={() => void sendJob(j)}>{sending === j.id ? "Sending…" : j.fiarep ? (chosen === j.fiarep.assignedStaffId ? "Sent" : "Reassign") : "Send to technician"}</Button>{j.fiarep ? <button type="button" onClick={() => toggleJob(j)} className="mt-1 block text-xs text-slate-500 underline">{openJob === j.id ? "hide" : "what was done"}</button> : null}</td>
              </tr>{openJob === j.id ? <tr><td colSpan={6} className="p-0">{renderWork(j)}</td></tr> : null}</React.Fragment>;
            })}</tbody>
          </table></div>
        )}
      </Fold>

      <Fold id="done" title="Completed by the crew" badge={String(doneJobs.length)} summary="Every job the crew finished — who, when, the note and the photos. Stays here for the record.">
        {doneJobs.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">Nothing finished yet.</p> : (
          <ul className="divide-y divide-slate-100">{doneJobs.map((j) => (
            <li key={j.id}>
              <button type="button" onClick={() => toggleJob(j)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-slate-50">
                <span className="font-medium text-slate-900">{j.company}</span>
                <span className="text-slate-700">{j.complaintNo || "—"} · {j.address}{j.unit ? ` · Apt ${j.unit}` : ""}</span>
                <span className="text-slate-500">{j.description}</span>
                <span className="ml-auto text-xs text-slate-500">{j.fiarep?.assignedTo} · done {stamp(j.fiarep?.completedAt)} · {j.fiarep?.status === "done" ? <span className="text-amber-700">needs your approval</span> : <span className="text-emerald-700">{j.fiarep?.status}</span>}</span>
              </button>
              {openJob === j.id ? renderWork(j) : null}
            </li>
          ))}</ul>
        )}
      </Fold>

      <Fold id="add" title="Add an employee" summary="Name, rate, and the code is issued on the spot.">
        <div className="flex flex-wrap items-end gap-2 px-4 pt-3">
          <label className="text-xs text-slate-600">Name<input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="First and last name" className="mt-1 block h-9 w-56 rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
          <label className="text-xs text-slate-600">Role
            <select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })} className="mt-1 block h-9 w-72 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900">
              {CREW_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label} — {k.blurb}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Hourly rate<span className="mt-1 flex h-9 items-center rounded-md border border-slate-300 px-2 text-sm text-slate-900"><span className="text-slate-400">$</span><input type="number" min={1} step={0.5} value={add.hourlyRate} onChange={(e) => setAdd({ ...add, hourlyRate: e.target.value })} placeholder="38" className="w-20 bg-transparent px-1 text-right focus:outline-none" /><span className="text-slate-400">/hr</span></span></label>
          <Button size="sm" className="h-9 bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={adding || !add.name.trim() || !Number(add.hourlyRate)} onClick={() => void addMember()}>{adding ? "Adding…" : "Add and issue a code"}</Button>
        </div>
        <p className="px-4 pb-3 pt-2 text-xs text-slate-500">The rate is what FIAREP pays the person; it never appears to clients. The sign-in code is issued the moment you add them.</p>
      </Fold>

      <Fold id="hours" title="Hours and pay" badge={crew ? `${active.length} on the crew · ${crew.totalHours} h · ${money(crew.totalPay)}` : undefined} defaultOpen summary="Who is on the clock, hours and pay for the period, sign-in codes.">
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <label>From <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
            <label>To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setRange(thisWeek())}>This week</Button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-4 py-2">Employee</th><th className="px-2 py-2">Sign-in code</th><th className="px-2 py-2 text-right">Rate</th><th className="px-2 py-2">Now</th><th className="px-2 py-2 text-right">Hours</th><th className="px-2 py-2 text-right">Pay</th><th className="px-4 py-2 text-right"></th></tr></thead>
          <tbody>
            {active.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">{crew ? "No one on the crew yet." : "Loading…"}</td></tr>}
            {active.map((m) => (
              <>
                <tr key={m.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2"><span className="font-medium text-slate-900">{m.name}</span><span className="block text-xs text-slate-500">{kindOfRole(m.role)}{m.position && m.position !== kindOfRole(m.role) ? ` · ${m.position}` : ""}</span>
                    {m.role === "community_coordinator" && (
                      <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                        <button type="button" role="switch" aria-checked={m.messaging !== false} aria-label={`Messaging for ${m.name}`} onClick={() => void setMessaging(m, m.messaging === false)}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition ${m.messaging !== false ? "bg-[#E0A526]" : "bg-slate-300"}`}>
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${m.messaging !== false ? "left-[18px]" : "left-0.5"}`} />
                        </button>
                        Messaging {m.messaging !== false ? "on" : "off"}
                      </label>
                    )}
                  </td>
                  <td className="px-2 py-2"><span className="font-mono text-base font-semibold tracking-wider text-slate-900">{m.code}</span><button type="button" className="ml-2 text-xs text-slate-500 underline" onClick={() => void copy(m)}>{copied === m.id ? "copied" : "copy"}</button><button type="button" className="ml-2 text-xs text-slate-500 underline" onClick={() => void resetCode(m)}>new code</button></td>
                  <td className="px-2 py-2 text-right"><span className="inline-flex items-center gap-1"><span className="text-slate-400">$</span><input type="number" min={1} step={0.5} value={edits[m.id] ?? m.hourlyRate ?? ""} onChange={(e) => setEdits((x) => ({ ...x, [m.id]: e.target.value }))} onBlur={() => void saveRate(m)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={`h-8 w-20 rounded-md border px-2 text-right text-sm text-slate-900 ${edits[m.id] != null ? "border-amber-400 bg-amber-50" : "border-slate-300"}`} aria-label={`Hourly rate for ${m.name}`} /><span className="text-xs text-slate-400">/hr</span></span></td>
                  <td className="px-2 py-2">{m.clockedInSince ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Clocked in · {when(m.clockedInSince)}</span> : <span className="text-xs text-slate-500">Out{m.lastPunch ? ` · last ${when(m.lastPunch.at)}` : ""}</span>}</td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-900">{m.hours.toFixed(2)}<span className="block text-xs font-normal text-slate-500">{m.shifts} shift{m.shifts === 1 ? "" : "s"}</span></td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-900">{m.pay == null ? "—" : money(m.pay)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap"><button type="button" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => void showPunches(m)}>{open === m.id ? "Hide the day" : "Day history"}</button><span className="mx-2 text-slate-300">·</span><button type="button" className="text-xs text-slate-400 underline hover:text-rose-700" onClick={() => void setStatus(m, "revoked")}>remove</button></td>
                </tr>
                {open === m.id && (
                  <tr key={`${m.id}-p`} className="bg-slate-50"><td colSpan={7} className="px-4 py-2 text-xs text-slate-700">
                    {punches.length === 0 ? "No punches in this period." : <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">{punches.map((p) => <li key={p.id}><span className={p.direction === "in" ? "text-emerald-700" : "text-slate-600"}>{p.direction === "in" ? "In" : "Out"}</span> · {new Date(p.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{p.address ? <span className="text-slate-500"> · {p.address}</span> : p.latitude != null ? <a className="text-slate-500 underline" href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`} target="_blank" rel="noreferrer"> · map</a> : null}{p.company ? <span className="ml-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-[#185FA5]">{p.company}{p.development ? ` · ${p.development}` : ""}</span> : null}</li>)}</ul>}
                    {stops.length > 0 && <div className="mt-2 border-t border-slate-200 pt-2"><p className="font-semibold text-slate-800">Where they were (stayed 30+ min)</p><ul className="mt-1 space-y-0.5">{stops.map((st) => <li key={st.id}><a className="font-medium text-slate-800 underline decoration-slate-300" href={`https://www.google.com/maps?q=${st.latitude},${st.longitude}`} target="_blank" rel="noreferrer">{st.address || `${st.latitude.toFixed(4)}, ${st.longitude.toFixed(4)}`}</a> · {new Date(st.arrivedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – {st.leftAt ? new Date(st.leftAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "still there"} · {Math.floor(st.minutes / 60)}h {String(st.minutes % 60).padStart(2, "0")}m{st.company ? <span className="ml-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-[#185FA5]">{st.company}{st.development ? ` · ${st.development}` : ""}</span> : <span className="ml-1 text-slate-400">not a registered building</span>}</li>)}</ul></div>}
                  </td></tr>
                )}
              </>
            ))}
          </tbody>
          {active.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold text-slate-950"><td className="px-4 py-2" colSpan={4}>{crew?.from} – {crew?.to}</td><td className="px-2 py-2 text-right">{crew?.totalHours.toFixed(2)}</td><td className="px-2 py-2 text-right">{money(crew?.totalPay ?? 0)}</td><td></td></tr></tfoot>}
        </table>
        <p className="px-4 py-2 text-xs text-slate-500">Hours pair each clock-in with the next clock-out; a shift still open counts up to now. Pay = hours × rate, before taxes and overtime.</p>
      </Fold>

      {(crew?.administrators?.length ?? 0) > 0 && (
        <Fold id="admins" title="Administrators" summary="Messaging on or off for each administrator" defaultOpen>
          <ul className="divide-y divide-slate-100">
            {crew!.administrators!.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span><span className="font-medium text-slate-900">{a.name}</span><span className="block text-xs text-slate-500">Administrator</span></span>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <button type="button" role="switch" aria-checked={a.messaging} aria-label={`Messaging for ${a.name}`} onClick={() => void setMessaging(a, !a.messaging)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${a.messaging ? "bg-[#E0A526]" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${a.messaging ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                  Messaging {a.messaging ? "on" : "off"}
                </label>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {removed.length > 0 && (
        <Fold id="removed" title="Removed" badge={String(removed.length)}>
          <ul className="space-y-1 px-4 py-3 text-sm text-slate-600">{removed.map((m) => <li key={m.id} className="flex items-center justify-between"><span>{m.name} · {m.position}</span><button type="button" className="text-xs underline" onClick={() => void setStatus(m, "approved")}>reinstate</button></li>)}</ul>
        </Fold>
      )}

      <Fold id="howto" title="What the employee does" tone="grey" summary="Install the app, sign in with name + code, punch the Time Clock.">
        <ol className="list-decimal space-y-0.5 px-4 py-3 pl-9 text-sm text-slate-700">
          <li>Installs the FIAREP app (App Store) or opens the site.</li>
          <li>Signs in with the name exactly as entered here and the 4-character code — the app opens the CPM / Inspector home with every field tool.</li>
          <li>Opens <b>Time Clock</b> and taps <b>Clock in</b> on arrival, <b>Clock out</b> when done. Each tap is time-stamped on the server.</li>
        </ol>
      </Fold>
    </div>
  );
}
