import { useEffect, useMemo, useState } from "react";
import {
  getListEntityRecordsQueryKey,
  getListNychaDevelopmentsQueryKey,
  useListEntityRecords,
  useListNychaDevelopments,
  type NychaDevelopment,
} from "@workspace/api-client-react";
import { 
  Building2, ChevronDown, ChevronRight, Clock, 
  Flame, Loader2, MapPin, Search, 
  Siren, Target, X, AlertOctagon, CheckSquare, Building,
  ShieldAlert, Users, CheckCircle, AlertCircle, Calendar, ArrowDownUp, Trophy
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DEVELOPMENT_ROTATION_MS,
  getComplaintPulseLevel,
  getDevelopmentPageCount,
  getVisibleDevelopmentPage,
  updateDevelopmentPage,
} from "@/lib/complaint-dashboard-rotation";

type Report = { id: string; development?: string | null; state?: Record<string, unknown>; createdAt: string; updatedAt: string; version: number };
const NYC_MAP_URL = "https://www.openstreetmap.org/export/embed.html?bbox=-74.25909%2C40.477399%2C-73.700181%2C40.916178&layer=mapnik";

function normalizedDevelopmentName(development: string | null | undefined) {
  return development
    ?.trim()
    .toLowerCase()
    .replace(/\b(houses?|developments?|apartments?)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ") || "";
}

function buildDevelopmentCatalogLookup(developments: NychaDevelopment[]) {
  const exact = new Map<string, NychaDevelopment>();
  const normalized = new Map<string, NychaDevelopment | null>();

  for (const development of developments) {
    exact.set(development.name.trim().toLowerCase(), development);
    const normalizedName = normalizedDevelopmentName(development.name);
    normalized.set(
      normalizedName,
      normalized.has(normalizedName) ? null : development,
    );
  }

  return { exact, normalized };
}

function findCatalogDevelopment(
  development: string | null | undefined,
  lookup: ReturnType<typeof buildDevelopmentCatalogLookup>,
) {
  if (!development) return null;
  return lookup.exact.get(development.trim().toLowerCase())
    || lookup.normalized.get(normalizedDevelopmentName(development))
    || null;
}

function mapUrlFor(latitude: number, longitude: number) {
  const longitudeSpan = 0.012;
  const latitudeSpan = 0.009;
  const bbox = [
    longitude - longitudeSpan,
    latitude - latitudeSpan,
    longitude + longitudeSpan,
    latitude + latitudeSpan,
  ].join(",");

  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}

function getField(r: Report, aliases: string[], fallback: string = ""): string {
  const s = r.state || {};
  for (const alias of aliases) {
    if (s[alias] !== undefined && s[alias] !== null && String(s[alias]).trim() !== "") {
      return String(s[alias]).trim();
    }
  }
  return fallback;
}

function statusOf(r: Report) { return String(r.state?.status || "submitted").toLowerCase(); }
function isCorrected(status: string) { 
  return ["done", "resolved", "work_approved", "approved", "completed", "in_house_completed", "closed"].includes(status); 
}
function addressOf(r: Report, developmentAddress?: string | null) {
  return getField(r, ["address", "buildingAddress", "building"], developmentAddress || "Unknown Address");
}
function categoryOf(r: Report) { return getField(r, ["category", "type", "complaintType"], "Uncategorized"); }
function boroughOf(r: Report) { return getField(r, ["borough"], "Unknown"); }
function tradeOf(r: Report) { return getField(r, ["trade", "assignedTrade", "tradeName"], "Unassigned"); }

type Stats = {
  name: string;
  activeCount: number;
  correctedCount: number;
  totalCount: number;
  oldestActive: number | null;
  latestActive: number | null;
  categories: Record<string, number>;
  reports: Report[];
  buildings: Map<string, Stats>;
};

function SummaryCard({ title, value, subValue, icon: Icon, colorClass, testId }: { title: string, value: string | number, subValue?: string, icon: React.ElementType, colorClass: string, testId: string }) {
  const colorMap = {
    red: "border-l-red-500 text-red-500 bg-red-500",
    blue: "border-l-blue-600 text-blue-600 bg-blue-600",
    indigo: "border-l-indigo-500 text-indigo-500 bg-indigo-500",
    teal: "border-l-teal-500 text-teal-500 bg-teal-500",
    orange: "border-l-orange-500 text-orange-500 bg-orange-500",
    purple: "border-l-purple-500 text-purple-500 bg-purple-500",
    green: "border-l-emerald-500 text-emerald-500 bg-emerald-500",
  };
  
  const mapping = colorMap[colorClass as keyof typeof colorMap] || colorMap.red;
  const borders = `border-l-[4px] sm:border-l-[5px] ${mapping.split(' ')[0]}`;
  const bg = mapping.split(' ')[2];
  
  return (
    <div className={`bg-white border-y border-r border-slate-200 ${borders} rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-start gap-3 shadow-sm`} data-testid={testId}>
      <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full ${bg} flex items-center justify-center shrink-0 sm:mt-0.5`}>
        <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
      </div>
      <div className="flex flex-col min-w-0">
        <div className="text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">{title}</div>
        <div className="text-lg sm:text-2xl font-black text-slate-900 leading-none truncate">{value}</div>
        {subValue && <div className="text-[9px] sm:text-[10px] font-semibold text-slate-500 truncate mt-1 sm:mt-1.5">{subValue}</div>}
      </div>
    </div>
  );
}

export default function ComplaintDashboard() {
  const reportsQuery = useListEntityRecords("resident-reports", undefined, {
    query: {
      queryKey: getListEntityRecordsQueryKey("resident-reports"),
      refetchInterval: 15_000,
      staleTime: 10_000,
    }
  });

  const reports = (reportsQuery.data || []) as Report[];
  const developmentCatalogQuery = useListNychaDevelopments({
    query: {
      queryKey: getListNychaDevelopmentsQueryKey(),
      staleTime: 30 * 60 * 1000,
    },
  });
  const developmentCatalogLookup = useMemo(
    () => buildDevelopmentCatalogLookup(developmentCatalogQuery.data || []),
    [developmentCatalogQuery.data],
  );
  const verifiedDevelopmentFor = (development: string | null | undefined) =>
    findCatalogDevelopment(development, developmentCatalogLookup);
  const reportAddress = (report: Report) =>
    addressOf(report, verifiedDevelopmentFor(report.development)?.address);
  
  // Filters
  const [search, setSearch] = useState("");
  const [boroughFilter, setBoroughFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [developmentPage, setDevelopmentPage] = useState(0);

  // Detail View State
  const [selectedDev, setSelectedDev] = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const selectedCatalogDevelopment = verifiedDevelopmentFor(selectedDev);
  const selectedHasCoordinates = selectedCatalogDevelopment?.latitude != null
    && selectedCatalogDevelopment.longitude != null;
  const mapUrl = selectedHasCoordinates
    ? mapUrlFor(selectedCatalogDevelopment.latitude!, selectedCatalogDevelopment.longitude!)
    : NYC_MAP_URL;

  const filterOptions = useMemo(() => {
    const boroughs = new Set<string>();
    
    reports.forEach(r => {
      const boro = boroughOf(r);
      
      if (boro) boroughs.add(boro);
    });
    
    return {
      boroughs: Array.from(boroughs).sort(),
    };
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const dev = r.development || "";
      const addr = reportAddress(r).toLowerCase();
      const boro = boroughOf(r).toLowerCase();
      
      if (search) {
        const q = search.toLowerCase();
        if (!dev.toLowerCase().includes(q) && !addr.includes(q)) return false;
      }
      
      if (boroughFilter !== "all" && boro !== boroughFilter.toLowerCase()) return false;
      
      const time = new Date(r.createdAt).getTime();
      if (fromDate && time < new Date(fromDate).getTime()) return false;
      if (toDate && time >= new Date(toDate).getTime() + 86400000) return false;
      
      return true;
    });
  }, [reports, search, boroughFilter, fromDate, toDate, developmentCatalogLookup]);

  const { devStats, bldgStats, globalStats } = useMemo(() => {
    const devs = new Map<string, Stats>();
    const bldgs = new Map<string, Stats>();
    const glob = { active: 0, oldest: null as number | null, recentlyCorrected: 0 };
    const now = Date.now();
    
    filteredReports.forEach(r => {
      const devName = r.development || "Unassigned";
      const bldgName = reportAddress(r);
      const status = statusOf(r);
      const corrected = isCorrected(status);
      const time = new Date(r.createdAt).getTime();
      const updated = new Date(r.updatedAt || r.createdAt).getTime();
      const cat = categoryOf(r);

      if (corrected) {
        if (now - updated <= 14 * 86400000) glob.recentlyCorrected++;
      } else {
        glob.active++;
        if (!glob.oldest || time < glob.oldest) glob.oldest = time;
      }

      if (!devs.has(devName)) devs.set(devName, { name: devName, activeCount: 0, correctedCount: 0, totalCount: 0, oldestActive: null, latestActive: null, categories: {}, reports: [], buildings: new Map() });
      if (!bldgs.has(bldgName)) bldgs.set(bldgName, { name: bldgName, activeCount: 0, correctedCount: 0, totalCount: 0, oldestActive: null, latestActive: null, categories: {}, reports: [], buildings: new Map() });
      
      const d = devs.get(devName)!;
      const b = bldgs.get(bldgName)!;

      d.reports.push(r);
      b.reports.push(r);
      d.totalCount++;
      b.totalCount++;

      if (!d.buildings.has(bldgName)) d.buildings.set(bldgName, b);
      
      if (corrected) {
        d.correctedCount++;
        b.correctedCount++;
      } else {
        d.activeCount++;
        b.activeCount++;
        d.categories[cat] = (d.categories[cat] || 0) + 1;
        b.categories[cat] = (b.categories[cat] || 0) + 1;
        
        if (!d.oldestActive || time < d.oldestActive) d.oldestActive = time;
        if (!d.latestActive || time > d.latestActive) d.latestActive = time;
        if (!b.oldestActive || time < b.oldestActive) b.oldestActive = time;
        if (!b.latestActive || time > b.latestActive) b.latestActive = time;
      }
    });

    const activeDevs = Array.from(devs.values()).filter(d => d.activeCount > 0);
    const activeBldgs = Array.from(bldgs.values()).filter(b => b.activeCount > 0);
    
    const sortFn = (a: Stats, b: Stats) => sortOrder === "desc" ? b.activeCount - a.activeCount : a.activeCount - b.activeCount;
    activeDevs.sort(sortFn);
    activeBldgs.sort(sortFn);

    return { devStats: activeDevs, bldgStats: activeBldgs, globalStats: glob };
  }, [filteredReports, sortOrder, developmentCatalogLookup]);

  const developmentPageCount = getDevelopmentPageCount(devStats.length);
  const visibleDevelopments = getVisibleDevelopmentPage(devStats, developmentPage);

  useEffect(() => {
    setDevelopmentPage((current) => updateDevelopmentPage(current, { type: "filtersChanged" }));
  }, [search, boroughFilter, fromDate, toDate, sortOrder]);

  useEffect(() => {
    setDevelopmentPage((current) => updateDevelopmentPage(current, {
      type: "countChanged",
      pageCount: developmentPageCount,
    }));
    if (developmentPageCount <= 1) return;
    const timer = window.setInterval(() => {
      setDevelopmentPage((current) => updateDevelopmentPage(current, {
        type: "next",
        pageCount: developmentPageCount,
      }));
    }, DEVELOPMENT_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [developmentPageCount]);

  const topDev = devStats.length > 0 ? (sortOrder === "desc" ? devStats[0] : devStats[devStats.length - 1]) : null;
  const topBldg = bldgStats.length > 0 ? (sortOrder === "desc" ? bldgStats[0] : bldgStats[bldgStats.length - 1]) : null;

  const selectedDevData = selectedDev ? devStats.find(d => d.name === selectedDev) : null;
  const devBuildings = selectedDevData 
    ? Array.from(selectedDevData.buildings.values())
        .filter(b => b.activeCount > 0)
        .sort((a, b) => sortOrder === "desc" ? b.activeCount - a.activeCount : a.activeCount - b.activeCount)
    : [];
  const selectedBldgData = selectedBuilding ? devBuildings.find(b => b.name === selectedBuilding) : null;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] bg-[#f4f6f9] text-slate-900 pb-8 overflow-hidden font-sans -m-4 md:-m-[28px_30px_40px]">
      
      <header className="bg-gradient-to-r from-[#003380] to-[#0055cc] relative overflow-hidden flex flex-col pb-4 mb-4 shadow-sm">
        {/* Subtle geometric skyline decoration */}
        <svg className="absolute right-0 bottom-0 w-full h-full object-cover opacity-20 mix-blend-overlay pointer-events-none" preserveAspectRatio="none" viewBox="0 0 1000 100">
          <rect x="0" y="80" width="1000" height="20" fill="#fff" />
          <rect x="50" y="60" width="30" height="40" fill="#fff" />
          <rect x="90" y="40" width="40" height="60" fill="#fff" />
          <rect x="140" y="70" width="25" height="30" fill="#fff" />
          <rect x="175" y="30" width="35" height="70" fill="#fff" />
          <rect x="220" y="50" width="50" height="50" fill="#fff" />
          <rect x="280" y="20" width="45" height="80" fill="#fff" />
          <rect x="335" y="60" width="20" height="40" fill="#fff" />
          <rect x="365" y="10" width="40" height="90" fill="#fff" />
          <rect x="415" y="45" width="55" height="55" fill="#fff" />
          <rect x="480" y="35" width="30" height="65" fill="#fff" />
          <rect x="520" y="65" width="40" height="35" fill="#fff" />
          <rect x="570" y="25" width="45" height="75" fill="#fff" />
          <rect x="625" y="55" width="25" height="45" fill="#fff" />
          <rect x="660" y="15" width="50" height="85" fill="#fff" />
          <rect x="720" y="40" width="35" height="60" fill="#fff" />
          <rect x="765" y="75" width="45" height="25" fill="#fff" />
          <rect x="820" y="30" width="30" height="70" fill="#fff" />
          <rect x="860" y="50" width="50" height="50" fill="#fff" />
          <rect x="920" y="20" width="40" height="80" fill="#fff" />
          <rect x="970" y="60" width="30" height="40" fill="#fff" />
        </svg>
        <div className="p-4 md:px-6 md:pt-6 relative z-10 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shadow-lg border-2 border-white/20 shrink-0">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Upper Management Complaint Command</h1>
          </div>
          <p className="text-sm text-blue-100 max-w-2xl ml-11">High-stakes operational surface. Real-time active complaint concentration mapping and deep drill-down analytics.</p>
        </div>
      </header>

      <div className="px-4 md:px-6 space-y-4">
        {/* 7 Summary Panels */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <SummaryCard title="Total Active" value={globalStats.active} icon={ShieldAlert} colorClass="red" testId="metric-total-active" />
          <SummaryCard title="Devs w/ Active" value={devStats.length} icon={Users} colorClass="blue" testId="metric-devs-active" />
          <SummaryCard title="Bldgs w/ Active" value={bldgStats.length} icon={Building2} colorClass="indigo" testId="metric-bldgs-active" />
          <SummaryCard title="Most Active Dev" value={topDev?.name || "-"} subValue={topDev ? `${topDev.activeCount} active` : ""} icon={MapPin} colorClass="teal" testId="metric-top-dev" />
          <SummaryCard title="Most Active Bldg" value={topBldg?.name || "-"} subValue={topBldg ? `${topBldg.activeCount} active` : ""} icon={Building} colorClass="orange" testId="metric-top-bldg" />
          <SummaryCard title="Oldest Open" value={globalStats.oldest ? `${Math.floor((Date.now() - globalStats.oldest)/86400000)}d ago` : "-"} subValue={globalStats.oldest ? new Date(globalStats.oldest).toLocaleDateString() : ""} icon={Clock} colorClass="purple" testId="metric-oldest" />
          <SummaryCard title="Recently Corrected" value={globalStats.recentlyCorrected} subValue="Last 14 days" icon={CheckCircle} colorClass="green" testId="metric-corrected" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 bg-white p-3 border border-slate-200 rounded-xl shadow-sm">
          <div className="relative flex-1 min-w-[200px] h-9">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
             <Input 
               placeholder="Search dev or address..." 
               value={search} 
               onChange={e => setSearch(e.target.value)} 
               className="pl-9 h-full bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500 rounded-md text-xs shadow-sm"
               data-testid="filter-search" 
             />
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
             <div className="relative flex min-w-[145px] items-center border border-slate-200 rounded-md bg-white px-2 h-9 shadow-sm hover:border-blue-300 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-colors">
               <MapPin className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0 pointer-events-none" />
               <span className="flex-1 text-xs text-slate-700 pointer-events-none truncate">{boroughFilter === "all" ? "All Boroughs" : boroughFilter}</span>
               <ChevronDown className="w-3.5 h-3.5 text-slate-500 ml-2 pointer-events-none" />
               <select value={boroughFilter} onChange={e => setBoroughFilter(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Borough" data-testid="filter-borough">
                <option value="all">All Boroughs</option>
                {filterOptions.boroughs.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="flex items-center border border-slate-200 rounded-md bg-white px-2 h-9 shadow-sm">
              <span className="text-[10px] text-slate-400 uppercase mr-1.5 font-semibold">From</span>
              <Calendar className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="bg-transparent text-slate-700 text-xs outline-none" data-testid="filter-from-date" />
            </div>
            <div className="flex items-center border border-slate-200 rounded-md bg-white px-2 h-9 shadow-sm">
              <span className="text-[10px] text-slate-400 uppercase mr-1.5 font-semibold">To</span>
              <Calendar className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="bg-transparent text-slate-700 text-xs outline-none" data-testid="filter-to-date" />
            </div>
            <div className="flex items-center border border-slate-200 rounded-md bg-white px-2 h-9 shadow-sm">
              <ArrowDownUp className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
              <select value={sortOrder} onChange={e => setSortOrder(e.target.value as "desc" | "asc")} className="bg-transparent text-xs text-slate-700 outline-none pr-4 w-full" data-testid="filter-sort">
                <option value="desc">Sort: High to Low</option>
                <option value="asc">Sort: Low to High</option>
              </select>
            </div>
          </div>
        </div>

        {reportsQuery.isLoading ? (
          <div className="flex items-center justify-center p-20 text-slate-400" data-testid="dashboard-loading">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col xl:flex-row gap-4 xl:h-[calc(100vh-22rem)] min-h-[600px] xl:min-h-[500px]">
            
            {/* Column 1: Active Developments List */}
            <div className="w-full xl:w-[320px] 2xl:w-[350px] shrink-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-0">
              <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <div className="flex items-center gap-1.5 text-slate-900 font-bold text-sm">
                    <AlertCircle className="w-4 h-4 text-red-600 fill-red-100" />
                    Active Development Concentrations
                  </div>
                  <div className="text-[10px] font-medium text-slate-500 mt-1">
                    Showing {visibleDevelopments.length} of {devStats.length} developments · Rotates every 30 minutes
                  </div>
                </div>
              </div>
              <ScrollArea className="flex-1 p-2 bg-slate-50/30">
                {devStats.length === 0 ? (
                  <div className="p-10 text-center text-slate-400 text-sm">No active developments matching criteria.</div>
                ) : (
                  <div className="space-y-2">
                    {visibleDevelopments.map(dev => {
                      const isSelected = selectedDev === dev.name;
                      const pulseLevel = getComplaintPulseLevel(dev.activeCount);
                      const intensity = pulseLevel === "red"
                        ? "bg-red-600 text-white shadow-md shadow-red-600/30 ring-2 ring-red-500 ring-offset-1 animate-pulse"
                        : pulseLevel === "orange"
                          ? "bg-orange-500 text-white shadow-sm shadow-orange-500/20 animate-pulse"
                          : "bg-red-500 text-white shadow-sm shadow-red-500/20";
                      
                      return (
                        <button
                          key={dev.name}
                          onClick={() => { setSelectedDev(dev.name); setSelectedBuilding(null); }}
                          className={`w-full text-left p-3 rounded-xl border flex items-center justify-between group transition-all
                            ${isSelected ? "border-red-300 bg-red-50 ring-1 ring-red-400 shadow-sm" : "border-slate-200 bg-white hover:border-red-300 hover:shadow-sm"}
                          `}
                          data-testid={`dev-card-${dev.name.replace(/\s+/g, '-')}`}
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-8 h-8 rounded-full font-bold text-sm flex items-center justify-center shrink-0 ${intensity}`}>
                              {dev.activeCount}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 text-sm truncate pr-2">{dev.name}</div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500 mt-0.5">
                                <span className="flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  {dev.correctedCount} corrected
                                </span>
                                {dev.oldestActive && <span>Old: {new Date(dev.oldestActive).toLocaleDateString()}</span>}
                              </div>
                            </div>
                          </div>
                          <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isSelected ? "text-red-500 translate-x-0.5" : "text-slate-300 group-hover:text-red-400 group-hover:translate-x-0.5"}`} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
              {developmentPageCount > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setDevelopmentPage((current) => updateDevelopmentPage(current, {
                      type: "previous",
                      pageCount: developmentPageCount,
                    }))}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-sm"
                    data-testid="button-previous-development-rotation"
                  >
                    Previous 10
                  </button>
                  <span className="text-[10px] font-bold text-slate-500" data-testid="text-development-rotation-page">
                    Group {developmentPage + 1} of {developmentPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDevelopmentPage((current) => updateDevelopmentPage(current, {
                      type: "next",
                      pageCount: developmentPageCount,
                    }))}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-sm"
                    data-testid="button-next-development-rotation"
                  >
                    Next 10
                  </button>
                </div>
              )}
            </div>

            {/* Column 2: Interactive Map Surface */}
            <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden relative shadow-sm min-h-[300px]">
              {selectedDev && developmentCatalogQuery.isLoading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
                  <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
                </div>
              ) : selectedDev && !selectedHasCoordinates ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 px-6 text-center">
                  <AlertCircle className="h-8 w-8 text-amber-500" />
                  <div className="font-bold text-slate-900">Location unavailable</div>
                  {selectedCatalogDevelopment?.address && (
                    <div className="text-sm font-semibold text-slate-600">
                      {selectedCatalogDevelopment.address}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <iframe
                    src={mapUrl}
                    className="w-full h-full border-0 absolute inset-0 opacity-[0.7] filter contrast-[0.9] saturate-[0.7]"
                    title={selectedDev ? `${selectedDev} map` : "NYC Overview"}
                  />
                  {selectedDev && selectedCatalogDevelopment && (
                    <>
                      <div className="absolute inset-x-0 top-4 flex justify-center px-4 pointer-events-none">
                        <div className="max-w-full rounded-full border border-slate-200 bg-white px-4 py-1.5 text-center shadow-lg shadow-red-500/10 ring-1 ring-red-100">
                          <div className="truncate text-sm font-bold text-slate-800">{selectedDev}</div>
                          {selectedCatalogDevelopment.address && (
                            <div className="truncate text-[10px] font-semibold text-slate-500">
                              {selectedCatalogDevelopment.address}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur border border-slate-200 rounded-lg p-2 shadow-sm flex items-center gap-2 pointer-events-none">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-600 shadow-sm shadow-red-500/50" />
                        <span className="text-[10px] font-bold text-slate-700 tracking-wider uppercase">Active Development</span>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Column 3: Top 10 OR Drill-down Panel */}
            <div className="w-full xl:w-[350px] 2xl:w-[400px] shrink-0 flex flex-col gap-4 min-h-0 transition-all duration-300">
              {!selectedDev ? (
                <>
                  <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden min-h-0">
                    <div className="p-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50 rounded-t-xl">
                      <Trophy className="w-4 h-4 text-blue-600 fill-blue-100" />
                      <span className="font-bold text-sm text-slate-900">{sortOrder === "desc" ? "Top 10 Critical Developments" : "Lowest 10 Active Developments"}</span>
                    </div>
                    <ScrollArea className="flex-1 p-2">
                      <div className="space-y-0.5">
                        {devStats.slice(0, 10).map((d, i) => (
                          <div key={d.name} className="flex items-center justify-between p-2 text-xs border-b border-slate-50 last:border-0 hover:bg-slate-50 rounded-md transition-colors" data-testid={`top-dev-${i}`}>
                            <div className="flex items-center gap-2 truncate pr-2">
                              <span className="font-bold text-slate-900 w-4 shrink-0">{i+1}.</span>
                              <span className="font-semibold text-slate-700 truncate" title={d.name}>{d.name}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-emerald-600 font-medium">{d.correctedCount} corr</span>
                              <span className="text-red-600 font-bold">{d.activeCount} act</span>
                            </div>
                          </div>
                        ))}
                        {devStats.length === 0 && <div className="p-4 text-center text-xs text-slate-400">No data available</div>}
                      </div>
                    </ScrollArea>
                  </div>
                  <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden min-h-0">
                    <div className="p-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50 rounded-t-xl">
                      <Building className="w-4 h-4 text-blue-600 fill-blue-100" />
                      <span className="font-bold text-sm text-slate-900">{sortOrder === "desc" ? "Top 10 Critical Buildings" : "Lowest 10 Active Buildings"}</span>
                    </div>
                    <ScrollArea className="flex-1 p-2">
                      <div className="space-y-0.5">
                        {bldgStats.slice(0, 10).map((b, i) => (
                          <div key={b.name} className="flex items-center justify-between p-2 text-xs border-b border-slate-50 last:border-0 hover:bg-slate-50 rounded-md transition-colors" data-testid={`top-bldg-${i}`}>
                            <div className="flex items-center gap-2 truncate pr-2">
                              <span className="font-bold text-slate-900 w-4 shrink-0">{i+1}.</span>
                              <span className="font-semibold text-slate-700 truncate" title={b.name}>{b.name}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-emerald-600 font-medium">{b.correctedCount} corr</span>
                              <span className="text-red-600 font-bold">{b.activeCount} act</span>
                            </div>
                          </div>
                        ))}
                        {bldgStats.length === 0 && <div className="p-4 text-center text-xs text-slate-400">No data available</div>}
                      </div>
                    </ScrollArea>
                  </div>
                </>
              ) : (
                <>
                  {selectedDevData && (
                    <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden min-h-0 relative">
                      <div className="p-4 border-b border-slate-200 relative bg-gradient-to-br from-blue-50 to-white">
                        <button onClick={() => setSelectedDev(null)} className="absolute right-3 top-3 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-white rounded-md border border-transparent hover:border-slate-200 shadow-sm transition-all" data-testid="close-dev-detail"><X className="w-4 h-4" /></button>
                        <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">Development Focus</div>
                        <h2 className="text-lg font-bold text-slate-900 pr-8 leading-tight">{selectedDevData.name}</h2>
                        <div className="flex gap-4 mt-4">
                          <div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Active</div>
                            <div className="text-xl font-black text-red-600">{selectedDevData.activeCount}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Corrected</div>
                            <div className="text-xl font-black text-emerald-600">{selectedDevData.correctedCount}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Oldest</div>
                            <div className="text-sm font-bold text-slate-700 mt-1">{selectedDevData.oldestActive ? new Date(selectedDevData.oldestActive).toLocaleDateString() : "N/A"}</div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-1.5 text-[10px] font-medium text-slate-600">
                          {Object.entries(selectedDevData.categories).map(([cat, count]) => (
                            <span key={cat} className="bg-white px-2 py-1 rounded-md border border-slate-200 shadow-sm">{cat} ({count})</span>
                          ))}
                        </div>
                      </div>
                      <div className="p-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs font-bold text-slate-600">
                        <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Building Clusters</span>
                        <span className="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px]">{devBuildings.length} active</span>
                      </div>
                      <ScrollArea className="flex-1 p-2 bg-slate-50/30">
                        <div className="space-y-1">
                          {devBuildings.map(bldg => (
                            <button
                              key={bldg.name}
                              onClick={() => setSelectedBuilding(bldg.name === selectedBuilding ? null : bldg.name)}
                              className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between group ${selectedBuilding === bldg.name ? "bg-blue-50/60 border-blue-300 ring-1 ring-blue-400 shadow-sm" : "bg-white border-slate-200 hover:border-blue-200 hover:shadow-sm"}`}
                              data-testid={`bldg-row-${bldg.name.replace(/\s+/g, '-')}`}
                            >
                              <div className="min-w-0 flex-1 pr-3">
                                <div className="text-sm font-bold text-slate-900 truncate" title={bldg.name}>{bldg.name}</div>
                                <div className="text-[10px] font-medium text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                  <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>{bldg.correctedCount} corr</span>
                                  {bldg.oldestActive && <span>Old: {new Date(bldg.oldestActive).toLocaleDateString()}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="text-lg font-black text-red-600">{bldg.activeCount}</div>
                                <ChevronRight className={`w-4 h-4 transition-transform ${selectedBuilding === bldg.name ? "rotate-90 text-blue-500" : "text-slate-300 group-hover:text-blue-400 group-hover:translate-x-0.5"}`} />
                              </div>
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {selectedBldgData && (
                    <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden min-h-0 relative">
                      <div className="p-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                        <div className="font-bold text-sm text-slate-900 truncate pr-2 flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 text-blue-600 fill-blue-100" />
                          {selectedBldgData.name}
                        </div>
                        <button onClick={() => setSelectedBuilding(null)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md transition-colors" data-testid="close-bldg-detail"><X className="w-3.5 h-3.5" /></button>
                      </div>
                      <ScrollArea className="flex-1 p-2 bg-slate-50/50">
                        <div className="space-y-2">
                          {selectedBldgData.reports.filter(r => !isCorrected(statusOf(r))).sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map(r => {
                            const state = r.state || {};
                            const cat = categoryOf(r);
                            return (
                              <div key={r.id} className="p-3 bg-white border border-slate-200 shadow-sm rounded-xl" data-testid={`complaint-${r.id}`}>
                                <div className="flex justify-between items-start mb-2 gap-2">
                                  <h4 className="text-xs font-bold text-slate-900 leading-tight">{String(state.title || state.complaintNo || r.id.slice(0,8))}</h4>
                                  <span className="text-[9px] px-1.5 py-0.5 bg-red-50 border border-red-100 text-red-600 rounded uppercase font-bold shrink-0">{statusOf(r).replace("_", " ")}</span>
                                </div>
                                <div className="text-[11px] font-medium text-slate-600 mb-3 line-clamp-2 leading-relaxed">{String(state.description || "No description provided.")}</div>
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold text-slate-500">
                                  <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">{cat}</span>
                                  <span className="flex items-center gap-1"><Clock className="w-3 h-3"/>{new Date(r.createdAt).toLocaleDateString()}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </>
              )}
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}
