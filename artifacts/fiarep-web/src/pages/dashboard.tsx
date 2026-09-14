import { useAuth } from "@/hooks/use-auth";
import { hasModuleAccess } from "@/lib/access-policy";
import {
  getListEntityRecordsQueryKey, getListNotificationsQueryKey,
  useListEntityRecords, useListNotifications,
} from "@workspace/api-client-react";
import {
  AlertTriangle, Bell, Building2, CalendarClock, ClipboardCheck, FileSearch,
  FolderKanban, Layers, Loader2, Plane, ShieldCheck, Wrench,
} from "lucide-react";
import { Link } from "wouter";

type RecordItem = {
  id: string;
  development?: string | null;
  state?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const stateOf = (item: RecordItem) => item.state ?? {};
const statusOf = (item: RecordItem) => String(stateOf(item).status ?? "new");
const titleOf = (item: RecordItem) =>
  String(stateOf(item).title ?? stateOf(item).description ?? item.id.slice(0, 8));
const dateOf = (item: RecordItem) => new Date(item.updatedAt || item.createdAt).getTime();
const formatDate = (value: string) => new Date(value).toLocaleDateString();

export default function Dashboard() {
  const { staff } = useAuth();
  const queryOptions = (entity: string, module: Parameters<typeof hasModuleAccess>[1]) => ({
    query: {
      queryKey: getListEntityRecordsQueryKey(entity),
      enabled: hasModuleAccess(staff, module),
      refetchInterval: 30_000,
      staleTime: 15_000,
      refetchOnMount: "always" as const,
    },
  });
  const inspectionsQuery = useListEntityRecords("inspections", undefined, queryOptions("inspections", "inspections"));
  const projectsQuery = useListEntityRecords("projects", undefined, queryOptions("projects", "projects"));
  const reportsQuery = useListEntityRecords("resident-reports", undefined, queryOptions("resident-reports", "reports"));
  const emergenciesQuery = useListEntityRecords("emergency-jobs", undefined, queryOptions("emergency-jobs", "emergency"));
  const leaveQuery = useListEntityRecords("leave-requests", undefined, queryOptions("leave-requests", "leave"));
  const repairsQuery = useListEntityRecords("project-scopes", undefined, queryOptions("project-scopes", "repairs"));
  const notificationsQuery = useListNotifications({
    query: {
      enabled: hasModuleAccess(staff, "notifications"),
      queryKey: getListNotificationsQueryKey(),
      refetchInterval: 30_000,
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });

  const records = (query: typeof inspectionsQuery) => (query.data ?? []) as RecordItem[];
  const inspections = records(inspectionsQuery);
  const projects = records(projectsQuery);
  const reports = records(reportsQuery);
  const emergencies = records(emergenciesQuery);
  const leave = records(leaveQuery);
  const repairs = records(repairsQuery);
  const notifications = notificationsQuery.data ?? [];
  const firstName = staff?.name?.split(" ")[0] || "User";
  const unread = notifications.filter((notification) => !notification.read).length;

  const metrics = [
    { label: "Active Projects", value: projects.filter((item) => !["completed", "closed", "cancelled"].includes(statusOf(item))).length, total: projects.length, icon: FolderKanban, query: projectsQuery, href: "/projects" },
    { label: "Resident Reports", value: reports.filter((item) => !["resolved", "closed"].includes(statusOf(item))).length, total: reports.length, icon: FileSearch, query: reportsQuery, href: "/reports" },
    { label: "Open Inspections", value: inspections.filter((item) => !["completed", "closed"].includes(statusOf(item))).length, total: inspections.length, icon: ClipboardCheck, query: inspectionsQuery, href: "/inspections" },
    { label: "Emergencies", value: emergencies.filter((item) => !["completed", "closed", "resolved"].includes(statusOf(item))).length, total: emergencies.length, icon: AlertTriangle, query: emergenciesQuery, href: "/emergency" },
    { label: "Pending Leave", value: leave.length, total: leave.length, icon: Plane, query: leaveQuery, href: "/leave?view=team" },
    { label: "Unread Notifications", value: unread, total: notifications.length, icon: Bell, query: notificationsQuery, href: "/notifications" },
  ].filter((metric) => hasModuleAccess(staff, metric.href === "/emergency" ? "emergency" : metric.href.startsWith("/leave") ? "leave" : metric.href.slice(1) as Parameters<typeof hasModuleAccess>[1]));
  const activity = [
    ...inspections.map((item) => ({ item, label: "Inspection", href: `/inspections?id=${encodeURIComponent(item.id)}`, icon: ClipboardCheck })),
    ...reports.map((item) => ({ item, label: "Resident report", href: `/reports?id=${encodeURIComponent(item.id)}`, icon: FileSearch })),
    ...emergencies.map((item) => ({ item, label: "Emergency", href: "/emergency", icon: AlertTriangle })),
    ...projects.map((item) => ({ item, label: "Project", href: "/projects", icon: FolderKanban })),
    ...leave.map((item) => ({ item, label: "Leave request", href: staff?.role === "management" || staff?.role === "administrator" ? "/leave?view=team" : "/leave", icon: Plane })),
    ...repairs.map((item) => ({ item, label: "Repair scope", href: "/repairs", icon: Wrench })),
  ].filter((entry) => hasModuleAccess(staff, entry.href.startsWith("/emergency") ? "emergency" : entry.href.startsWith("/reports") ? "reports" : entry.href.startsWith("/inspections") ? "inspections" : entry.href.startsWith("/projects") ? "projects" : entry.href.startsWith("/repairs") ? "repairs" : "leave"))
    .sort((a, b) => dateOf(b.item) - dateOf(a.item)).slice(0, 7);
  const activityLoading = [inspectionsQuery, reportsQuery, emergenciesQuery, projectsQuery, leaveQuery, repairsQuery].some((query) => query.isLoading);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[14px] p-[26px_30px] shadow-sm mb-[22px] bg-gradient-to-r from-white via-white/90 to-white/20">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#b9c6d6] to-[#8fa3b8]" />
        <h1 className="text-[26px] font-extrabold tracking-[-.3px] text-foreground">Welcome back, <span className="text-[#F5B301]">{firstName}!</span></h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Here&apos;s what&apos;s happening with your operations today.</p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[18px] mb-[22px]">
        {metrics.map(({ label, value, total, icon: Icon, query, href }) => (
          <Link key={label} href={href} className="bg-card rounded-[14px] shadow-sm border border-border p-5 flex justify-between items-start hover:border-primary/50 transition-colors">
            <div><div className="text-[13px] text-muted-foreground font-medium">{label}</div><div className="text-[30px] font-extrabold my-2 tracking-[-.5px] leading-none">{query.isLoading ? "-" : query.isError ? "—" : value}</div><div className="text-xs text-muted-foreground">{query.isError ? "Unavailable" : `${total} total`}</div></div>
            <div className="w-[46px] h-[46px] rounded-xl bg-primary text-sidebar grid place-items-center shrink-0"><Icon className="w-[22px] h-[22px]" /></div>
          </Link>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-[18px] mb-[22px]">
        <div className="bg-card rounded-[14px] shadow-sm border border-border">
          <div className="flex items-center justify-between p-[18px_22px] border-b border-border"><h3 className="text-base font-bold">Recent operational activity</h3><span className="text-xs text-muted-foreground">Live overview</span></div>
          <div className="p-[8px_10px]">
            {activityLoading ? <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Loading activity...</div> :
              activity.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground"><Layers className="w-8 h-8 opacity-20 mx-auto mb-2" />No recent activity found.</div> :
                activity.map(({ item, label, href, icon: Icon }) => <Link key={`${label}-${item.id}`} href={href} className="flex items-center gap-3.5 p-[12px] rounded-[10px] hover:bg-muted/50 transition-colors">
                  <div className="w-10 h-10 rounded-[9px] shrink-0 bg-gradient-to-br from-[#cdd8e4] to-[#9fb2c6] grid place-items-center text-[#5a6b7d]"><Icon className="w-5 h-5" /></div>
                  <div className="flex-1 min-w-0"><b className="text-sm font-semibold truncate block">{titleOf(item)}</b><span className="text-[12.5px] text-muted-foreground truncate block">{label} · {item.development || "No location"}</span></div>
                  <div className="text-right shrink-0"><div className="text-[12.5px] font-bold text-[#F5B301] capitalize">{statusOf(item).replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">{formatDate(item.updatedAt || item.createdAt)}</div></div>
                </Link>)}
          </div>
        </div>

        <div className="bg-card rounded-[14px] shadow-sm border border-border">
          <div className="flex items-center justify-between p-[18px_22px] border-b border-border"><h3 className="text-base font-bold">Operational watchlist</h3><Link href="/notifications" className="text-accent text-[13px] font-semibold hover:underline">View alerts</Link></div>
          <div className="p-[12px_20px_18px] space-y-2">
            {notificationsQuery.isLoading ? <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Loading notifications...</div> :
              notificationsQuery.isError ? <div className="p-8 text-center text-sm text-muted-foreground"><Bell className="w-8 h-8 opacity-20 mx-auto mb-2" />Notifications are unavailable.</div> :
                notifications.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground"><ShieldCheck className="w-8 h-8 opacity-20 mx-auto mb-2" />No notifications requiring attention.</div> :
                  notifications.slice().sort((a, b) => Number(b.read) - Number(a.read) || new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5).map((notification) => <div key={notification.id} className={`flex gap-3.5 p-3 border-b border-border last:border-0 ${!notification.read ? "bg-[#fffaf0]" : ""}`}>
                    <div className="w-[34px] h-[34px] rounded-[9px] shrink-0 bg-[#fff5d6] text-[#F5B301] grid place-items-center"><Bell className="w-[17px] h-[17px]" /></div><div><b className="text-[13.5px] font-semibold">{notification.message}</b><span className="text-xs text-muted-foreground block mt-0.5">{notification.detail || formatDate(notification.at)}{!notification.read && " · Unread"}</span></div>
                  </div>)}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[18px]">
        {hasModuleAccess(staff, "inspections") && <FeatureCard icon={ShieldCheck} title="Accurate Inspections" desc="Detailed field assessments" href="/inspections" />}
        {hasModuleAccess(staff, "reports") && <FeatureCard icon={FileSearch} title="Resident Reports" desc="Resolve housing concerns" href="/reports" />}
        {hasModuleAccess(staff, "repairs") && <FeatureCard icon={Wrench} title="Efficient Repairs" desc="Track and manage repairs" href="/repairs" />}
        {hasModuleAccess(staff, "calendar") && <FeatureCard icon={CalendarClock} title="Operational Control" desc="Keep teams coordinated" href="/calendar" />}
      </section>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc, href }: { icon: typeof ShieldCheck; title: string; desc: string; href: string }) {
  return (
    <Link
      href={href}
      aria-label={`${title}: ${desc}`}
      className="group bg-card rounded-[14px] shadow-sm border border-border p-5 flex items-center gap-3.5 transition-all hover:border-primary/60 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <div className="w-[42px] h-[42px] rounded-[11px] shrink-0 bg-primary text-sidebar grid place-items-center transition-transform group-hover:scale-105">
        <Icon className="w-[21px] h-[21px]" />
      </div>
      <div>
        <b className="text-sm font-bold block">{title}</b>
        <span className="text-[12.5px] text-muted-foreground">{desc}</span>
      </div>
    </Link>
  );
}