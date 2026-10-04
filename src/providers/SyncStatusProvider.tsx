import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { replayPendingSales } from '@/offline/offlinePos';
import { OutboxStore, type OutboxOperation } from '@/offline/outbox';
import { OutboxReplayScheduler } from '@/offline/replayScheduler';
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
  const replayScheduler = useMemo(() => userId ? new OutboxReplayScheduler(
    outbox,
    (context) => replayPendingSales(outbox, {
      expectedOwnerId: context.expectedOwnerId,
      canReplay: context.isCurrent,
    }),
    { expectedOwnerId: userId },
  ) : null, [userId]);
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

  useEffect(() => {
    if (loading || !replayScheduler || state !== 'online') return;
    replayScheduler.start();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') replayScheduler.wake();
    });
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') replayScheduler.wake();
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      appStateSubscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      replayScheduler.stop();
    };
  }, [loading, replayScheduler, state]);

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
