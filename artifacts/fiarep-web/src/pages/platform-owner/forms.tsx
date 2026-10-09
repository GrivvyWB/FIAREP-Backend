import { useState } from "react";
import { Input } from "@/components/ui/input";
import { FORM_GROUPS } from "@/lib/forms-library";

const KIND: Record<string, string> = { form: "bg-rose-100 text-rose-700", portal: "bg-sky-100 text-sky-800", guide: "bg-slate-100 text-slate-700" };

/** Platform Control → Forms: every City form, portal and guide a job needs,
 * in the order a job runs — lookup, correct and certify, lead, dismissal,
 * DOB / OATH, AEP — with the FIAREP tool that feeds each one. */
export default function OwnerForms() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = FORM_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.use.toLowerCase().includes(needle)) })).filter((g) => g.items.length > 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Forms — everything a job needs to clear a violation</h1>
          <p className="text-sm text-slate-500">City forms, portals and guides in job order, each with where FIAREP feeds it. Links go to nyc.gov; checked October 8, 2026.</p>
        </div>
        <Input className="w-80" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search forms (AEU2, mold, lead, dismissal…)" />
      </div>
      {groups.map((g) => (
        <section key={g.title} className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">{g.title}</h2>
            <p className="mt-1 text-xs text-slate-600">{g.intro}</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {g.items.map((i) => (
                <tr key={i.url + i.name} className="border-t border-slate-100 align-top">
                  <td className="w-24 px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${KIND[i.kind]}`}>{i.kind}</span></td>
                  <td className="px-2 py-2"><a href={i.url} target="_blank" rel="noreferrer" className="font-medium text-[#185FA5] underline">{i.name}</a>{i.fiarep ? <span className="block text-xs text-amber-700">FIAREP: {i.fiarep}</span> : null}</td>
                  <td className="px-4 py-2 text-slate-700">{i.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {groups.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Nothing matches.</p>}
    </div>
  );
}
