import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, setTokenSource } from './api-client';
import { resetTrackingSocket } from './tracking';
import type { Role, Session, User } from './types';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: User | null;
  login(email: string, password: string): Promise<User>;
  register(fullName: string, email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  hasRole(...roles: Role[]): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The access token lives only in memory (never localStorage), so injected scripts cannot read
 * it from storage. The session survives a reload through the httpOnly refresh cookie.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const token = useRef<string | null>(null);
  const renewTimer = useRef<number>();
  const inflightRefresh = useRef<Promise<string | null> | null>(null);
  const userId = useRef<string | null>(null);

  const apply = useCallback((session: Session | null) => {
    window.clearTimeout(renewTimer.current);
    token.current = session?.accessToken ?? null;
    // Logout or another account: the realtime socket must not keep the previous identity.
    const nextUserId = session?.user.id ?? null;
    if (nextUserId !== userId.current) {
      userId.current = nextUserId;
      resetTrackingSocket();
    }
    setUser(session?.user ?? null);
    setStatus(session ? 'authenticated' : 'anonymous');
  }, []);

  // Several requests may hit 401 at once: they all wait for the same single refresh call.
  const refresh = useCallback((): Promise<string | null> => {
    inflightRefresh.current ??= api<Session | null>('/auth/refresh', {
      method: 'POST',
      retryOnUnauthorized: false,
    })
      .then((session) => {
        apply(session);
        if (!session) return null; // 204: guest without a session cookie
        scheduleRenewal(session.expiresIn);
        return session.accessToken;
      })
      .catch(() => {
        apply(null);
        return null;
      })
      .finally(() => {
        inflightRefresh.current = null;
      });
    return inflightRefresh.current;

    function scheduleRenewal(expiresInSeconds: number) {
      const delay = Math.max(expiresInSeconds - 60, 30) * 1000;
      renewTimer.current = window.setTimeout(() => void refresh(), delay);
    }
  }, [apply]);

  useEffect(() => {
    setTokenSource({ current: () => token.current, refresh });
    void refresh();
    return () => window.clearTimeout(renewTimer.current);
  }, [refresh]);

  const startSession = useCallback(
    (session: Session) => {
      apply(session);
      renewTimer.current = window.setTimeout(
        () => void refresh(),
        Math.max(session.expiresIn - 60, 30) * 1000,
      );
      return session.user;
    },
    [apply, refresh],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: async (email, password) =>
        startSession(
          await api<Session>('/auth/login', {
            method: 'POST',
            body: { email, password },
            retryOnUnauthorized: false,
          }),
        ),
      register: async (fullName, email, password) =>
        startSession(
          await api<Session>('/auth/register', {
            method: 'POST',
            body: { fullName, email, password },
            retryOnUnauthorized: false,
          }),
        ),
      logout: async () => {
        await api('/auth/logout', { method: 'POST', retryOnUnauthorized: false }).catch(() => null);
        apply(null);
      },
      hasRole: (...roles) => !!user && roles.includes(user.role),
    }),
    [status, user, startSession, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
