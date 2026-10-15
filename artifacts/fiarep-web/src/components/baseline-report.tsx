// FIAREP Building Baseline Report — the printable report (client platform and
// Platform Control). Print / Save as PDF uses the browser's print.
export type BFinding = {
  id: string; code?: string; area: string; floor: string; unit: string; wall: string; issue: string; description: string; trade: string;
  priority: "Critical" | "High" | "Medium" | "Low"; time: string; action: string; tools: string[]; materials: string[]; fixtures: string[];
  photos: string[]; existing: boolean; sourceRef: string; status: "open" | "repaired";
};
export type BAssessment = {
  id: string; reportId: string; clientName: string; propertyName: string; address: string; ownerCompany: string; buildingType: string; units: number | null;
  inspectionDate: string; inspector: string; areas: Record<string, boolean>; findings: BFinding[]; status: string;
  signatures: { inspector: string; representative: string; date: string }; photoUrls: Record<string, string>; areaGroups: Record<string, string[]>; areaNotes?: Record<string, { note: string; photos: string[] }>;
  score: number; band: string; counts: Record<string, number>; roadmap: { immediate: number; shortTerm: number; longTerm: number };
};

const LEVELS = [
  { p: "Critical", n: 1, title: "Priority Level 1 - Immediate Action Required", note: "Life safety hazards, active leaks, structural concerns, electrical hazards, gas-related issues, or conditions likely to cause further damage.", color: "#b91c1c" },
  { p: "High", n: 2, title: "Priority Level 2 - High Priority", note: "Conditions requiring prompt attention to avoid escalation, tenant complaints, or future violations.", color: "#c2410c" },
  { p: "Medium", n: 3, title: "Priority Level 3 - Medium Priority", note: "Maintenance deficiencies requiring correction but not posing an immediate threat.", color: "#b45309" },
  { p: "Low", n: 4, title: "Priority Level 4 - Low Priority", note: "Cosmetic or non-urgent maintenance items.", color: "#166534" },
] as const;
const BAND = { Excellent: "🟢", Good: "🟡", Fair: "🟠", Poor: "🔴" } as Record<string, string>;
const TRADES = ["Plumbing", "Electrical", "Carpentry", "Roofing", "Masonry", "Painting", "HVAC", "General Maintenance"];
const box = (on: boolean) => (on ? "☑" : "☐");
const where = (f: BFinding) => [f.area, f.floor && `Floor ${f.floor}`, f.unit && `Unit ${f.unit}`, f.wall].filter(Boolean).join(" · ") || "—";

export function BaselineReport({ a }: { a: BAssessment }) {
  const H = "mt-6 text-lg font-bold text-slate-900";
  return (
    <div className="mx-auto max-w-4xl space-y-2 bg-white p-6 text-sm text-slate-800 print:p-0">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${a.status === "complete" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{a.status === "complete" ? "Complete" : "Walk-through in progress"}</span>
        <button type="button" onClick={() => window.print()} className="rounded-md bg-[#185FA5] px-3 py-1.5 text-sm font-semibold text-white">Print / Save as PDF</button>
      </div>
      <h1 className="text-2xl font-extrabold text-[#0B2A4A]">FIAREP Building Baseline Report</h1>
      <h2 className={H}>Building Information</h2>
      <table className="w-full"><tbody>
        {[["Property Name", a.propertyName], ["Building Address", a.address], ["Owner/Management Company", a.ownerCompany], ["Number of Units", a.units != null ? String(a.units) : ""], ["Inspection Date", a.inspectionDate], ["Inspected by", a.inspector], ["Report ID", a.reportId]].map(([k, v]) => (
          <tr key={k} className="border-t border-slate-100"><td className="w-64 py-1 font-semibold">{k}</td><td className="py-1">{v || "—"}</td></tr>
        ))}
        <tr className="border-t border-slate-100"><td className="py-1 font-semibold">Building Type</td><td className="py-1">{["Residential", "Mixed Use", "Commercial"].map((t) => `${box(a.buildingType === t)} ${t}`).join("   ")}</td></tr>
      </tbody></table>

      <h2 className={H}>Executive Summary</h2>
      <p>This Baseline Building Assessment establishes the property's initial condition upon enrollment into FIAREP. A comprehensive walk-through inspection was performed to identify existing violations, maintenance deficiencies, safety concerns, and compliance issues throughout the building.</p>
      <p>All identified conditions have been documented, photographed, categorized, prioritized, and archived within the FIAREP platform. This report serves as the property's starting baseline for future complaint management, repair tracking, compliance monitoring, and asset preservation.</p>

      <h2 className={H}>Building Health Score</h2>
      <div className="flex items-center gap-5 rounded-lg border border-slate-200 p-4">
        <div className="text-5xl font-black" style={{ color: a.score >= 90 ? "#166534" : a.score >= 75 ? "#a16207" : a.score >= 60 ? "#c2410c" : "#b91c1c" }}>{a.score}</div>
        <div>
          <p className="font-bold">Overall Building Condition: {BAND[a.band]} {a.band}</p>
          <p className="text-xs text-slate-500">🟢 Excellent (90-100) · 🟡 Good (75-89) · 🟠 Fair (60-74) · 🔴 Poor (Below 60)</p>
          <p className="text-xs text-slate-500">Score: 100 less 15 per critical, 7 per high, 3 per medium and 1 per low finding still open.</p>
        </div>
      </div>

      <h2 className={H}>Inspection Areas Reviewed</h2>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-3">
        {Object.entries(a.areaGroups).map(([g, list]) => (
          <div key={g}><p className="font-semibold">{g}</p>{list.map((ar) => <p key={ar}>{box(!!a.areas[ar])} {ar}</p>)}</div>
        ))}
      </div>
      {Object.values(a.areaGroups).flat().filter((ar) => a.areaNotes?.[ar]?.note || a.areaNotes?.[ar]?.photos.length).map((ar) => (
        <div key={ar} className="mt-4 break-inside-avoid rounded-md border border-slate-200 p-3">
          <p className="font-semibold">{ar}</p>
          {a.areaNotes![ar]!.note && <p className="mt-1 whitespace-pre-wrap text-sm">{a.areaNotes![ar]!.note}</p>}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {a.areaNotes![ar]!.photos.map((p) => a.photoUrls[p] ? <img key={p} src={a.photoUrls[p]} alt={ar} className="w-full rounded-md border border-slate-200" /> : null)}
          </div>
        </div>
      ))}

      <h2 className={H}>Priority Violation Summary</h2>
      {LEVELS.map((lv) => {
        const rows = a.findings.filter((f) => f.priority === lv.p);
        return (
          <div key={lv.p} className="break-inside-avoid">
            <p className="mt-3 font-bold" style={{ color: lv.color }}>{lv.title}</p>
            <p className="text-xs text-slate-500">{lv.note}</p>
            <table className="mt-1 w-full border border-slate-200 text-xs">
              <thead><tr className="bg-slate-50 text-left"><th className="p-1.5">ID</th><th className="p-1.5">Location</th><th className="p-1.5">Issue</th><th className="p-1.5">Trade</th><th className="p-1.5">Priority</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td className="p-1.5 text-slate-400" colSpan={5}>None</td></tr>}
                {rows.map((f) => <tr key={f.id} className="border-t border-slate-100"><td className="p-1.5 font-semibold">{f.code}</td><td className="p-1.5">{where(f)}</td><td className="p-1.5">{f.issue}{f.status === "repaired" ? " ✅" : ""}</td><td className="p-1.5">{f.trade}</td><td className="p-1.5">{lv.p}</td></tr>)}
              </tbody>
            </table>
          </div>
        );
      })}

      <h2 className={H}>Violation Detail Pages</h2>
      {a.findings.map((f) => (
        <div key={f.id} className="break-inside-avoid rounded-lg border border-slate-200 p-4 print:break-before-page">
          <p className="font-bold">Violation ID: FIAREP-{f.code}{f.existing ? ` · Existing known violation${f.sourceRef ? " (" + f.sourceRef + ")" : ""}` : " · Newly identified"}</p>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <p className="font-semibold">Location</p>
              <p>Building Area: {f.area || "—"}<br />Floor: {f.floor || "—"}<br />Unit: {f.unit || "—"}<br />Wall/Area: {f.wall || "—"}</p>
              <p className="font-semibold">Issue Detected</p><p>{f.issue}</p>
              {!!f.description && <><p className="font-semibold">Description</p><p>{f.description}</p></>}
              <p className="font-semibold">Recommended Trade</p><p>{TRADES.map((t) => `${box(f.trade === t)} ${t}`).join("  ")}</p>
              <p className="font-semibold">Priority Rating</p><p>{["Critical", "High", "Medium", "Low"].map((p) => `${box(f.priority === p)} ${p}`).join("  ")}</p>
              <p><b>Estimated Repair Time:</b> {f.time || "—"}</p>
              <p><b>Recommended Action:</b> {f.action || "—"}</p>
              <p><b>Tools Suggested:</b> {f.tools.join(", ") || "—"}</p>
              <p><b>Materials Suggested:</b> {f.materials.join(", ") || "—"}</p>
              <p><b>Fixtures Suggested:</b> {f.fixtures.join(", ") || "—"}</p>
              <p><b>Repair Status:</b> {f.status === "repaired" ? "Repaired" : "Open"}</p>
            </div>
            <div>
              <p className="font-semibold">Photo Documentation</p>
              <p className="text-xs">Before Photos Attached: {box(f.photos.length > 0)} Yes {box(f.photos.length === 0)} No</p>
              {f.photos.map((p) => a.photoUrls[p] ? <img key={p} src={a.photoUrls[p]} alt={f.issue} className="mt-2 w-full rounded-md border border-slate-200" /> : null)}
            </div>
          </div>
        </div>
      ))}

      <h2 className={H}>FIAREP Repair Roadmap</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-red-50 p-3"><p className="font-semibold">Immediate Repairs (0-7 Days)</p><p className="text-2xl font-bold">{a.roadmap.immediate}</p></div>
        <div className="rounded-lg bg-orange-50 p-3"><p className="font-semibold">Short-Term Repairs (7-30 Days)</p><p className="text-2xl font-bold">{a.roadmap.shortTerm}</p></div>
        <div className="rounded-lg bg-lime-50 p-3"><p className="font-semibold">Long-Term Repairs (30-90 Days)</p><p className="text-2xl font-bold">{a.roadmap.longTerm}</p></div>
      </div>

      <h2 className={H}>Baseline Asset Archive</h2>
      <p>All identified conditions have been stored within the FIAREP Building Archive and linked to: building profile · unit location · repair history · future resident complaints · work orders · inspection records · compliance tracking.</p>
      <p>Future resident complaints will automatically be compared against this baseline data to determine: ✅ Existing condition ✅ New condition ✅ Reoccurring issue ✅ Escalating issue ✅ Repair verification status.</p>

      <h2 className={H}>FIAREP Baseline Assessment Certification</h2>
      <p>The building walk-through inspection has been completed and all observed conditions have been documented and entered into the FIAREP platform. This report establishes the property's initial operating condition and serves as the foundation for ongoing compliance, maintenance, repair management, and resident complaint tracking.</p>
      <p className="mt-2">Inspector Signature: <b>{a.signatures.inspector || "___________________"}</b></p>
      <p>Property Representative: <b>{a.signatures.representative || "___________________"}</b></p>
      <p>Date: <b>{a.signatures.date || "___________________"}</b></p>
      <div className="mt-6 text-center italic text-slate-500"><p>FIAREP Motto</p><p>"Inspect. Prioritize. Repair. Track."</p><p>"Building Baselines Create Better Buildings."</p></div>
    </div>
  );
}
