import { ReactNode, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useOwnerAuth } from "@/hooks/use-owner-auth";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, BellRing, Building2, ClipboardList, DollarSign, FileText, Landmark, LayoutDashboard, LogOut, PanelsTopLeft, Search, ShieldAlert, Hammer, HardHat, UsersRound } from "lucide-react";
import { Link, useLocation } from "wouter";

export function OwnerShell({ children }: { children: ReactNode }) {
  // Unseen violation alerts: red blinking badge on the Alerts tab, refreshed every minute.
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = async () => { try { const r = await customFetch<{ unseen: number }>("/api/v1/platform/alerts/summary", { responseType: "json" } as never); if (alive) setUnseen(r.unseen); } catch { /* badge stays */ } };
    void poll(); const t = setInterval(() => void poll(), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const { ownerName, logout } = useOwnerAuth();
  const [location, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-slate-950 border-b border-slate-800 text-slate-50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xl font-bold tracking-tight cursor-pointer" onClick={() => setLocation("/platform-owner")}>
              <span>FIA<span className="text-[#F5B301]">REP</span></span>
            </div>
            <div className="h-5 w-px bg-slate-700" />
            <div className="flex items-center gap-2 text-sm font-medium text-slate-300 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700/50">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              Platform Control
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-400">
              Authorized as <span className="font-semibold text-slate-200">{ownerName}</span>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={logout}
              className="text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Terminate Session
            </Button>
          </div>
        </div>
      </header>

      {/* Tabs on the right side of the page (a row on top on small screens). */}
      <div className="flex-1 flex flex-col lg:flex-row-reverse">
      <nav className="border-b lg:border-b-0 lg:border-l border-slate-200 bg-white lg:w-60 lg:shrink-0">
        <div className="px-4 py-2 lg:px-3 lg:py-4 flex flex-wrap lg:flex-col gap-x-5 gap-y-1 lg:gap-1 lg:sticky lg:top-16">
          <Link
            href="/platform-owner"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Building2 className="h-4 w-4" />
            Organizations
          </Link>
          <Link
            href="/platform-owner/properties"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/properties"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Building2 className="h-4 w-4" />
            Properties
          </Link>
          <Link
            href="/platform-owner/modules"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/modules"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <PanelsTopLeft className="h-4 w-4" />
            Module Management
          </Link>
          <Link
            href="/platform-owner/join-requests"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/join-requests"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Building2 className="h-4 w-4" />
            Join requests
          </Link>
          <Link
            href="/platform-owner/work-requests"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/work-requests"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <ClipboardList className="h-4 w-4" />
            Job requests
          </Link>
          <Link
            href="/platform-owner/aep"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/aep"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Landmark className="h-4 w-4" />
            AEP registry
          </Link>
          <Link
            href="/platform-owner/building-lookup"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/building-lookup"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Search className="h-4 w-4" />
            Building lookup
          </Link>
          <Link
            href="/platform-owner/repair-prices"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/repair-prices"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Hammer className="h-4 w-4" />
            Repair price book
          </Link>
          <Link
            href="/platform-owner/pricing"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/pricing"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <DollarSign className="h-4 w-4" />
            Pricing ladder
          </Link>
          <Link
            href="/platform-owner/complaints"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location.startsWith("/platform-owner/complaints")
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            Complaint Dashboard
          </Link>
          <Link
            href="/platform-owner/baseline"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location.startsWith("/platform-owner/baseline")
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <ClipboardCheck className="h-4 w-4" />
            Building Baseline
          </Link>
          <Link
            href="/platform-owner/forms"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/forms"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <FileText className="h-4 w-4" />
            Forms
          </Link>
          <Link
            href="/platform-owner/crew"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/crew"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <HardHat className="h-4 w-4" />
            Crew
          </Link>
          <Link
            href="/platform-owner/fiarep-services"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/fiarep-services"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <UsersRound className="h-4 w-4" />
            FIAREP Services
          </Link>
          <Link
            href="/platform-owner/alerts"
            className={`flex items-center gap-2 py-2 border-b-2 lg:border-b-0 lg:border-l-2 lg:px-3 text-sm font-semibold transition-colors ${
              location === "/platform-owner/alerts"
                ? "border-[#185FA5] text-slate-950"
                : unseen > 0 ? "border-transparent text-rose-700" : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <BellRing className={`h-4 w-4 ${unseen > 0 ? "animate-pulse text-rose-600" : ""}`} />
            Alerts
            {unseen > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white animate-pulse" style={{ animationDuration: "1s" }}>{unseen}</span>}
          </Link>
        </div>
      </nav>

      <main className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      </div>
    </div>
  );
}
