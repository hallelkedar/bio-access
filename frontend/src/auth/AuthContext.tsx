import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import * as authApi from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";
import type { RegisterInput, User } from "../api/types";
import { clearToken, getToken, setToken } from "./tokenStore";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthState {
  user: User | null;
  status: Status;
  /** True after a 401 signed the user out (the login page explains why). */
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [status, setStatus] = useState<Status>(() => (getToken() ? "loading" : "anonymous"));
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const endSession = useCallback((expired: boolean) => {
    clearToken();
    setUser(null);
    setStatus("anonymous");
    setSessionExpired(expired);
  }, []);
  const logout = useCallback(() => endSession(false), [endSession]);

  // Restore the session after a reload. The role comes from the server, never from the JWT itself.
  useEffect(() => {
    if (!getToken()) return;
    let active = true;
    authApi
      .fetchMe()
      .then((me) => {
        if (!active) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        clearToken();
        setStatus("anonymous");
      });
    return () => {
      active = false;
    };
  }, []);

  // Any 401 while logged in (expired token): sign out. ProtectedRoute then sends the user to
  // /login, remembering the page so they come back to it after logging in again.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (userRef.current) endSession(true); // not on a wrong password at the login page itself
    });
    return () => setUnauthorizedHandler(() => {});
  }, [endSession]);

  const login = useCallback(async (email: string, password: string) => {
    setToken(await authApi.login(email, password));
    const me = await authApi.fetchMe();
    setUser(me);
    setStatus("authenticated");
    setSessionExpired(false);
    return me;
  }, []);

  const register = useCallback(
    async (input: RegisterInput) => {
      await authApi.register(input);
      return login(input.email, input.password);
    },
    [login],
  );

  const value = useMemo(
    () => ({ user, status, sessionExpired, login, register, logout }),
    [user, status, sessionExpired, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}
