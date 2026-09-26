import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { OutboxStore, type OutboxOperation } from '@/offline/outbox';
import { deriveSyncStatus, type SyncStatusSnapshot } from '@/offline/syncStatus';
import { useConnectivity } from './ConnectivityProvider';
import { useAuth } from './AuthProvider';

type SyncStatusContextValue = SyncStatusSnapshot & {
  operations: OutboxOperation[];
  refresh: () => void;
};

const SyncStatusContext = createContext<SyncStatusContextValue | undefined>(undefined);
const outbox = new OutboxStore();

export function SyncStatusProvider({ children }: PropsWithChildren) {
  const { state } = useConnectivity();
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [operations, setOperations] = useState<OutboxOperation[]>([]);
  const refresh = useCallback(() => {
    void Promise.resolve().then(async () => {
      if (loading || !userId) {
        setOperations([]);
        return;
      }
      try {
        setOperations(await outbox.refresh(userId));
      } catch {
        // Status is advisory. A concurrent owner switch or storage failure
        // must clear the view instead of exposing an unverified operation set.
        setOperations([]);
      }
    });
  }, [loading, userId]);

  useEffect(() => {
    refresh();
    return outbox.subscribe(refresh);
  }, [refresh]);

  const value = useMemo(
    () => ({ ...deriveSyncStatus(state, operations), operations, refresh }),
    [state, operations, refresh],
  );

  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus() {
  const value = useContext(SyncStatusContext);
  if (!value) throw new Error('useSyncStatus must be used inside SyncStatusProvider');
  return value;
}
