import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { OutboxStore, type OutboxOperation } from '@/offline/outbox';
import { deriveSyncStatus, type SyncStatusSnapshot } from '@/offline/syncStatus';
import { useConnectivity } from './ConnectivityProvider';

type SyncStatusContextValue = SyncStatusSnapshot & {
  operations: OutboxOperation[];
  refresh: () => void;
};

const SyncStatusContext = createContext<SyncStatusContextValue | undefined>(undefined);
const outbox = new OutboxStore();

export function SyncStatusProvider({ children }: PropsWithChildren) {
  const { state } = useConnectivity();
  const [operations, setOperations] = useState<OutboxOperation[]>(() => outbox.list());
  const refresh = () => setOperations(outbox.list());

  useEffect(() => outbox.subscribe(refresh), []);

  const value = useMemo(
    () => ({ ...deriveSyncStatus(state, operations), operations, refresh }),
    [state, operations],
  );

  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus() {
  const value = useContext(SyncStatusContext);
  if (!value) throw new Error('useSyncStatus must be used inside SyncStatusProvider');
  return value;
}
