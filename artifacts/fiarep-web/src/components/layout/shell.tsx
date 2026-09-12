import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { PageBackButton } from "./page-back-button";

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar sidebarOpen={sidebarOpen} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 md:p-[28px_30px_40px]">
          {location !== "/" && location !== "/dashboard" && <PageBackButton />}
          {children}
        </main>
      </div>
    </div>
  );
}
