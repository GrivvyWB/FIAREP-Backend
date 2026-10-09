import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";

type Alert = { id: string; kind: string; date: string; address: string; borough: string; company?: string; title: string; detail: string; foundAt: string; seen?: boolean };
const KIND_STYLE: Record<string, string> = { "HPD complaint": "bg-rose-600 text-white", "HPD violation": "bg-rose-100 text-rose-800", "DOB violation": "bg-amber-100 text-amber-900", "OATH / ECB summons": "bg-amber-500 text-slate-950", "311 call": "bg-sky-100 text-sky-900" };
const recent = (iso: string) => Date.now() - new Date(iso).getTime() < 48 * 3600 * 1000;

/** The strip itself: a header with the viewer's own on / off switch
 * (remembered in this browser), then the newest alerts, red and blinking
 * while new. `load` fetches the list; `isNew` decides what counts as new. */
function Strip({ storageKey, scope, menu, load, isNew, showCompany }: { storageKey: string; scope: string; menu: string; load: () => Promise<Alert[]>; isNew: (a: Alert) => boolean; showCompany?: boolean }) {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(storageKey) !== "off"; } catch { return true; } });
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { try { localStorage.setItem(storageKey, on ? "on" : "off"); } catch { /* ignore */ } }, [on, storageKey]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const run = async () => { try { const list = await load(); if (alive) { setAlerts(list); setError(""); } } catch (err: any) { if (alive) setError(err?.data?.error || err?.message || "Could not load violation alerts"); } };
    void run(); const t = setInterval(() => void run(), 60_000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  const fresh = (alerts || []).filter(isNew);
  const shown = (alerts || []).slice(0, 12);
  return (
    <section className={`rounded-xl border shadow-sm ${on && fresh.length ? "border-rose-400 bg-rose-50" : "border-slate-200 bg-white"}`} data-testid="violation-alerts-strip">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <BellRing className={`h-4 w-4 ${on && fresh.length ? "animate-pulse text-rose-600" : "text-slate-400"}`} />
          <span className="text-sm font-semibold text-slate-900">Violation alerts</span>
          {on && fresh.length > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white animate-pulse">{fresh.length} new</span>}
          <span className="text-xs text-slate-500">311 complaints, HPD / DOB violations and OATH summonses on {scope} — checked every 30 minutes</span>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">{on ? "On" : "Off"}<Switch checked={on} onCheckedChange={setOn} aria-label="Show violation alerts" /></label>
      </div>
      {on && (
        <div className="border-t border-slate-200/70 px-3 py-2">
          {error && <p className="text-xs text-rose-700">{error}</p>}
          {!error && alerts && shown.length === 0 && <p className="text-xs text-slate-500">Nothing new.</p>}
          {!error && shown.length > 0 && (
            <ul className="divide-y divide-slate-200/70">
              {shown.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-2 py-1.5 text-xs">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${isNew(a) ? "animate-pulse bg-rose-600" : "bg-slate-300"}`} />
                  <span className={`rounded-full px-1.5 py-0.5 font-semibold ${KIND_STYLE[a.kind] || "bg-slate-100 text-slate-700"}`}>{a.kind}</span>
                  <span className="text-slate-500">{a.date}</span>
                  <span className="font-semibold text-slate-900">{a.address}, {a.borough}</span>
                  {showCompany && a.company ? <span className="text-slate-500">· {a.company}</span> : null}
                  <span className="text-slate-800">— {a.title}</span>
                  <span className="basis-full pl-4 text-slate-500">{a.detail}</span>
                </li>
              ))}
            </ul>
          )}
          {alerts && alerts.length > shown.length && <p className="pt-1 text-xs text-slate-500">Showing {shown.length} of {alerts.length} — the full list is under {menu} in the menu.</p>}
        </div>
      )}
    </section>
  );
}

/** Client website → Upper Management Complaint Command. Shown only when the
 * platform owner switched on "Violation Alerts — Upper Management Complaint
 * Command" for the organization (its own switch, separate from the menu
 * page). The organization's own buildings; red for the last 48 hours. */
export function ViolationAlertsStrip() {
  const { staff, organizationModules } = useAuth();
  const role = String(staff?.role || "");
  const allowed = !!staff && organizationModules?.["violation-alerts-command"] === true && !["vendor", "resident", "procurement"].includes(role);
  if (!allowed) return null;
  return <Strip storageKey="fiarep_command_violation_alerts" scope="your buildings" menu="Violation Alerts" isNew={(a) => recent(a.foundAt)}
    load={async () => (await customFetch<{ alerts: Alert[] }>("/api/v1/violation-alerts", { responseType: "json" } as never)).alerts} />;
}

/** Platform Control dashboard: every watched client building; red until
 * marked seen on the Alerts tab. No organization switch involved. */
export function PlatformAlertsStrip() {
  return <Strip storageKey="fiarep_owner_violation_alerts" scope="every watched client building" menu="Alerts" showCompany isNew={(a) => a.seen !== true}
    load={() => customFetch<Alert[]>("/api/v1/platform/alerts", { responseType: "json" } as never)} />;
}
