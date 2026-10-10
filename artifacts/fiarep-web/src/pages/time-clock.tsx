import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";

type Status = { config: { mobileClockEnabled: boolean; integrationEnabled: boolean; provider: string | null }; current: { direction: "in" | "out"; punchAt: string } | null; nextDirection: "in" | "out" };
type Punch = { id: string; direction: "in" | "out"; punchAt: string; source: string; location?: { latitude: number; longitude: number; accuracyM: number | null; address: string | null } | null };
type Stop = { id: string; latitude: number; longitude: number; address: string | null; arrivedAt: string; leftAt: string | null };
type Tab = "clock" | "schedule" | "reports" | "timeoff" | "profile";
type LeaveRow = { id: string; version: number; development?: string | null; state?: Record<string, unknown>; createdAt: string };

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const timeLabel = (iso: string | number) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const hm = (ms: number) => { const h = Math.floor(ms / 36e5); const m = Math.floor((ms % 36e5) / 6e4); return `${h}h ${String(m).padStart(2, "0")}m`; };
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const mondayOf = (t: number) => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };

/** Worked time inside [from, to) from a list of punches; an open shift counts to `now`. */
function worked(punches: Punch[], from: number, to: number, now: number): { ms: number; shifts: Array<{ start: number; end: number | null }> } {
  const list = [...punches].sort((a, b) => new Date(a.punchAt).getTime() - new Date(b.punchAt).getTime());
  let open: number | null = null; let ms = 0; const shifts: Array<{ start: number; end: number | null }> = [];
  for (const p of list) {
    const t = new Date(p.punchAt).getTime();
    if (p.direction === "in") open = t;
    else if (open != null) { const s = Math.max(open, from), e = Math.min(t, to); if (e > s) { ms += e - s; shifts.push({ start: open, end: t }); } open = null; }
  }
  if (open != null) { const s = Math.max(open, from), e = Math.min(now, to); if (e > s) { ms += e - s; shifts.push({ start: open, end: null }); } }
  return { ms, shifts };
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Time clock for staff — the look of a punch terminal: who you are, the live
 * clock, today and this shift, one big Punch in / Punch out, this week's
 * punches, and tabs for the week's schedule, reports by week, and the profile.
 * Same server clock as the app's Attendance screen. */
export default function TimeClock() {
  const { staff, organizationName, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("clock");
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<Punch[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Time off: the person's own leave requests (the same leave-requests records the Leave page and HR use).
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [leaveDraft, setLeaveDraft] = useState({ type: "Vacation", start: "", end: "", reason: "" });
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveMsg, setLeaveMsg] = useState("");
  async function loadLeave() {
    try { const rows = await customFetch<LeaveRow[]>("/api/v1/leave-requests", { responseType: "json" } as never); setLeave((rows || []).filter((r) => { const st = r.state || {}; return st["employeeStaffId"] === staff?.id || (!st["employeeStaffId"] && String(st["employee"] || "").trim().toLowerCase() === String(staff?.name || "").trim().toLowerCase()); })); } catch { /* leave module may be off */ }
  }
  async function requestTimeOff() {
    const start = leaveDraft.start, end = leaveDraft.end || leaveDraft.start;
    if (!start) { setLeaveMsg("Pick a start date."); return; }
    if (end < start) { setLeaveMsg("The end date must be on or after the start."); return; }
    const days = Math.floor((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 864e5) + 1;
    setLeaveBusy(true); setLeaveMsg("");
    try {
      const state = { employee: staff?.name || "", employeeStaffId: staff?.id, type: leaveDraft.type, startAt: `${start}T09:00`, endAt: `${end}T17:00`, returnAt: "", startDate: start, endDate: end, days, reason: leaveDraft.reason.trim(), reasonableAccommodation: "", coveredByStaffId: "", title: `${staff?.name || "Staff"} leave`, status: "Pending" };
      await customFetch("/api/v1/leave-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: crypto.randomUUID(), state, version: 1, development: staff?.developments?.[0] }), responseType: "json" } as never);
      setLeaveDraft({ type: "Vacation", start: "", end: "", reason: "" }); setLeaveMsg("Request sent to your supervisor."); await loadLeave();
    } catch (e) { setLeaveMsg((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not send the request."); }
    finally { setLeaveBusy(false); }
  }

  async function load() {
    try {
      const [s, h] = await Promise.all([
        customFetch<Status>("/api/v1/time-clock/status", { responseType: "json" } as never),
        customFetch<Punch[]>("/api/v1/time-clock/history?limit=100", { responseType: "json" } as never),
      ]);
      setStatus(s); setHistory(h); setError("");
      try { const from = new Date(); from.setDate(from.getDate() - 7); setStops(await customFetch<Stop[]>(`/api/v1/time-clock/locations?from=${encodeURIComponent(from.toISOString())}`, { responseType: "json" } as never)); } catch { /* optional */ }
    } catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not load the time clock."); }
  }
  useEffect(() => { void load(); void loadLeave(); const t = setInterval(() => setNow(Date.now()), 1000); const r = setInterval(() => void load(), 60_000); return () => { clearInterval(t); clearInterval(r); }; }, []);

  /** The browser's position, if the person allows it — sent with the punch so the record shows where it was made. */
  function wherever(): Promise<{ latitude: number; longitude: number; accuracyM: number } | null> {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) { resolve(null); return; }
      const done = (v: { latitude: number; longitude: number; accuracyM: number } | null) => resolve(v);
      navigator.geolocation.getCurrentPosition((pos) => done({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: pos.coords.accuracy }), () => done(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    });
  }
  async function punch() {
    if (!status || busy) return;
    setBusy(true); setError("");
    try {
      const location = await wherever();
      await customFetch("/api/v1/time-clock/punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction: status.nextDirection, idempotencyKey: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`, location }), responseType: "json" } as never);
      await load();
    } catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not record the punch."); }
    finally { setBusy(false); }
  }

  const clockedIn = status?.current?.direction === "in";
  const since = clockedIn && status?.current ? new Date(status.current.punchAt).getTime() : null;
  const today = worked(history, startOfDay(now), startOfDay(now) + 864e5, now);
  const weekStart = mondayOf(now);
  const week = worked(history, weekStart, weekStart + 7 * 864e5, now);
  const weekPunches = history.filter((p) => new Date(p.punchAt).getTime() >= weekStart).sort((a, b) => new Date(b.punchAt).getTime() - new Date(a.punchAt).getTime());
  const lastOut = [...history].filter((p) => p.direction === "out").sort((a, b) => new Date(b.punchAt).getTime() - new Date(a.punchAt).getTime())[0];

  // Schedule: this week by day, from the punches (what was actually worked).
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const from = weekStart + i * 864e5; const w = worked(history, from, from + 864e5, now); return { from, ...w }; }), [history, weekStart, now]);
  // Reports: the last 6 weeks.
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, i) => { const from = weekStart - i * 7 * 864e5; const w = worked(history, from, from + 7 * 864e5, now); return { from, ...w }; }), [history, weekStart, now]);

  const sec = new Date(now).getSeconds();
  const ringDeg = (sec / 60) * 360;
  const clockText = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const ampm = clockText.replace(/^[\d:]+\s?/, ""); const hhmm = clockText.replace(/\s?[AP]M$/i, "");
  const enabled = status?.config.mobileClockEnabled;

  const Pill = ({ dir }: { dir: "in" | "out" }) => <span className={`inline-flex w-16 items-center justify-center rounded-full px-2 py-1 text-xs font-extrabold tracking-wide text-white ${dir === "in" ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]" : "bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.6)]"}`}>{dir === "in" ? "IN" : "OUT"} →</span>;
  const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`rounded-2xl border border-sky-500/30 bg-[#0d1b3a]/80 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.08),0_0_24px_rgba(37,99,235,0.15)] ${className}`}>{children}</div>;

  return (
    <div className="min-h-[100dvh] bg-[#060b1c] text-white" style={{ backgroundImage: "radial-gradient(60% 40% at 80% 0%, rgba(239,68,68,0.18), transparent 60%), radial-gradient(50% 35% at 0% 20%, rgba(37,99,235,0.22), transparent 60%)" }}>
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 pb-24 pt-5">
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-full border-[3px] border-sky-400 bg-[#13234a] text-2xl font-extrabold text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.5)]">{initials(staff?.name || "?")}</div>
          <div className="min-w-0">
            <p className="truncate text-2xl font-extrabold leading-tight">{staff?.name}</p>
            <p className="text-sm text-sky-200/80">{staff?.position || "Staff"}</p>
          </div>
        </div>

        {error && <p className="mt-3 rounded-xl border border-rose-400/50 bg-rose-900/40 px-3 py-2 text-sm text-rose-100">{error}</p>}

        {tab === "clock" && (
          <>
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
              <Card className="px-2 py-4 text-center">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto text-sky-300" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-sky-200/80">Today</p>
                <p className="whitespace-nowrap text-lg font-extrabold tabular-nums">{hm(today.ms)}</p>
                <p className="text-[11px] text-sky-200/60">Total hours</p>
              </Card>
              <div className="relative grid h-44 w-44 place-items-center">
                <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(from 0deg, #38bdf8 0deg, #2563eb ${ringDeg}deg, rgba(56,189,248,0.15) ${ringDeg}deg 360deg)`, filter: "drop-shadow(0 0 14px rgba(56,189,248,0.7))" }} />
                <div className="absolute inset-[7px] rounded-full bg-[#0a1430]" />
                <div className="absolute right-3 top-3 h-5 w-5 rounded-full bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.9)]" />
                <div className="relative text-center">
                  <p className={`text-[11px] font-extrabold uppercase tracking-widest ${clockedIn ? "text-emerald-400" : "text-slate-400"}`}><span className={`mr-1 inline-block h-2 w-2 rounded-full ${clockedIn ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-slate-500"}`} />{clockedIn ? "Clocked in" : "Clocked out"}</p>
                  <p className="font-mono text-4xl font-extrabold tabular-nums leading-none">{hhmm}<span className="ml-1 align-top text-sm font-bold">{ampm}</span></p>
                  <p className="mt-1 text-xs text-sky-200/80">{new Date(now).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</p>
                </div>
              </div>
              <Card className="px-2 py-4 text-center">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto text-sky-300" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-sky-200/80">Shift</p>
                {since != null ? <><p className="whitespace-nowrap text-lg font-extrabold tabular-nums">{timeLabel(since)}</p><p className="whitespace-nowrap text-[11px] text-sky-100">{hm(now - since)} so far</p></> : lastOut ? <><p className="text-base font-extrabold">Off</p><p className="text-[11px] text-sky-200/60">last out {timeLabel(lastOut.punchAt)}</p></> : <p className="text-base font-extrabold">Off</p>}
              </Card>
            </div>

            {!status ? <p className="mt-6 text-center text-sky-200/70">Loading…</p> : !enabled ? (
              <p className="mt-6 rounded-xl border border-sky-500/30 bg-[#0d1b3a] px-4 py-3 text-center text-sm text-sky-100">The time clock is not switched on for {organizationName || "your company"}. Ask your office.</p>
            ) : (
              <button type="button" onClick={() => void punch()} disabled={busy}
                className={`mt-6 flex h-24 w-full items-center justify-center gap-4 rounded-full border-2 text-3xl font-extrabold uppercase tracking-wide text-white transition active:scale-[0.98] disabled:opacity-60 ${status.nextDirection === "in" ? "border-emerald-300/70 bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-[0_0_32px_rgba(16,185,129,0.6)]" : "border-rose-300/70 bg-gradient-to-r from-rose-600 to-red-500 shadow-[0_0_32px_rgba(244,63,94,0.6)]"}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 11a3 3 0 0 0-3 3v2M12 11a3 3 0 0 1 3 3v4M12 7a7 7 0 0 0-7 7v2M12 7a7 7 0 0 1 7 7M12 3a11 11 0 0 0-9 4.7M12 3a11 11 0 0 1 9 4.7M9 20a7 7 0 0 1-2-3"/></svg>
                <span className="border-l border-white/40 pl-4">{busy ? "…" : status.nextDirection === "in" ? "Punch in" : "Punch out"} →</span>
              </button>
            )}
            <p className="mt-3 rounded-full border border-sky-500/30 bg-[#0d1b3a]/80 px-4 py-2 text-center text-xs text-sky-100/90">Each punch is time-stamped on the server the moment you tap, with where you are.</p>

            <Card className="mt-4 p-4">
              <div className="flex items-center justify-between">
                <p className="text-lg font-extrabold">This week</p>
                <span className="rounded-full border border-sky-400/40 px-3 py-1 text-right text-sm font-extrabold tabular-nums">{hm(week.ms)}<span className="block text-[10px] font-semibold text-sky-200/70">Total hours</span></span>
              </div>
              {weekPunches.length === 0 ? <p className="mt-3 text-sm text-sky-200/70">No punches yet this week.</p> : (
                <ul className="mt-2 divide-y divide-sky-500/20">
                  {weekPunches.map((p) => <li key={p.id} className="flex items-center gap-4 py-2.5"><Pill dir={p.direction} /><span className="flex-1"><span className="block text-sm font-semibold">{dayLabel(p.punchAt)}</span><span className="block text-xs text-sky-200/70">{timeLabel(p.punchAt)}{p.location?.address ? ` · ${p.location.address}` : p.location ? ` · ${p.location.latitude.toFixed(4)}, ${p.location.longitude.toFixed(4)}` : ""}</span></span></li>)}
                </ul>
              )}
            </Card>

            {(clockedIn || stops.length > 0) && (
              <Card className="mt-4 p-4">
                <p className="text-lg font-extrabold">Where you've been</p>
                <p className="text-xs text-sky-200/70">On the clock, the app notes each place you stay more than 30 minutes — arrival and departure.</p>
                {stops.length === 0 ? <p className="mt-2 text-sm text-sky-200/70">Nothing recorded yet{clockedIn ? " this shift" : ""}.</p> : (
                  <ul className="mt-2 divide-y divide-sky-500/20">
                    {stops.slice(0, 12).map((st) => { const a = new Date(st.arrivedAt).getTime(); const l = st.leftAt ? new Date(st.leftAt).getTime() : now; return (
                      <li key={st.id} className="py-2.5 text-sm">
                        <span className="block font-semibold">{st.address || `${st.latitude.toFixed(4)}, ${st.longitude.toFixed(4)}`}</span>
                        <span className="block text-xs text-sky-200/70">{dayLabel(st.arrivedAt)} · {timeLabel(st.arrivedAt)} – {st.leftAt ? timeLabel(st.leftAt) : "still here"} · {hm(l - a)}</span>
                      </li>
                    ); })}
                  </ul>
                )}
              </Card>
            )}
          </>
        )}

        {tab === "schedule" && (
          <Card className="mt-4 p-4">
            <p className="text-lg font-extrabold">This week</p>
            <p className="text-xs text-sky-200/70">{new Date(weekStart).toLocaleDateString([], { month: "short", day: "numeric" })} – {new Date(weekStart + 6 * 864e5).toLocaleDateString([], { month: "short", day: "numeric" })} · shifts as worked</p>
            <ul className="mt-2 divide-y divide-sky-500/20">
              {days.map((d) => { const isToday = d.from === startOfDay(now); return (
                <li key={d.from} className={`flex items-start gap-3 py-2.5 ${isToday ? "text-white" : "text-sky-100/80"}`}>
                  <span className={`w-12 rounded-lg py-1 text-center text-xs font-extrabold ${isToday ? "bg-sky-500 text-white" : "bg-[#13234a]"}`}>{DAY[new Date(d.from).getDay()]}<span className="block text-[10px] font-semibold opacity-80">{new Date(d.from).getDate()}</span></span>
                  <span className="flex-1 text-sm">{d.shifts.length === 0 ? <span className="text-sky-200/50">—</span> : d.shifts.map((s, i) => <span key={i} className="block">{timeLabel(s.start)} – {s.end == null ? "now" : timeLabel(s.end)}</span>)}</span>
                  <span className="text-sm font-extrabold tabular-nums">{d.ms ? hm(d.ms) : ""}</span>
                </li>
              ); })}
            </ul>
            <p className="mt-3 border-t border-sky-500/20 pt-2 text-right text-sm font-extrabold">Week {hm(week.ms)}</p>
          </Card>
        )}

        {tab === "reports" && (
          <Card className="mt-4 p-4">
            <p className="text-lg font-extrabold">Reports</p>
            <p className="text-xs text-sky-200/70">Hours by week, from your punches.</p>
            <ul className="mt-2 divide-y divide-sky-500/20">
              {weeks.map((w) => <li key={w.from} className="flex items-center justify-between py-2.5 text-sm"><span>{new Date(w.from).toLocaleDateString([], { month: "short", day: "numeric" })} – {new Date(w.from + 6 * 864e5).toLocaleDateString([], { month: "short", day: "numeric" })}<span className="block text-xs text-sky-200/60">{w.shifts.length} shift{w.shifts.length === 1 ? "" : "s"}</span></span><span className="font-extrabold tabular-nums">{hm(w.ms)}</span></li>)}
            </ul>
            <p className="mt-3 text-xs text-sky-200/60">Pay is worked out by your office from these hours and your rate.</p>
          </Card>
        )}

        {tab === "timeoff" && (
          <>
            <Card className="mt-4 p-4">
              <p className="text-lg font-extrabold">Request time off</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <label className="col-span-2 text-xs text-sky-200/80">Type
                  <select value={leaveDraft.type} onChange={(e) => setLeaveDraft({ ...leaveDraft, type: e.target.value })} className="mt-1 block h-11 w-full rounded-xl border border-sky-500/40 bg-[#0a1430] px-3 text-base text-white">
                    {["Vacation", "Sick", "Personal", "Bereavement", "Jury duty", "Other"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="text-xs text-sky-200/80">First day<input type="date" value={leaveDraft.start} onChange={(e) => setLeaveDraft({ ...leaveDraft, start: e.target.value })} className="mt-1 block h-11 w-full rounded-xl border border-sky-500/40 bg-[#0a1430] px-3 text-base text-white" /></label>
                <label className="text-xs text-sky-200/80">Last day<input type="date" value={leaveDraft.end} min={leaveDraft.start || undefined} onChange={(e) => setLeaveDraft({ ...leaveDraft, end: e.target.value })} className="mt-1 block h-11 w-full rounded-xl border border-sky-500/40 bg-[#0a1430] px-3 text-base text-white" /></label>
                <label className="col-span-2 text-xs text-sky-200/80">Reason (optional)<textarea value={leaveDraft.reason} onChange={(e) => setLeaveDraft({ ...leaveDraft, reason: e.target.value })} rows={2} className="mt-1 block w-full rounded-xl border border-sky-500/40 bg-[#0a1430] px-3 py-2 text-base text-white" /></label>
              </div>
              {leaveMsg && <p className={`mt-2 text-sm ${leaveMsg.startsWith("Request sent") ? "text-emerald-400" : "text-rose-300"}`}>{leaveMsg}</p>}
              <button type="button" onClick={() => void requestTimeOff()} disabled={leaveBusy || !leaveDraft.start} className="mt-3 h-14 w-full rounded-full border-2 border-sky-300/70 bg-gradient-to-r from-sky-600 to-blue-500 text-lg font-extrabold uppercase tracking-wide text-white shadow-[0_0_24px_rgba(56,189,248,0.5)] disabled:opacity-50">{leaveBusy ? "Sending…" : "Send request →"}</button>
            </Card>
            <Card className="mt-4 p-4">
              <p className="text-lg font-extrabold">My requests</p>
              {leave.length === 0 ? <p className="mt-2 text-sm text-sky-200/70">No requests yet.</p> : (
                <ul className="mt-2 divide-y divide-sky-500/20">
                  {[...leave].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => { const st = r.state || {}; const status = String(st["status"] || "Pending"); return (
                    <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className={`inline-flex w-20 justify-center rounded-full px-2 py-1 text-xs font-extrabold text-white ${status === "Approved" ? "bg-emerald-500" : status === "Denied" ? "bg-rose-500" : "bg-amber-500 text-slate-950"}`}>{status === "Approved" ? "APPROVED" : status === "Denied" ? "DENIED" : "PENDING"}</span>
                      <span className="flex-1"><span className="block font-semibold">{String(st["type"] || "Time off")} · {String(st["startDate"] || String(st["startAt"] || "").slice(0, 10))}{st["endDate"] && st["endDate"] !== st["startDate"] ? ` – ${String(st["endDate"])}` : ""}</span>{Boolean(st["reason"]) && <span className="block text-xs text-sky-200/70">{String(st["reason"])}</span>}</span>
                      <span className="text-xs text-sky-200/70">{Number(st["days"]) || 1}d</span>
                    </li>
                  ); })}
                </ul>
              )}
            </Card>
          </>
        )}

        {tab === "profile" && (
          <Card className="mt-4 p-4">
            <p className="text-lg font-extrabold">{staff?.name}</p>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-sky-200/70">Position</dt><dd className="font-semibold">{staff?.position || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-sky-200/70">Company</dt><dd className="font-semibold">{organizationName || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-sky-200/70">Status</dt><dd className={`font-semibold ${clockedIn ? "text-emerald-400" : ""}`}>{clockedIn ? `Clocked in since ${timeLabel(since!)}` : "Clocked out"}</dd></div>
              <div className="flex justify-between"><dt className="text-sky-200/70">This week</dt><dd className="font-semibold tabular-nums">{hm(week.ms)}</dd></div>
            </dl>
            <button type="button" onClick={logout} className="mt-4 w-full rounded-xl border border-rose-400/50 bg-rose-900/30 py-2.5 text-sm font-bold text-rose-100">Sign out</button>
          </Card>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-sky-500/30 bg-[#070e24]/95 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {([["clock", "Clock"], ["schedule", "Schedule"], ["reports", "Reports"], ["timeoff", "Time off"], ["profile", "Profile"]] as Array<[Tab, string]>).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`flex flex-col items-center gap-1 py-3 text-xs font-semibold ${tab === k ? "text-sky-300" : "text-sky-100/60"}`}>
              <span className={`h-0.5 w-8 rounded-full ${tab === k ? "bg-sky-400" : "bg-transparent"}`} />
              {k === "clock" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>}
              {k === "schedule" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>}
              {k === "reports" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h6"/></svg>}
              {k === "timeoff" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 14l6-3 9-8 3 3-8 9-3 6z"/><path d="M9 11l4 4"/></svg>}
              {k === "profile" && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>}
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
