import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { setAuthTokenGetter, setBaseUrl, Staff, useLogin, useGetCurrentStaff, useRefreshSession, getGetCurrentStaffQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  staff: Staff | null;
  isLoading: boolean;
  login: (name: string, code: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loginMutation = useLogin();
  const refreshMutation = useRefreshSession();
  
  const { refetch: fetchCurrentStaff } = useGetCurrentStaff({
    query: {
      enabled: false,
      retry: false,
      queryKey: getGetCurrentStaffQueryKey(),
    }
  });

  useEffect(() => {
    setBaseUrl("");
    
    // Register token getter for all customFetch calls
    setAuthTokenGetter(() => {
      return localStorage.getItem("fiarep_access_token");
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

  const login = async (name: string, code: string) => {
    const res = await loginMutation.mutateAsync({ data: { name, code } });
    localStorage.setItem("fiarep_access_token", res.accessToken);
    localStorage.setItem("fiarep_refresh_token", res.refreshToken);
    setStaff(res.staff);
  };

  const logout = () => {
    localStorage.removeItem("fiarep_access_token");
    localStorage.removeItem("fiarep_refresh_token");
    setStaff(null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        staff,
        isLoading,
        login,
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
