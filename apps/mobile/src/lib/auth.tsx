import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import { unregisterPush } from './push';
import type { SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  token: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    displayName: string;
    username: string;
    password: string;
    ageConfirmed: boolean;
  }) => Promise<{ pending: boolean }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setTok] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const t = await getToken();
    setTok(t);
    if (!t) {
      setUser(null);
      return;
    }
    try {
      const data = await api.get<{ user: SessionUser | null }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: SessionUser; token?: string }>('/api/auth/signin', {
      email,
      password,
    });
    if (data.token) {
      await setToken(data.token);
      setTok(data.token);
    }
    setUser(data.user);
  }, []);

  const signUp = useCallback<AuthState['signUp']>(async (input) => {
    const data = await api.post<{ user?: SessionUser; token?: string; pending?: boolean }>(
      '/api/auth/signup',
      input,
    );
    if (data.token && data.user) {
      await setToken(data.token);
      setTok(data.token);
      setUser(data.user);
      return { pending: false };
    }
    return { pending: true };
  }, []);

  const signOut = useCallback(async () => {
    // Drop this device's push token while the session is still valid.
    await unregisterPush();
    try {
      await api.post('/api/auth/signout');
    } catch {
      // Even if the network call fails, drop the local session.
    }
    await setToken(null);
    setTok(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, token, signIn, signUp, signOut, refresh }),
    [user, loading, token, signIn, signUp, signOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
