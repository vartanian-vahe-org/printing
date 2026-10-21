import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type StaffUser } from './api';

interface AuthState {
  user: StaffUser | null;
  /** True until the first /me check finishes. */
  loading: boolean;
  /** Signs in, or returns a challenge when the account uses two-step sign-in. */
  login: (email: string, password: string) => Promise<{ challenge: string } | null>;
  /** Second step: the 6-digit code for the challenge. */
  verifyCode: (challenge: string, code: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: StaffUser }>('/admin/auth/me')
      .then((data) => setUser(data.user))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ user?: StaffUser; twoFactorRequired?: boolean; challenge?: string }>('/admin/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (data.twoFactorRequired && data.challenge) return { challenge: data.challenge };
    setUser(data.user ?? null);
    return null;
  }, []);

  const verifyCode = useCallback(async (challenge: string, code: string) => {
    const data = await api<{ user: StaffUser }>('/admin/auth/login/verify', { method: 'POST', body: { challenge, code } });
    setUser(data.user);
  }, []);

  const refresh = useCallback(async () => {
    setUser((await api<{ user: StaffUser }>('/admin/auth/me')).user);
  }, []);

  const logout = useCallback(async () => {
    await api('/admin/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, verifyCode, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
