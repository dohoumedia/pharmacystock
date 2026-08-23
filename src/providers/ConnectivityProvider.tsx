import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { env } from '@/lib/env';

export type ConnectivityState = 'checking' | 'online' | 'offline';

type ConnectivityContextValue = {
  state: ConnectivityState;
  isOnline: boolean;
  lastCheckedAt: number | null;
  refresh: () => Promise<void>;
};

const ConnectivityContext = createContext<ConnectivityContextValue | undefined>(undefined);

function initialState(): ConnectivityState {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') return navigator.onLine ? 'online' : 'offline';
  return 'checking';
}

export function ConnectivityProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<ConnectivityState>(initialState);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      await fetch(`${env.supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: { apikey: env.supabasePublishableKey },
        cache: 'no-store',
      });
      setState('online');
    } catch {
      setState('offline');
    } finally {
      setLastCheckedAt(Date.now());
    }
  }, []);

  useEffect(() => {
    const initialCheck = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), 30000);

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const online = () => void refresh();
      const offline = () => {
        setState('offline');
        setLastCheckedAt(Date.now());
      };
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      return () => {
        clearTimeout(initialCheck);
        clearInterval(interval);
        window.removeEventListener('online', online);
        window.removeEventListener('offline', offline);
      };
    }

    return () => {
      clearTimeout(initialCheck);
      clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ state, isOnline: state === 'online', lastCheckedAt, refresh }),
    [state, lastCheckedAt, refresh],
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity() {
  const value = useContext(ConnectivityContext);
  if (!value) throw new Error('useConnectivity must be used inside ConnectivityProvider');
  return value;
}
