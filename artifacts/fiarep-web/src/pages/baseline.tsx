import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { BaselineReport, type BAssessment } from "@/components/baseline-report";

/** Client platform (and FIAREP staff): Building Baseline reports. */
export default function BaselinePage({ owner = false }: { owner?: boolean }) {
  const base = owner ? "/api/v1/platform/baseline" : "/api/v1/baseline";
  const link = owner ? "/platform-owner/baseline" : "/baseline-report";
  const [, params] = useRoute(owner ? "/platform-owner/baseline/:id" : "/baseline-report/:id");
  const id = params?.id;
  const [list, setList] = useState<BAssessment[] | null>(null);
  const [one, setOne] = useState<BAssessment | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setErr("");
    if (id) customFetch<BAssessment>(`${base}/${encodeURIComponent(id)}`, { responseType: "json" } as never).then(setOne).catch(() => setErr("That report could not be opened."));
    else customFetch<BAssessment[]>(base, { responseType: "json" } as never).then(setList).catch(() => setErr("Baselines could not be loaded."));
  }, [id, base]);
  if (err) return <p className="p-6 text-sm text-red-700">{err}</p>;
  if (id) return one ? <div><Link href={link} className="text-sm text-[#185FA5] underline print:hidden">← All baselines</Link><BaselineReport a={one} /></div> : <p className="p-6 text-sm text-slate-500">Loading…</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Building Baseline</h1>
        <p className="text-sm text-slate-500">The onboarding walk-through of each building: every violation photographed, located, categorized and prioritized. Inspect. Prioritize. Repair. Track.</p>
      </div>
      {list === null && <p className="text-sm text-slate-500">Loading…</p>}
      {list && list.length === 0 && <p className="text-sm text-slate-500">{owner ? "No baseline assessments yet. FIAREP inspectors start them in the app (Building Baseline tile)." : "Your building baseline appears here once FIAREP completes the walk-through."}</p>}
      <div className="space-y-2">
        {list?.map((a) => (
          <Link key={a.id} href={`${link}/${a.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50">
            <p className="font-semibold text-slate-900">{a.propertyName || a.address}</p>
            <p className="text-xs text-slate-500">{a.reportId} · {a.address}{owner ? ` · ${a.clientName}` : ""}</p>
            <p className="text-sm">Health score {a.score} — {a.band} · {a.findings.length} finding{a.findings.length === 1 ? "" : "s"} · <span className={a.status === "complete" ? "text-emerald-700" : "text-amber-700"}>{a.status === "complete" ? "Complete" : "Walk-through in progress"}</span></p>
          </Link>
        ))}
      </div>
    </div>
  );
}
