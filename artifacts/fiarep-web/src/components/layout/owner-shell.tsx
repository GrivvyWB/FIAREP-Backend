import { ReactNode } from "react";
import { useOwnerAuth } from "@/hooks/use-owner-auth";
import { Button } from "@/components/ui/button";
import { Building2, LogOut, PanelsTopLeft, ShieldAlert } from "lucide-react";
import { Link, useLocation } from "wouter";

export function OwnerShell({ children }: { children: ReactNode }) {
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

      <nav className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-end gap-6">
          <Link
            href="/platform-owner"
            className={`h-12 flex items-center gap-2 border-b-2 text-sm font-semibold transition-colors ${
              location === "/platform-owner"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Building2 className="h-4 w-4" />
            Organizations
          </Link>
          <Link
            href="/platform-owner/modules"
            className={`h-12 flex items-center gap-2 border-b-2 text-sm font-semibold transition-colors ${
              location === "/platform-owner/modules"
                ? "border-[#185FA5] text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <PanelsTopLeft className="h-4 w-4" />
            Module Management
          </Link>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
