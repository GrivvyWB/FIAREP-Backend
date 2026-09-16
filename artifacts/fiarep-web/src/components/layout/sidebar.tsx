import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { hasModuleAccess } from "@/lib/access-policy";
import { 
  LayoutDashboard, 
  ClipboardCheck, 
  FileText, 
  Wrench, 
  Briefcase, 
  FolderOpen, 
  CalendarDays, 
  Users, 
  UsersRound, 
  Settings,
  Plus,
  Upload,
  AlertTriangle,
  ShoppingCart,
  BellRing,
  ArrowUpToLine,
  Plane,
  Database,
  MoreHorizontal,
  FileCog,
  Target,
  UserCog,
} from "lucide-react";

export function Sidebar({ open, setOpen }: { open: boolean, setOpen: (open: boolean) => void }) {
  const [location] = useLocation();
  const { staff } = useAuth();
  const closeOnMobile = () => {
    if (window.matchMedia("(max-width: 767px)").matches) setOpen(false);
  };

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" as const },
    { name: "Inspections", href: "/inspections", icon: ClipboardCheck, module: "inspections" as const },
    { name: "HUD Inspections", href: "/hud-inspections", icon: ClipboardCheck, module: "hud-inspections" as const },
    { name: "Estimates", href: "/estimates", icon: FileText, module: "estimates" as const },
    { name: "Repairs", href: "/repairs", icon: Wrench, module: "repairs" as const },
    { name: "Projects", href: "/projects", icon: Briefcase, module: "projects" as const },
    { name: "Reports", href: "/reports", icon: FolderOpen, module: "reports" as const },
    { name: "Calendar", href: "/calendar", icon: CalendarDays, module: "calendar" as const },
    { name: "Clients", href: "/clients", icon: Users, module: "clients" as const },
    { name: "Team", href: "/team", icon: UsersRound, module: "team" as const },
    { name: "HR Workspace", href: "/hr", icon: UserCog, module: "hr" as const },
    { name: "Violations", href: "/violations", icon: AlertTriangle, module: "violations" as const },
    ...(staff?.role === "procurement" ? [{ name: "Procurement", href: "/procurement", icon: ShoppingCart, module: "procurement" as const }] : []),
    ...(hasModuleAccess(staff, "scope-review") ? [{ name: "Scope Review", href: "/scope-review", icon: ClipboardCheck, module: "scope-review" as const }] : []),
    ...(hasModuleAccess(staff, "scope-writing") ? [{ name: "Scope Writing", href: "/scope-writing", icon: ClipboardCheck, module: "scope-writing" as const }] : []),
    ...((staff?.role === "management" || staff?.role === "administrator") ? [
      { name: "Emergency", href: "/emergency", icon: BellRing, module: "emergency" as const },
      { name: "Scores", href: "/scores", icon: Target, module: "scores" as const },
    ] : []),
    { name: "Change Orders", href: "/change-orders", icon: FileCog, module: "change-orders" as const },
    { name: "Elevators", href: "/elevators", icon: ArrowUpToLine, module: "elevators" as const },
    { name: "Leave", href: "/leave", icon: Plane, module: "leave" as const },
    { name: "Shared Data", href: "/shared-data", icon: Database, module: "shared-data" as const },
    { name: "Settings", href: "/settings", icon: Settings, module: "settings" as const },
  ].filter((item) => hasModuleAccess(staff, item.module));

  return (
    <>
      <aside 
        className={`w-[264px] bg-sidebar text-sidebar-foreground flex flex-col flex-shrink-0 fixed md:sticky top-0 h-[100dvh] z-60 transition-[transform,width] duration-250 ease-in-out ${
          open ? "translate-x-0 md:w-[264px]" : "-translate-x-full md:w-0 md:overflow-hidden"
        }`}
      >
        <div className="relative w-[264px] border-b border-sidebar-border shrink-0 overflow-hidden bg-white">
          <img
            src={`${import.meta.env.BASE_URL}fiarep-sidebar-logo.png`}
            alt="FIAREP"
            className="block h-auto w-full"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-slate-300 bg-white/90 text-slate-700 shadow-sm hover:bg-white"
            aria-label="Close sidebar"
            title="Close sidebar"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>

        <nav className="p-[14px_12px] flex-1 overflow-y-auto overflow-x-hidden space-y-[3px]">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link 
                key={item.name} 
                href={item.href}
                onClick={closeOnMobile}
                className={`flex items-center gap-3 p-[11px_14px] rounded-[9px] text-[14.5px] font-medium transition-colors ${
                  isActive 
                    ? "bg-primary text-sidebar font-bold" 
                    : "text-[#b7c0cc] hover:bg-sidebar-accent hover:text-white"
                }`}
                data-testid={`nav-link-${item.name.toLowerCase()}`}
              >
                <Icon className={`w-[19px] h-[19px] shrink-0 ${isActive ? "opacity-100" : "opacity-85"}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="m-[8px_16px_18px] p-[16px] bg-[#12161d] border border-sidebar-border rounded-xl shrink-0">
          <h4 className="text-[11px] tracking-[.6px] text-[#8b94a1] mb-3 font-semibold uppercase">QUICK ACTION</h4>
          {hasModuleAccess(staff, "inspection-create") && <Link href="/inspections/new" onClick={closeOnMobile}>
            <div className="w-full border-none cursor-pointer p-[11px] rounded-[9px] text-[13.5px] font-semibold flex items-center justify-center gap-2 mb-2 bg-primary text-sidebar hover:bg-[#F5B301] transition-colors">
              <Plus className="w-4 h-4" />
              New Inspection
            </div>
          </Link>}
          {hasModuleAccess(staff, "report-upload") && <Link href="/reports/upload" onClick={closeOnMobile}>
            <div className="w-full border border-[#2a323e] cursor-pointer p-[11px] rounded-[9px] text-[13.5px] font-semibold flex items-center justify-center gap-2 bg-transparent text-[#cfd6df] hover:bg-[#1a212b] transition-colors">
              <Upload className="w-4 h-4" />
              Upload Report
            </div>
          </Link>}
        </div>

        <div className="p-[16px_22px_20px] text-[11px] text-[#5c6572] border-t border-sidebar-border shrink-0">
          © {new Date().getFullYear()} FIAREP<br />Grivvy Com LLC
        </div>
      </aside>
      
      {open && (
        <div 
          className="fixed inset-0 bg-black/40 z-50 md:hidden" 
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
