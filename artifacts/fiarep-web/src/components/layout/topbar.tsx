import { Bell, ChevronDown, MoreHorizontal } from "lucide-react";
import { getListNotificationsQueryKey, useListNotifications } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { isCoverageEligible } from "@/lib/access-policy";
import { CoverSiteButton } from "@/components/layout/cover-site-button";
import { Link } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar({ sidebarOpen, onMenuClick }: { sidebarOpen: boolean; onMenuClick: () => void }) {
  const { staff, logout } = useAuth();
  const { data: notifications } = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      refetchInterval: 30_000,
      staleTime: 15_000,
      refetchOnMount: "always",
    },
  });
  const unreadCount = (notifications ?? []).filter((notification) => !notification.read).length;
  
  // Extract initials
  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  return (
    <header className="bg-card border-b border-border px-4 md:px-[30px] h-[68px] flex items-center justify-between sticky top-0 z-20 shrink-0">
      <div className="flex items-center gap-3.5">
        {!sidebarOpen && (
          <button
            type="button"
            className="grid place-items-center w-10 h-10 rounded-[9px] border border-border bg-white cursor-pointer text-foreground hover:bg-muted"
            onClick={onMenuClick}
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        )}
        <div className="text-[20px] font-extrabold tracking-[.3px] leading-tight">
          FIA<span className="text-[#F5B301]">REP</span>
          <small className="block text-[10.5px] font-medium text-muted-foreground tracking-normal">
            Field Inspection, Assessment, Repair, Estimation &amp; Property Operations Platform
          </small>
        </div>
      </div>
      
      <div className="flex items-center gap-5 md:gap-[22px]">
        {isCoverageEligible(staff) && <CoverSiteButton />}
        <Link href="/notifications" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"} className="relative text-muted-foreground cursor-pointer hover:text-foreground transition-colors block">
          <Bell className={`w-[22px] h-[22px] ${unreadCount > 0 ? "notification-bell-unread text-[#b77900]" : ""}`} />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-[#F5B301] text-sidebar text-[10px] font-bold min-w-[17px] h-[17px] px-1 rounded-full grid place-items-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>
        
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 cursor-pointer outline-none">
            <div className="w-[38px] h-[38px] rounded-full bg-gradient-to-br from-[#3d6fa8] to-[#185FA5] text-white grid place-items-center font-bold text-sm shrink-0">
              {staff ? getInitials(staff.name) : "US"}
            </div>
            <div className="hidden md:block leading-tight text-left">
              <b className="text-[13.5px] font-bold block">{staff?.name || "User"}</b>
              <span className="text-[11.5px] text-muted-foreground block capitalize">{staff?.role || "Staff"}</span>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground hidden md:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:bg-destructive/10 cursor-pointer">
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
