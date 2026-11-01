import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { PageBackButton } from "./page-back-button";
import { useMessageAlerts } from "@/hooks/use-message-alerts";
import { useToast } from "@/hooks/use-toast";

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  // A new message anywhere: chime, desktop notice, and a note on the screen.
  useMessageAlerts((who, body) => toast({ title: `New message from ${who}`, description: body }));
  // Every page change checks the sign-in is still good (at most every 10 s): a sign-in made with a
  // code that has since been changed is stopped right there and sent back to sign in.
  const lastCheck = useRef(0);
  useEffect(() => {
    if (Date.now() - lastCheck.current < 10_000) return;
    lastCheck.current = Date.now();
    void customFetch("/api/v1/auth/me", { responseType: "json" } as never).catch(() => undefined);
  }, [location]);

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
