import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type Member = { id: string; name: string; position: string; code: string; status: string; hourlyRate: number | null; hours: number; shifts: number; pay: number | null; clockedInSince: string | null; lastPunch: { direction: string; at: string } | null };
type Crew = { clockEnabled: boolean; from: string; to: string; members: Member[]; totalHours: number; totalPay: number };
type Punch = { id: string; direction: string; at: string; source: string };

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const iso = (d: Date) => d.toISOString().slice(0, 10);
function thisWeek(): { from: string; to: string } { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const e = new Date(d); e.setDate(e.getDate() + 6); return { from: iso(d), to: iso(e) }; }

/** Platform Control → FIAREP crew: FIAREP's own technicians. Switch the time
 * clock on, add a person with an hourly rate, hand them the code — they log in
 * to the FIAREP app as a worker and clock in / out on the Attendance screen.
 * Hours and pay for any period come from the punches. FIAREP only. */
export default function OwnerCrew() {
  const [crew, setCrew] = useState<Crew | null>(null);
  const [range, setRange] = useState(thisWeek);
  const [error, setError] = useState("");
  const [add, setAdd] = useState({ name: "", position: "Technician", hourlyRate: "" });
  const [adding, setAdding] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string>("");
  const [punches, setPunches] = useState<Punch[]>([]);
  const [copied, setCopied] = useState("");

  async function load(r = range) {
    try { setCrew(await customFetch<Crew>(`/api/v1/platform/crew?from=${r.from}&to=${r.to}`, { responseType: "json" } as never)); setError(""); }
    catch (e) { setError((e as Error)?.message || "Could not load the crew."); }
  }
  useEffect(() => { void load(range); const t = setInterval(() => void load(range), 60_000); return () => clearInterval(t); }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const req = async (url: string, method: string, body?: unknown) => customFetch(url, { method, headers: { "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body), responseType: "json" } as never);
  const setClock = async (enabled: boolean) => { try { await req("/api/v1/platform/crew/clock", "PUT", { enabled }); await load(); } catch (e) { setError((e as Error)?.message || "Could not change the clock."); } };
  const addMember = async () => {
    if (!add.name.trim() || !Number(add.hourlyRate)) return;
    setAdding(true); setError("");
    try { await req("/api/v1/platform/crew", "POST", { name: add.name.trim(), position: add.position.trim() || "Technician", hourlyRate: Number(add.hourlyRate) }); setAdd({ name: "", position: "Technician", hourlyRate: "" }); await load(); }
    catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not add."); }
    finally { setAdding(false); }
  };
  const saveRate = async (m: Member) => { const v = Number(edits[m.id]); if (!v || v === m.hourlyRate) { setEdits((x) => { const n = { ...x }; delete n[m.id]; return n; }); return; } try { await req(`/api/v1/platform/crew/${m.id}`, "PATCH", { hourlyRate: v }); setEdits((x) => { const n = { ...x }; delete n[m.id]; return n; }); await load(); } catch (e) { setError((e as Error)?.message || "Could not save."); } };
  const setStatus = async (m: Member, status: "approved" | "revoked") => { try { await req(`/api/v1/platform/crew/${m.id}`, "PATCH", { status }); await load(); } catch (e) { setError((e as Error)?.message || "Could not update."); } };
  const resetCode = async (m: Member) => { try { await req(`/api/v1/platform/crew/${m.id}/reset-code`, "POST"); await load(); } catch (e) { setError((e as Error)?.message || "Could not reset the code."); } };
  const showPunches = async (m: Member) => { if (open === m.id) { setOpen(""); return; } setOpen(m.id); try { setPunches(await customFetch<Punch[]>(`/api/v1/platform/crew/${m.id}/punches?from=${range.from}&to=${range.to}`, { responseType: "json" } as never)); } catch { setPunches([]); } };
  const copy = async (m: Member) => { try { await navigator.clipboard.writeText(`${m.name} · code ${m.code}`); setCopied(m.id); setTimeout(() => setCopied(""), 1500); } catch { /* clipboard blocked */ } };

  const active = crew?.members.filter((m) => m.status === "approved") ?? [];
  const removed = crew?.members.filter((m) => m.status !== "approved") ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">FIAREP crew</h1>
          <p className="text-sm text-slate-500">FIAREP's own technicians. Add a person, hand them their code — they log in to the FIAREP app as a worker and clock in and out on the Attendance screen. Hours here are what the plan's labor pool is measured against.</p>
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

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Add an employee</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">Name<input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="First and last name" className="mt-1 block h-9 w-56 rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
          <label className="text-xs text-slate-600">Position<input value={add.position} onChange={(e) => setAdd({ ...add, position: e.target.value })} className="mt-1 block h-9 w-40 rounded-md border border-slate-300 px-2 text-sm text-slate-900" /></label>
          <label className="text-xs text-slate-600">Hourly rate<span className="mt-1 flex h-9 items-center rounded-md border border-slate-300 px-2 text-sm text-slate-900"><span className="text-slate-400">$</span><input type="number" min={1} step={0.5} value={add.hourlyRate} onChange={(e) => setAdd({ ...add, hourlyRate: e.target.value })} placeholder="38" className="w-20 bg-transparent px-1 text-right focus:outline-none" /><span className="text-slate-400">/hr</span></span></label>
          <Button size="sm" className="h-9 bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={adding || !add.name.trim() || !Number(add.hourlyRate)} onClick={() => void addMember()}>{adding ? "Adding…" : "Add and issue a code"}</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">The rate is what FIAREP pays the person; it never appears to clients. The sign-in code is issued the moment you add them.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Hours and pay</p>
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
                  <td className="px-4 py-2"><span className="font-medium text-slate-900">{m.name}</span><span className="block text-xs text-slate-500">{m.position}</span></td>
                  <td className="px-2 py-2"><span className="font-mono text-base font-semibold tracking-wider text-slate-900">{m.code}</span><button type="button" className="ml-2 text-xs text-slate-500 underline" onClick={() => void copy(m)}>{copied === m.id ? "copied" : "copy"}</button><button type="button" className="ml-2 text-xs text-slate-500 underline" onClick={() => void resetCode(m)}>new code</button></td>
                  <td className="px-2 py-2 text-right"><span className="inline-flex items-center gap-1"><span className="text-slate-400">$</span><input type="number" min={1} step={0.5} value={edits[m.id] ?? m.hourlyRate ?? ""} onChange={(e) => setEdits((x) => ({ ...x, [m.id]: e.target.value }))} onBlur={() => void saveRate(m)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={`h-8 w-20 rounded-md border px-2 text-right text-sm text-slate-900 ${edits[m.id] != null ? "border-amber-400 bg-amber-50" : "border-slate-300"}`} aria-label={`Hourly rate for ${m.name}`} /><span className="text-xs text-slate-400">/hr</span></span></td>
                  <td className="px-2 py-2">{m.clockedInSince ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Clocked in · {when(m.clockedInSince)}</span> : <span className="text-xs text-slate-500">Out{m.lastPunch ? ` · last ${when(m.lastPunch.at)}` : ""}</span>}</td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-900">{m.hours.toFixed(2)}<span className="block text-xs font-normal text-slate-500">{m.shifts} shift{m.shifts === 1 ? "" : "s"}</span></td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-900">{m.pay == null ? "—" : money(m.pay)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap"><button type="button" className="text-xs text-slate-600 underline" onClick={() => void showPunches(m)}>{open === m.id ? "hide punches" : "punches"}</button><span className="mx-2 text-slate-300">·</span><button type="button" className="text-xs text-slate-400 underline hover:text-rose-700" onClick={() => void setStatus(m, "revoked")}>remove</button></td>
                </tr>
                {open === m.id && (
                  <tr key={`${m.id}-p`} className="bg-slate-50"><td colSpan={7} className="px-4 py-2 text-xs text-slate-700">
                    {punches.length === 0 ? "No punches in this period." : <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-3">{punches.map((p) => <li key={p.id}><span className={p.direction === "in" ? "text-emerald-700" : "text-slate-600"}>{p.direction === "in" ? "In" : "Out"}</span> · {new Date(p.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</li>)}</ul>}
                  </td></tr>
                )}
              </>
            ))}
          </tbody>
          {active.length > 0 && <tfoot><tr className="border-t-2 border-slate-200 font-semibold text-slate-950"><td className="px-4 py-2" colSpan={4}>{crew?.from} – {crew?.to}</td><td className="px-2 py-2 text-right">{crew?.totalHours.toFixed(2)}</td><td className="px-2 py-2 text-right">{money(crew?.totalPay ?? 0)}</td><td></td></tr></tfoot>}
        </table>
        <p className="px-4 py-2 text-xs text-slate-500">Hours pair each clock-in with the next clock-out; a shift still open counts up to now. Pay = hours × rate, before taxes and overtime.</p>
      </section>

      {removed.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Removed</p>
          <ul className="mt-1 space-y-1 text-sm text-slate-600">{removed.map((m) => <li key={m.id} className="flex items-center justify-between"><span>{m.name} · {m.position}</span><button type="button" className="text-xs underline" onClick={() => void setStatus(m, "approved")}>reinstate</button></li>)}</ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">What the employee does</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>Installs the FIAREP app (App Store) or opens the site.</li>
          <li>Signs in as a worker with the name exactly as entered here and the 4-character code.</li>
          <li>Opens <b>Attendance</b> and taps <b>Clock in</b> on arrival, <b>Clock out</b> when done. Each tap is time-stamped on the server.</li>
        </ol>
      </section>
    </div>
  );
}
