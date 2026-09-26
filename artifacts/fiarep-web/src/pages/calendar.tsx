import { sameTitle, supervisedTradeForPosition } from "@/lib/titles";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, ClipboardCheck, FolderKanban, Loader2, Plane, Wrench, FileSearch } from "lucide-react";
import { Link } from "wouter";
import { getListEntityRecordsQueryKey, useListEntityRecords } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import type { Staff } from "@workspace/api-client-react";

type RecordItem = { id: string; development?: string | null; state?: Record<string, unknown>; createdAt?: string; updatedAt?: string };
type CalendarItem = RecordItem & { category: Category; label: string; href: string; start: Date; end: Date };
type Category = "Projects" | "Inspections" | "Resident reports" | "Emergency jobs" | "Elevator jobs" | "Leave requests";
const categories: Category[] = ["Projects", "Inspections", "Resident reports", "Emergency jobs", "Elevator jobs", "Leave requests"];
const meta: Record<Category, { entity: string; href: string; icon: typeof FolderKanban; color: string }> = {
  Projects: { entity: "projects", href: "/projects", icon: FolderKanban, color: "bg-[#dce7f1] text-[#526b80]" },
  Inspections: { entity: "inspections", href: "/inspections", icon: ClipboardCheck, color: "bg-[#fff5d6] text-[#b17d00]" },
  "Resident reports": { entity: "resident-reports", href: "/reports", icon: FileSearch, color: "bg-[#e6e0f1] text-[#69558d]" },
  "Emergency jobs": { entity: "emergency-jobs", href: "/emergency", icon: AlertTriangle, color: "bg-[#f8dfdf] text-[#a44949]" },
  "Elevator jobs": { entity: "elevator-jobs", href: "/elevators", icon: Wrench, color: "bg-[#dcefe9] text-[#367461]" },
  "Leave requests": { entity: "leave-requests", href: "/leave", icon: Plane, color: "bg-[#e4e8f7] text-[#5265a0]" },
};

const value = (s: Record<string, unknown>, keys: string[]) => keys.map((key) => s[key]).find((v) => v !== undefined && v !== null && String(v).trim() !== "");
const parseDate = (input: unknown, fallback: string | undefined) => {
  const date = new Date(String(input || fallback || ""));
  return Number.isNaN(date.getTime()) ? null : date;
};
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const displayDate = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * Keep the calendar's source list in step with the entity-level read policy.
 * The API remains authoritative (and still filters individual records), but
 * avoiding requests for entities a role can never read prevents expected 403s
 * from being presented as broken calendar sources.
 */
function canReadCalendarEntity(staff: Staff | null, entity: string): boolean {
  if (!staff) return false;
  if (staff.role === "emergency") {
    if (entity === "emergency-jobs") return true;
    if (staff.position !== "Maintenance Worker") return false;
  }
  if (entity === "emergency-jobs") {
    return staff.role === "administrator" ||
      staff.role === "management" ||
      staff.position === "Borough Director";
  }
  if (entity === "elevator-jobs") {
    return staff.role === "administrator" ||
      staff.role === "management" ||
      staff.position === "Borough Director" ||
      (["worker", "inspector"].includes(staff.role) &&
        (sameTitle(staff.position, "Elevator Service") ||
          supervisedTradeForPosition(staff.position) === "Elevator Service" ||
          (staff.role === "inspector" && staff.position === "CPM")));
  }
  return true;
}

function normalize(record: RecordItem, category: Category): CalendarItem | null {
  const s = record.state || {};
  const start = parseDate(value(s, ["startDate", "scheduledDate", "date", "dueDate", "inspectionDate", "eventDate", "appointmentDate", "plannedDate"]), record.updatedAt || record.createdAt);
  if (!start) return null;
  const end = parseDate(value(s, ["endDate", "finishDate"]), start.toISOString()) || start;
  const m = meta[category];
  const href = category === "Resident reports" || category === "Inspections"
    ? `${m.href}?id=${encodeURIComponent(record.id)}`
    : m.href;
  return { ...record, category, label: String(value(s, ["title", "name", "description", "reason", "issue"]) || `${category} record`), href, start, end };
}

export default function Calendar() {
  const { staff } = useAuth();
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [filter, setFilter] = useState<"All" | Category>("All");
  const options = (entity: string) => ({
    query: {
      queryKey: getListEntityRecordsQueryKey(entity),
      enabled: canReadCalendarEntity(staff, entity),
      refetchInterval: 30_000,
      staleTime: 10_000,
      refetchOnMount: "always" as const,
    },
  });
  const projects = useListEntityRecords("projects", undefined, options("projects"));
  const inspections = useListEntityRecords("inspections", undefined, options("inspections"));
  const reports = useListEntityRecords("resident-reports", undefined, options("resident-reports"));
  const emergencies = useListEntityRecords("emergency-jobs", undefined, options("emergency-jobs"));
  const elevators = useListEntityRecords("elevator-jobs", undefined, options("elevator-jobs"));
  const leave = useListEntityRecords("leave-requests", undefined, options("leave-requests"));
  const sources = [
    { query: projects, enabled: canReadCalendarEntity(staff, "projects") },
    { query: inspections, enabled: canReadCalendarEntity(staff, "inspections") },
    { query: reports, enabled: canReadCalendarEntity(staff, "resident-reports") },
    { query: emergencies, enabled: canReadCalendarEntity(staff, "emergency-jobs") },
    { query: elevators, enabled: canReadCalendarEntity(staff, "elevator-jobs") },
    { query: leave, enabled: canReadCalendarEntity(staff, "leave-requests") },
  ] as const;
  const queries = sources.map(({ query }) => query);
  const records = useMemo(() => ([projects, inspections, reports, emergencies, elevators, leave] as const).flatMap((query, i) =>
    ((query.data || []) as RecordItem[]).map((record) => normalize(record, categories[i]))
  ).filter((item): item is CalendarItem => Boolean(item)), [projects.data, inspections.data, reports.data, emergencies.data, elevators.data, leave.data]);
  const visible = filter === "All" ? records : records.filter((item) => item.category === filter);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const day = new Date(gridStart); day.setDate(gridStart.getDate() + i); return day; });
  const agenda = visible.filter((item) => startOfDay(item.start) <= startOfDay(new Date(`${selected}T23:59:59`)) && startOfDay(item.end) >= startOfDay(new Date(`${selected}T00:00:00`))).sort((a, b) => a.start.getTime() - b.start.getTime());
  const today = dayKey(new Date());
  const loading = queries.some((query) => query.isLoading);
  // Disabled sources are intentionally absent, not unavailable. Only count
  // failures from requests this staff member is authorized to make.
  const errors = sources.filter(({ query, enabled }) => enabled && query.isError).length;
  const goMonth = (amount: number) => {
    const target = new Date(cursor.getFullYear(), cursor.getMonth() + amount, 1);
    const selectedDate = new Date(`${selected}T12:00:00`);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    const day = Math.min(selectedDate.getDate(), lastDay);
    const nextSelected = new Date(target.getFullYear(), target.getMonth(), day);
    setCursor(target);
    setSelected(dayKey(nextSelected));
  };

  return <div className="space-y-6 h-full flex flex-col">
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold tracking-tight">Calendar</h1><p className="text-muted-foreground text-sm">Date-organized operational records.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filter calendar records" className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as "All" | Category)}><option value="All">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
        <button className="h-9 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted" onClick={() => { const now = new Date(); setCursor(now); setSelected(dayKey(now)); }}>Today</button>
      </div>
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-[18px] flex-1 min-h-0">
      <section className="bg-card rounded-[14px] shadow-sm border border-border overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4"><button aria-label="Previous month" className="rounded-md p-2 hover:bg-muted" onClick={() => goMonth(-1)}><ArrowLeft className="h-4 w-4" /></button><h2 className="text-lg font-bold">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><button aria-label="Next month" className="rounded-md p-2 hover:bg-muted" onClick={() => goMonth(1)}><ArrowRight className="h-4 w-4" /></button></div>
        {errors > 0 && <div className="border-b border-border bg-[#fffaf0] px-4 py-2 text-xs text-muted-foreground">{errors} data source{errors > 1 ? "s are" : " is"} unavailable; showing available records.</div>}
        <div className="grid grid-cols-7 border-b border-border">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => <div key={name} className="p-2 text-center text-[11px] font-semibold uppercase text-muted-foreground">{name}</div>)}</div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = dayKey(day); const entries = visible.filter((item) => startOfDay(item.start) <= startOfDay(day) && startOfDay(item.end) >= startOfDay(day));
            return <div key={key} onClick={() => setSelected(key)} className={`min-h-[76px] sm:min-h-[100px] border-b border-r border-border p-1.5 text-left align-top transition-colors hover:bg-muted/60 ${day.getMonth() !== cursor.getMonth() ? "bg-muted/20 text-muted-foreground/50" : ""} ${selected === key ? "ring-2 ring-inset ring-[#F5B301]" : ""}`}>
              <button type="button" aria-label={`Select ${displayDate(day)}`} onClick={() => setSelected(key)} className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${today === key ? "bg-[#F5B301] font-bold text-[#263746]" : ""}`}>{day.getDate()}</button>
              <div className="mt-1 space-y-1">
                {entries.slice(0, 3).map((item) => (
                  <Link
                    key={`${item.category}-${item.id}`}
                    href={item.href}
                    onClick={(event) => event.stopPropagation()}
                    className={`block truncate rounded px-1 py-0.5 text-[10px] font-semibold ${meta[item.category].color}`}
                  >
                    {item.label}
                  </Link>
                ))}
                {entries.length > 3 && <button type="button" onClick={() => setSelected(key)} className="block px-1 text-[10px] text-muted-foreground">+{entries.length - 3} more</button>}
              </div>
            </div>;
          })}
        </div>
        {loading && <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading operational records…</div>}
      </section>
      <aside className="bg-card rounded-[14px] shadow-sm border border-border flex min-h-[280px] flex-col overflow-hidden">
        <div className="border-b border-border p-4"><h2 className="font-bold">{new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2><p className="mt-1 text-xs text-muted-foreground">{agenda.length} scheduled record{agenda.length === 1 ? "" : "s"}</p></div>
        <div className="flex-1 overflow-y-auto p-3">
          {agenda.length === 0 ? <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center text-sm text-muted-foreground"><CalendarDays className="mb-3 h-9 w-9 opacity-25" />No records scheduled for this day.</div> : <div className="space-y-2">{agenda.map((item) => { const Icon = meta[item.category].icon; const s = item.state || {}; return <Link key={`${item.category}-${item.id}`} href={item.href} className="block rounded-xl border border-border p-3 hover:border-primary/50 hover:bg-muted/30"><div className="flex gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${meta[item.category].color}`}><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{item.label}</div><div className="mt-1 text-xs text-muted-foreground">{item.category} · {String(s.status || "New").replaceAll("_", " ")}</div><div className="mt-1 text-xs text-muted-foreground">{item.development || "All developments"} · {displayDate(item.start)}{item.end.getTime() !== item.start.getTime() ? ` – ${displayDate(item.end)}` : ""}</div></div></div></Link>; })}</div>}
        </div>
      </aside>
    </div>
  </div>;
}