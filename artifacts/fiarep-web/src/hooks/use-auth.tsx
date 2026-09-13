import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { setAuthTokenGetter, setAuthRefreshHandler, setBaseUrl, Staff, useGetCurrentStaff, useRefreshSession, getGetCurrentStaffQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

interface AuthContextType {
  staff: Staff | null;
  isLoading: boolean;
  login: (name: string, code: string, organizationId?: string) => Promise<
    { status: "authenticated" } |
    { status: "procurement-verification"; challengeCode: string; challengeToken: string }
  >;
  procurementLogin: (name: string, code: string, challengeCode: string, challengeToken: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshMutation = useRefreshSession();
  let refreshInFlight: Promise<string | null> | null = null;
  
  const { refetch: fetchCurrentStaff } = useGetCurrentStaff({
    query: {
      enabled: false,
      retry: false,
      queryKey: getGetCurrentStaffQueryKey(),
    }
  });

  useEffect(() => {
    // The same QueryClient is shared across sessions and the platform-owner
    // console. Never let a previous identity's tenant data remain visible.
    queryClient.clear();
    setBaseUrl("");
    
    // Register token getter for all customFetch calls
    setAuthTokenGetter(() => {
      return localStorage.getItem("fiarep_access_token");
    });
    setAuthRefreshHandler(() => {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = (async () => {
        const token = localStorage.getItem("fiarep_refresh_token");
        if (!token) {
          localStorage.removeItem("fiarep_access_token");
          queryClient.clear();
          setStaff(null);
          return null;
        }
        try {
          const response = await fetch("/api/v1/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: token }) });
          if (!response.ok) throw new Error("Staff session refresh failed");
          const session = await response.json() as { accessToken: string; refreshToken: string };
          localStorage.setItem("fiarep_access_token", session.accessToken);
          localStorage.setItem("fiarep_refresh_token", session.refreshToken);
          return session.accessToken;
        } catch {
          localStorage.removeItem("fiarep_access_token");
          localStorage.removeItem("fiarep_refresh_token");
          queryClient.clear();
          setStaff(null);
          return null;
        } finally { refreshInFlight = null; }
      })();
      return refreshInFlight;
    });

    const initAuth = async () => {
      try {
        const accessToken = localStorage.getItem("fiarep_access_token");
        const refreshToken = localStorage.getItem("fiarep_refresh_token");
        
        if (accessToken) {
          const { data, error } = await fetchCurrentStaff();
          if (data && !error) {
            setStaff(data);
            setIsLoading(false);
            return;
          }
        }
        
      if (refreshToken) {
          const res = await refreshMutation.mutateAsync({ data: { refreshToken } });
          localStorage.setItem("fiarep_access_token", res.accessToken);
          localStorage.setItem("fiarep_refresh_token", res.refreshToken);
          const { data: newStaff } = await fetchCurrentStaff();
          if (newStaff) {
            setStaff(newStaff);
          } else {
            throw new Error("Validation failed after refresh");
          }
        } else {
          localStorage.removeItem("fiarep_access_token");
        }
      } catch (err) {
        console.error("Failed to restore session", err);
        localStorage.removeItem("fiarep_access_token");
        localStorage.removeItem("fiarep_refresh_token");
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (
    name: string,
    code: string,
    organizationId?: string,
  ): Promise<
    { status: "authenticated" } |
    { status: "procurement-verification"; challengeCode: string; challengeToken: string }
  > => {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code, ...(organizationId ? { organizationId } : {}) }),
    });
    const payload = await response.json();
    if (response.status === 202 && payload?.requiresProcurementVerification === true) {
      return {
        status: "procurement-verification",
        challengeCode: payload.challengeCode,
        challengeToken: payload.challengeToken,
      };
    }
    if (!response.ok) throw new Error(payload?.error || "Invalid staff name or code");
    localStorage.setItem("fiarep_access_token", payload.accessToken);
    localStorage.setItem("fiarep_refresh_token", payload.refreshToken);
    queryClient.clear();
    setStaff(payload.staff);
    return { status: "authenticated" };
  };

  const procurementLogin = async (name: string, code: string, challengeCode: string, challengeToken: string) => {
    const response = await fetch("/api/v1/auth/procurement/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code, challengeCode, challengeToken }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || "Invalid procurement credentials");
    localStorage.setItem("fiarep_access_token", payload.accessToken);
    localStorage.setItem("fiarep_refresh_token", payload.refreshToken);
    queryClient.clear();
    setStaff(payload.staff);
  };

  const logout = () => {
    localStorage.removeItem("fiarep_access_token");
    localStorage.removeItem("fiarep_refresh_token");
    queryClient.clear();
    setStaff(null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        staff,
        isLoading,
        login,
        procurementLogin,
        logout,
        isAuthenticated: !!staff,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
