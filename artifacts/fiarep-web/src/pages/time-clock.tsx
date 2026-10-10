import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";

type Status = { config: { mobileClockEnabled: boolean; integrationEnabled: boolean; provider: string | null }; current: { direction: "in" | "out"; punchAt: string } | null; nextDirection: "in" | "out" };
type Punch = { id: string; direction: "in" | "out"; punchAt: string; source: string };

const fmt = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const hhmm = (ms: number) => { const h = Math.floor(ms / 36e5); const m = Math.floor((ms % 36e5) / 6e4); return `${h}h ${String(m).padStart(2, "0")}m`; };

/** Time clock for staff: one big button that punches in or out, the current
 * state, and this week's punches with hours. Same server clock the mobile
 * app's Attendance screen uses, so a tech can punch from either. */
export default function TimeClock() {
  const { staff } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<Punch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  async function load() {
    try {
      const [s, h] = await Promise.all([
        customFetch<Status>("/api/v1/time-clock/status", { responseType: "json" } as never),
        customFetch<Punch[]>("/api/v1/time-clock/history?limit=100", { responseType: "json" } as never),
      ]);
      setStatus(s); setHistory(h); setError("");
    } catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not load the time clock."); }
  }
  useEffect(() => { void load(); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  async function punch() {
    if (!status || busy) return;
    setBusy(true); setError("");
    try {
      await customFetch("/api/v1/time-clock/punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction: status.nextDirection, idempotencyKey: `web-${Date.now()}-${Math.random().toString(36).slice(2)}` }), responseType: "json" } as never);
      await load();
    } catch (e) { setError((e as { data?: { error?: string } })?.data?.error || (e as Error)?.message || "Could not record the punch."); }
    finally { setBusy(false); }
  }

  const clockedIn = status?.current?.direction === "in";
  const since = clockedIn && status?.current ? new Date(status.current.punchAt).getTime() : null;

  // This week (Monday to now): pair each in with the next out.
  const weekStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); })();
  const week = [...history].filter((p) => new Date(p.punchAt).getTime() >= weekStart).sort((a, b) => new Date(a.punchAt).getTime() - new Date(b.punchAt).getTime());
  let weekMs = 0; let openAt: number | null = null;
  for (const p of week) { const t = new Date(p.punchAt).getTime(); if (p.direction === "in") openAt = t; else if (openAt != null) { weekMs += t - openAt; openAt = null; } }
  if (openAt != null) weekMs += now - openAt;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">Time clock</h1>
        <p className="text-sm text-slate-500">{staff?.name}{staff?.position ? ` · ${staff.position}` : ""}</p>
      </div>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {!status ? <p className="text-slate-500">Loading…</p> : !status.config.mobileClockEnabled ? (
          <p className="text-slate-700">The time clock is not switched on for your company. Ask your office.</p>
        ) : (
          <>
            <p className={`text-sm font-semibold uppercase tracking-wide ${clockedIn ? "text-emerald-700" : "text-slate-500"}`}>{clockedIn ? "Clocked in" : "Clocked out"}</p>
            {since != null && <p className="mt-1 text-3xl font-bold tabular-nums text-slate-950">{hhmm(now - since)}</p>}
            {status.current && <p className="mt-1 text-xs text-slate-500">{clockedIn ? "since" : "last punch"} {fmt(status.current.punchAt)}</p>}
            <button type="button" onClick={() => void punch()} disabled={busy}
              className={`mt-5 h-20 w-full max-w-sm rounded-2xl text-2xl font-bold text-white shadow-md transition active:scale-[0.98] disabled:opacity-60 ${status.nextDirection === "in" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500"}`}>
              {busy ? "…" : status.nextDirection === "in" ? "Punch in" : "Punch out"}
            </button>
            <p className="mt-3 text-xs text-slate-500">Each punch is time-stamped on the server the moment you tap.</p>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-slate-900">This week</p>
          <p className="text-sm font-semibold text-slate-900">{hhmm(weekMs)}</p>
        </div>
        {week.length === 0 ? <p className="mt-2 text-sm text-slate-500">No punches yet this week.</p> : (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {[...week].reverse().map((p) => <li key={p.id} className="flex items-center justify-between py-1.5"><span className={p.direction === "in" ? "font-medium text-emerald-700" : "font-medium text-slate-700"}>{p.direction === "in" ? "In" : "Out"}</span><span className="text-slate-600">{fmt(p.punchAt)}</span></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
