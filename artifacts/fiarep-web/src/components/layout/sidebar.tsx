import { Link, useLocation } from "wouter";
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
  Plane
} from "lucide-react";

export function Sidebar({ open, setOpen }: { open: boolean, setOpen: (open: boolean) => void }) {
  const [location] = useLocation();

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Inspections", href: "/inspections", icon: ClipboardCheck },
    { name: "Estimates", href: "/estimates", icon: FileText },
    { name: "Repairs", href: "/repairs", icon: Wrench },
    { name: "Projects", href: "/projects", icon: Briefcase },
    { name: "Reports", href: "/reports", icon: FolderOpen },
    { name: "Calendar", href: "/calendar", icon: CalendarDays },
    { name: "Clients", href: "/clients", icon: Users },
    { name: "Team", href: "/team", icon: UsersRound },
    { name: "Violations", href: "/violations", icon: AlertTriangle },
    { name: "Procurement", href: "/procurement", icon: ShoppingCart },
    { name: "Emergency", href: "/emergency", icon: BellRing },
    { name: "Elevators", href: "/elevators", icon: ArrowUpToLine },
    { name: "Leave", href: "/leave", icon: Plane },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <>
      <aside 
        className={`w-[264px] bg-sidebar text-sidebar-foreground flex flex-col flex-shrink-0 fixed md:sticky top-0 h-[100dvh] z-60 transition-transform duration-250 ease-in-out ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="p-[18px_16px_16px] border-b border-sidebar-border flex justify-center shrink-0">
          <div className="font-bold text-2xl tracking-tight text-white flex items-center gap-2">
            FIA<span className="text-primary">REP</span>
          </div>
        </div>

        <nav className="p-[14px_12px] flex-1 overflow-y-auto overflow-x-hidden space-y-[3px]">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link 
                key={item.name} 
                href={item.href}
                onClick={() => setOpen(false)}
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
          <Link href="/inspections/new" onClick={() => setOpen(false)}>
            <div className="w-full border-none cursor-pointer p-[11px] rounded-[9px] text-[13.5px] font-semibold flex items-center justify-center gap-2 mb-2 bg-primary text-sidebar hover:bg-[#F5B301] transition-colors">
              <Plus className="w-4 h-4" />
              New Inspection
            </div>
          </Link>
          <Link href="/reports/upload" onClick={() => setOpen(false)}>
            <div className="w-full border border-[#2a323e] cursor-pointer p-[11px] rounded-[9px] text-[13.5px] font-semibold flex items-center justify-center gap-2 bg-transparent text-[#cfd6df] hover:bg-[#1a212b] transition-colors">
              <Upload className="w-4 h-4" />
              Upload Report
            </div>
          </Link>
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
