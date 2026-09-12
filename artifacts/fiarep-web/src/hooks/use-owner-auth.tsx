import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { setAuthTokenGetter, setAuthRefreshHandler, usePlatformOwnerLogin } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

interface OwnerAuthContextType {
  ownerName: string | null;
  isLoading: boolean;
  login: (name: string, code: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const OwnerAuthContext = createContext<OwnerAuthContextType | undefined>(undefined);

export function OwnerAuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loginMutation = usePlatformOwnerLogin();
  let refreshInFlight: Promise<string | null> | null = null;

  useEffect(() => {
    queryClient.clear();
    // When inside OwnerAuthProvider, we always provide the owner token
    setAuthTokenGetter(() => {
      return localStorage.getItem("fiarep_owner_access_token");
    });
    setAuthRefreshHandler(() => {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = (async () => {
        try {
          const response = await fetch("/api/v1/platform/auth/refresh", { method: "POST", credentials: "include" });
          if (!response.ok) throw new Error("Owner session refresh failed");
          const session = await response.json() as { accessToken: string; ownerName: string };
          localStorage.setItem("fiarep_owner_access_token", session.accessToken);
          localStorage.setItem("fiarep_owner_name", session.ownerName);
          setOwnerName(session.ownerName);
          return session.accessToken;
        } catch {
          localStorage.removeItem("fiarep_owner_access_token");
          localStorage.removeItem("fiarep_owner_name");
          setOwnerName(null);
          return null;
        } finally { refreshInFlight = null; }
      })();
      return refreshInFlight;
    });

    const initAuth = async () => {
      const accessToken = localStorage.getItem("fiarep_owner_access_token");
      try {
        if (accessToken) {
          const me = await fetch("/api/v1/platform/auth/me", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (me.ok) {
            const owner = (await me.json()) as { name?: string };
            if (owner.name) setOwnerName(owner.name);
            return;
          }
          const refreshed = await fetch("/api/v1/platform/auth/refresh", { method: "POST", credentials: "include" });
          if (refreshed.ok) {
            const session = (await refreshed.json()) as { accessToken: string; ownerName: string };
            localStorage.setItem("fiarep_owner_access_token", session.accessToken);
            localStorage.setItem("fiarep_owner_name", session.ownerName);
            setOwnerName(session.ownerName);
            return;
          }
        }
      } finally {
        if (!localStorage.getItem("fiarep_owner_access_token")) {
          localStorage.removeItem("fiarep_owner_access_token");
          localStorage.removeItem("fiarep_owner_name");
        }
        setIsLoading(false);
      }
    };

    void initAuth();
    return () => {
      // Restore the staff auth strategy when leaving the owner console.
      setAuthTokenGetter(() => localStorage.getItem("fiarep_access_token"));
      let staffRefreshInFlight: Promise<string | null> | null = null;
      setAuthRefreshHandler(() => {
        if (staffRefreshInFlight) return staffRefreshInFlight;
        staffRefreshInFlight = (async () => {
          const refreshToken = localStorage.getItem("fiarep_refresh_token");
          if (!refreshToken) return null;
          try {
            const response = await fetch("/api/v1/auth/refresh", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken }),
            });
            if (!response.ok) throw new Error("Staff session refresh failed");
            const session = await response.json() as { accessToken: string; refreshToken: string };
            localStorage.setItem("fiarep_access_token", session.accessToken);
            localStorage.setItem("fiarep_refresh_token", session.refreshToken);
            return session.accessToken;
          } catch {
            localStorage.removeItem("fiarep_access_token");
            localStorage.removeItem("fiarep_refresh_token");
            return null;
          } finally { staffRefreshInFlight = null; }
        })();
        return staffRefreshInFlight;
      });
    };
  }, []);

  const login = async (name: string, code: string) => {
    const res = await loginMutation.mutateAsync({ data: { name, code } });
    localStorage.setItem("fiarep_owner_access_token", res.accessToken);
    localStorage.setItem("fiarep_owner_name", res.ownerName ?? name);
    queryClient.clear();
    setOwnerName(res.ownerName ?? name);
  };

  const logout = () => {
    localStorage.removeItem("fiarep_owner_access_token");
    queryClient.clear();
    void fetch("/api/v1/platform/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    localStorage.removeItem("fiarep_owner_name");
    setOwnerName(null);
    setLocation("/platform-owner/login");
  };

  return (
    <OwnerAuthContext.Provider
      value={{
        ownerName,
        isLoading,
        login,
        logout,
        isAuthenticated: !!ownerName,
      }}
    >
      {children}
    </OwnerAuthContext.Provider>
  );
}

export function useOwnerAuth() {
  const context = useContext(OwnerAuthContext);
  if (!context) {
    throw new Error("useOwnerAuth must be used within an OwnerAuthProvider");
  }
  return context;
}
