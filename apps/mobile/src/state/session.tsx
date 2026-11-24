import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, SESSION_EXPIRED_MESSAGE } from '@/api/client';
import { logout as apiLogout } from '@/api/hooks/auth';
import { persister } from '@/api/queryClient';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionContextValue {
  status: SessionStatus;
  /** Set when the session ended because the refresh token was rejected. */
  expiredNotice: string | null;
  dismissExpiredNotice: () => void;
  signOut: () => Promise<void>;
  /** Wipe local state after the account was deleted server-side. */
  forgetDevice: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  status: 'loading',
  expiredNotice: null,
  dismissExpiredNotice: () => {},
  signOut: async () => {},
  forgetDevice: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null);

  const wipeCache = useCallback(() => {
    qc.clear();
    Promise.resolve(persister.removeClient()).catch(() => {});
  }, [qc]);

  useEffect(() => {
    let mounted = true;
    api
      .getStoredTokens()
      .then((t) => mounted && setStatus(t ? 'signedIn' : 'signedOut'))
      .catch(() => mounted && setStatus('signedOut'));
    const off = api.onSessionChange((event) => {
      if (event === 'started') {
        setExpiredNotice(null);
        setStatus('signedIn');
        return;
      }
      if (event === 'expired') setExpiredNotice(SESSION_EXPIRED_MESSAGE);
      wipeCache();
      setStatus('signedOut');
    });
    return () => {
      mounted = false;
      off();
    };
  }, [wipeCache]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      expiredNotice,
      dismissExpiredNotice: () => setExpiredNotice(null),
      signOut: () => apiLogout(wipeCache),
      forgetDevice: async () => {
        wipeCache();
        await api.clearSession('logout');
      },
    }),
    [status, expiredNotice, wipeCache],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
