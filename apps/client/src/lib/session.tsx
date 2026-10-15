import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type SessionUser } from './api';

/**
 * Session context. The token lives in an httpOnly cookie, so this holds only the
 * identity and permission list the UI needs to decide what to show.
 *
 * Hiding a control the user lacks permission for is a courtesy, not a control — the
 * server checks every request regardless.
 */

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Access cookies last 15 minutes. Refresh before that so an open editor does
  // not 401 the next draft save, and again when the tab comes back to the front
  // after Chrome has frozen background timers.
  useEffect(() => {
    if (!user) return;

    const refresh = () => {
      void api.auth.refresh();
    };
    const interval = window.setInterval(refresh, 10 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    await api.auth.login(email, password);
    setUser(await api.auth.me());
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const can = useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user],
  );

  return (
    <SessionContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}
