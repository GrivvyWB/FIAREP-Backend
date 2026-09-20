import { useEffect, useMemo, useState } from "react";
import { getListEntityRecordsQueryKey, useListEntityRecords } from "@workspace/api-client-react";
import { 
  Building2, ChevronRight, Clock, 
  Flame, Loader2, MapPin, Search, 
  Siren, Target, X, AlertOctagon, CheckSquare, Building
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type Report = { id: string; development?: string | null; state?: Record<string, unknown>; createdAt: string; updatedAt: string; version: number };
const DEVELOPMENTS_PER_ROTATION = 10;
const DEVELOPMENT_ROTATION_MS = 30 * 60 * 1000;

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
function addressOf(r: Report) { return getField(r, ["address", "buildingAddress", "building"], "Unknown Address"); }
function categoryOf(r: Report) { return getField(r, ["category", "type", "complaintType"], "Uncategorized"); }
function boroughOf(r: Report) { return getField(r, ["borough"], ""); }
function tradeOf(r: Report) { return getField(r, ["trade", "assignedTrade", "tradeName"], ""); }

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

function SummaryCard({ title, value, subValue, icon: Icon, testId }: { title: string, value: string | number, subValue?: string, icon: React.ElementType, testId: string }) {
  return (
    <div className="bg-red-950/20 border border-red-900/40 rounded-xl p-3 flex flex-col relative overflow-hidden" data-testid={testId}>
      <Icon className="absolute -right-2 -top-2 w-12 h-12 text-red-900/20" />
      <div className="text-[10px] font-bold text-red-500/80 uppercase tracking-wider mb-1 relative z-10">{title}</div>
      <div className="text-xl font-black text-red-50 truncate relative z-10">{value}</div>
      {subValue && <div className="text-[10px] text-red-300 truncate mt-0.5 relative z-10">{subValue}</div>}
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
  
  // Filters
  const [search, setSearch] = useState("");
  const [boroughFilter, setBoroughFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tradeFilter, setTradeFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [developmentPage, setDevelopmentPage] = useState(0);

  // Detail View State
  const [selectedDev, setSelectedDev] = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);

  const filterOptions = useMemo(() => {
    const boroughs = new Set<string>();
    const categories = new Set<string>();
    const trades = new Set<string>();
    
    reports.forEach(r => {
      const boro = boroughOf(r);
      const cat = categoryOf(r);
      const trd = tradeOf(r);
      
      if (boro) boroughs.add(boro);
      if (cat && cat !== "Uncategorized") categories.add(cat);
      if (trd) trades.add(trd);
    });
    
    return {
      boroughs: Array.from(boroughs).sort(),
      categories: Array.from(categories).sort(),
      trades: Array.from(trades).sort(),
    };
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const dev = r.development || "";
      const addr = addressOf(r).toLowerCase();
      const boro = boroughOf(r).toLowerCase();
      const cat = categoryOf(r).toLowerCase();
      const trd = tradeOf(r).toLowerCase();
      
      if (search) {
        const q = search.toLowerCase();
        if (!dev.toLowerCase().includes(q) && !addr.includes(q)) return false;
      }
      
      if (boroughFilter !== "all" && boro !== boroughFilter.toLowerCase()) return false;
      if (categoryFilter !== "all" && cat !== categoryFilter.toLowerCase()) return false;
      if (tradeFilter !== "all" && trd !== tradeFilter.toLowerCase()) return false;
      
      const time = new Date(r.createdAt).getTime();
      if (fromDate && time < new Date(fromDate).getTime()) return false;
      if (toDate && time >= new Date(toDate).getTime() + 86400000) return false;
      
      return true;
    });
  }, [reports, search, boroughFilter, categoryFilter, tradeFilter, fromDate, toDate]);

  const { devStats, bldgStats, globalStats } = useMemo(() => {
    const devs = new Map<string, Stats>();
    const bldgs = new Map<string, Stats>();
    const glob = { active: 0, oldest: null as number | null, recentlyCorrected: 0 };
    const now = Date.now();
    
    filteredReports.forEach(r => {
      const devName = r.development || "Unassigned";
      const bldgName = addressOf(r);
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
  }, [filteredReports, sortOrder]);

  const developmentPageCount = Math.max(
    1,
    Math.ceil(devStats.length / DEVELOPMENTS_PER_ROTATION),
  );
  const visibleDevelopments = devStats.slice(
    developmentPage * DEVELOPMENTS_PER_ROTATION,
    (developmentPage + 1) * DEVELOPMENTS_PER_ROTATION,
  );

  useEffect(() => {
    setDevelopmentPage(0);
  }, [search, boroughFilter, categoryFilter, tradeFilter, fromDate, toDate, sortOrder]);

  useEffect(() => {
    setDevelopmentPage((current) => Math.min(current, developmentPageCount - 1));
    if (developmentPageCount <= 1) return;
    const timer = window.setInterval(() => {
      setDevelopmentPage((current) => (current + 1) % developmentPageCount);
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

  const selectClass = "h-9 rounded-md border border-red-900/50 bg-black/50 text-red-100 text-xs px-3 py-1 focus:ring-1 focus:ring-red-500/50 outline-none";

  return (
    <div className="relative min-h-[calc(100vh-4rem)] bg-[#0f0404] text-slate-300 p-4 -m-4 md:-m-[28px_30px_40px] md:p-6 lg:p-8 overflow-hidden font-sans border border-red-950/40" style={{ colorScheme: 'dark' }}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-red-900/20 via-[#0f0404] to-[#0f0404] -z-10" />
      
      <header className="mb-6 flex flex-col gap-4 border-b border-red-900/40 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Siren className="w-5 h-5 text-red-500" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-red-50">Upper Management Complaint Command</h1>
          </div>
          <p className="text-sm text-red-200/60 max-w-2xl">High-stakes operational surface. Real-time active complaint concentration mapping and deep drill-down analytics.</p>
        </div>

        {/* 7 Summary Panels */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mt-2">
          <SummaryCard title="Total Active" value={globalStats.active} icon={Siren} testId="metric-total-active" />
          <SummaryCard title="Devs w/ Active" value={devStats.length} icon={Building2} testId="metric-devs-active" />
          <SummaryCard title="Bldgs w/ Active" value={bldgStats.length} icon={Building} testId="metric-bldgs-active" />
          <SummaryCard title="Most Active Dev" value={topDev?.name || "-"} subValue={topDev ? `${topDev.activeCount} active` : ""} icon={Flame} testId="metric-top-dev" />
          <SummaryCard title="Most Active Bldg" value={topBldg?.name || "-"} subValue={topBldg ? `${topBldg.activeCount} active` : ""} icon={AlertOctagon} testId="metric-top-bldg" />
          <SummaryCard title="Oldest Open" value={globalStats.oldest ? `${Math.floor((Date.now() - globalStats.oldest)/86400000)}d ago` : "-"} subValue={globalStats.oldest ? new Date(globalStats.oldest).toLocaleDateString() : ""} icon={Clock} testId="metric-oldest" />
          <SummaryCard title="Recently Corrected" value={globalStats.recentlyCorrected} subValue="Last 14 days" icon={CheckSquare} testId="metric-corrected" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 bg-red-950/10 p-3 border border-red-950/60 rounded-xl">
          <div className="relative min-w-[200px] flex-1">
             <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500/50" />
             <Input 
               placeholder="Search dev or address..." 
               value={search} 
               onChange={e => setSearch(e.target.value)} 
               className="pl-9 h-9 bg-black/50 border-red-900/50 text-red-100 placeholder:text-red-500/30 focus-visible:ring-red-500/50 text-xs"
               data-testid="filter-search" 
             />
          </div>
          <select value={boroughFilter} onChange={e => setBoroughFilter(e.target.value)} className={selectClass} data-testid="filter-borough">
            <option value="all">All Boroughs</option>
            {filterOptions.boroughs.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={selectClass} data-testid="filter-category">
            <option value="all">All Categories</option>
            {filterOptions.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={tradeFilter} onChange={e => setTradeFilter(e.target.value)} className={selectClass} data-testid="filter-trade">
            <option value="all">All Trades</option>
            {filterOptions.trades.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="flex items-center gap-2 bg-black/30 rounded-md border border-red-900/50 px-2">
            <span className="text-[10px] text-red-400/70 uppercase">From</span>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 bg-transparent text-red-100 text-xs outline-none" data-testid="filter-from-date" />
          </div>
          <div className="flex items-center gap-2 bg-black/30 rounded-md border border-red-900/50 px-2">
            <span className="text-[10px] text-red-400/70 uppercase">To</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-8 bg-transparent text-red-100 text-xs outline-none" data-testid="filter-to-date" />
          </div>
          <select value={sortOrder} onChange={e => setSortOrder(e.target.value as "desc" | "asc")} className={selectClass} data-testid="filter-sort">
            <option value="desc">Sort: High to Low</option>
            <option value="asc">Sort: Low to High</option>
          </select>
        </div>
      </header>

      {reportsQuery.isLoading ? (
        <div className="flex items-center justify-center p-20 text-red-500/60" data-testid="dashboard-loading">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col xl:flex-row gap-6 h-[calc(100vh-24rem)] min-h-[500px]">
          
          {/* Main Concentration Surface */}
          <div className="flex-1 flex flex-col min-w-0 bg-black/40 border border-red-950/60 rounded-xl overflow-hidden shadow-2xl shadow-red-950/20 backdrop-blur-sm">
            <div className="p-4 border-b border-red-900/30 bg-red-950/20 flex flex-wrap items-center gap-4 justify-between">
              <div>
                <div className="flex items-center gap-2 text-red-100 font-semibold">
                  <Flame className="w-4 h-4 text-red-500" />
                  Active Development Concentrations
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-red-400/60">
                  Showing {visibleDevelopments.length} of {devStats.length} developments · Rotates every 30 minutes
                </div>
              </div>
            </div>
            
            <ScrollArea className="flex-1 p-4">
              {devStats.length === 0 ? (
                <div className="p-10 text-center text-red-500/40 text-sm">No active developments matching criteria.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-10 gap-2">
                  {visibleDevelopments.map(dev => {
                    const intensity = dev.activeCount >= 20
                      ? "bg-red-600 border-red-300 text-white animate-pulse shadow-lg shadow-red-600/60"
                      : dev.activeCount >= 10
                        ? "bg-orange-600/90 border-orange-300 text-white animate-pulse shadow-md shadow-orange-600/40"
                        : dev.activeCount >= 5
                          ? "bg-orange-900/70 border-orange-600/70 text-orange-50"
                          : "bg-red-950/40 border-red-900/40 text-red-200";
                    return (
                      <button
                        key={dev.name}
                        onClick={() => { setSelectedDev(dev.name); setSelectedBuilding(null); }}
                        className={`text-left rounded-lg p-2.5 border transition-all ${intensity} ${selectedDev === dev.name ? "ring-2 ring-red-400 ring-offset-2 ring-offset-[#0f0404] shadow-lg shadow-red-900/50 scale-105 z-10" : "hover:border-red-400/50 hover:bg-red-900/80"}`}
                        data-testid={`dev-card-${dev.name.replace(/\s+/g, '-')}`}
                      >
                        <div className="text-[22px] font-black leading-none mb-1">{dev.activeCount}</div>
                        <div className="text-[10px] font-bold uppercase truncate opacity-90 mb-2" title={dev.name}>{dev.name}</div>
                        <div className="text-[9px] opacity-70 flex flex-col gap-0.5">
                          <span>{dev.correctedCount} corrected</span>
                          {dev.oldestActive && <span>Old: {new Date(dev.oldestActive).toLocaleDateString()}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            {developmentPageCount > 1 && (
              <div className="flex items-center justify-between border-t border-red-900/30 bg-red-950/20 px-4 py-2">
                <button
                  type="button"
                  onClick={() => setDevelopmentPage((current) => (current - 1 + developmentPageCount) % developmentPageCount)}
                  className="rounded border border-red-900/50 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-900/40"
                  data-testid="button-previous-development-rotation"
                >
                  Previous 10
                </button>
                <span className="text-xs font-semibold text-red-300" data-testid="text-development-rotation-page">
                  Group {developmentPage + 1} of {developmentPageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setDevelopmentPage((current) => (current + 1) % developmentPageCount)}
                  className="rounded border border-red-900/50 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-900/40"
                  data-testid="button-next-development-rotation"
                >
                  Next 10
                </button>
              </div>
            )}
          </div>

          {/* Drill-down Panel */}
          <div className={`w-full xl:w-[450px] shrink-0 flex flex-col gap-4 transition-all duration-300 ${selectedDev ? "translate-x-0 opacity-100" : "xl:translate-x-4 opacity-0 xl:hidden pointer-events-none hidden xl:flex"}`}>
            
            {/* Development Detail */}
            {selectedDevData && (
              <div className="flex-1 flex flex-col min-h-0 bg-black/60 border border-red-900/50 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md">
                <div className="p-4 border-b border-red-900/40 bg-gradient-to-r from-red-950/80 to-transparent relative">
                  <button onClick={() => setSelectedDev(null)} className="absolute right-3 top-3 p-1 text-red-400/50 hover:text-red-100 hover:bg-red-900/50 rounded-md" data-testid="close-dev-detail"><X className="w-4 h-4" /></button>
                  <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Development Focus</div>
                  <h2 className="text-lg font-bold text-red-50 pr-8">{selectedDevData.name}</h2>
                  <div className="flex gap-4 mt-3">
                    <div>
                      <div className="text-[10px] text-red-400/70 uppercase">Active</div>
                      <div className="text-xl font-black text-red-400">{selectedDevData.activeCount}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-500/70 uppercase">Corrected</div>
                      <div className="text-xl font-black text-emerald-500">{selectedDevData.correctedCount}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-red-400/70 uppercase">Oldest</div>
                      <div className="text-sm font-semibold text-red-200 mt-1">{selectedDevData.oldestActive ? new Date(selectedDevData.oldestActive).toLocaleDateString() : "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-red-400/70 uppercase">Latest</div>
                      <div className="text-sm font-semibold text-red-200 mt-1">{selectedDevData.latestActive ? new Date(selectedDevData.latestActive).toLocaleDateString() : "N/A"}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-red-300">
                    {Object.entries(selectedDevData.categories).map(([cat, count]) => (
                      <span key={cat} className="bg-red-950/40 px-2 py-1 rounded border border-red-900/30">{cat} ({count})</span>
                    ))}
                  </div>
                </div>

                {/* Buildings in Dev */}
                <div className="p-3 border-b border-red-900/30 bg-red-950/10 flex items-center justify-between text-xs font-semibold text-red-200">
                  <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Building Clusters</span>
                  <span>{devBuildings.length} active</span>
                </div>
                
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1">
                    {devBuildings.map(bldg => (
                      <button
                        key={bldg.name}
                        onClick={() => setSelectedBuilding(bldg.name === selectedBuilding ? null : bldg.name)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center justify-between group ${selectedBuilding === bldg.name ? "bg-red-900/40 border-red-500/50" : "bg-black/40 border-transparent hover:bg-red-950/40 hover:border-red-900/30"}`}
                        data-testid={`bldg-row-${bldg.name.replace(/\s+/g, '-')}`}
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="text-sm font-bold text-red-100 truncate" title={bldg.name}>{bldg.name}</div>
                          <div className="text-[10px] text-red-400/60 mt-0.5 flex flex-wrap gap-2">
                            <span>{bldg.correctedCount} corrected</span>
                            {bldg.oldestActive && <span>Old: {new Date(bldg.oldestActive).toLocaleDateString()}</span>}
                            {bldg.latestActive && <span>New: {new Date(bldg.latestActive).toLocaleDateString()}</span>}
                            {Object.entries(bldg.categories).slice(0,2).map(([c, n]) => <span key={c}>{c}:{n}</span>)}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-center">
                            <div className="text-lg font-black text-red-500 leading-none">{bldg.activeCount}</div>
                          </div>
                          <ChevronRight className={`w-4 h-4 text-red-500/50 transition-transform ${selectedBuilding === bldg.name ? "rotate-90" : "group-hover:translate-x-0.5"}`} />
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Building Detail (Complaints) */}
            {selectedBldgData && (
              <div className="flex-1 flex flex-col min-h-0 bg-[#160505] border border-red-700/50 rounded-xl overflow-hidden shadow-2xl shadow-red-900/20 backdrop-blur-md">
                <div className="p-3 border-b border-red-900/50 bg-red-950/40 flex justify-between items-center">
                  <div className="font-bold text-sm text-red-50 truncate pr-2"><MapPin className="inline w-3.5 h-3.5 mr-1 text-red-500" />{selectedBldgData.name}</div>
                  <button onClick={() => setSelectedBuilding(null)} className="p-1 text-red-400/50 hover:text-red-100" data-testid="close-bldg-detail"><X className="w-3.5 h-3.5" /></button>
                </div>
                <ScrollArea className="flex-1 p-2">
                  <div className="space-y-2">
                    {selectedBldgData.reports.filter(r => !isCorrected(statusOf(r))).sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map(r => {
                      const state = r.state || {};
                      const cat = categoryOf(r);
                      return (
                        <div key={r.id} className="p-3 bg-black/60 border border-red-900/30 rounded-lg" data-testid={`complaint-${r.id}`}>
                          <div className="flex justify-between items-start mb-1.5 gap-2">
                            <h4 className="text-xs font-bold text-red-100 leading-tight">{String(state.title || state.complaintNo || r.id.slice(0,8))}</h4>
                            <span className="text-[9px] px-1.5 py-0.5 bg-red-950 text-red-400 rounded uppercase font-bold shrink-0">{statusOf(r).replace("_", " ")}</span>
                          </div>
                          <div className="text-[11px] text-red-200/70 mb-2 line-clamp-2">{String(state.description || "No description provided.")}</div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-red-500/60 font-medium">
                            <span className="bg-red-950/50 px-1.5 py-0.5 rounded border border-red-900/30">{cat}</span>
                            <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          
        </div>
      )}

      {/* Top 10 Overlay / Extra Analytics */}
      {!selectedDev && !reportsQuery.isLoading && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
          <div className="bg-black/30 border border-red-900/30 rounded-xl p-4">
            <h3 className="text-sm font-bold text-red-200 mb-4 flex items-center gap-2"><Target className="w-4 h-4 text-red-500" />{sortOrder === "desc" ? "Top 10 Critical Developments" : "Lowest 10 Active Developments"}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {devStats.slice(0, 10).map((d, i) => (
                <div key={d.name} className="flex justify-between items-center text-xs border-b border-red-950/50 pb-1" data-testid={`top-dev-${i}`}>
                  <span className="text-red-100/80 truncate pr-2"><span className="text-red-600 font-black mr-2">{i+1}.</span>{d.name}</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] text-red-500/50">{d.correctedCount} corr</span>
                    <span className="font-bold text-red-400">{d.activeCount} act</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-black/30 border border-red-900/30 rounded-xl p-4">
            <h3 className="text-sm font-bold text-red-200 mb-4 flex items-center gap-2"><AlertOctagon className="w-4 h-4 text-red-500" />{sortOrder === "desc" ? "Top 10 Critical Buildings" : "Lowest 10 Active Buildings"}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {bldgStats.slice(0, 10).map((b, i) => (
                <div key={b.name} className="flex justify-between items-center text-xs border-b border-red-950/50 pb-1" data-testid={`top-bldg-${i}`}>
                  <span className="text-red-100/80 truncate pr-2" title={b.name}><span className="text-red-600 font-black mr-2">{i+1}.</span>{b.name}</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] text-red-500/50">{b.correctedCount} corr</span>
                    <span className="font-bold text-red-400">{b.activeCount} act</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
