"use client";

import { createContext, useContext } from "react";

interface AuthModeContextType {
  /** True when the app runs without authentication (DISABLE_LOGIN=true). */
  disableLogin: boolean;
}

const AuthModeContext = createContext<AuthModeContextType | undefined>(undefined);

export function AuthModeProvider({
  disableLogin,
  children
}: {
  disableLogin: boolean;
  children: React.ReactNode;
}) {
  return <AuthModeContext.Provider value={{ disableLogin }}>{children}</AuthModeContext.Provider>;
}

export function useAuthMode(): AuthModeContextType {
  const ctx = useContext(AuthModeContext);
  if (!ctx) {
    // Safe default for callers rendered outside the provider (e.g. in tests).
    return { disableLogin: false };
  }
  return ctx;
}
