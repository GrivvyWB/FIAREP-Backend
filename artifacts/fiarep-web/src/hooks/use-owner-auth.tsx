import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { setAuthTokenGetter, usePlatformOwnerLogin } from "@workspace/api-client-react";
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
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loginMutation = usePlatformOwnerLogin();

  useEffect(() => {
    // When inside OwnerAuthProvider, we always provide the owner token
    setAuthTokenGetter(() => {
      return localStorage.getItem("fiarep_owner_access_token");
    });

    const initAuth = () => {
      const accessToken = localStorage.getItem("fiarep_owner_access_token");
      const savedName = localStorage.getItem("fiarep_owner_name");
      
      if (accessToken && savedName) {
        setOwnerName(savedName);
      } else {
        localStorage.removeItem("fiarep_owner_access_token");
        localStorage.removeItem("fiarep_owner_name");
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async (name: string, code: string) => {
    const res = await loginMutation.mutateAsync({ data: { name, code } });
    localStorage.setItem("fiarep_owner_access_token", res.accessToken);
    localStorage.setItem("fiarep_owner_name", name);
    setOwnerName(name);
  };

  const logout = () => {
    localStorage.removeItem("fiarep_owner_access_token");
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
