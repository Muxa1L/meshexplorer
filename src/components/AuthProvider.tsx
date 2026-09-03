"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuthUser } from "@/types/auth";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return (data?.user as AuthUser) ?? null;
}

/**
 * Provides the signed-in user (via /api/auth/me) to the authenticated app
 * shell. Middleware already guarantees a session for these pages; this
 * context exposes the user's identity and role to the UI.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchCurrentUser,
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      // Full navigation so middleware re-runs and the session cookie is gone.
      window.location.href = "/login";
    }
  }, []);

  const value = useMemo(
    () => ({ user: data ?? null, isLoading, logout }),
    [data, isLoading, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}