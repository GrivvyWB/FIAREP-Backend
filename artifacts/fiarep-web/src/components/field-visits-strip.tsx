import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { DoorOpen } from "lucide-react";
import { OUTCOME_TONE } from "@/pages/door-visits";

type V = { id: string; at: string; address: string; staffName: string; outcome?: string; outcomeLabel: string; floor?: string; unit?: string; sentAt?: string | null };

/** Field visits on the Complaint Command: where members actually went, by building (last 30 days). */
export function FieldVisitsStrip() {
  const q = useQuery({ queryKey: ["door-visits"], queryFn: () => customFetch<V[]>("/api/v1/door-visits", { responseType: "json" } as never), refetchInterval: 60_000 });
  const since = Date.now() - 30 * 86_400_000;
  const rows = (q.data || []).filter((v) => v.sentAt && new Date(v.at).getTime() >= since);
  const byBuilding = new Map<string, V[]>();
  for (const v of rows) { const k = v.address || "Location not read"; byBuilding.set(k, [...(byBuilding.get(k) || []), v]); }
  const buildings = [...byBuilding.entries()].sort((a, b) => b[1].length - a[1].length);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><DoorOpen className="h-4 w-4 text-[#185FA5]" /> Field visits · last 30 days</p>
        <Link href="/door-visits" className="text-xs font-medium text-[#185FA5] underline">All door visits</Link>
      </div>
      {rows.length === 0 ? <p className="text-xs text-slate-500">No door visits in the last 30 days.</p> : (
        <div className="space-y-2">
          {buildings.slice(0, 8).map(([b, list]) => (
            <div key={b} className="rounded-lg border border-slate-100 px-3 py-2">
              <p className="text-sm font-semibold text-slate-900">{b} <span className="font-normal text-slate-500">· {list.length} visit{list.length === 1 ? "" : "s"}</span></p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {list.slice(0, 6).map((v) => (
                  <Link key={v.id} href={`/door-visits?id=${encodeURIComponent(v.id)}`} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_TONE[v.outcome || ""] || "bg-amber-100 text-amber-800"}`}>
                    {new Date(v.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {v.staffName} · {v.outcomeLabel}{v.unit ? ` · Apt ${v.unit}` : ""}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
