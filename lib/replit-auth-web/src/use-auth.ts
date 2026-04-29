import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/user", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    const base =
      (typeof document !== "undefined"
        ? document.querySelector("base")?.getAttribute("href")
        : null) ||
      window.location.pathname.replace(/[^/]*$/, "") ||
      "/";
    const trimmed = base.replace(/\/+$/, "") || "/";
    const url = `/api/login?returnTo=${encodeURIComponent(trimmed)}`;
    // Break out of any embedding iframe (Replit preview) so the OIDC flow
    // runs in the top-level window, where cookies/state work reliably.
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = url;
        return;
      }
    } catch {
      // Cross-origin top — fall back to opening in a new tab.
      window.open(url, "_blank", "noopener");
      return;
    }
    window.location.href = url;
  }, []);

  const logout = useCallback(() => {
    const url = "/api/logout";
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = url;
        return;
      }
    } catch {
      window.open(url, "_blank", "noopener");
      return;
    }
    window.location.href = url;
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
