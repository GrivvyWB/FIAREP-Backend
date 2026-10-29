// A city's own record for a building outside New York City (Platform Control → City Records).
export type CityRecord = { address: string; owner: string; units: number | null; value: number | null; use: string; yearBuilt: string; id: string; link: string };
export type CityViolation = { date: string; code: string; title: string; status: string; id: string; link: string };
export type CityRecords = { source: { id: string; label: string; publisher: string }; matched: string; records: CityRecord[]; violations: CityViolation[] | null; openViolations: number; retrievedAt: string };

const money = (n: number | null) => (n == null ? "" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

export function CityRecordsCard({ data }: { data: CityRecords }) {
  const units = data.records.reduce((a, r) => a + (r.units || 0), 0);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-4">
        <p className="font-semibold">{data.matched}</p>
        <p className="text-sm text-muted-foreground">{data.source.label} city records · {data.records.length} record{data.records.length === 1 ? "" : "s"}{units ? ` · ${units.toLocaleString("en-US")} units` : ""}{data.violations ? ` · ${data.openViolations} open violation${data.openViolations === 1 ? "" : "s"} of ${data.violations.length}` : ""}</p>
        <p className="mt-1 text-xs text-muted-foreground">From {data.source.publisher}. Retrieved {new Date(data.retrievedAt).toLocaleString()}.</p>
      </div>
      {data.records.length === 0 && <p className="rounded-md border bg-card p-3 text-sm text-muted-foreground">The city's records have no building at this address. Check the house number and street.</p>}
      {data.records.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Address</th><th className="p-2">Owner</th><th className="p-2 text-right">Units</th><th className="p-2 text-right">Value</th><th className="p-2">Use</th><th className="p-2">Built</th></tr></thead>
            <tbody>
              {data.records.map((r, i) => (
                <tr key={`${r.id}-${i}`} className="border-t">
                  <td className="p-2">{r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="text-[#185FA5] underline">{r.address}</a> : r.address}</td>
                  <td className="p-2">{r.owner || (data.source.id === "md" ? "On the SDAT page" : "—")}</td>
                  <td className="p-2 text-right">{r.units ?? "—"}</td>
                  <td className="p-2 text-right">{money(r.value) || "—"}</td>
                  <td className="p-2">{r.use || "—"}</td>
                  <td className="p-2">{r.yearBuilt && r.yearBuilt !== "0" ? r.yearBuilt : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.violations && data.violations.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <p className="border-b px-3 py-2 text-sm font-semibold">Violations</p>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Date</th><th className="p-2">Code</th><th className="p-2">Violation</th><th className="p-2">Status</th></tr></thead>
            <tbody>
              {data.violations.map((v, i) => (
                <tr key={`${v.id}-${i}`} className="border-t"><td className="p-2 whitespace-nowrap">{v.date}</td><td className="p-2">{v.code}</td><td className="p-2">{v.title}</td><td className={`p-2 font-medium ${/^open|in violation/i.test(v.status) ? "text-red-700" : "text-muted-foreground"}`}>{v.status}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
